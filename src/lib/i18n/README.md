# Translations

Three languages ship: **English** (`en`, the source of the key type), **German** (`de`, always "du") and
**Afrikaans** (`af`, always "jy"). Spanish, French, Italian, Dutch, Polish, Brazilian Portuguese, Japanese and Simplified
Chinese have their files and checks and wait for their words; a language is offered only once it is complete. Names, notes
and other family-written text are never translated. Translators start at [docs/translating.md](../../../docs/translating.md).

## Where things live

| File | What it is |
| --- | --- |
| `areas/<area>.ts` | The English words of one area of the app: `export const en`, a flat object of keys. The source of the key type. |
| `locales/<locale>/<area>.ts` | One language's words for that area: `export default { … } satisfies Strings<typeof en, "<locale>">`. `index.ts` beside them merges them; `node scripts/i18n-scaffold.ts` writes it and the empty file of a new area. |
| `languages.ts` | The registry: `LOCALES`, `LANGUAGES` (native name, Intl locale, flag, plural categories, address, Accept-Language tags, short months, `complete`), `negotiateLocale`, `offeredLocales`. Safe to import anywhere. |
| `types.ts` | `Locale`, `Message` (a string or a plural: a form per CLDR category, `other` always), `Strings`, `Vars`. |
| `dictionary.ts` | Merges English with each language's table, types `Key`, and holds `translate`, `formatDate`, `relativeTime`, `ordinal`, `translateMessage`, `missingKeys`, `pluralCategory`. No React, so the test runner loads it. |
| `catalog.ts` | The list of area modules (`AREAS`) and every other language's table, for the server and the test runner. Adding an area means adding it here. |
| `catalog.client.ts`, `browser-tables.ts` | The browser's catalog. `vite.config.ts` puts it in place of `catalog.ts` in the client build: English ships with the app, and each other language is one generated chunk that `loadLocale` fetches before hydration (`src/router.tsx`) and before the picker switches. |
| `vocabularies` | Faiths, colours, favourite words, occupations and the heraldry library's charges are dictionary areas (`faiths`, `favourites`, `occupations`, `charge-library`): `faith.name.<id>`, `colour.<id>`, `occupation.<id>`, `heraldry.library.<id>`. Their ids and search words are in `src/lib/faiths.ts`, `favourites.ts`, `occupations.ts` and `scripts/charge-library.tsv`. Code that matches what a reader typed uses `namesInEveryLanguage(key)` (the languages the page has) and rebuilds on `tablesVersion()`; `check.ts` holds these keys (`VOCABULARY_KEY`) to missing and extra only. |
| `check.ts`, `glossary/` | The translation checks (`node scripts/i18n-check.ts`, and the tests for every complete language) and the glossary of Kindred's terms (`en.json`) with each language's rendering. |
| `index.tsx` | React: `I18nProvider` and `useT()`. It re-exports `dictionary.ts`. |
| `../../components/LanguagePicker.tsx` | The language picker (a flag and a list of native names) and `LanguageChoices`, the phone's row. |
| `kinship.ts`, `kinship/` | `kinshipLabel`, `yourKinship`, `yourKinshipParts`: relation words in each language from graph labels, and "your …" with the possessive agreeing with the word ("dein Vater", "deine Cousine", "die Ehefrau deines Cousins"), one module per language (`kinship/<locale>.ts`, a neutral stub until written) and `kinship/cases.ts`, the table every module answers. Never build "your {kin}" from a key. |
| `titles.ts` | `localizeTitle`: the section word of a page title in each language. |
| `request.ts` | `requestLocale`: the locale for a request, for the root route to serialise. |
| `i18n.test.ts` | Areas hold English only and every language has its files; the registry agrees with Intl; plurals, negotiation and the instance's languages; no key is in two areas. |
| `no-hardcoded.test.ts`, `hardcoded-scan.ts` | The guard: no English written into a screen, no thrown sentence the dictionary lacks, and every check of `check.ts` on every complete language (no key missing, no entry still in English, du and jy throughout, placeholders and plurals). Its short allowlists hold the genuine exceptions. |

## Adding or changing a string

1. Pick the area that owns the screen (table below). Add the key to its `en`, and the words to every complete language's
   file: `locales/de/<area>.ts` (German, du) and `locales/af/<area>.ts` (Afrikaans, jy). A complete language's file is
   typed over every `en` key, so `npx tsc --noEmit` fails until it is there. A language still being translated gets the
   key from its translation lane.
2. Name the key `area.snake_case_name` (existing keys keep their names). Keys are unique across the whole app.
3. In components: `const t = useT();` then `t('shell.tree')`, `t('common.people', { count: 3 })`.
   In server code: `translate(locale, 'ai.errBudget', vars)` with the request's own locale. Never keep a
   locale in a global.
4. Run `npm test` (it catches a key missing from a complete language, present in two areas, or text left in the code), and
   `node scripts/i18n-check.ts de` to see the warnings.
5. A sentence thrown on the server is English with a key of the same text, and the client shows it through `translateMessage`. Lower-case messages are codes, which the UI maps.

Plurals are `{ one: '…{count}…', other: '…{count}…' }`, chosen by `Intl.PluralRules` for each language: a language gives
the CLDR categories it needs (Polish `one`, `few`, `many`, `other`; Japanese `other` alone) and a missing one takes `other`.
Placeholders are `{name}`; numbers are formatted for the locale. Keep placeholders identical in every language.
A sentence with a link or a bold name inside is still one key: `"{author} hat einen Spruch von {subject} festgehalten"`,
rendered with `richText(t, key, { author: <b>…</b>, subject: <PersonLink … /> })`. Never glue a sentence from a subject,
a verb key and an object: German puts the participle last.

## German: naming people by role

- Name the task or the group, not the person: roles are „Lesen“, „Mitwirken“, „Bearbeiten“, „Verwalten“; groups are „die Familienverwaltung“, „alle mit Bearbeitungsrecht“, „Lesende“, „Mitwirkende“ (neutral in the plural).
- Where one person must be named, write both forms in full („eine Verwalterin oder ein Verwalter“, „Partner oder Partnerin“): no colon, slash or generic masculine. The one exception is an occupation of a person whose sex is `x` or unknown („Lehrer:in“, below).

One feature, one name in every place (menu, heading, page title, tour): German Kalender, Fehlende Angaben, Verzeichnis, Filter,
Minikarte, Darstellung, Stammbaum (the phone tab says „Baum“); Afrikaans Almanak, Inligting nodig, Register, lens, minikaart, tema,
Stamboom (the phone tab says „Boom“).

## Areas

| Area | Owns |
| --- | --- |
| `common` | Buttons, states, units and generic labels shared by all screens (`ui.*`, `common.*`) |
| `shell` | Navigation, the home page of families, the ⌘K palette and its commands (`shell.*`, `index.*`) |
| `tree` | The family tree canvas, its minimap and the first-run question (`canvas.*`, `firstrun.*`) |
| `panel` | The person panel: facts, relatives, contact details, memories (`panel.*`, `fact.*`) |
| `fields` | The person editor and detail fields, labels, inputs, the Markdown editor, validation |
| `photos` | The gallery, albums, the lightbox, uploads and profile photos (`gallery.*`, `lb.*`, `up.*`) |
| `ai` | The assistant, AI settings, proposals, portrait and arms suggestions (`ai.*`) |
| `exchange` | Import and export: GEDCOM and the Markdown archive (`exchange.*`) |
| `houses` | Houses, succession, arms and their chronicle |
| `heraldry`, `charge-library` | Coats of arms and the heraldry designer; the names of the library's 590 charges |
| `portrait` | The character editor and drawn portraits |
| `access` | Sign-in, passkeys, invitations, roles, the account menu, not-found and no-access states |
| `setup` | First-time setup of a server |
| `print` | The Print page and everything on paper: the charts, the family book, the colophon (`print.*`) |
| `tour` | The guided tours: the first-run offer, the Tours dialog, the card's buttons and each step's words (`tour.*`, the grand tour's under `tour.g.*`); `docs/tours.md` |
| `today`, `today-questions` | Today: the page, its cards, the quiz and the stewards' switch (`today.*`); the sixty questions of the week (`today.q.*`) |
| `whois` | "Who is this?": naming people in untagged photographs, its card, page and confirmations (`whois.*`) |
| `campaign` | The Campaign: the game between the houses, its practice skirmish, the Today card and the stewards' Games page (`campaign.*`) |
| `history` | The change history: the History page, a person's history, "What's new" and the weekly push (`history.*`) |
| `feed` | The family's feed on Today: messages, the composer, the stream's lines, the strip of cards on a phone, the push about a new message (`feed.*`) |
| `recipes` | Recipes: the Cookbook, a recipe's page, cooking mode and the recipe form (`recipes.*`) |
| `faiths`, `favourites`, `occupations` | The vocabularies: faiths (`faith.tradition.*`, `faith.name.*`), colours and favourite words (`colour.*`, `favourite.*`), occupations (`occupation.*`) |
| `atlas`, `almanac`, `chronicle`, `contacts`, `needed` | Empty until the translation sweep moves those pages' text here |

## Language choice

- Guests keep their language in `localStorage` and a cookie (`kindred_locale_guest`).
- A signed-in reader's choice is also saved on the account (`user.locale`, migration `accounts/0004_locale`,
  `setMyLocale`). The server renders the stored value first, then that reader's cookie, then `Accept-Language`,
  then English, skipping any language the instance does not offer (`requestLocale`, `offeredLanguages` in
  `src/lib/operator/settings.server.ts`: the operator's choice, complete languages only). The language picker (a flag
  that opens the native names) is in the top bar's tools, the sign-in card's corner and the home page; on phones it is a
  row in the More sheet. The ⌘K palette's "Change language" opens the same list. All of them list `useT().offered`, and
  none is shown when English is the only language.

## What the browser downloads

Every language is about 70 kB gzipped, so the browser does not get them all. It always has English: the fallback for a
missing entry, and the language of server errors (`translateMessage`), the blazon and canting. Any other language comes as
one more chunk when the page was rendered in it or the reader picks it. The server holds every language.
`translate()` stays synchronous everywhere; in the browser, a language not loaded yet falls back to English, so call
`loadLocale(locale)` first wherever a new language appears (the root route, the router's `hydrate`, `setLocale`).

## Occupations (`src/lib/occupations.ts`)

Each occupation has a stable `id`, search keywords, and a label per language in the dictionary (`occupation.<id>` in
`areas/occupations.ts` and each language's `occupations.ts`). A language with a masculine and a feminine form writes
`"masculine|feminine"` ("Bäcker|Bäckerin"); one without writes a single form. A person keeps the text the family typed in
`person.occupation` and, when it names a vocabulary entry, the entry's id in `person.occupation_code` (tree migration
`0006_occupation`).

- With a code, every reader sees the entry in their language. A language with two forms gives the one for the person's
  sex: "Bäcker" for `m`, "Bäckerin" for `f`, and for `x` or unknown the pair (German "Bäcker:in", another language
  "masculine/feminine").
- Without a code, the text is shown exactly as written. The editor suggests entries as you type, in any language.
- `scripts/map-occupations.ts` gives codes to existing text, once, after the migration. It is a one-off script rather
  than migration-on-open, because the matching needs the vocabulary's labels and the migrations are SQL that runs on
  both SQLite and D1. It never changes the text.
- "Translate" (shown when the family's assistant is on and the occupation has no code) asks the model once per text
  and locale, then keeps the answer in `occupation_translation`. The translation is shown beside the text, never in
  its place.

## Testing note

`npm test` runs `.ts` files directly with Node's type stripping. Code that a test imports must therefore avoid JSX,
TypeScript parameter properties and enums, and must import relative modules with an explicit `.ts` extension. That is
why the dictionary, the formatters and the occupation rules live in `.ts` files and the React code in `index.tsx`.
