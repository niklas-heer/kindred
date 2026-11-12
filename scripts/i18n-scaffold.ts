// Keeps src/lib/i18n/locales/ in step with the areas: every language other than English has one file per area (an empty
// one to fill in, when new) and an index.ts that merges them, which the server's catalog imports. Run it after adding an
// area or a language; the i18n test fails while it would change anything (docs/translating.md).
//
//   node scripts/i18n-scaffold.ts           write what is missing or out of date
//   node scripts/i18n-scaffold.ts --check   only list it, and exit 1 when there is something
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES, LOCALES, type Locale } from "../src/lib/i18n/languages.ts";

const I18N = fileURLToPath(new URL("../src/lib/i18n/", import.meta.url));
const AREAS = join(I18N, "areas");
const LOCALES_DIR = join(I18N, "locales");

/** The areas, by file name without `.ts`, in a stable order. */
export const areaNames = () =>
  readdirSync(AREAS)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => f.slice(0, -3))
    .sort();

const ident = (area: string) => area.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

/** The header line of a language's file for an area. */
export const headerOf = (locale: Locale, area: string) =>
  `// ${LANGUAGES[locale].english} (${LANGUAGES[locale].address}): the words of src/lib/i18n/areas/${area}.ts. English there is the source; keys are the same.`;

export function stub(locale: Locale, area: string): string {
  return `${headerOf(locale, area)}
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/${area}.ts";

export default {
} satisfies Strings<typeof en, "${locale}">;
`;
}

export function indexOf(locale: Locale, areas: readonly string[]): string {
  return `// Every area of ${LANGUAGES[locale].english}, merged. Written by \`node scripts/i18n-scaffold.ts\`; do not edit it by hand.
${areas.map((a) => `import ${ident(a)} from "./${a}.ts";`).join("\n")}

export default {
${areas.map((a) => `  ...${ident(a)},`).join("\n")}
};
`;
}

/** What is missing or out of date: [path, content] for each file to write. */
export function plan(): [string, string][] {
  const areas = areaNames();
  const out: [string, string][] = [];
  for (const locale of LOCALES) {
    if (locale === "en") continue;
    const dir = join(LOCALES_DIR, locale);
    for (const area of areas) {
      const file = join(dir, `${area}.ts`);
      if (!existsSync(file)) out.push([file, stub(locale, area)]);
    }
    const index = join(dir, "index.ts");
    const want = indexOf(locale, areas);
    if (!existsSync(index) || readFileSync(index, "utf8") !== want) out.push([index, want]);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const todo = plan();
  if (process.argv.includes("--check")) {
    for (const [file] of todo) console.log(file);
    process.exitCode = todo.length ? 1 : 0;
  } else {
    for (const [file, content] of todo) {
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, content);
    }
    console.log(`${todo.length} file(s) written`);
  }
}
