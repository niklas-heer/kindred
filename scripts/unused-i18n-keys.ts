// Finds translation keys nothing uses. A key counts as used when its full dotted name appears as a string anywhere in
// the code (outside the dictionary files), or when it sits under a dynamically built prefix: `today.q.${id}`,
// "history.reply." + kind, and so on. Every key under such a prefix is kept, so the list never holds a false positive
// for those. Template literals that start with a placeholder cannot be resolved; they are reported as `unresolved`.
//
// One more way to be used: the server throws English sentences and the client finds the key by that text
// (translateMessage in src/lib/i18n/dictionary.ts). So a key in a namespace of thrown sentences (`TEXT_KEYED`) is used
// when its English is a whole string literal in the code (outside tests), unless an earlier key has the same English and
// wins the lookup. This applies to those namespaces only: a "Try again" or "Name" somewhere does not keep any other key alive.
//
//   node scripts/unused-i18n-keys.ts            list the unused keys
//   node scripts/unused-i18n-keys.ts --remove   delete them from every area file and every language's file (locales/)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const AREAS_DIR = join(root, "src/lib/i18n/areas");
const LOCALES_DIR = join(root, "src/lib/i18n/locales");
const SCAN = ["src", "server", "scripts", "e2e"];
const EXT = /\.(?:ts|tsx|js|mjs|json)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}

/** The English keys of one area file: the entries of its `en` object (the only language an area file holds). */
export function areaKeys(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const enBlock = text.slice(text.indexOf("export const en"));
  return [...enBlock.matchAll(/^ {2}"([^"]+)":/gm)].map((m) => m[1]);
}

/**
 * The keys that are looked up by their English text: errors the server throws (`err.`, `auth.`, `x.err.y`), the lines of
 * the GEDCOM export's loss report, and the few sentences and labels that are thrown or sent as English and translated by
 * the reader (`translateMessage`): the Almanac's labels, the passkey device names, "Confirm it's you", a changed link.
 */
export const TEXT_KEYED = /^(?:err|auth)\.|\.err\.|^exchange\.loss\.|^(?:proof\.needed|acc\.linkChanged)$/;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface Report {
  keys: string[];
  /** Nothing names the key and no thrown sentence is its English text: safe to delete. */
  unused: string[];
  /** Not named, but a sentence the code throws is its English text (`TEXT_KEYED`), so the reader finds it by that text. Used. */
  byText: string[];
  prefixes: string[];
  unresolved: string[];
}

export async function findUnused(): Promise<Report> {
  const areaFiles = readdirSync(AREAS_DIR).filter((f) => f.endsWith(".ts")).map((f) => join(AREAS_DIR, f));
  const keys = areaFiles.flatMap(areaKeys);
  const english = new Map<string, string[]>();
  for (const f of areaFiles) {
    const area = (await import(f)).en as Record<string, string | { one: string; other: string }>;
    for (const [k, v] of Object.entries(area)) english.set(k, typeof v === "string" ? [v] : [v.one, v.other]);
  }
  const firstSegments = new Set(keys.map((k) => k.split(".")[0]));
  const { KEYS: lookupOrder } = await import("../src/lib/i18n/dictionary.ts");
  const source = SCAN.flatMap((d) => walk(join(root, d)))
    .filter((f) => !f.startsWith(AREAS_DIR) && !f.startsWith(LOCALES_DIR) && !f.endsWith("unused-i18n-keys.ts") && !f.endsWith("unused-i18n-keys.test.ts"))
    .map((f) => ({ file: relative(root, f), text: readFileSync(f, "utf8") }));
  const all = source.map((s) => s.text).join("\n");

  const prefixes = new Set<string>();
  const unresolved: string[] = [];
  const addPrefix = (p: string) => {
    if (p.includes(".") && firstSegments.has(p.split(".")[0])) prefixes.add(p);
  };
  for (const { file, text } of source) {
    // "area.name_" + x   or   'area.' + x
    for (const m of text.matchAll(/["'`]([a-z][a-z0-9]*(?:\.[a-z0-9_]+)*[._])["'`]\s*\+/g)) addPrefix(m[1]);
    // `area.name_${x}`: the text before the first placeholder, when it is a dotted name
    for (const m of text.matchAll(/`([a-z][a-z0-9]*(?:\.[a-z0-9_]+)*[._]?)\$\{/g)) addPrefix(m[1]);
    // t(`${x}.name`) and friends: cannot be resolved
    for (const m of text.matchAll(/\bt\(\s*`\$\{[^}]*\}[^`]*`/g)) unresolved.push(`${file}: ${m[0]}`);
  }
  const literals = new Set<string>();
  const regexes: RegExp[] = [];
  for (const { file, text } of source) {
    if (/\.test\.tsx?$/.test(file)) continue;
    for (const m of text.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
      const raw = m[1] ?? m[2] ?? m[3] ?? "";
      const body = raw.replace(/\\(.)/g, "$1");
      if (m[3] !== undefined && body.includes("${")) regexes.push(new RegExp(`^${body.split(/\$\{[^}]*\}/).map(escapeRegExp).join(".+")}$`));
      else literals.add(body);
    }
  }
  const prefixList = [...prefixes];
  const words = new Set([...all.matchAll(/[\w.-]+/g)].map((m) => m[0].replace(/^\.+|\.+$/g, "")));
  // A key that ends in a dot (`t("notfoundpage.")`) is lost by the word scan, which trims dots, so also look for the whole literal.
  const named = keys.filter((k) => words.has(k) || literals.has(k) || prefixList.some((p) => k.startsWith(p)));
  const rest = keys.filter((k) => !named.includes(k));
  // The server throws English sentences that the client looks up by their text (translateMessage), so a key whose English is
  // a whole string literal in the code is used. It must be the whole literal (a template literal with its `${}` parts as
  // wildcards): a word that merely appears inside a comment or a longer sentence does not make "Name" or "Try again" used.
  // The lookup takes the first key with that English, so a later one with the same text is never found.
  const firstWith = new Map<string, string>();
  for (const k of lookupOrder as string[]) for (const form of english.get(k) ?? []) if (!firstWith.has(form)) firstWith.set(form, k);
  const textUsed = (k: string) =>
    TEXT_KEYED.test(k) && english.get(k)!.every((form) => (firstWith.get(form) ?? k) === k) &&
    english.get(k)!.some((form) => {
      // The code may add a leading count or name itself ("{count} story is not exported" is built from "story is not exported").
      const bare = form.replace(/^\{\w+\} /, "");
      const shapes = [form, bare];
      if (!form.includes("{")) return literals.has(form) || regexes.some((re) => re.test(form));
      return shapes.some((s) => (!s.includes("{") && literals.has(s)) || textMatches(s));
    });
  /** Whether some template literal in the code, with its placeholders as wildcards, can produce this English template. */
  const textMatches = (template: string) => {
    const fixed = template.split(/\{\w+\}/);
    const filled = fixed.join("\u0001");
    return regexes.some((re) => re.test(filled.replace(/\u0001/g, "x")));
  };
  const byText = rest.filter(textUsed);
  const unused = rest.filter((k) => !byText.includes(k));
  return { keys, unused, byText, prefixes: prefixList.sort(), unresolved };
}

/** Removes the entries of `drop` from the objects of one area file or one language's file. An entry runs from its key line to the next key, comment or closing brace. */
export function removeKeys(text: string, drop: Set<string>): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const m = /^ {2}"([^"]+)":/.exec(line);
    if (m) skipping = drop.has(m[1]);
    else if (/^(?: {2}\/\/|\};?|export |\s*$)/.test(line) || /^ {2}\/\*/.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  return out.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = await findUnused();
  if (process.argv.includes("--remove")) {
    const drop = new Set(report.unused);
    const files = [
      ...readdirSync(AREAS_DIR).filter((n) => n.endsWith(".ts")).map((f) => join(AREAS_DIR, f)),
      ...readdirSync(LOCALES_DIR).flatMap((l) => readdirSync(join(LOCALES_DIR, l)).filter((n) => n.endsWith(".ts") && n !== "index.ts").map((f) => join(LOCALES_DIR, l, f))),
    ];
    for (const p of files) {
      const before = readFileSync(p, "utf8");
      const after = removeKeys(before, drop);
      if (after !== before) writeFileSync(p, after);
    }
  }
  console.log(report.unused.join("\n"));
  console.error(`${report.keys.length} keys, ${report.unused.length} unused, ${report.byText.length} found by their English text, ${report.prefixes.length} dynamic prefixes, ${report.unresolved.length} unresolved`);
  for (const u of report.unresolved) console.error(`unresolved: ${u}`);
  process.exitCode = report.unused.length && !process.argv.includes("--remove") ? 1 : 0;
}
