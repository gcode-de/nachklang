import { test } from "node:test";
import assert from "node:assert/strict";
import { DraftSaver } from "../lib/draft-saver";
import { executionStatus, deliverySummary } from "../lib/message-status";

test("queued saves use confirmed revisions and old responses never label new prose saved", async () => {
  const states: string[] = [];
  const calls: Record<string, unknown>[] = [];
  let resolve!: (value: {id: string; revision: number}) => void;
  const saver = new DraftSaver(async input => { calls.push(input); if (calls.length === 1) return new Promise(r => resolve = r); return { id: "id", revision: 1 }; }, s => states.push(s));
  const old = { body: "old" }, current = { body: "new", recipientEmail: "person@" };
  saver.change(old); const first = saver.save(old);
  await new Promise(r => setImmediate(r));
  saver.change(current); const second = saver.save(current);
  resolve({id: "id", revision: 0}); await first;
  assert.notEqual(states.at(-1), "Gespeichert");
  await second;
  assert.equal(calls[1].revision, 0); assert.equal(calls[1].id, "id");
  assert.equal(states.at(-1), "Gespeichert"); assert.equal(saver.unsaved, false);
});
test("network failure preserves unsaved snapshot and permits explicit retry", async () => {
  let fail = true; const states: string[] = [];
  const saver = new DraftSaver(async () => { if (fail) throw new Error("offline"); return {id: "id", revision: 0}; }, s => states.push(s));
  const draft = {body: "private prose"}; saver.change(draft);
  await assert.rejects(saver.save(draft), /offline/);
  assert.equal(saver.unsaved, true); assert.match(states.at(-1)!, /Nicht gespeichert.*erneut versuchen/);
  fail = false; await saver.save(draft); assert.equal(saver.unsaved, false);
});
test("permission and execution are distinct and mailserver acceptance is not delivery", () => {
  const base = {ready: 1, status: "pending", delivery_date: null};
  assert.match(executionStatus({...base, ready: 0}, "active"), /nicht automatisch/);
  assert.match(executionStatus(base, "disabled"), /pausiert/);
  assert.match(executionStatus(base, "active"), /Lebensprüfung/);
  assert.match(executionStatus(base, "awaiting"), /Antwortfrist/);
  assert.match(executionStatus({...base, delivery_date: "2099-01-01"}, "released"), /Datum/);
  assert.match(executionStatus({...base, status: "sending"}, "released"), /übergeben/);
  assert.match(executionStatus({...base, status: "sent"}, "released"), /Mailserver angenommen/);
  assert.match(executionStatus({...base, status: "failed"}, "released"), /Keine automatische Wiederholung/);
  assert.match(executionStatus({...base, status: "failed", failure_kind: "rejected"}, "released"), /abgelehnt/);
  assert.match(executionStatus({...base, status: "failed", failure_kind: "unknown"}, "released"), /unklar/);
  assert.match(deliverySummary("2020-01-01"), /UTC.*keine Zusage/i);
});
