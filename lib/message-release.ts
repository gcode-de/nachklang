import { randomBytes } from "node:crypto";
import { db } from "./database";
import { decrypt, tokenHash } from "./crypto";
import { life, event, type MessageRow, type Payload } from "./life";
import { validateMessage } from "./validation";

function owned(userId: string, id: unknown) {
  if (typeof id !== "string") throw new Error("Nachricht nicht gefunden.");
  const row = db().prepare("SELECT * FROM message WHERE id = ? AND user_id = ?").get(id, userId) as MessageRow | undefined;
  if (!row) throw new Error("Nachricht nicht gefunden.");
  return row;
}
function context(userId: string) {
  const status = life(userId);
  return JSON.stringify([status.state, status.next_check, status.deadline, status.confirmed_at]);
}
export function reviewRelease(userId: string, id: unknown, now = Date.now()) {
  return db().transaction(() => {
    const row = owned(userId, id);
    if (row.status !== "pending" || life(userId).state === "released") throw new Error("Bitte stoppe zuerst den ausstehenden Versand.");
    const payload = decrypt<Payload>(row.payload);
    validateMessage({ ...payload, deliveryDate: row.delivery_date, ready: true });
    const token = randomBytes(32).toString("hex");
    db().prepare("UPDATE message SET release_token = ?, release_context = ?, release_expires = ? WHERE id = ?").run(tokenHash(token), context(userId), now + 5 * 60_000, row.id);
    return { id: row.id, revision: row.revision, token, ...payload, deliveryDate: row.delivery_date, checkState: life(userId).state, deadline: life(userId).deadline };
  })();
}
export function releaseMessage(userId: string, input: Record<string, unknown>, now = Date.now()) {
  db().transaction(() => {
    const row = owned(userId, input.id);
    if (input.confirmed !== true || typeof input.token !== "string" || !/^[a-f0-9]{64}$/.test(input.token) || tokenHash(input.token) !== row.release_token) throw new Error("Bitte prüfe und bestätige die Freigabe ausdrücklich.");
    // A lost response may be retried, but never grants a different revision permission.
    if (row.ready) return;
    if (row.status !== "pending" || life(userId).state === "released" || !row.release_expires || now > row.release_expires || row.release_context !== context(userId)) throw new Error("Prüfstatus oder Nachricht geändert. Bitte Freigabe erneut prüfen.");
    validateMessage({ ...decrypt<Payload>(row.payload), deliveryDate: row.delivery_date, ready: true });
    db().prepare("UPDATE message SET ready = 1 WHERE id = ? AND user_id = ?").run(row.id, userId);
    event(userId, "message_armed");
  })();
}
export function revokeMessage(userId: string, id: unknown) {
  db().transaction(() => {
    const row = owned(userId, id);
    if (row.status !== "pending") throw new Error("Begonnene Sendungen können nicht zurückgerufen werden. Bitte die Prüfung sofort stoppen.");
    db().prepare("UPDATE message SET ready = 0, revision = revision + 1, release_token = NULL WHERE id = ? AND user_id = ?").run(row.id, userId);
    event(userId, "message_revoked");
  })();
}
