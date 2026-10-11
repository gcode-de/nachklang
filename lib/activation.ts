import { randomBytes } from "node:crypto";
import { db } from "./database";
import { tokenHash } from "./crypto";
import { life, nextMonth, confirm, event } from "./life";

function readiness(userId: string, now: number) {
  const owner = db().prepare("SELECT email, emailVerified FROM user WHERE id = ?").get(userId) as { email: string; emailVerified: number };
  if (!owner?.emailVerified) throw new Error("Bitte bestätige zuerst deine Konto-E-Mail-Adresse.");
  const worker = db().prepare("SELECT last_tick FROM worker WHERE id = 1").get() as { last_tick: number | null };
  if (!worker.last_tick || now - worker.last_tick > 60 * 60_000 || worker.last_tick > now + 60_000) throw new Error("Prüfjob nicht aktuell. Bitte den Betreiber bitten, den Worker zu starten, und erneut prüfen.");
  const probe = db().prepare("SELECT requested_at, accepted_at, received_at FROM mail_probe WHERE user_id = ?").get(userId) as { requested_at: number; accepted_at: number | null; received_at: number | null } | undefined;
  const failure = life(userId).check_failed_at;
  if (failure && (!probe?.received_at || probe.requested_at <= failure || probe.received_at <= failure)) throw new Error("Mailproblem: Bitte zuerst den Empfang einer neuen Testmail bestätigen.");
  const messages = db().prepare("SELECT id, revision, ready, status FROM message WHERE user_id = ? ORDER BY id").all(userId) as { ready: number; status: string }[];
  return { email: owner.email, received: !!probe?.received_at, releasedCount: messages.filter(m => m.ready && m.status === "pending").length, draftCount: messages.filter(m => !m.ready && m.status === "pending").length, context: JSON.stringify([owner.email, probe || null, messages, life(userId).state]) };
}
export function reviewActivation(userId: string, now = Date.now()) {
  return db().transaction(() => {
    if (life(userId).state !== "disabled") throw new Error("Die Prüfung ist bereits aktiv. Bitte Status neu laden.");
    const state = readiness(userId, now);
    const token = randomBytes(32).toString("hex");
    const nextCheck = nextMonth(now);
    db().prepare("INSERT INTO activation_review(user_id, token_hash, context, reviewed_at, expires_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash, context=excluded.context, reviewed_at=excluded.reviewed_at, expires_at=excluded.expires_at").run(userId, tokenHash(token), state.context, now, now + 5 * 60_000);
    const { context, ...publicState } = state;
    return { ...publicState, token, nextCheck, replyDays: 7, workerHealthy: true };
  })();
}
export function activate(userId: string, input: Record<string, unknown>, now = Date.now()) {
  db().transaction(() => {
    const review = db().prepare("SELECT * FROM activation_review WHERE user_id = ?").get(userId) as { token_hash: string; context: string; reviewed_at: number; expires_at: number } | undefined;
    if (!review || input.confirmed !== true || typeof input.token !== "string" || !/^[a-f0-9]{64}$/.test(input.token) || tokenHash(input.token) !== review.token_hash || now > review.expires_at) throw new Error("Bitte die Aktivierung erneut prüfen und ausdrücklich bestätigen.");
    const state = readiness(userId, now);
    if (life(userId).state !== "disabled" || review.context !== state.context) throw new Error("Bereitschaft geändert. Bitte erneut prüfen.");
    if (!state.received && input.bypassReceipt !== true) throw new Error("Empfang unbestätigt. Testmail im eigenen Postfach bestätigen oder das Risiko ausdrücklich anerkennen.");
    confirm(userId, review.reviewed_at);
    if (!state.received) event(userId, "receipt_warning_accepted");
    db().prepare("DELETE FROM activation_review WHERE user_id = ?").run(userId);
  })();
}
