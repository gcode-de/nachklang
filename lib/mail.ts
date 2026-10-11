import { recordMailFailure, flushAdminAlerts } from "./admin-alerts";
import nodemailer from "nodemailer";

export type Mail = {
  to: string;
  subject: string;
  text: string;
  messageId?: string;
};
export function mailFailure(error: unknown): {kind: "rejected" | "unknown"; reason: string} {
  const value = error as { responseCode?: number; command?: string; code?: string } | null;
  // Only explicit SMTP negative replies or known pre-handoff failures prove nonacceptance.
  if ((typeof value?.responseCode === "number" && value.responseCode >= 400 && value.responseCode < 600 && ["CONN", "AUTH", "MAIL FROM", "RCPT TO", "DATA"].includes(value.command || "")) || ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "NK_NOT_ATTEMPTED", "NK_REJECTED"].includes(value?.code || "")) return {kind:"rejected",reason:"Keine SMTP-Annahme: Verbindung nicht begonnen oder ausdrücklich abgelehnt."};
  return {kind:"unknown",reason:"SMTP-Annahme nicht sicher feststellbar; keine automatische Wiederholung."};
}
export async function sendMail(mail: Mail) {
  try {
    await deliverMail(mail);
  } catch (error) {
    try {
      recordMailFailure();
      await flushAdminAlerts();
    } catch {
      console.error(
        "Mailfehler konnte nicht für den Admin-Alarm gespeichert werden.",
      );
    }
    throw error;
  }
}
async function deliverMail(mail: Mail) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) {
    throw Object.assign(new Error("SMTP_HOST und SMTP_FROM müssen eingerichtet sein."), {code: "NK_NOT_ATTEMPTED"});
  }
  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: process.env.SMTP_ALLOW_INSECURE !== "true" && port !== 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    const result = await transport.sendMail({
      from: process.env.SMTP_FROM,
      ...mail,
    });
    if (!result.accepted?.length)
      throw Object.assign(new Error("SMTP hat die Nachricht nicht angenommen."), {code: "NK_REJECTED"});
  } finally {
    transport.close();
  }
}
