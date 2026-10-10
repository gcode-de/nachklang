import { randomBytes } from "node:crypto";
import { db } from "./database";
import { tokenHash } from "./crypto";
import { appUrl } from "./config";
import { sendMail, type Mail } from "./mail";
import { event } from "./life";

export async function testMail(
  userId: string,
  email: string,
  now = Date.now(),
  deliver: (mail: Mail) => Promise<void> = sendMail,
) {
  const token = randomBytes(32).toString("hex");
  const hash = tokenHash(token);
  db().transaction(() => {
    const previous = db()
      .prepare("SELECT requested_at FROM mail_probe WHERE user_id = ?")
      .get(userId) as { requested_at: number } | undefined;
    if (previous && now - previous.requested_at < 60_000)
      throw new Error("Bitte warte eine Minute vor dem nächsten Mailtest.");
    db()
      .prepare(
        "INSERT INTO mail_probe(user_id, token_hash, requested_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, requested_at = excluded.requested_at, accepted_at = NULL, received_at = NULL",
      )
      .run(userId, hash, now);
  })();
  try {
    await deliver({
      to: email,
      subject: "Nachklang: Bitte bestätige den Empfang dieser Testmail",
      text: `Mit diesem Test prüfst du, ob Nachklang-Mails in deinem Postfach ankommen. Öffne den Link und bestätige den Empfang ausdrücklich:\n\n${appUrl()}/confirm?kind=mail&token=${token}\n\nDer Link gilt 24 Stunden. Er startet oder stoppt keinen Lebenstimer. Prüfe auch deinen Spamordner.`,
    });
    db()
      .prepare(
        "UPDATE mail_probe SET accepted_at = ? WHERE user_id = ? AND token_hash = ?",
      )
      .run(now, userId, hash);
    event(userId, "mail_test_sent", now);
  } catch {
    event(userId, "mail_test_failed", now);
    throw new Error(
      "Die Testmail konnte nicht vom Mailserver angenommen werden. Bitte prüfe die SMTP-Einstellungen.",
    );
  }
}
export function confirmMailTest(token: string, now = Date.now()) {
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  return db().transaction(() => {
    const probe = db()
      .prepare(
        "SELECT user_id FROM mail_probe WHERE token_hash = ? AND requested_at >= ?",
      )
      .get(tokenHash(token), now - 86_400_000) as
      { user_id: string } | undefined;
    if (!probe) return false;
    db()
      .prepare(
        "UPDATE mail_probe SET received_at = ?, token_hash = NULL WHERE user_id = ?",
      )
      .run(now, probe.user_id);
    event(probe.user_id, "mail_test_received", now);
    return true;
  })();
}
