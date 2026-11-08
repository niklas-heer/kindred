# Exchange: GEDCOM and the Markdown archive

A family can leave Kindred as a **GEDCOM 5.5.1** file, which other genealogy programs read, or as a **Markdown
archive** in the v1 format, which Kindred v1 and `scripts/import-kindred.ts` read. A GEDCOM file can come back in.
Every format keeps part of a family and drops the rest, and this page says which part, in both directions, so that a
family is never moved on a false belief about what came with it.

## Who can do what

- **Export** (GEDCOM or Markdown): editors and stewards. An export holds every name, date, place, link and biography in
  the family, which viewers and contributors can read in the app but may not take away.
- **Import** (GEDCOM): stewards only, the same role that manages access. Importing changes the family, so it sits with
  the people who are responsible for it.

The export page shows what each format leaves out before you download it, and each Markdown archive lists the same in
its README.

## Exporting

On the family's **Import and export** page (`/<family>/settings/import`), or with the export route directly:

```
GET /api/export/<family>?format=gedcom      → <family>-<date>.ged
GET /api/export/<family>?format=markdown    → <family>-markdown-<date>.zip
```

Both are sent with `Cache-Control: no-store`, and the file is built in full before the response starts.

From a family database on your own machine (read-only, so nothing is written to it):

```sh
node scripts/export-gedcom.ts <family> -o family.ged      # or to stdout without -o
node scripts/export-markdown.ts <family> archive/<family>  # a folder of notes and portraits
```

Both read `data/<family>.db`, or `$KINDRED_DATA_DIR/<family>.db`, and report what they leave out on stderr.

## GEDCOM 5.5.1

The file is LINEAGE-LINKED, in UTF-8, with CRLF line endings. Kindred's own facts that GEDCOM does not have are
carried in `_KINDRED_*` tags, which other programs skip, so a file made here comes back as the same family.

| In Kindred | In GEDCOM | Notes |
| --- | --- | --- |
| The person's id | `INDI` `_KINDRED_ID` | Used to match people on import. |
| Living | `_KINDRED_LIVING Y` | A person who is not living has `DEAT` instead. |
| Given name, surname | `NAME` with `GIVN`, `SURN` | The birth name. |
| Current name | a second `NAME` with `TYPE married` | Only when it differs from the birth name. |
| Sex | `SEX M`, `F`, `X` | `U` (unknown) is read as no sex. |
| Title, nickname, occupation | `TITL`, `NICK`, `OCCU` | |
| Birth | `BIRT` with `DATE`, `PLAC` | |
| Death | `DEAT` with `DATE`, `PLAC`; `DEAT Y` when only death is known | `DEAT N` means "not dead" and does not make a person dead. |
| Biography | `NOTE` | Long text is split across `CONC` and `CONT` lines, under 255 characters each. |
| Portrait | `OBJE` with `FILE` (the media key) and `FORM` | The reference only. The picture is not in the file. |
| Parent link | `FAMC` on the child, with `PEDI` (`birth`, `adopted`, `foster`) and `_KINDRED_KIND` (`biological`, `adoptive`, `foster`, `step`), and `_KINDRED_CONFIDENCE` | |
| Partnership | `FAM` with `HUSB`, `WIFE`, `_KINDRED_ID` and `_KINDRED_KIND` | `_KINDRED_KIND` is `marriage`, `partnership`, `betrothal`, `other`, or `parents` for a family with no partnership. |
| Marriage | `MARR` with `DATE`, `PLAC` | |
| Start of a non-marriage partnership | `_KINDRED_BEGAN` with `DATE`, `PLAC` | |
| Divorce | `DIV` with `DATE` | The end reason is `divorce`. |
| Other ending (for example, a death) | `_KINDRED_END <reason>` with `DATE` | |
| Children | `CHIL` on the family | A child belongs to one family for each kind of parent link, so a birth parent and a step parent are two families. |

**Dates.** Kindred's partial dates map to GEDCOM's: `1953`, `AUG 1953`, `8 AUG 1953`, and `ABT …` for an approximate
date (Kindred's `~`). On import, `CAL` and `EST` are read as about. `BEF` and `AFT`, `BET … AND …` and `FROM … TO …` have
no Kindred form: each is kept as about its nearest year and the report says so. A date Kindred cannot store (`31 FEB
1900`, or free text such as "the winter of the bad harvest") is dropped and the report says why.

**Text.** An `@` in text is written as `@@`, and a line break as `CONT`. A file with another character set is read as
UTF-8, and the report says so.

**Unknown tags** are never fatal. Anything Kindred does not read is counted and listed as skipped, once per tag, so a
file from another program still imports what it can. The header's `SOUR` names the program that wrote the file, and
that is not counted.

**What GEDCOM leaves out**, and says so on export:

- stories, memories, sayings and recipes;
- contact details and other person fields, private or not;
- houses and their arms;
- place coordinates (place names are kept);
- epithets;
- the pictures themselves (portraits are referenced by key only);
- a child with three or more parents of one kind (a GEDCOM family holds two, so the first two are written).

## The Markdown archive (v1)

The archive is one note per person, in `people/`, with a YAML front matter and the biography under `## Story`. The
notes follow the v1 schema, and the README in the archive lists what it leaves out. Each person's file name is their
id, made safe for any file system.

| In Kindred | In the archive |
| --- | --- |
| The person's id | `id` (the file name is derived from it) |
| Name | `name`, the given name and the surname |
| Living | `living: true` or `false` |
| Born, died | `born`, `died`; a date Kindred holds as about is written `about 1900` (v1's form) |
| Birth and death places | `birth_place`, `death_place` |
| Occupation | `occupation` |
| Nickname | `aliases` |
| Sex, title, epithet, current name | `sex`, `title`, `epithet`, `current_name` (extra properties that v1 keeps) |
| Portrait | `portrait` (a file in `attachments/`, with the picture copied in) |
| Parent link | `parents`, with `person`, `relation` (`biological_parent`, `adoptive_parent`, `foster_parent`), `kind`, `role` (`mother`, `father`, `parent`) and `status` (`accepted`, `tentative`, `disputed`) |
| Partnership (not a marriage) | `partners`, with `person`, `id`, `start` and `place` (the last two are extra properties) |
| Marriage | an event of type `marriage`, with `id`, `date`, `place`, and `people` (the other partner; the owner is implicit) |
| A marriage that ended by something other than divorce | `ended` and `ended_by` on the marriage event |
| Divorce | an event of type `divorce` |
| Biography | the body, under `## Story` |

A partnership belongs to the note of its lower-id partner, so it is declared once.

**What the archive leaves out:** step-parent links, because v1 has no step relation and writing one as a biological
claim would be a false fact in v1; stories, memories and sayings; contact details and other fields; houses and arms; and
pictures other than portraits.

## Importing a GEDCOM file

On the **Import and export** page, a steward chooses a `.ged` file (up to 5 MB) and presses **Preview**. The page
then shows, and nothing is written yet:

- the people the file would add, and the people it matches to the family already;
- conflicts, where a matched person has a different birth or death date or place in the file;
- the parent links and partnerships that would be new, and how many were already there;
- possible duplicates, and anything the reader should know about the file.

**Matching.** A person matches someone in the family when they carry the same `_KINDRED_ID`, or else when their name is
the same and their birth years agree (or one has no birth year). A name that matches two people is not guessed at: the
person is added as new, and the preview says so. A second person in the file with the same id is reported too.

**What an import changes.** It only adds: new people, new parent links and new partnerships. It never changes a person
who is already in the family, and it never removes anything. A conflict is listed for the steward to settle by hand.

**A family that already has people** needs an explicit choice. The page asks the steward to turn on "Add to this
family", and the server refuses the import without it. The same goes for a family with no new people to add: the
preview says there is nothing to do, and the button stays off.

**The write** is one batch. It starts with guards that restate the counts the preview relied on, so if anyone changed
the family in between, nothing is written and the import is planned again on fresh reads. A retry after a lost
response writes nothing twice: the request carries a key, and the server answers a repeat with the first result.

The import is written in one batch. A very large family may take a while to write, and the page waits for it. The
batch size is not limited by Kindred itself; if Cloudflare D1 refuses a large batch, split the file. That limit has
not been measured for this app.

## Round trips, measured

These were run on the test family `modern` (346 people, 411 parent links, 140 partnerships):

- **GEDCOM → a new family → compared field by field:** all 346 people match on every carried field (names, dates, places,
  living, titles, nicknames, occupations and biographies). All 411 parent links and all 140 partnerships come back
  exactly, with their kinds, confidence, dates and places.
- **Markdown archive → `scripts/import-kindred.ts`:** all 346 people come back, with their birth dates, birth places and living status. 400 parent links come back, because the 11 step-parent links are left out by design. All 140
  partnerships come back, with their kinds. The start dates of the 12 partnerships do not: `import-kindred.ts` reads a
  marriage's date from its event but not a partnership's, so they are kept in the archive but not in the spike's import.

The round trip into a second family is also covered by unit tests (`src/lib/exchange/*.test.ts`), including partial
dates, several marriages to different people, adoptive and step links, long and escaped biographies and unknown tags.

## Limits of `scripts/import-kindred.ts`

It reads a v1 archive's `people/` folder only, so an archive that keeps its notes elsewhere needs them moved there first.
It keys partnerships by the pair of people, so two unions between the same two people would be read as one. It creates
houses from surnames, with generated arms, because v1 has no houses of its own.

## Where the code is

- `src/lib/exchange/gedcom.ts`: GEDCOM, written and read.
- `src/lib/exchange/dates.ts`: partial dates in both directions.
- `src/lib/exchange/markdown.ts`, `zip.ts`: the v1 archive, and the ZIP it downloads in.
- `src/lib/exchange/model.ts`: the family as plain data, read from a database.
- `src/lib/exchange/plan.ts`: what an import would do. Pure.
- `src/lib/exchange/import.server.ts`, `export.server.ts`, `exchange.functions.ts`: the server side.
- `src/lib/exchange/copy.ts`: the page's text, in English and German.
