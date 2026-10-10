import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, migrateApp } from "../lib/database";
import {
  recordMailFailure,
  flushAdminAlerts,
  sendTelegram,
} from "../lib/admin-alerts";
import { sendMail } from "../lib/mail";
const directory = mkdtempSync(join(tmpdir(), "nachklang-alerts-"));
process.env.DATABASE_PATH = join(directory, "test.sqlite");
process.env.BETTER_AUTH_URL = "http://localhost:3000";
const now = Date.now();
const sent: { chat_id: string; text: string }[] = [];
const request: typeof fetch = async (_url, options) => {
  sent.push(JSON.parse(String(options?.body)));
  return Response.json({ ok: true });
};
const state = () =>
  db().prepare("SELECT * FROM admin_alert WHERE id = 1").get() as {
    pending_count: number;
    last_sent: number | null;
  };
before(() => {
  db().exec("CREATE TABLE user(id TEXT PRIMARY KEY)");
  migrateApp();
});
beforeEach(() => {
  db().exec("DELETE FROM admin_alert");
  sent.length = 0;
  process.env.TELEGRAM_BOT_TOKEN = "123456:fake-token-for-tests";
  process.env.TELEGRAM_CHAT_ID = "-123456";
});
after(() => {
  db().close();
  rmSync(directory, { recursive: true, force: true });
});
test("alerts batch failures and preserve new failures while sending", async () => {
  recordMailFailure(now);
  recordMailFailure(now + 1);
  await flushAdminAlerts(now + 2, async (url, options) => {
    assert.equal(
      String(url),
      "https://api.telegram.org/bot123456:fake-token-for-tests/sendMessage",
    );
    recordMailFailure(now + 3);
    return request(url, options);
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat_id, "-123456");
  assert.match(sent[0].text, /2 fehlgeschlagene Versandversuche/);
  assert.ok(!sent[0].text.includes("fake-token"));
  assert.equal(state().pending_count, 1);
  await flushAdminAlerts(now + 4, request);
  assert.equal(sent.length, 1);
  await flushAdminAlerts(now + 10 * 60_000 + 2, request);
  assert.equal(sent.length, 2);
  assert.equal(state().pending_count, 0);
});
test("Telegram outage keeps alerts for retry, including API ok:false", async () => {
  recordMailFailure(now);
  await flushAdminAlerts(now, async () => Response.json({ ok: false }));
  assert.equal(state().pending_count, 1);
  await flushAdminAlerts(now + 1, request);
  assert.equal(sent.length, 0);
  await flushAdminAlerts(now + 10 * 60_000, request);
  assert.equal(state().pending_count, 0);
});
test("missing Telegram config keeps failures queued without network calls", async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  recordMailFailure(now);
  await flushAdminAlerts(now, request);
  assert.equal(sent.length, 0);
  assert.equal(state().pending_count, 1);
});
test("send errors never expose bot tokens", async () => {
  await assert.rejects(
    sendTelegram("Test", async () => {
      throw new Error("URL with fake-token-for-tests");
    }),
    (error) =>
      error instanceof Error &&
      error.message === "Telegram-Alarm konnte nicht zugestellt werden.",
  );
});
test("all SMTP failures are queued centrally and preserve the SMTP error", async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.SMTP_HOST;
  await assert.rejects(
    sendMail({
      to: "private@example.test",
      subject: "Private subject",
      text: "Private body",
    }),
    /SMTP_HOST/,
  );
  assert.equal(state().pending_count, 1);
  process.env.TELEGRAM_BOT_TOKEN = "123456:fake-token-for-tests";
  await flushAdminAlerts(now + 1, request);
  assert.ok(!sent[0].text.includes("private@example.test"));
  assert.ok(!sent[0].text.includes("Private body"));
});
