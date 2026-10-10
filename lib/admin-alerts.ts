import { db } from "./database";
import { appUrl } from "./config";

const COOLDOWN = 10 * 60_000;
export function recordMailFailure(now = Date.now()) {
  db()
    .prepare(
      `INSERT INTO admin_alert(id,pending_count,first_failure,last_failure) VALUES(1,1,?,?)
    ON CONFLICT(id) DO UPDATE SET pending_count = pending_count + 1,
    first_failure = COALESCE(first_failure, excluded.first_failure), last_failure = excluded.last_failure`,
    )
    .run(now, now);
}
export async function sendTelegram(
  text: string,
  request: typeof fetch = fetch,
) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat)
    throw new Error("TELEGRAM_BOT_TOKEN und TELEGRAM_CHAT_ID fehlen.");
  try {
    const response = await request(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chat,
          text,
          link_preview_options: { is_disabled: true },
        }),
        signal: AbortSignal.timeout(8_000),
        redirect: "error",
      },
    );
    const result = (await response.json()) as { ok?: boolean };
    if (!response.ok || result.ok !== true)
      throw new Error("Telegram rejected alert");
  } catch {
    // Never include fetch errors: the request URL contains the bot token.
    throw new Error("Telegram-Alarm konnte nicht zugestellt werden.");
  }
}
export async function flushAdminAlerts(
  now = Date.now(),
  request: typeof fetch = fetch,
) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;
  try {
    const alert = db().transaction(() => {
      const row = db()
        .prepare("SELECT * FROM admin_alert WHERE id = 1")
        .get() as
        | {
            pending_count: number;
            first_failure: number;
            last_failure: number;
            last_attempt: number | null;
          }
        | undefined;
      if (
        !row?.pending_count ||
        (row.last_attempt !== null && now - row.last_attempt < COOLDOWN)
      )
        return;
      db()
        .prepare("UPDATE admin_alert SET last_attempt = ? WHERE id = 1")
        .run(now);
      return row;
    })();
    if (!alert) return;
    await sendTelegram(
      `Nachklang: E-Mail-Versand fehlgeschlagen oder unklar.\n${alert.pending_count} fehlgeschlagene Versandversuche seit ${new Date(alert.first_failure).toISOString()}.\nBitte SMTP, Anbieter-Rückläufer und den Prüfjob kontrollieren.\n${appUrl()}/dashboard\n\nDieser Admin-Hinweis verändert keinen Lebenstimer.`,
      request,
    );
    db()
      .prepare(
        "UPDATE admin_alert SET pending_count = pending_count - ?, first_failure = CASE WHEN pending_count = ? THEN NULL ELSE first_failure END, last_sent = ? WHERE id = 1",
      )
      .run(alert.pending_count, alert.pending_count, now);
  } catch {
    console.error(
      "Telegram-Admin-Alarm fehlgeschlagen; bleibt für den nächsten Versuch gespeichert.",
    );
  }
}
