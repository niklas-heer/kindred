// node --test scripts/unused-i18n-keys.test.ts — no translation key is dead weight (the report ends at zero unused, and nothing
// is left "unsure": a key is named, under a dynamic prefix, or a thrown sentence's text), and the remover cuts whole entries.
import assert from "node:assert/strict";
import { test } from "node:test";
import { findUnused, removeKeys, TEXT_KEYED } from "./unused-i18n-keys.ts";

test("every key is used by the code, a dynamic prefix or a thrown sentence's text", async () => {
  const report = await findUnused();
  assert.ok(report.keys.length > 1000 && report.prefixes.includes("today.q."), "the scan found the dictionary and the dynamic prefixes");
  assert.deepEqual(report.unused, [], "unused keys: delete them with `node scripts/unused-i18n-keys.ts --remove`");
  assert.deepEqual(report.unresolved, [], "a key built from a variable that starts the name cannot be checked");
  // Only thrown sentences are found by their text; any other key must be named in the code or sit under a dynamic prefix.
  assert.deepEqual(report.byText.filter((k) => !TEXT_KEYED.test(k)), []);
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
