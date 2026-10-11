import { randomBytes } from "node:crypto";
import { db } from "./database";
import { decrypt, tokenHash } from "./crypto";
import { appUrl } from "./config";
import { sendMail, mailFailure, type Mail } from "./mail";

export const DAY = 86_400_000;
export const REPLY_WINDOW = 7 * DAY;
const OUTAGE_WINDOW = 60 * 60_000;
const LEASE_WINDOW = 5 * 60_000;
export type Life = {
  user_id: string;
  state: "disabled" | "active" | "awaiting" | "released";
  next_check: number | null;
  deadline: number | null;
  confirmed_at: number | null;
  released_at: number | null;
  token_hash: string | null;
  check_sent_at: number | null;
  check_inflight: number | null;
  check_failed_at: number | null;
  reminder_stage: number | null;
};
export type Payload = {
  recipientName: string;
  recipientEmail: string;
  body: string;
};
export type MessageRow = {
  id: string;
  user_id: string;
  payload: string;
  delivery_date: string | null;
  ready: number;
  status: "pending" | "sending" | "sent" | "failed";
  created_at: number;
  updated_at: number;
  sent_at: number | null;
  revision: number;
  release_token: string | null;
  release_context: string | null;
  release_expires: number | null;
  failure_kind: "rejected" | "unknown" | null;
  failure_reason: string | null;
  dispatch_owner: string | null;
};

export function nextMonth(now: number) {
  const date = new Date(now);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.getTime();
}
export function event(userId: string, kind: string, now = Date.now()) {
  db()
    .prepare(
      "INSERT INTO event(user_id, kind, created_at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM user WHERE id = ?)",
    )
    .run(userId, kind, now, userId);
}
export function life(userId: string): Life {
  db().prepare("INSERT OR IGNORE INTO life(user_id) VALUES (?)").run(userId);
  return db()
    .prepare("SELECT * FROM life WHERE user_id = ?")
    .get(userId) as Life;
}
export function confirm(userId: string, now = Date.now()) {
  db().transaction(() => {
    life(userId);
    db()
      .prepare(
        "UPDATE life SET state = 'active', next_check = ?, deadline = NULL, token_hash = NULL, confirmed_at = ?, released_at = NULL, check_inflight = NULL, reminder_stage = NULL WHERE user_id = ?",
      )
      .run(nextMonth(now), now, userId);
    event(userId, "confirmed", now);
  })();
}
export function disable(userId: string) {
  db().transaction(() => {
    life(userId);
    db()
      .prepare(
        "UPDATE life SET state = 'disabled', next_check = NULL, deadline = NULL, token_hash = NULL, released_at = NULL, check_inflight = NULL, reminder_stage = NULL WHERE user_id = ?",
      )
      .run(userId);
    event(userId, "disabled");
  })();
}
export function confirmToken(token: string, now = Date.now()) {
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  return db().transaction(() => {
    const row = db()
      .prepare(
        "SELECT * FROM life WHERE token_hash = ? AND state IN ('awaiting', 'released')",
      )
      .get(tokenHash(token)) as Life | undefined;
    if (!row) return false;
    confirm(row.user_id, now);
    return true;
  })();
}

export async function tick(
  now = Date.now(),
  deliver: (mail: Mail) => Promise<void> = sendMail,
) {
  const owner = randomBytes(16).toString("hex");
  const acquired = db().transaction(() => {
    const worker = db().prepare("SELECT * FROM worker WHERE id = 1").get() as {
      last_tick: number | null;
      lease_until: number;
    };
    if (worker.lease_until > now) return false;
    // SMTP may have accepted a message before a crashed process could record success.
    db()
      .prepare("UPDATE message SET status = 'failed', failure_kind = 'unknown', failure_reason = 'Unterbrochene SMTP-Übergabe; Annahme unklar.', dispatch_owner = NULL WHERE status = 'sending'")
      .run();
    // An interrupted check send must never leave a countdown running.
    db()
      .prepare(
        "UPDATE life SET token_hash = NULL, deadline = NULL, check_inflight = NULL, next_check = ? WHERE state = 'active' AND check_inflight = 1",
      )
      .run(now);
    if (!worker.last_tick || now - worker.last_tick > OUTAGE_WINDOW) {
      const rows = db()
        .prepare(
          "SELECT user_id FROM life WHERE state IN ('awaiting','released')",
        )
        .all() as { user_id: string }[];
      for (const row of rows) {
        db()
          .prepare(
            "UPDATE life SET state = 'active', next_check = ?, deadline = NULL, token_hash = NULL, released_at = NULL, check_inflight = NULL, reminder_stage = NULL WHERE user_id = ?",
          )
          .run(now, row.user_id);
        event(row.user_id, "outage_reset", now);
      }
    }
    db()
      .prepare("UPDATE worker SET last_tick = ?, lease_until = ?, lease_owner = ? WHERE id = 1")
      .run(now, now + LEASE_WINDOW, owner);
    return true;
  })();
  if (!acquired) return;
  const owns = () => !!db().prepare("SELECT 1 FROM worker WHERE id=1 AND lease_owner=?").get(owner);
  const renew = () => db().prepare("UPDATE worker SET lease_until = ? WHERE id = 1 AND lease_owner = ?").run(Math.max(now, Date.now()) + LEASE_WINDOW, owner).changes > 0;
  try {
    // Only an explicit receipt for a probe requested after the failure proves recovery.
    db().prepare("UPDATE life SET check_failed_at = NULL WHERE check_failed_at IS NOT NULL AND EXISTS (SELECT 1 FROM mail_probe WHERE mail_probe.user_id = life.user_id AND requested_at > life.check_failed_at AND received_at > life.check_failed_at)").run();
    db().prepare("UPDATE life SET state='disabled', next_check=NULL, deadline=NULL, token_hash=NULL, released_at=NULL WHERE check_failed_at IS NOT NULL").run();
    const checks = db()
      .prepare(
        "SELECT life.*, user.email FROM life JOIN user ON user.id = life.user_id WHERE state = 'active' AND next_check <= ? AND user.emailVerified = 1",
      )
      .all(now) as (Life & { email: string })[];
    for (const check of checks) {
      if (!renew()) return;
      const token = randomBytes(32).toString("hex");
      const hash = tokenHash(token);
      const claimed = db()
        .prepare(
          "UPDATE life SET token_hash = ?, deadline = NULL, check_inflight = 1 WHERE user_id = ? AND state = 'active' AND next_check <= ? AND check_failed_at IS NULL AND EXISTS (SELECT 1 FROM worker WHERE id=1 AND lease_owner=?)",
        )
        .run(hash, check.user_id, now, owner);
      if (!claimed.changes) continue;
      try {
        await deliver({
          to: check.email,
          subject: "Nachklang: Bitte bestätige, dass es dir gut geht",
          text: `Bitte bestätige innerhalb von sieben Tagen, dass du noch lebst. Ohne Bestätigung gibt Nachklang deine vorbereiteten Nachrichten zum Versand frei.\n\n${appUrl()}/confirm?token=${token}\n\nDer Link öffnet zunächst eine Bestätigungsseite. Alternativ kannst du dich im Dashboard melden.`,
        });
        if (!owns()) return;
        const started = db()
          .prepare(
            "UPDATE life SET state = 'awaiting', deadline = ?, check_sent_at = ?, check_inflight = NULL, reminder_stage = 0 WHERE user_id = ? AND state = 'active' AND token_hash = ? AND check_inflight = 1 AND check_failed_at IS NULL AND EXISTS (SELECT 1 FROM worker WHERE id=1 AND lease_owner=?)",
          )
          .run(now + REPLY_WINDOW, now, check.user_id, hash, owner);
        if (started.changes) event(check.user_id, "check_sent", now);
      } catch {
        if (!owns()) return;
        db()
          .prepare(
            "UPDATE life SET state = 'active', next_check = ?, deadline = NULL, token_hash = NULL, check_inflight = NULL, check_failed_at = ? WHERE user_id = ? AND token_hash = ? AND EXISTS (SELECT 1 FROM worker WHERE id=1 AND lease_owner=?)",
          )
          .run(now + 15 * 60_000, now, check.user_id, hash, owner);
        db().prepare("UPDATE life SET check_failed_at = MAX(COALESCE(check_failed_at, 0), ?) WHERE user_id = ? AND EXISTS (SELECT 1 FROM worker WHERE id=1 AND lease_owner=?)").run(now, check.user_id, owner);
        event(check.user_id, "check_failed", now);
      }
    }
    const reminders = db()
      .prepare(
        "SELECT life.*, user.email FROM life JOIN user ON user.id = life.user_id WHERE state = 'awaiting' AND deadline > ? AND deadline <= ?",
      )
      .all(now, now + 4 * DAY) as (Life & { email: string })[];
    for (const check of reminders) {
      const stage = check.deadline! - now <= DAY ? 2 : 1;
      if ((check.reminder_stage || 0) >= stage) continue;
      if (!renew()) return;
      try {
        await deliver({
          to: check.email,
          subject: "Nachklang: Dein Countdown läuft – bitte melde dich",
          text: `Dein Lebenszeichen fehlt. Die Antwortfrist endet am ${new Date(check.deadline!).toISOString()}. Stoppe den Countdown direkt im Dashboard: ${appUrl()}/dashboard

Dort kannst du auch die monatliche Prüfung vollständig pausieren.`,
        });
        if (!owns()) return;
        db()
          .prepare(
            "UPDATE life SET reminder_stage = ? WHERE user_id = ? AND state = 'awaiting' AND token_hash = ? AND EXISTS (SELECT 1 FROM worker WHERE id=1 AND lease_owner=?)",
          )
          .run(stage, check.user_id, check.token_hash, owner);
        event(check.user_id, "reminder_sent", now);
      } catch {
        if (!owns()) return;
        // A known delivery problem must not release personal messages.
        const stopped = db()
          .prepare(
            "UPDATE life SET state = 'disabled', deadline = NULL, next_check = NULL, token_hash = NULL, check_failed_at = ? WHERE user_id = ? AND state = 'awaiting' AND token_hash = ? AND EXISTS (SELECT 1 FROM worker WHERE id=1 AND lease_owner=?)",
          )
          .run(now, check.user_id, check.token_hash, owner);
        // Preserve a concurrent pause/confirmation, but never lose its unresolved transport failure.
        const recorded = db().prepare("UPDATE life SET check_failed_at = MAX(COALESCE(check_failed_at, 0), ?) WHERE user_id = ? AND EXISTS (SELECT 1 FROM worker WHERE id=1 AND lease_owner=?)").run(now, check.user_id, owner);
        if (stopped.changes || recorded.changes) event(check.user_id, "reminder_failed", now);
      }
    }
    if (!owns()) return;
    db().transaction(() => {
      const expired = db()
        .prepare(
          "SELECT user_id FROM life WHERE state = 'awaiting' AND deadline <= ?",
        )
        .all(now) as { user_id: string }[];
      for (const row of expired) {
        db()
          .prepare(
            "UPDATE life SET state = 'released', released_at = ? WHERE user_id = ?",
          )
          .run(now, row.user_id);
        event(row.user_id, "released", now);
      }
    })();
    const messages = db()
      .prepare(
        "SELECT message.* FROM message JOIN life ON life.user_id = message.user_id JOIN user ON user.id = message.user_id WHERE life.state = 'released' AND user.emailVerified = 1 AND ready = 1 AND status = 'pending' AND (delivery_date IS NULL OR delivery_date <= ?)",
      )
      .all(new Date(now).toISOString().slice(0, 10)) as MessageRow[];
    for (const message of messages) {
      if (!renew()) return;
      const claimed = db()
        .prepare(
          "UPDATE message SET status = 'sending', dispatch_owner = ? WHERE id = ? AND status = 'pending' AND ready = 1 AND revision = ? AND payload = ? AND EXISTS (SELECT 1 FROM life WHERE user_id = message.user_id AND state = 'released' AND check_failed_at IS NULL) AND EXISTS (SELECT 1 FROM user WHERE id = message.user_id AND emailVerified = 1) AND EXISTS (SELECT 1 FROM worker WHERE id=1 AND lease_owner=?)",
        )
        .run(owner, message.id, message.revision, message.payload, owner);
      if (!claimed.changes) continue;
      try {
        const current = db().prepare("SELECT payload FROM message WHERE id = ? AND status = 'sending'").get(message.id) as { payload: string };
        const payload = decrypt<Payload>(current.payload);
        const sender = db()
          .prepare("SELECT name FROM user WHERE id = ?")
          .get(message.user_id) as { name: string };
        await deliver({
          to: payload.recipientEmail,
          subject: `Eine Nachricht von ${sender.name.replace(/[\r\n]/g, " ")}`,
          messageId: `<${message.id}@${new URL(appUrl()).hostname}>`,
          text: `${payload.body}\n\n—\nDiese Nachricht wurde von ${sender.name} bei Nachklang hinterlegt. Der Versand wurde durch eine ausgebliebene Lebensbestätigung ausgelöst; dies ist keine amtliche Bestätigung eines Todesfalls.`,
        });
        if (!owns()) return;
        db()
          .prepare(
            "UPDATE message SET status = 'sent', sent_at = ? WHERE id = ? AND status = 'sending' AND dispatch_owner = ? AND EXISTS (SELECT 1 FROM worker WHERE id=1 AND lease_owner = ?)",
          )
          .run(now, message.id, owner, owner);
        event(message.user_id, "message_sent", now);
      } catch (error) {
        if (!owns()) return;
        const failure = mailFailure(error);
        db()
          .prepare("UPDATE message SET status = 'failed', failure_kind = ?, failure_reason = ? WHERE id = ? AND status = 'sending' AND dispatch_owner = ? AND EXISTS (SELECT 1 FROM worker WHERE id=1 AND lease_owner = ?)")
          .run(failure.kind, failure.reason, message.id, owner, owner);
        event(message.user_id, "message_failed", now);
      }
    }
  } finally {
    db()
      .prepare("UPDATE worker SET last_tick = ?, lease_until = 0, lease_owner = NULL WHERE id = 1 AND lease_owner = ?")
      .run(now, owner);
  }
}
