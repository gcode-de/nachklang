import { recordMailFailure, flushAdminAlerts } from "./admin-alerts";
import nodemailer from "nodemailer";

export type Mail = {
  to: string;
  subject: string;
  text: string;
  messageId?: string;
};
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
    throw new Error("SMTP_HOST und SMTP_FROM müssen eingerichtet sein.");
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
      throw new Error("SMTP hat die Nachricht nicht angenommen.");
  } finally {
    transport.close();
  }
}
