import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMigrations } from "better-auth/db/migration";
import { betterAuth } from "better-auth";
import { hashPassword } from "better-auth/crypto";
import { getCurrentAdapter } from "@better-auth/core/context";
import Database from "better-sqlite3";
import { auth, authOptions } from "../lib/auth";
import { db, migrateApp } from "../lib/database";
import { GET, POST } from "../app/api/dashboard/route";
import { POST as confirmRoute } from "../app/api/confirm/route";
import { life, tick, DAY } from "../lib/life";
import { readJson } from "../lib/request";

const directory = mkdtempSync(join(tmpdir(), "nachklang-auth-"));
process.env.DATABASE_PATH = join(directory, "test.sqlite");
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("hex");
process.env.MESSAGE_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_FROM = "Nachklang <local@example.test>";
process.env.SMTP_ALLOW_INSECURE = "true";
const received: string[] = [];
let onMailReceived: (() => void) | undefined;
const sockets = new Set<Socket>();
// Minimal local SMTP sink: no external delivery and no extra test dependency.
const server = createServer((socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.write("220 localhost test SMTP\r\n");
  let buffer = "",
    data = false,
    body = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    while (buffer.includes("\r\n")) {
      const index = buffer.indexOf("\r\n");
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (data) {
        if (line === ".") {
          onMailReceived?.();
          received.push(body);
          body = "";
          data = false;
          socket.write("250 accepted\r\n");
        } else body += line.replace(/^\.\./, ".") + "\r\n";
      } else if (/^(EHLO|HELO)/.test(line))
        socket.write("250-localhost\r\n250 SIZE 200000\r\n");
      else if (line === "DATA") {
        data = true;
        socket.write("354 send data\r\n");
      } else if (line === "QUIT") socket.end("221 bye\r\n");
      else socket.write("250 ok\r\n");
    }
  });
});

const password = "test-password-only-2026!";
let clientIp = "192.0.2.10";
function request(
  path: string,
  body?: unknown,
  cookie = "",
  origin = "http://localhost:3000",
) {
  return new Request(`http://localhost:3000${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      origin,
      cookie,
      "cf-connecting-ip": clientIp,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}
function mailUrl(index: number, expression: RegExp) {
  const text = received[index]
    .replace(/=\r\n/g, "")
    .replace(/=([A-F0-9]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
  return text.match(expression)![0].trim();
}
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.SMTP_PORT = String((server.address() as { port: number }).port);
  await (await getMigrations(authOptions())).runMigrations();
  migrateApp();
});
after(async () => {
  await auth().$context;
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db().close();
  rmSync(directory, { recursive: true, force: true });
});

test("registration reserves the writer before hashing and releases it before SMTP", async () => {
  const writer = new Database(process.env.DATABASE_PATH!);
  writer.pragma("busy_timeout = 0");
  let blockedDuringHash = false;
  let mailWriteError: unknown;
  let wroteDuringMail = false;
  const options = authOptions();
  const isolatedAuth = betterAuth({
    ...options,
    emailAndPassword: {
      ...options.emailAndPassword,
      password: {
        hash: async (value) => {
          const adapter = await getCurrentAdapter((await isolatedAuth.$context).adapter);
          await adapter.findOne({
            model: "user",
            where: [{ field: "email", value: "concurrent@example.test" }],
          });
          try {
            writer.prepare("UPDATE worker SET last_tick = 123 WHERE id = 1").run();
          } catch (error) {
            assert.equal((error as { code: string }).code, "SQLITE_BUSY");
            blockedDuringHash = true;
          }
          return hashPassword(value);
        },
        verify: async () => false,
      },
    },
  });
  onMailReceived = () => {
    try {
      writer.prepare("UPDATE worker SET last_tick = 124 WHERE id = 1").run();
      wroteDuringMail = true;
    } catch (error) {
      mailWriteError = error;
    }
  };
  try {
    const response = await isolatedAuth.handler(
      request("/api/auth/sign-up/email", {
        name: "Concurrent owner",
        email: "concurrent@example.test",
        password,
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(blockedDuringHash, true);
    assert.equal(mailWriteError, undefined);
    assert.equal(wroteDuringMail, true);
    const user = writer
      .prepare("SELECT id FROM user WHERE email = ?")
      .get("concurrent@example.test") as { id: string };
    assert.ok(user);
    const credentials = writer
      .prepare("SELECT COUNT(*) AS n FROM account WHERE userId = ?")
      .get(user.id) as { n: number };
    assert.equal(credentials.n, 1);
    writer.prepare("DELETE FROM user WHERE id = ?").run(user.id);
    received.pop();
  } finally {
    onMailReceived = undefined;
    writer.close();
  }
});
test("real auth, owner isolation, CSRF, check link and SMTP delivery", async () => {
  const signup = await auth().handler(
    request("/api/auth/sign-up/email", {
      name: "Owner",
      email: "owner@example.test",
      password,
      callbackURL: "/dashboard",
    }),
  );
  assert.equal(signup.status, 200);
  assert.equal(received.length, 1);
  const unverified = await auth().handler(
    request("/api/auth/sign-in/email", {
      email: "owner@example.test",
      password,
    }),
  );
  assert.equal(unverified.status, 403);
  const verify = await auth().handler(
    new Request(
      mailUrl(0, /http:\/\/localhost:3000\/api\/auth\/verify-email\?[^\s]+/),
      { headers: { "cf-connecting-ip": clientIp } },
    ),
  );
  assert.equal(verify.status, 302);
  const login = await auth().handler(
    request("/api/auth/sign-in/email", {
      email: "owner@example.test",
      password,
    }),
  );
  assert.equal(login.status, 200);
  const cookie = cookies(login);
  assert.equal((await GET(request("/api/dashboard"))).status, 401);
  const save = await POST(
    request(
      "/api/dashboard",
      {
        action: "save",
        recipientName: "Ada",
        recipientEmail: "ada@example.test",
        body: "Only a test.",
        ready: true,
      },
      cookie,
    ),
  );
  assert.equal(save.status, 200);
  const id = (await save.json()).id;
  const snapshot = await (
    await GET(request("/api/dashboard", undefined, cookie))
  ).json();
  assert.equal(snapshot.messages.length, 1);
  assert.equal(snapshot.messages[0].ready, 0, "even a forged autosave cannot arm");
  assert.equal(snapshot.life.state, "disabled");
  const review = await POST(request("/api/dashboard", { action: "review_release", id }, cookie));
  assert.equal(review.status, 200, "server builds an explicit release review");
  const reviewed = await review.json();
  assert.equal(reviewed.recipientEmail, "ada@example.test");
  assert.equal(reviewed.checkState, "disabled");
  const { POST: release } = await import("../app/api/messages/release/route");
  assert.equal((await release(request("/api/messages/release", { action: "release", id, token: reviewed.token, confirmed: true }, cookie))).status, 200);
  assert.equal((await release(request("/api/messages/release", { action: "release", id, token: reviewed.token, confirmed: true }, cookie))).status, 200, "same confirmation is idempotent");
  assert.equal(
    (
      await POST(
        request(
          "/api/dashboard",
          { action: "delete", id },
          cookie,
          "https://attacker.test",
        ),
      )
    ).status,
    403,
  );
  const userId = db()
    .prepare("SELECT id FROM user WHERE email = 'owner@example.test'")
    .get() as { id: string };
  db()
    .prepare(
      "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)",
    )
    .run("other", "Other", "other@example.test", 1, Date.now(), Date.now());
  db()
    .prepare(
      "INSERT INTO message(id,user_id,payload,created_at,updated_at) VALUES('foreign','other','not-readable',?,?)",
    )
    .run(Date.now(), Date.now());
  assert.equal(
    (
      await POST(
        request("/api/dashboard", { action: "delete", id: "foreign" }, cookie),
      )
    ).status,
    400,
  );
  assert.equal((await POST(request("/api/dashboard", { action: "confirm" }, cookie))).status, 400, "disabled checks cannot bypass readiness with confirm");
  db().prepare("UPDATE worker SET last_tick = ?").run(Date.now());
  const activationReview = await POST(request("/api/dashboard", { action: "review_activation" }, cookie));
  assert.equal(activationReview.status, 200);
  const activation = await activationReview.json();
  assert.equal(activation.releasedCount, 1);
  assert.equal(activation.received, false);
  assert.equal((await POST(request("/api/dashboard", { action: "activate", token: activation.token, confirmed: true }, cookie))).status, 400, "SMTP health does not substitute for receipt");
  assert.equal((await POST(request("/api/dashboard", { action: "activate", token: activation.token, confirmed: true, bypassReceipt: true }, cookie))).status, 200);
  const now = Date.now();
  db()
    .prepare("UPDATE life SET next_check = ? WHERE user_id = ?")
    .run(now, userId.id);
  db().prepare("UPDATE worker SET last_tick = ?").run(now);
  await tick(now);
  assert.equal(received.length, 2);
  const url = mailUrl(
    1,
    /http:\/\/localhost:3000\/confirm\?token=[a-f0-9]{64}/,
  );
  const token = new URL(url).searchParams.get("token")!;
  assert.equal(life(userId.id).state, "awaiting");
  const form = new FormData();
  form.set("token", token);
  const confirmed = await confirmRoute(
    new Request("http://localhost:3000/api/confirm", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
      body: form,
    }),
  );
  assert.equal(confirmed.status, 303);
  assert.equal(life(userId.id).state, "active");
  db()
    .prepare(
      "UPDATE life SET state = 'awaiting', deadline = ? WHERE user_id = ?",
    )
    .run(now, userId.id);
  await tick(now);
  assert.equal(received.length, 3);
  assert.match(received[2], /ada@example.test/);
  assert.equal(
    (
      db().prepare("SELECT status FROM message WHERE id = ?").get(id) as {
        status: string;
      }
    ).status,
    "sent",
  );
  await tick(now + 1);
  assert.equal(received.length, 3);
});
test("authenticated mailtest records explicit receipt and never changes life state", async () => {
  clientIp = "192.0.2.19";
  const login = await auth().handler(
    request("/api/auth/sign-in/email", {
      email: "owner@example.test",
      password,
    }),
  );
  const cookie = cookies(login);
  const initial = received.length;
  assert.equal(
    (await POST(request("/api/dashboard", { action: "test_mail" }, cookie)))
      .status,
    200,
  );
  const url = mailUrl(
    initial,
    /http:\/\/localhost:3000\/confirm\?kind=mail&token=[a-f0-9]{64}/,
  );
  const form = new FormData();
  form.set("kind", "mail");
  form.set("token", new URL(url).searchParams.get("token")!);
  const result = await confirmRoute(
    new Request("http://localhost:3000/api/confirm", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
      body: form,
    }),
  );
  assert.match(result.headers.get("location")!, /result=ok&kind=mail/);
  const snapshot = await (
    await GET(request("/api/dashboard", undefined, cookie))
  ).json();
  assert.ok(snapshot.mailTest.received_at);
  assert.equal(snapshot.life.state, "released");
  assert.equal(snapshot.life.token_hash, undefined);
  assert.equal(
    (await POST(request("/api/dashboard", { action: "test_mail" }, cookie)))
      .status,
    400,
  );
});
test("password reset sends a usable token and revokes the old password", async () => {
  clientIp = "192.0.2.20";
  const initial = received.length;
  const response = await auth().handler(
    request("/api/auth/request-password-reset", {
      email: "owner@example.test",
      redirectTo: "/reset-password",
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(received.length, initial + 1);
  const url = mailUrl(
    initial,
    /http:\/\/localhost:3000\/api\/auth\/reset-password\/[^\s]+/,
  );
  const token = new URL(url).pathname.split("/").at(-1)!;
  const newPassword = "changed-password-only-2026!";
  const reset = await auth().handler(
    request("/api/auth/reset-password", { token, newPassword }),
  );
  assert.equal(reset.status, 200);
  const oldLogin = await auth().handler(
    request("/api/auth/sign-in/email", {
      email: "owner@example.test",
      password,
    }),
  );
  assert.equal(oldLogin.status, 401);
  const newLogin = await auth().handler(
    request("/api/auth/sign-in/email", {
      email: "owner@example.test",
      password: newPassword,
    }),
  );
  assert.equal(newLogin.status, 200);
});
test("account deletion requires the password and removes its messages", async () => {
  clientIp = "192.0.2.30";
  const login = await auth().handler(
    request("/api/auth/sign-in/email", {
      email: "owner@example.test",
      password: "changed-password-only-2026!",
    }),
  );
  assert.equal(login.status, 200);
  const cookie = cookies(login);
  const denied = await auth().handler(
    request(
      "/api/auth/delete-user",
      { password: "incorrect-password" },
      cookie,
    ),
  );
  assert.notEqual(denied.status, 200);
  const removed = await auth().handler(
    request(
      "/api/auth/delete-user",
      { password: "changed-password-only-2026!" },
      cookie,
    ),
  );
  assert.equal(removed.status, 200);
  assert.equal(
    db().prepare("SELECT * FROM user WHERE email = 'owner@example.test'").get(),
    undefined,
  );
  assert.equal(
    db().prepare("SELECT * FROM message WHERE id <> 'foreign'").all().length,
    0,
  );
});
test("body limit holds without a Content-Length header", async () => {
  await assert.rejects(
    readJson(
      new Request("http://localhost:3000", {
        method: "POST",
        body: JSON.stringify({ data: "a".repeat(150_000) }),
      }),
    ),
    /zu groß/,
  );
});

test("closed registration rejects API signup without creating a user", async () => {
  process.env.ALLOW_REGISTRATION = "false";
  try {
    const privateAuth = betterAuth(authOptions());
    const response = await privateAuth.handler(
      request("/api/auth/sign-up/email", {
        name: "Blocked",
        email: "blocked@example.test",
        password,
      }),
    );
    assert.equal(response.status, 400);
    assert.equal(
      db()
        .prepare("SELECT id FROM user WHERE email = 'blocked@example.test'")
        .get(),
      undefined,
    );
  } finally {
    delete process.env.ALLOW_REGISTRATION;
  }
});
