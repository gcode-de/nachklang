import { sendTelegram } from "../lib/admin-alerts";
await sendTelegram(
  "Nachklang: Telegram-Test erfolgreich. Dieser Admin-Kanal meldet fehlgeschlagene E-Mail-Versandversuche. Kein Lebenstimer wurde verändert.",
);
console.log("Telegram-Testnachricht zugestellt.");
