// Checks the translations (src/lib/i18n/check.ts, docs/translating.md): for each language, or the ones named, the keys it
// lacks or has extra, placeholders and plural forms that do not match English, entries still in English, the formal
// address, kinship and page titles not yet written (errors: a language with any is not complete), and long button labels,
// English words left behind and glossary terms rendered another way (warnings, for a person to judge).
//
//   node scripts/i18n-check.ts              every language: a summary line each
//   node scripts/i18n-check.ts fr           one language: every finding, grouped by check, and the files the missing keys belong in
//   node scripts/i18n-check.ts fr --json    the findings as JSON, for a script or an agent
//   node scripts/i18n-check.ts fr --errors  only the errors
// Exit status 1 when a language marked complete (src/lib/i18n/languages.ts) has an error.
import { CHECKS, checkAll, type CheckName, type Finding } from "../src/lib/i18n/check.ts";
import { areaNames } from "./i18n-scaffold.ts";
import { KEYS } from "../src/lib/i18n/dictionary.ts";
import { LANGUAGES, LOCALES, isLocale, type Locale } from "../src/lib/i18n/languages.ts";

const args = process.argv.slice(2);
const named = args.filter((a) => !a.startsWith("--"));
for (const n of named) if (!isLocale(n) || n === "en") throw new Error(`i18n-check: not a language to check: ${n} (one of ${LOCALES.filter((l) => l !== "en").join(", ")})`);
const locales = (named.length ? named : LOCALES.filter((l) => l !== "en")) as Locale[];
let findings = checkAll(locales);
if (args.includes("--errors")) findings = findings.filter((f) => f.severity === "error");

if (args.includes("--json")) {
  console.log(JSON.stringify(findings, null, 2));
} else if (named.length) {
  for (const locale of locales) {
    const own = findings.filter((f) => f.locale === locale);
    const missing = own.filter((f) => f.check === "missing").length;
    console.log(`${locale} (${LANGUAGES[locale].english}): ${KEYS.length - missing} of ${KEYS.length} keys translated; ${count(own, "error")} errors, ${count(own, "warning")} warnings`);
    for (const check of Object.keys(CHECKS) as CheckName[]) {
      const these = own.filter((f) => f.check === check);
      if (!these.length) continue;
      console.log(`\n## ${check} (${CHECKS[check].severity}): ${CHECKS[check].what} — ${these.length}`);
      const shown = check === "missing" && !args.includes("--all") ? these.slice(0, 40) : these;
      for (const f of shown) console.log(`  ${f.key ?? ""}${f.key ? ": " : ""}${f.detail}`);
      if (shown.length < these.length) console.log(`  … and ${these.length - shown.length} more (--all lists them)`);
    }
    // Which file of the language each missing key belongs in: the words of the vocabularies (faiths, occupations, colours,
    // heraldic charges) are files like any other area.
    const missingKeys = own.filter((f) => f.check === "missing" && f.key).map((f) => f.key!);
    if (missingKeys.length) {
      const fileOf = new Map<string, string>();
      for (const area of areaNames()) for (const key of Object.keys(((await import(`../src/lib/i18n/areas/${area}.ts`)) as { en: object }).en)) fileOf.set(key, area);
      const per = new Map<string, number>();
      for (const key of missingKeys) per.set(fileOf.get(key) ?? "?", (per.get(fileOf.get(key) ?? "?") ?? 0) + 1);
      console.log(`\n## to fill: the missing keys by file`);
      for (const [area, n] of [...per].sort((a, b) => b[1] - a[1])) console.log(`  src/lib/i18n/locales/${locale}/${area}.ts: ${n}`);
    }
    console.log("");
  }
} else {
  for (const locale of locales) {
    const own = findings.filter((f) => f.locale === locale);
    const by = (Object.keys(CHECKS) as CheckName[]).map((c) => [c, own.filter((f) => f.check === c).length] as const).filter(([, n]) => n);
    const missing = own.filter((f) => f.check === "missing").length;
    const share = Math.floor(((KEYS.length - missing) / KEYS.length) * 100);
    console.log(`${locale.padEnd(8)} ${LANGUAGES[locale].complete ? "complete  " : "incomplete"} ${String(share).padStart(3)}%  ${by.map(([c, n]) => `${c} ${n}`).join(", ") || "clean"}`);
  }
}

function count(list: Finding[], severity: Finding["severity"]) {
  return list.filter((f) => f.severity === severity).length;
}
const broken = findings.filter((f) => f.severity === "error" && LANGUAGES[f.locale].complete);
process.exitCode = broken.length ? 1 : 0;
