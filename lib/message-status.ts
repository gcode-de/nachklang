export function executionStatus(message: {ready: number; status: string; delivery_date: string | null; failure_kind?: string | null}, state: string, now=Date.now()) {
  if (message.status === "failed" && message.failure_kind === "rejected") return "Nicht angenommen: SMTP-Übergabe nicht begonnen oder ausdrücklich abgelehnt. Keine automatische Wiederholung.";
  if (message.status === "sent") return "Vom Mailserver angenommen — keine Bestätigung der Zustellung ins Postfach.";
  if (message.status === "failed") return "Versand unklar / fehlgeschlagen. Keine automatische Wiederholung; erneuter Versand kann ein Duplikat erzeugen.";
  if (message.status === "sending") return "Wird an den Mailserver übergeben. Nicht zurückrufbar.";
  if (!message.ready) return "Wird nicht automatisch versendet.";
  if (state === "disabled") return "Prüfung pausiert. Die Nachrichtenfreigabe bleibt bestehen.";
  if (state === "awaiting") return "Wartet auf Ablauf der Antwortfrist ohne Lebensbestätigung.";
  if (state !== "released") return "Wartet auf eine ausgebliebene Lebensprüfung.";
  if (message.delivery_date && message.delivery_date > new Date(now).toISOString().slice(0,10)) return "Datum noch nicht erreicht; frühestens ab dem gewählten UTC-Kalendertag.";
  return "Für Übergabe beim nächsten Prüfjob vorgesehen. Jetzt stoppen, solange die Übergabe nicht begonnen hat.";
}
export function deliverySummary(value: string | null) {
  const condition = "Nur nach aktiver monatlicher Prüfung und sieben Tagen ohne Bestätigung; keine Zusage einer Zustellung.";
  if (!value) return `Kein zusätzliches Datum. ${condition}`;
  const formatted = new Date(`${value}T00:00:00Z`).toLocaleDateString("de-DE", {timeZone: "UTC", dateStyle: "long"});
  return `Nicht vor ${formatted} (UTC-Kalendertag, ab 00:00 UTC). Ein vergangenes Datum erlaubt den nächsten Prüfjob nach Freigabe, keinen rückwirkenden Versand. ${condition}`;
}
