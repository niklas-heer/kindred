// node --test scripts/unused-i18n-keys.test.ts — no translation key is dead weight, and the remover cuts whole entries.
import assert from "node:assert/strict";
import { test } from "node:test";
import { findUnused, removeKeys } from "./unused-i18n-keys.ts";

test("every key is used by the code, a dynamic prefix or a thrown sentence's text", async () => {
  const report = await findUnused();
  assert.ok(report.keys.length > 1000 && report.prefixes.includes("today.q."), "the scan found the dictionary and the dynamic prefixes");
  assert.deepEqual(report.unused, [], "unused keys: delete them with `node scripts/unused-i18n-keys.ts --remove`");
});

test("removeKeys drops a whole entry, also over several lines, and keeps the neighbours and comments", () => {
  const text = [
    "export const en = {",
    '  "a.one": "One",',
    '  "a.two":',
    '    "Two, on its own line",',
    "  // a group",
    '  "a.three": { one: "x", other: "y" },',
    "};",
    "",
  ].join("\n");
  assert.equal(removeKeys(text, new Set(["a.two"])), text.replace('  "a.two":\n    "Two, on its own line",\n', ""));
});
