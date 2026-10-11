import type { Payload } from "./life";

export function validateMessage(
  input: unknown,
): Payload & { deliveryDate: string | null; ready: boolean } {
  if (!input || typeof input !== "object")
    throw new Error("Ungültige Nachricht.");
  const value = input as Record<string, unknown>;
  const recipientName =
    typeof value.recipientName === "string" ? value.recipientName.trim() : "";
  const recipientEmail =
    typeof value.recipientEmail === "string" ? value.recipientEmail.trim() : "";
  const body = typeof value.body === "string" ? value.body : "";
  if (
    recipientName.length > 200 ||
    recipientEmail.length > 254 ||
    body.length > 100_000
  )
    throw new Error("Nachricht ist zu lang.");
  if (
    value.ready && recipientEmail &&
    (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipientEmail) ||
      /[\r\n]/.test(recipientEmail))
  )
    throw new Error("Ungültige E-Mail-Adresse.");
  if (typeof value.ready !== "boolean")
    throw new Error("Versandfreigabe fehlt.");
  if (value.ready && (!recipientName || !recipientEmail || !body.trim()))
    throw new Error(
      "Für die Freigabe sind Name, E-Mail und Text erforderlich.",
    );
  let deliveryDate = null;
  if (value.deliveryDate) {
    if (
      typeof value.deliveryDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.deliveryDate)
    )
      throw new Error("Ungültiges Versanddatum.");
    const date = new Date(value.deliveryDate + "T00:00:00Z");
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value.deliveryDate
    )
      throw new Error("Ungültiges Versanddatum.");
    deliveryDate = value.deliveryDate;
  }
  return {
    recipientName,
    recipientEmail,
    body,
    deliveryDate,
    ready: value.ready,
  };
}
