// Makes the emoji palette's data (src/lib/emoji/), so the palette never asks a third party for anything (docs/responses.md).
//
//   npm pack emojibase-data@18.0.0 cldr-annotations-full@49.0.0 cldr-annotations-derived-full@49.0.0
//   (unpack each into <dir>/<name>, as `tar xzf <tgz> -C <dir>/<name>`)
//   node scripts/emoji-data.ts <dir>
//
// Sources: emojibase-data (MIT; its names are Unicode CLDR's) for the emoji, their order and group, and the English and
// German names and keywords; Unicode CLDR's annotations (Unicode licence) for every other language (CLDR_LANGUAGE below),
// read the same way for each, so a new language is one line there.
// Neither is a dependency of the app: only the files written here are.
//
// What is kept: every fully-qualified emoji of Emoji 15.0 or older (widely drawn by phones and computers), without skin
// tones (one form each), without the components (a hair colour alone) and without the regional letters. Written:
//   emoji.json         [[emoji, group], ...] in Unicode's order; group 0-8 as GROUPS in src/lib/emoji/index.ts
//   names.<locale>.json  one string per emoji, in the same order: its name, then "|" and its keywords, all lower case
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/emoji-data.ts <dir with emojibase-data, cldr-annotations-full and cldr-annotations-derived-full unpacked>');
  process.exit(2);
}
const out = join(import.meta.dirname, '..', 'src', 'lib', 'emoji');
const read = <T>(...path: string[]) => JSON.parse(readFileSync(join(dir, ...path), 'utf8')) as T;

interface Entry { emoji: string; label: string; tags?: string[]; group?: number; order?: number; version: number; hexcode: string }
interface Compact { hexcode: string; label: string; tags?: string[] }
type Cldr = Record<string, { default?: string[]; tts?: string[] }>;

const MAX_VERSION = 15.0;
/** emojibase's groups, without the components (2): what the palette's tabs are, in this order. */
const GROUPS = [0, 1, 3, 4, 5, 6, 7, 8, 9];

const en = read<Entry[]>('emojibase-data', 'package', 'en', 'data.json')
  .filter((e) => e.group !== undefined && GROUPS.includes(e.group) && e.version <= MAX_VERSION)
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

const de = new Map(read<Compact[]>('emojibase-data', 'package', 'de', 'compact.json').map((e) => [e.hexcode, e]));

/** Kindred's locale and the CLDR locale its names come from (CLDR's `pt` is Brazilian, its `zh` Simplified). */
const CLDR_LANGUAGE: Record<string, string> = { af: 'af', es: 'es', fr: 'fr', it: 'it', nl: 'nl', pl: 'pl', 'pt-BR': 'pt', ja: 'ja', 'zh-Hans': 'zh' };
const cldr = (lang: string): Cldr => ({
  ...read<{ annotations: { annotations: Cldr } }>('cldr-annotations-full', 'package', 'annotations', lang, 'annotations.json').annotations.annotations,
  ...read<{ annotationsDerived: { annotations: Cldr } }>('cldr-annotations-derived-full', 'package', 'annotationsDerived', lang, 'annotations.json').annotationsDerived.annotations,
});
/** CLDR writes most emoji without the presentation selector. */
const bare = (s: string) => s.replace(/️/g, '');

const line = (label: string | undefined, tags: string[] | undefined) => {
  if (!label) return '';
  const words = [...new Set((tags ?? []).map((t) => t.toLowerCase()).filter((t) => t && t !== label.toLowerCase()))];
  return words.length ? `${label.toLowerCase()}|${words.join(' ')}` : label.toLowerCase();
};

const emoji = en.map((e) => [e.emoji, GROUPS.indexOf(e.group!)]);
const names = {
  en: en.map((e) => line(e.label, e.tags)),
  de: en.map((e) => { const d = de.get(e.hexcode); return line(d?.label, d?.tags); }),
  ...Object.fromEntries(Object.entries(CLDR_LANGUAGE).map(([locale, lang]) => {
    const table = cldr(lang);
    return [locale, en.map((e) => { const a = table[e.emoji] ?? table[bare(e.emoji)]; return line(a?.tts?.[0], a?.default); })];
  })),
};

writeFileSync(join(out, 'emoji.json'), `${JSON.stringify(emoji)}\n`);
for (const [lang, list] of Object.entries(names)) writeFileSync(join(out, `names.${lang}.json`), `${JSON.stringify(list)}\n`);
const missing = Object.fromEntries(Object.entries(names).map(([lang, list]) => [lang, list.filter((s) => !s).length]));
console.log(`${emoji.length} emoji written to ${out}; without a name: ${JSON.stringify(missing)}`);
