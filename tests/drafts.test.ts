import { test } from "node:test";
import assert from "node:assert/strict";
import { validateMessage } from "../lib/validation";

test("incomplete recipient draft preserves prose but cannot pass release validation", () => {
  const draft = { recipientName: "", recipientEmail: "person@", body: "Meine neuen Worte.", ready: false };
  assert.equal(validateMessage(draft).body, draft.body);
  assert.equal(validateMessage(draft).recipientEmail, "person@");
  assert.throws(() => validateMessage({ ...draft, ready: true }), /E-Mail/);
});
