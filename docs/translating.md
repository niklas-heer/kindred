# Translating Kindred

Kindred is written in English and translated into German (`de`) and Afrikaans (`af`). Spanish (`es`), French (`fr`),
Italian (`it`), Dutch (`nl`), Polish (`pl`), Brazilian Portuguese (`pt-BR`), Japanese (`ja`) and Simplified Chinese
(`zh-Hans`) have their files and checks in place and wait for their words. This guide is for whoever writes them, a person
or an agent. `src/lib/i18n/README.md` is the developer's side: how a screen uses the dictionary.

A language is offered to readers only once it is **complete**: every check below passes and `complete: true` is set in
`src/lib/i18n/languages.ts`. Until then the app runs in English wherever a word is missing, and nobody can choose the
language. Operators then choose which complete languages their server offers ([hosting many
families](hosting-many-families.md#languages)).

## Where the words are

| What | Where |
| --- | --- |
| English, the source and the list of keys | `src/lib/i18n/areas/<area>.ts` (`export const en`) |
| Your language, one file per area | `src/lib/i18n/locales/<locale>/<area>.ts` (`export default { … }`) |
| The language's facts: native name, Intl locale, plural categories, address, short months, date order, speech tag | `src/lib/i18n/languages.ts` |
| Kindred's terms with their meaning | `src/lib/i18n/glossary/en.json` |
| How your language renders them | `src/lib/i18n/glossary/<locale>.json` |
| Kinship words ("your great-aunt") | `src/lib/i18n/kinship/<locale>.ts`, answers in `kinship/cases.ts` |
| Page title section words | `TITLE_WORDS` in `src/lib/i18n/titles.ts` |
| Ordinals ("1er", "50.") | `ORDINAL_FORMS` in `src/lib/i18n/dictionary.ts` |
| Emoji names and keywords | `src/lib/emoji/names.<locale>.json`, generated from Unicode CLDR (`scripts/emoji-data.ts`); nothing to write |

A file in `locales/<locale>/` is typed against English: while the language is incomplete any key may be missing, and once
`complete` is set, `npx tsc --noEmit` fails on any gap. A key English does not have is always a type error. Never edit
`locales/<locale>/index.ts`: `node scripts/i18n-scaffold.ts` writes it, and the stubs for a new area.

## The procedure

1. Read `glossary/en.json` and write `glossary/<locale>.json`: for every term, how your language says it (`use`) and the
   lower-case stems a correct translation contains (`accept`, e.g. `["famili"]` for Familie, Familien). Agree on these
   before writing a sentence: one feature has one name in the menu, the heading, the page title and the tour.
2. Translate area by area. For each key of `areas/<area>.ts`, write the same key in `locales/<locale>/<area>.ts`. Keep the
   order of the English file; keep every `{placeholder}` exactly; give plurals the forms your language needs (below).
3. Run `node scripts/i18n-check.ts <locale>` and fix every error. Read every warning and fix the real ones.
4. Write `kinship/<locale>.ts` (below) and add your answer to every case in `kinship/cases.ts`.
5. Add your language to every word in `TITLE_WORDS`, and check its line in `ORDINAL_FORMS` and `shortMonths`.
6. When the check reports no errors, set `complete: true` in `languages.ts`, then run `npx tsc --noEmit`,
   `KINDRED_DATA_DIR=$(mktemp -d) node --test src/lib/i18n/*.test.ts src/lib/i18n/kinship/*.test.ts` and
   `node scripts/unused-i18n-keys.ts`. The tests run every check on every complete language.

`mise run i18n:check` runs the check for every language (a summary line each); `mise run i18n:check -- fr` for one.
`--json` gives the findings to a script, `--errors` only the errors, `--all` every missing key.

## What the check looks for

Errors keep a language from being complete:

- **missing** and **extra**: keys English has and yours does not, or the other way round.
- **placeholders**: `{name}` differs from the English form for the same count. `{count}` may be spelled out in a singular
  ("one person") and `{article}` is English's "a" or "an"; every other placeholder must appear.
- **plurals**: an English plural needs a form for each category a whole number reaches in your language, and no form your
  language never uses.
- **english**: an entry that is still the English text (more than one word, or an everyday word such as "Save"). A name,
  a brand or a true cognate goes in `sameAsEnglish` in your glossary, with the key.
- **address**: the formal address where Kindred speaks informally (below).
- **kinship**: `kinship/<locale>.ts` is still the neutral stub.
- **titles**: a page-title word without your language.

Warnings are for you to judge:

- **length**: a button or tab label more than 1.6 times as long as the English and at least 7 characters longer. The check
  finds those keys itself: `t('…')` among the children of a `<button>`, a `*Button` or a `<Tab>`. Prefer the shorter word
  your language allows; a long one can wrap or push the row apart on a phone.
- **leftover**: an English word ("the", "family", "save") from the key's own English, still in the translation. A word of
  your language that is spelled like an English one goes in `ownWords` in your glossary.
- **glossary**: a key whose English uses a term, whose translation contains none of that term's `accept` stems. Sometimes
  the sentence is right without the term ("chosen by you" where the reader is the steward); usually it is a stray synonym.

## Tone

Kindred speaks to one relative, warmly and plainly: short sentences, everyday words, no jargon, no exclamation marks, no
"please" in every sentence. It is a family's own place, so it uses the form relatives use with each other.

| Language | Address | Why |
| --- | --- | --- |
| German | **du** (always) | Already so; relatives say du. |
| Afrikaans | **jy** (always) | Already so; "u" is for strangers and elders in formal letters. |
| Spanish | **tú** | Relatives tutean; tú is understood everywhere, and *usted* reads as a bank. Neutral Spanish, no vosotros: one text serves Spain and Latin America (*ustedes* for "you all"). |
| French | **tu** | Families tutoient each other, and Kindred speaks as one of them; *vous* would make the app the only formal voice in the room. Keep *vous* for "you all" only where a sentence clearly speaks to several people. |
| Italian | **tu** | Italian apps and families both use tu; *Lei* is for officials. |
| Dutch | **je/jij** | Standard in Dutch software; *u* sounds like the tax office. |
| Polish | **ty** (second person singular) | Close and family-like. Avoid *Pan/Pani*; where a sentence would need the reader's grammatical gender, rephrase (impersonal or infinitive forms: "Zapisano", "Dodaj osobę") rather than write "zapisałeś/aś". |
| Brazilian Portuguese | **você** | The everyday form in Brazil; *tu* is regional and *o senhor/a senhora* formal. |
| Japanese | **polite です/ます** | Plain form reads as curt from an app, keigo as stiff. Avoid あなた; leave the subject out as Japanese does. |
| Simplified Chinese | **你**, neutral | Warm and plain; 您 is honorific and distant for a family app. Mainland usage and punctuation (，。：“”). |

Never translate names, places, a family's own words (notes, stories, mottos) or anything a person typed. Keep "Kindred".

## Plurals

A plural is an object with a form per CLDR category: `{ one: "{count} osoba", few: "{count} osoby", many: "{count} osób",
other: "{count} osoby" }`. `Intl.PluralRules` for the language's Intl locale picks the category from `count`, and a
category the entry leaves out takes `other`. Give the categories a whole number reaches in your language:

| Language | Forms to give |
| --- | --- |
| English, German, Afrikaans, Dutch | `one`, `other` |
| Spanish, Italian, Brazilian Portuguese | `one`, `other` (`many` exists for millions; leave it out) |
| French | `one` (0 and 1), `other` |
| Polish | `one`, `few`, `many`, `other` |
| Japanese, Chinese | `other` alone, or a plain string |

The check says which are missing. A sentence that is a plain string in English must stay a plain string: a count that
changes a word belongs in a plural in English first.

## Kinship

Relations are not dictionary keys: `graph.kinship()` names every relation in English ("great-aunt", "second cousin once
removed", "wife's sister's husband"), and `kinship/<locale>.ts` turns that into your language. A module is three functions
(`KinshipRules` in `kinship/shared.ts`):

- `label(k, view)`: the relation alone ("Großtante", "oupagrootjie"); `"you"` is the reader. `view` is `"you"` when seen
  from the reader and `"them"` when from a person named beside it, for languages where that changes the words ("Ehefrau
  deines Cousins" against "Ehefrau des Cousins").
- `your(list)`: with the reader's possessive, lower case, several relations joined with " & " ("deine Großmutter").
- `yourParts(k)`: `your()` of one relation in parts, the relation words marked `kin: true`, starting with a capital.

It must cover: a parent, child, sibling, uncle or aunt, nephew or niece whose sex is unknown (both words, or a neutral one);
any number of generations up and down ("2× great-grandmother" is never the same word as one generation); half-, step-,
foster and adoptive ties; in-laws, and a partner's relatives without a word of their own; cousins by degree, removal and
direction (`k.cousin.up`: a parent's cousin is above, a cousin's child below; `k.cousin.sex`); relations by marriage
("uncle's wife") and through someone ("stepfather's brother"); and "relative by marriage" with `k.sex`. `de.ts` shows a
language with grammatical gender and genitives, `af.ts` one with a single possessive (the `possessive()` helper).

Until a module is written, the language uses `neutral.ts`: the English word and no possessive, and the language cannot be
complete. `kinship/cases.ts` holds the cases every module answers, as `[label, your]` per locale; add yours to each.

## Numbers, dates and other words outside the dictionary

- Dates, times, numbers and sorting come from `Intl` with the language's `intl` locale. Abbreviated months are Kindred's own
  (`shortMonths` in `languages.ts`), because engines disagree on them and a page must read the same on the server and in
  every browser: check yours against your language's usual abbreviations in a date ("15 sept. 2020"). "About 1900" and
  "never" are keys (`date.circa`, `time.never`).
- Ordinals: `ORDINAL_FORMS` gives a form per ordinal category (`Intl.PluralRules` with `type: "ordinal"`), `{n}` the number.
- The date picker writes day, month and year as numbers in the order and with the separator the language says in
  `languages.ts` (`dateOrder`: `dmy`, or `ymd` for Japanese and Chinese; `dateSeparator`). A test compares them with
  `Intl`. A date typed or pasted is read in that order too (`8.8.1953`, `1953/8/8`, `1953年8月8日`), and the words that
  mean "about" before a date (`c.`, `ca.`, `um`) are the dictionary list `date.aboutWords`.
- Vocabularies are dictionary areas like any other, so your file lists what is missing and `tsc` fails on a gap once the
  language is complete: faiths (`faiths.ts`: `faith.tradition.*`, `faith.name.*`), colours and the usual favourites
  (`favourites.ts`), occupations (`occupations.ts`), the heraldry library's charges (`charge-library.ts`) and the first
  charges and tinctures (`heraldry.ts`). They are suggestion lists, so a reader can always type their own words, and the
  check holds them to "every key given" only, not to the prose checks (a name equal to the English is often right).
  Their search words (aliases and keywords, in `src/lib/faiths.ts`, `favourites.ts`, `occupations.ts` and
  `scripts/charge-library.tsv`) are language-neutral; add a spelling there only when your readers type one the names
  do not cover.
  - An occupation with a masculine and a feminine form (French, Spanish, Italian, Portuguese, Polish, German) is written
    `"masculine|feminine"` (`"Bäcker|Bäckerin"`); one without writes a single form. The reader sees the form for the
    person's sex, and the pair "masculine/feminine" (German: "Bäcker:in") when it is not known.
  - `favourites.ts` also holds the words that label a favourite colour (`favourite.colourLabels`, "colour, favourite
    colour") and the words that join colours (`favourite.joiners`, "and, or"), comma-separated: a family's own "blue and
    green" or "Farbe" gets swatches. `recipes.ts` holds `recipes.unitWords`, the units people write after an amount in
    a pasted ingredient list ("tbsp, cup, pinch"), comma-separated, in lower case.
- The assistant answers in `assistant` from `languages.ts` ("French, addressing the reader with \"tu\"").

## The files a language fills

Everything a new language needs, so none is forgotten. `node scripts/i18n-check.ts <locale>` lists the missing keys and
which file of yours each belongs in; `node scripts/i18n-scaffold.ts` writes an empty file for any area you lack.

1. `src/lib/i18n/glossary/<locale>.json`: how your language renders Kindred's terms (do this first).
2. `src/lib/i18n/locales/<locale>/<area>.ts`, one file per area of `src/lib/i18n/areas/` (57 of them), including the
   vocabularies: `faiths.ts`, `occupations.ts`, `favourites.ts`, `charge-library.ts`, the charge, tincture and shield
   names in `heraldry.ts`, the weekly questions in `today-questions.ts`, the recipe units in `recipes.ts`, and the
   words of dates and times in `common.ts`. Never `locales/<locale>/index.ts`: the scaffold writes it.
3. `src/lib/i18n/kinship/<locale>.ts` (replace the stub) and your answer in every case of `kinship/cases.ts`.
4. `TITLE_WORDS` in `src/lib/i18n/titles.ts` (your language on every word) and your line in `ORDINAL_FORMS` in
   `src/lib/i18n/dictionary.ts`.
5. Your entry in `src/lib/i18n/languages.ts`: check `shortMonths`, `dateOrder` and `dateSeparator`, `speech` (the tag
   the browser listens in), `formal` (the formal pronoun the app avoids, which the assistant is told), `jobForms`
   (a gendered job, "masculine/feminine", if the language has one), then `complete: true` when the check is clean.
6. Nothing for the emoji names (generated), the search words of the vocabularies (language-neutral), or the campaign's
   invented names (never translated).

## Adding a language that is not listed

1. Add it to `LOCALES` and `LANGUAGES` in `src/lib/i18n/languages.ts` with `complete: false`: a canonical BCP 47 tag, its
   native name, Intl locale, flag, plural categories (`new Intl.PluralRules(intl).resolvedOptions().pluralCategories`),
   address, the Accept-Language tags it answers and its short months. The test compares the plurals with Intl.
2. Run `node scripts/i18n-scaffold.ts`: it writes `locales/<locale>/` with an empty file per area and the index.
3. Add the import to `PRELOADED` in `catalog.ts`, the loader in `catalog.client.ts`, `kinship/<locale>.ts` (copy a stub) and
   its line in `kinship/index.ts`, and the CLDR locale in `CLDR_LANGUAGE` of `scripts/emoji-data.ts` (then run it, as its
   header says) and in `NAMES` of `src/lib/emoji/index.ts`.
4. `npx tsc --noEmit` lists every other table keyed by locale. A right-to-left script needs layout work beyond this guide.
