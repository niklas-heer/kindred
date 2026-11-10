// Finds translation keys nothing uses. A key counts as used when its full dotted name appears as a string anywhere in
// the code (outside the dictionary files), or when it sits under a dynamically built prefix: `today.q.${id}`,
// "history.reply." + kind, and so on. Every key under such a prefix is kept, so the list never holds a false positive
// for those. Template literals that start with a placeholder cannot be resolved; they are reported as `unresolved`.
//
//   node scripts/unused-i18n-keys.ts            list the unused keys
//   node scripts/unused-i18n-keys.ts --remove   delete them from every area file (en, de and af)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const AREAS_DIR = join(root, "src/lib/i18n/areas");
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

/** The English keys of one area file, with the line range of each entry in the `en` object. */
export function areaKeys(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const enBlock = text.slice(text.indexOf("export const en"), text.indexOf("export const de"));
  return [...enBlock.matchAll(/^ {2}"([^"]+)":/gm)].map((m) => m[1]);
}

export interface Report {
  keys: string[];
  /** Nothing names the key and no code holds its English text: safe to delete. */
  unused: string[];
  /** No code names the key, but its English text (or the fixed part of it) appears in code, where a thrown sentence is looked up by its text. Left alone. */
  unsure: string[];
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
  const source = SCAN.flatMap((d) => walk(join(root, d)))
    .filter((f) => !f.startsWith(AREAS_DIR) && !f.endsWith("unused-i18n-keys.ts") && !f.endsWith("unused-i18n-keys.test.ts"))
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
  const prefixList = [...prefixes];
  const words = new Set([...all.matchAll(/[\w.-]+/g)].map((m) => m[0].replace(/^\.+|\.+$/g, "")));
  const named = keys.filter((k) => words.has(k) || prefixList.some((p) => k.startsWith(p)));
  const rest = keys.filter((k) => !named.includes(k));
  // The server throws English sentences that the client looks up by their text (translateMessage), so the text counts.
  const textUsed = (k: string) =>
    english.get(k)!.some((form) => {
      const longest = form.split(/\{\w+\}/).reduce((a, b) => (b.length > a.length ? b : a), "").trim();
      return longest.length >= (form.includes("{") ? 8 : 1) && all.includes(longest);
    });
  const unsure = rest.filter(textUsed);
  const unused = rest.filter((k) => !unsure.includes(k));
  return { keys, unused, unsure, prefixes: prefixList.sort(), unresolved };
}

/** Removes the entries of `drop` from the en, de and af objects of one area file. An entry runs from its key line to the next key, comment or closing brace. */
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
    for (const f of readdirSync(AREAS_DIR).filter((n) => n.endsWith(".ts"))) {
      const p = join(AREAS_DIR, f);
      const before = readFileSync(p, "utf8");
      const after = removeKeys(before, drop);
      if (after !== before) writeFileSync(p, after);
    }
  }
  console.log(report.unused.join("\n"));
  console.error(`${report.unsure.length} more may be used through their English text: ${report.unsure.join(" ")}`);
  console.error(`${report.keys.length} keys, ${report.unused.length} unused, ${report.prefixes.length} dynamic prefixes, ${report.unresolved.length} unresolved`);
  for (const u of report.unresolved) console.error(`unresolved: ${u}`);
  process.exitCode = report.unused.length && !process.argv.includes("--remove") ? 1 : 0;
}
