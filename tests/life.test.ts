import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "../lib/auth";
import { db, migrateApp } from "../lib/database";
import {
  confirm,
  confirmToken,
  disable,
  life,
  nextMonth,
  tick,
  DAY,
  REPLY_WINDOW,
} from "../lib/life";
import { decrypt, encrypt, tokenHash } from "../lib/crypto";
import { validateMessage } from "../lib/validation";
import type { Mail } from "../lib/mail";

const directory = mkdtempSync(join(tmpdir(), "nachklang-test-"));
const now = Date.now();
process.env.DATABASE_PATH = join(directory, "test.sqlite");
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("hex");
process.env.MESSAGE_ENCRYPTION_KEY = "b".repeat(64);
process.env.BETTER_AUTH_URL = "http://localhost:3000";
const payload = {
  recipientName: "Ada",
  recipientEmail: "ada@example.test",
  body: "Danke für alles.",
};
const mails: Mail[] = [];
const deliver = async (mail: Mail) => {
  mails.push(mail);
};

before(async () => {
  await (await getMigrations(authOptions())).runMigrations();
  migrateApp();
});
beforeEach(() => {
  db().exec(
    "DELETE FROM event; DELETE FROM message; DELETE FROM life; DELETE FROM user;",
  );
  db()
    .prepare(
      "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)",
    )
    .run("owner", "Sam", "sam@example.test", 1, now, now);
  db()
    .prepare("UPDATE worker SET last_tick = ?, lease_until = 0 WHERE id = 1")
    .run(now);
  mails.length = 0;
});
after(() => {
  db().close();
  rmSync(directory, { recursive: true, force: true });
});

function addMessage(
  id = "message",
  ready = 1,
  deliveryDate: string | null = null,
) {
  db()
    .prepare(
      "INSERT INTO message(id,user_id,payload,delivery_date,ready,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(id, "owner", encrypt(payload), deliveryDate, ready, now, now);
}
function awaiting(deadline = now) {
  life("owner");
  db()
    .prepare(
      "UPDATE life SET state = 'awaiting', deadline = ?, token_hash = ? WHERE user_id = 'owner'",
    )
    .run(deadline, tokenHash("a".repeat(64)));
}

test("calendar months clamp at month-end and keep the time", () => {
  assert.equal(
    new Date(nextMonth(Date.parse("2028-01-31T12:30:00Z"))).toISOString(),
    "2028-02-29T12:30:00.000Z",
  );
  assert.equal(
    new Date(nextMonth(Date.parse("2027-01-31T12:30:00Z"))).toISOString(),
    "2027-02-28T12:30:00.000Z",
  );
});
test("messages are encrypted and tampering is rejected", () => {
  const encrypted = encrypt(payload);
  assert.ok(!encrypted.includes(payload.body));
  assert.deepEqual(decrypt(encrypted), payload);
  const data = Buffer.from(encrypted, "base64");
  data[30] ^= 1;
  assert.throws(() => decrypt(data.toString("base64")));
});
test("trust boundaries reject malformed addresses, dates and incomplete release", () => {
  assert.throws(() =>
    validateMessage({
      ...payload,
      recipientEmail: "a@b.test\r\nBcc: x@y.test",
      ready: true,
    }),
  );
  assert.throws(() =>
    validateMessage({ ...payload, deliveryDate: "2026-02-30", ready: true }),
  );
  assert.throws(() => validateMessage({ ...payload, body: " ", ready: true }));
  assert.equal(validateMessage({ ...payload, ready: false }).ready, false);
});
test("accounts start disabled; enabling starts a monthly interval", () => {
  assert.equal(life("owner").state, "disabled");
  confirm("owner", now);
  assert.equal(life("owner").next_check, nextMonth(now));
  disable("owner");
  assert.equal(life("owner").state, "disabled");
});
test("successful check creates a seven-day reply window and single-use token", async () => {
  confirm("owner", now - 40 * DAY);
  await tick(now, deliver);
  assert.equal(mails.length, 1);
  assert.equal(life("owner").state, "awaiting");
  assert.equal(life("owner").deadline, now + REPLY_WINDOW);
  const token = mails[0].text.match(/token=([a-f0-9]{64})/)![1];
  assert.notEqual(life("owner").token_hash, token);
  assert.equal(confirmToken(token, now), true);
  assert.equal(confirmToken(token, now), false);
  assert.equal(life("owner").state, "active");
});
test("failed check email cannot release recipient messages", async () => {
  confirm("owner", now - 40 * DAY);
  addMessage();
  await tick(now, async () => {
    throw new Error("SMTP unavailable");
  });
  assert.equal(life("owner").state, "active");
  assert.equal(life("owner").deadline, null);
  assert.equal(
    (db().prepare("SELECT status FROM message").get() as { status: string })
      .status,
    "pending",
  );
});
test("expired checks deliver ready messages once, respecting future dates and drafts", async () => {
  awaiting();
  addMessage();
  addMessage("draft", 0);
  addMessage("future", 1, "2099-01-01");
  await tick(now, deliver);
  await tick(now + 1, deliver);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, payload.recipientEmail);
  assert.equal(
    (
      db().prepare("SELECT status FROM message WHERE id = 'message'").get() as {
        status: string;
      }
    ).status,
    "sent",
  );
});
test("confirmation cancels an expired check before dispatch", async () => {
  awaiting();
  addMessage();
  confirm("owner", now);
  await tick(now, deliver);
  assert.equal(mails.length, 0);
});
test("confirmation between recipient messages stops the remaining dispatch", async () => {
  awaiting();
  addMessage("first");
  addMessage("second");
  await tick(now, async (mail) => {
    mails.push(mail);
    confirm("owner", now);
  });
  assert.equal(mails.length, 1);
});
test("outage resets released state and requires a fresh successful check", async () => {
  awaiting();
  addMessage();
  db()
    .prepare("UPDATE life SET state = 'released' WHERE user_id = 'owner'")
    .run();
  db()
    .prepare("UPDATE worker SET last_tick = ?")
    .run(now - 2 * 60 * 60_000);
  await tick(now, deliver);
  assert.equal(life("owner").state, "awaiting");
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, "sam@example.test");
});
test("ambiguous transport failure is not automatically retried", async () => {
  awaiting();
  addMessage();
  let attempts = 0;
  await tick(now, async () => {
    attempts++;
    throw new Error("Connection closed after DATA");
  });
  await tick(now + 1, deliver);
  assert.equal(attempts, 1);
  assert.equal(mails.length, 0);
  assert.equal(
    (db().prepare("SELECT status FROM message").get() as { status: string })
      .status,
    "failed",
  );
});
test("worker lease prevents overlapping jobs", async () => {
  awaiting();
  addMessage();
  db()
    .prepare("UPDATE worker SET lease_until = ?")
    .run(now + DAY);
  await tick(now, deliver);
  assert.equal(mails.length, 0);
});
test("deleting a user cascades to encrypted messages and state", () => {
  awaiting();
  addMessage();
  db().prepare("DELETE FROM user WHERE id = 'owner'").run();
  assert.equal(db().prepare("SELECT * FROM message").all().length, 0);
  assert.equal(db().prepare("SELECT * FROM life").all().length, 0);
});
