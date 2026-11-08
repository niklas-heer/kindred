# Translations

Three languages ship: **English** (`en`, the source of the key type), **German** (`de`, always "du") and
**Afrikaans** (`af`, always "jy"). Names, notes and other family-written text are never translated.

## Where things live

| File | What it is |
| --- | --- |
| `areas/<area>.ts` | The words of one area of the app: `export const en`, `de` and `af`, each a flat object of keys. |
| `types.ts` | `Locale`, `LOCALES`, `Message` (a string or `{one, other}`), `Vars`, `isLocale`. Safe to import anywhere. |
| `dictionary.ts` | Merges every area, types `Key`, and holds `translate`, `formatDate`, `relativeTime`, `ordinal`, `negotiateLocale`, `translateMessage`, `missingKeys`. No React, so the test runner loads it. |
| `index.tsx` | React: `I18nProvider` and `useT()`. It re-exports `dictionary.ts`. |
| `../../components/LanguagePicker.tsx` | The language picker (a flag and a list of native names) and `LanguageChoices`, the phone's row. |
| `kinship.ts` | `kinshipLabel`: relation words for German and Afrikaans, from graph labels. |
| `titles.ts` | `localizeTitle`: the section word of a page title in each language. |
| `request.ts` | `requestLocale`: the locale for a request, for the root route to serialise. |
| `i18n.test.ts` | Every area has the same keys in `en` and `de`; no key is in two areas; the Afrikaans coverage is reported. |

## Adding or changing a string

1. Pick the area that owns the screen (table below). Add the key to that file, in **all three** objects:
   `en` (English), `de` (German, du) and `af` (Afrikaans, jy). `de` is typed over every `en` key, so
   `npx tsc --noEmit` fails until it is there. `af` may lag: a missing Afrikaans entry falls back to English,
   and the test prints it.
2. Name the key `area.snake_case_name` (existing keys keep their names). Keys are unique across the whole app.
3. In components: `const t = useT();` then `t('shell.tree')`, `t('common.people', { count: 3 })`.
   In server code: `translate(locale, 'ai.errBudget', vars)` with the request's own locale. Never keep a
   locale in a global.
4. Run `npm test` (the area test catches a key missing from `de` or present in two areas).

Plurals are `{ one: '…{count}…', other: '…{count}…' }`, chosen by `Intl.PluralRules` for each language.
Placeholders are `{name}`; numbers are formatted for the locale. Keep placeholders identical in every language.

## Areas

| Area | Owns |
| --- | --- |
| `common` | Buttons, states, units and generic labels shared by all screens (`ui.*`, `common.*`) |
| `shell` | Navigation, the home page of families, the ⌘K palette and its commands (`shell.*`, `index.*`) |
| `tree` | The family tree canvas, its minimap and the first-run tour (`canvas.*`, `firstrun.*`) |
| `panel` | The person panel: facts, relatives, contact details, memories (`panel.*`, `fact.*`) |
| `fields` | The person editor and detail fields, labels, inputs, the Markdown editor, validation |
| `photos` | The gallery, albums, the lightbox, uploads and profile photos (`gallery.*`, `lb.*`, `up.*`) |
| `ai` | The assistant, AI settings, proposals, portrait and arms suggestions (`ai.*`) |
| `exchange` | Import and export: GEDCOM and the Markdown archive (`exchange.*`) |
| `houses` | Houses, succession, arms and their chronicle |
| `heraldry` | Coats of arms and the heraldry designer |
| `portrait` | The character editor and drawn portraits |
| `access` | Sign-in, passkeys, invitations, roles, the account menu, not-found and no-access states |
| `setup` | First-time setup of a server |
| `atlas`, `almanac`, `chronicle`, `contacts`, `needed` | Empty until the translation sweep moves those pages' text here |

## Language choice

- Guests keep their language in `localStorage` and a cookie (`kindred_locale_guest`).
- A signed-in reader's choice is also saved on the account (`user.locale`, migration `accounts/0004_locale`,
  `setMyLocale`). The server renders the stored value first, then that reader's cookie, then `Accept-Language`,
  then English. The language picker (a flag that opens the three native names) is in the top bar's tools, the
  sign-in card's corner and the home page; on phones it is a row in the More sheet. The ⌘K palette's "Change
  language" opens the same three languages.

## Occupations (`src/lib/occupations.ts`)

Each occupation has a stable `id`, an English label, German masculine and feminine forms (`de.m`, `de.f`), an
Afrikaans label and search keywords. A person keeps the text the family typed in `person.occupation` and, when it
names a vocabulary entry, the entry's id in `person.occupation_code` (tree migration `0006_occupation`).

- With a code, every reader sees the entry in their language. German uses the form for the person's sex: "Bäcker"
  for `m`, "Bäckerin" for `f`, and "Bäcker:in" for `x` or unknown.
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
