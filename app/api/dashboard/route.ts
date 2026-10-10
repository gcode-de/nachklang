import { randomUUID } from "node:crypto";
import { auth } from "../../../lib/auth";
import { appUrl } from "../../../lib/config";
import { db } from "../../../lib/database";
import { encrypt, decrypt } from "../../../lib/crypto";
import {
  life,
  confirm,
  disable,
  event,
  type MessageRow,
  type Payload,
} from "../../../lib/life";
import { validateMessage } from "../../../lib/validation";
import { testMail } from "../../../lib/mail-test";
import { readJson } from "../../../lib/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function user(request: Request) {
  const session = await auth().api.getSession({ headers: request.headers });
  return session?.user.emailVerified ? session.user : null;
}
export async function GET(request: Request) {
  const owner = await user(request);
  if (!owner)
    return Response.json(
      { error: "Bitte melde dich mit bestätigter E-Mail-Adresse an." },
      { status: 401 },
    );
  const rows = db()
    .prepare("SELECT * FROM message WHERE user_id = ? ORDER BY created_at DESC")
    .all(owner.id) as MessageRow[];
  const worker = db()
    .prepare("SELECT last_tick FROM worker WHERE id = 1")
    .get();
  return Response.json(
    {
      user: { id: owner.id, name: owner.name, email: owner.email },
      life: (() => {
        const { token_hash, ...status } = life(owner.id);
        return status;
      })(),
      mailTest:
        db()
          .prepare(
            "SELECT requested_at, accepted_at, received_at FROM mail_probe WHERE user_id = ?",
          )
          .get(owner.id) || null,
      worker,
      messages: rows.map(({ payload, user_id, ...row }) => ({
        ...row,
        ...decrypt<Payload>(payload),
      })),
      events: db()
        .prepare(
          "SELECT kind, created_at FROM event WHERE user_id = ? ORDER BY id DESC LIMIT 20",
        )
        .all(owner.id),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== appUrl())
    return Response.json({ error: "Ungültige Herkunft." }, { status: 403 });
  const owner = await user(request);
  if (!owner)
    return Response.json({ error: "Bitte anmelden." }, { status: 401 });
  if (Number(request.headers.get("content-length")) > 150_000)
    return Response.json({ error: "Anfrage ist zu groß." }, { status: 413 });
  let raw;
  try {
    raw = await readJson(request);
  } catch {
    return Response.json(
      { error: "Ungültige oder zu große Anfrage." },
      { status: 400 },
    );
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return Response.json({ error: "Ungültige Anfrage." }, { status: 400 });
  const input = raw as Record<string, unknown>;
  let savedId: string | undefined;
  try {
    if (input.action === "test_mail") await testMail(owner.id, owner.email);
    else if (input.action === "confirm") confirm(owner.id);
    else if (input.action === "disable") disable(owner.id);
    else if (
      input.action === "save" ||
      input.action === "delete" ||
      input.action === "retry"
    ) {
      db().transaction(() => {
        if (life(owner.id).state === "released")
          throw new Error(
            "Bitte bestätige zuerst, dass du lebst, um den ausstehenden Versand zu stoppen.",
          );
        const existing =
          typeof input.id === "string"
            ? (db()
                .prepare("SELECT * FROM message WHERE id = ? AND user_id = ?")
                .get(input.id, owner.id) as MessageRow | undefined)
            : undefined;
        if (input.id && !existing) throw new Error("Nachricht nicht gefunden.");
        if (existing?.status === "sending")
          throw new Error("Diese Nachricht wird gerade versendet.");
        if (input.action === "delete") {
          if (!existing) throw new Error("Nachricht nicht gefunden.");
          db()
            .prepare("DELETE FROM message WHERE id = ? AND user_id = ?")
            .run(existing.id, owner.id);
          event(owner.id, "message_deleted");
        } else if (input.action === "retry") {
          if (
            existing?.status !== "failed" ||
            input.acceptDuplicateRisk !== true
          )
            throw new Error(
              "Bitte bestätige das Risiko eines doppelten Versands.",
            );
          db()
            .prepare("UPDATE message SET status = 'pending' WHERE id = ?")
            .run(existing.id);
          event(owner.id, "retry_armed");
        } else {
          if (existing?.status === "sent" || existing?.status === "failed")
            throw new Error(
              "Versendete oder unklare Nachrichten können nicht bearbeitet werden.",
            );
          const { deliveryDate, ready, ...payload } = validateMessage(input);
          const now = Date.now();
          if (existing) {
            savedId = existing.id;
            db()
              .prepare(
                "UPDATE message SET payload = ?, delivery_date = ?, ready = ?, updated_at = ? WHERE id = ? AND user_id = ?",
              )
              .run(
                encrypt(payload),
                deliveryDate,
                Number(ready),
                now,
                existing.id,
                owner.id,
              );
          } else {
            const count = db()
              .prepare("SELECT COUNT(*) AS n FROM message WHERE user_id = ?")
              .get(owner.id) as { n: number };
            if (count.n >= 100)
              throw new Error("Maximal 100 Nachrichten pro Konto.");
            savedId = randomUUID();
            db()
              .prepare(
                "INSERT INTO message(id,user_id,payload,delivery_date,ready,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
              )
              .run(
                savedId,
                owner.id,
                encrypt(payload),
                deliveryDate,
                Number(ready),
                now,
                now,
              );
          }
        }
      })();
    } else throw new Error("Unbekannte Aktion.");
    return Response.json({ ok: true, id: savedId });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Aktion fehlgeschlagen.",
      },
      { status: 400 },
    );
  }
}
