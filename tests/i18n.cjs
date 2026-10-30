"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("../src/web/i18n.js");

const { t, setLang, lang, formatDate, year, dictionaries, has } = globalThis.KindredI18n;
const webDir = path.join(__dirname, "..", "src", "web");
const read = (name) => fs.readFileSync(path.join(webDir, name), "utf8");

test("full ISO dates become long localized dates and stay UTC-stable", () => {
  setLang("en");
  assert.equal(formatDate("1928-09-21"), "21 September 1928");
  assert.equal(formatDate("2000-01-01"), "1 January 2000");
  setLang("de");
  assert.equal(formatDate("1928-09-21"), "21. September 1928");
  setLang("en");
});

test("YYYY-MM becomes month and year; other values come back exactly as written", () => {
  setLang("en");
  assert.equal(formatDate("1928-09"), "September 1928");
  setLang("de");
  assert.equal(formatDate("1928-09"), "September 1928");
  setLang("en");
  for (const value of ["1928", "about 1928", "21.9.1928", "1928-13-01", "1928-02-30", "1928-9-21", "", " 1928-09-21 "]) {
    assert.equal(formatDate(value), value);
  }
  assert.equal(formatDate(undefined), "");
});

test("year returns the first standalone four-digit year or the value as written", () => {
  assert.equal(year("1928-09-21"), "1928");
  assert.equal(year("21 September 1928"), "1928");
  assert.equal(year("c. 1850 to 1860"), "1850");
  assert.equal(year("1850s"), "1850s");
  assert.equal(year("Spring"), "Spring");
  assert.equal(year(undefined), "");
  assert.equal(year(null), "");
});

test("plurals follow each language's rules", () => {
  setLang("en");
  assert.equal(t("people", { count: 1 }), "1 person");
  assert.equal(t("people", { count: 5 }), "5 people");
  assert.equal(t("people", { count: 0 }), "0 people");
  setLang("de");
  assert.equal(t("people", { count: 1 }), "1 Person");
  assert.equal(t("people", { count: 5 }), "5 Personen");
  assert.equal(t("archiveDiagnostics", { count: 2 }), "2 Archivhinweise");
  setLang("en");
});

test("interpolation fills named parameters and leaves unknown placeholders visible", () => {
  setLang("de");
  assert.equal(t("connectionsOf", { name: "Ada" }), "Verbindungen von Ada · in dieser Ansicht");
  assert.equal(t("connectionsOf"), "Verbindungen von {name} · in dieser Ansicht");
  setLang("en");
  // A value that itself contains braces must be inserted verbatim, not interpolated again.
  assert.equal(t("nodeLabel", { name: "{role}" }), "{role}. Open details.");
});

test("missing German text falls back to English, then to the key", () => {
  dictionaries.en.onlyInEnglish = "English only";
  setLang("de");
  assert.equal(t("onlyInEnglish"), "English only");
  assert.equal(t("no.such.key"), "no.such.key");
  assert.equal(has("onlyInEnglish"), true);
  assert.equal(has("no.such.key"), false);
  delete dictionaries.en.onlyInEnglish;
  setLang("en");
});

test("unsupported languages are ignored", () => {
  setLang("de");
  assert.equal(setLang("fr"), "de");
  assert.equal(lang(), "de");
  setLang("en");
});

test("German and English define the same keys", () => {
  const english = Object.keys(dictionaries.en).sort();
  const german = Object.keys(dictionaries.de).sort();
  assert.deepEqual(german, english);
  for (const key of english) {
    assert.equal(typeof dictionaries.en[key] === "object", typeof dictionaries.de[key] === "object", `${key} plural shape`);
  }
});

test("every key used by the static shell and the app exists", () => {
  const html = read("index.html");
  const app = read("app.js");
  const keys = new Set();
  for (const [, key] of html.matchAll(/data-i18n="([^"]+)"/gu)) keys.add(key);
  for (const [, pairs] of html.matchAll(/data-i18n-attr="([^"]+)"/gu)) {
    for (const pair of pairs.split(";")) keys.add(pair.split(":")[1].trim());
  }
  for (const [, key] of app.matchAll(/\bt\("([^"]+)"/gu)) keys.add(key);
  for (const [, key] of app.matchAll(/"((?:family)\.\w+)"/gu)) keys.add(key);
  // Values of known() are looked up as group.value, so every value the data can carry must be translated.
  for (const group of ["role.mother", "role.father", "role.parent", "kind.person", "kind.source", "kind.event", "kind.relationship", "kind.place", "kind.media",
    "status.accepted", "status.tentative", "status.disputed", "status.rejected", "relation.biological", "relation.adoptive", "relation.foster", "relation.partner", "relation.evidence", "relation.event"]) {
    keys.add(group);
  }
  const missing = [...keys].filter((key) => !Object.hasOwn(dictionaries.en, key) || !Object.hasOwn(dictionaries.de, key));
  assert.deepEqual(missing, []);
});
