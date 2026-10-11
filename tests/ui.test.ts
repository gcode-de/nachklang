import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
test("editor separates content autosave from reviewed authorization with linked errors", () => {
  const page = source("app/dashboard/page.tsx");
  assert.ok(!page.includes('change("ready"'));
  const editor = source("app/dashboard/editor.tsx");
  assert.match(editor, /review_release/); assert.match(editor, /confirmed: true/);
  assert.match(editor, /aria-invalid/); assert.match(editor, /aria-describedby/);
  assert.match(editor, /Nicht gespeichert|DraftSaver/);
});
test("logical source order places messages before collapsed diagnostics", () => {
  const page = source("app/dashboard/page.tsx");
  assert.ok(page.indexOf("Deine Nachrichten") < page.indexOf("MAILVERBINDUNG"));
  assert.match(page, /<details className="activity">/);
  assert.ok(!source("app/globals.css").includes("order: -1"));
  assert.match(source("app/layout.tsx"), /href="#main-content"/);
});
test("public access and missing operator notice are truthful, not invented", () => {
  assert.match(source("app/page.tsx"), /Anmelden/);
  assert.match(source("app/login/page.tsx"), /Private Instanz/);
  assert.match(source("app/about/page.tsx"), /nicht hinterlegt/);
  assert.ok(!source("app/layout.tsx").includes("So funktioniert es & Datenschutz"));
});
