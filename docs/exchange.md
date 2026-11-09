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
| Living | `_KINDRED_LIVING Y` | A person who is not living has `DEAT` instead. On import, see "Who is living" below. |
| Given name, surname | `NAME` with `GIVN`, `SURN` | The birth name. |
| Current name | a second `NAME` with `TYPE married` | Only when it differs from the birth name. |
| Sex | `SEX M`, `F`, `X` | `U` (unknown) is read as no sex. |
| Title, nickname, occupation | `TITL`, `NICK`, `OCCU` | |
| Birth | `BIRT` with `DATE`, `PLAC` | |
| Death | `DEAT` with `DATE`, `PLAC`; `DEAT Y` when only death is known | `DEAT N` means "not dead" and does not make a person dead. |
| Biography | `NOTE` | Long text is split across `CONC` and `CONT` lines, under 255 characters each. It comes back character for character, spaces and blank lines included. |
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
no Kindred form: before/after dates become approximate dates, ranges use their first date, and the report says so.
Kindred's dates are Gregorian: a Julian date (`@#DJULIAN@ 1 FEB 1700`) or a dual year (`1 FEB 1700/01`, from when the year
began in March) is kept as about its year, the later one of a dual year (`~1701`). Its day and month are dropped, because
they belong to the other calendar, and the report quotes the original date; a person has no field to keep that text in.
`@#DGREGORIAN@` is read as the date it marks. A date Kindred cannot store (`31 FEB 1900`, a Hebrew or French Republican
date, or free text such as "the winter of the bad harvest") is dropped and the report says why.

**Who is living.** A Kindred file says it for everyone. A file from another program often has no death record for an
old ancestor, so a person with neither a death record nor `_KINDRED_LIVING` is imported as living only when that is
possible: someone who would be over 110 today, by their own birth date or by the dates of their children, grandchildren
or partnerships (a parent or partner is taken to be at least 12), is imported as died, date unknown (not living, with no
death date), and the report counts them. A death record, `DEAT N` and `_KINDRED_LIVING` are always taken as they are.

**Text.** An `@` in text is written as `@@`, and a line break as `CONT`, in every value: a line break in a place or a
title cannot break the file. A line too long for one GEDCOM line goes on in `CONC` lines, and, as GEDCOM 5.5.1 asks, it
is never cut next to a space (other programs trim the spaces around a value, which would glue two words together), nor
inside a character outside the BMP. On import, the spaces at the end of a line are kept, so a Markdown hard break (two
trailing spaces) survives; a biography (`NOTE`) keeps every character, and every other value loses only the spaces
around it. A `/` in a name is written as `∕` (U+2215) in `NAME`, where `/` marks the surname, as it is in `GIVN` and
`SURN`, and comes back as `/`. A line break in a name becomes a space.

**Character sets.** The import page decodes the file before it is sent: by its byte order mark first (UTF-8, UTF-16
little- or big-endian), then UTF-16 without a mark, then the header's `1 CHAR` line. `UTF-8`, `ASCII` and `UNICODE`
without UTF-16 bytes are read as UTF-8; `ANSI`, `WINDOWS-1252` and `ISO-8859-1` as Windows-1252; `MACINTOSH` as Mac
Roman; and `ANSEL`, GEDCOM 5.5.1's default, by a table of its letters and combining accents (which ANSEL puts before
the letter and Unicode after), composed so a name reads as typed. A byte the character set does not have becomes
`�`, and the report says how many there are. A file with another character set (such as `IBMPC`) is read as UTF-8, and
the report says so.

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

## The nightly archive

The database is the family's source of truth. A nightly job can also keep a readable copy in a **private GitHub
repository**: the v1 Markdown archive above and a GEDCOM file, committed to a folder of that repository. Nothing is read
back from it. It is a copy to read, to search, or to restore from by hand.

> **The archive holds private data.** It has every name, date, place, link and biography in the family, and the GEDCOM
> file has the same. The repository must stay **private**, and only stewards should configure it. Kindred checks the
> repository's visibility before each write and refuses a public one.

It is off until a family has its settings (below). A family without them is skipped quietly.

### Settings

Each family has its own settings, named by its id in capitals with `-` written as `_`. For the family `modern`:

| Name | Kind | What it does |
| --- | --- | --- |
| `KINDRED_ARCHIVE_MODERN_REPO` | variable | `owner/name` of the private repository, such as `family/kindred-archive`. |
| `KINDRED_ARCHIVE_MODERN_TOKEN` | secret | A fine-grained token for that one repository. See below. |
| `KINDRED_ARCHIVE_MODERN_BRANCH` | variable | The branch to commit to. Default `main`. The branch must exist: the repository needs at least one commit. |
| `KINDRED_ARCHIVE_MODERN_PATH` | variable | The folder the archive owns. Default `archive`. Nothing outside it is changed. |

Set both `_REPO` and `_TOKEN`, or neither: one without the other is reported in the log and the family is not archived.

**The token.** Create it under GitHub's fine-grained tokens, with **Only select repositories** set to the one archive
repository. Give it **Contents: Read and write**, and nothing else. Metadata read comes with it, and Kindred uses it to
check the repository is private. Give each family its own repository and token, so that one leaked token reaches one
family.

### What the job does

Each night, for each configured family:

1. Reads the family's current data from its database, and renders the GEDCOM file, the notes, the README and the
   portraits, the same way the exports do.
2. Reads the branch and the folder, and compares every file by its git blob id. Nothing is written when nothing differs.
3. If something differs, creates the new files and removes the files in the folder that are no longer exported, then
   makes one commit and moves the branch to it. The commit is by `Kindred <kindred@users.noreply.github.com>`, with the
   message `archive: nightly export of <family>, <date>`, and a line that counts the files added, changed and removed.

The exports print the date they were written on. The job keeps the date of the folder's last commit, so a night on
which nothing else changed writes nothing. A change moves the date on to that day.

The folder's layout:

| Path | What it is |
| --- | --- |
| `<family>.ged` | The GEDCOM 5.5.1 file. It refers to the portraits but does not include them. |
| `README.md` | The README of the v1 archive, which says what the archive leaves out. |
| `people/<id>.md` | One note per person, in the v1 format. |
| `attachments/` | The portraits. |
| `.kindred-archive` | The marker: which family the folder belongs to, and the date of its last export. Do not edit it. |

**One folder, one family.** The marker names its family, and a run refuses a folder whose marker names another. Two
families in one folder would delete each other's files, so they need their own folder or their own repository.

**Errors and limits.** A failure is logged with the family's name, and the other families still run. The token is never
written to a log. GitHub's rate limits are handled: a secondary limit (GitHub's guard against many writes at once) is
waited out, up to five times in one run, and after that the run fails and the next night tries again. A primary limit
(the hourly quota) fails the run at once, for the same reason. If the branch moves while the job works (someone
pushed), the job reads it again and commits on top.

### Running it by hand

From the command line, with the settings in the environment, for one family:

```sh
KINDRED_ARCHIVE_MODERN_REPO=family/kindred-archive KINDRED_ARCHIVE_MODERN_TOKEN=… \
  node scripts/archive-now.ts modern --dry-run
```

`--dry-run` reads the repository, prints the files that would be added, changed or removed, and writes nothing. Without
it, the run commits the change. The script exits with status 1 when the archive could not be written.

Research projects are carried by the Markdown archive and this nightly archive only, in `research/<project>.md` with each
document under `research/files/`. Private research is left out, and past 40 MB of documents the rest are listed by name
but not copied, so a run stays within a Worker's memory. A GEDCOM file carries no research. Each report says what is missing.

The archive is a copy, not a backup: it leaves out what the formats leave out, which the sections above list. Keep the
database's own backups (see [self-host.md](self-host.md) and [deploy-cloudflare.md](deploy-cloudflare.md)).

## Importing a GEDCOM file

On the **Import and export** page, a steward chooses a `.ged` file (up to 5 MB) and presses **Preview**. The page
then shows, and nothing is written yet:

- the people the file would add, and the people it matches to the family already;
- conflicts, where a matched person has a different birth or death date or place in the file, or a matched partnership
  a different kind, date or place, and parent links that are refused (see below);
- the parent links and partnerships that would be new, and how many were already there;
- possible duplicates, and anything the reader should know about the file.

**Language.** The preview's own sentences (the counts, the conflicts, the notes and any refusal) are shown in the
reader's language: English, German or Afrikaans. Names, dates and the file's own text are shown as they are. Date conversion notes (such as `BEF 1900`) are translated too.

**Matching.** A person matches someone in the family when they carry the same `_KINDRED_ID`, or else when their name is
the same and their birth years agree (or one has no birth year). A name that matches two people is not guessed at: the
person is added as new, and the preview says so. A second person in the file with the same id is reported too.

**What an import changes.** It only adds: new people, new parent links and new partnerships. It never changes a person
or a partnership that is already in the family, and it never removes anything. A conflict is listed for the steward to
settle by hand.

**Partnerships.** A partnership in the file between two people who already have one in the family is that partnership,
even when its date, end, kind or place was changed in the family since the file was made: it is matched (first an
identical one, then the one with the same `_KINDRED_ID`, then one of the same kind, then any), and each difference is
listed as a conflict. A couple is never given a second partnership by an import, and a partnership id the family already
uses is never reused for a new one. So a family can re-import its own export at any time.

**Parent links keep the link form's rules**, for new people and for people already in the family alike (so an older
backup cannot put back parents that were corrected since):

- A child has at most two parents of one kind. A link that would add a third birth parent (or a third adoptive, foster
  or step parent) is listed as a conflict and is not added; the first two in the family or the file are kept.
- A birth or adoptive parent is born before the child, in an earlier year. A link to a parent born later, or in the same
  year, is listed as a conflict and is not added. A step or foster parent may be younger, and a missing birth year on
  either side is no reason to refuse.
- A parent link that would make someone their own ancestor is listed as a conflict and is not added. While the file
  holds any such link, the whole import is refused, and nothing is written until the file is corrected.

The other two kinds of refused link do not stop the rest of the file: the preview counts them, and the write leaves out
exactly the links the preview listed.

**A family that already has people** needs an explicit choice. The page asks the steward to turn on "Add to this
family", and the server refuses the import without it. The same goes for a family with no new people to add: the
preview says there is nothing to do, and the button stays off.

**The write** is one batch. It starts with guards that restate the counts the preview relied on, so if anyone changed
the family in between, nothing is written and the import is planned again on fresh reads. A retry after a lost
response writes nothing twice: the request carries a key, and the server answers a repeat with the first result.

The import is written in one batch. A very large family may take a while to write, and the page waits for it. The
batch size is not limited by Kindred itself; if Cloudflare D1 refuses a large batch, split the file. That limit has
not been measured for this app.

## Round trips

GEDCOM round trips are covered by `src/lib/exchange/*.test.ts`, including partial dates, several marriages,
adoptive and step links, long and escaped biographies and unknown tags, and a property test over awkward text (long
words, a space where a line is cut, trailing spaces, blank lines, characters outside the BMP, a leading `@`). These tests cover the carried fields;
they do not make either format a complete backup. Check an import's preview and compare the result with its source.

## Limits of `scripts/import-kindred.ts`

It reads a v1 archive's `people/` folder only, so an archive that keeps its notes elsewhere needs them moved there first.
It keys partnerships by the pair of people, so two unions between the same two people would be read as one. It creates
houses from surnames, with generated arms, because v1 has no houses of its own. It does not import attachments,
current names, titles, epithets, parent confidence or partnership endings. Sex is inferred from parent roles rather
than read from the explicit field. Check names and relationships against the original after importing.

## Where the code is

- `src/lib/exchange/gedcom.ts`: GEDCOM, written and read.
- `src/lib/exchange/encoding.ts`: a file's bytes as text, by its byte order mark and `CHAR` line.
- `src/lib/exchange/dates.ts`: partial dates in both directions.
- `src/lib/exchange/markdown.ts`, `zip.ts`: the v1 archive, and the ZIP it downloads in.
- `src/lib/exchange/model.ts`: the family as plain data, read from a database.
- `src/lib/exchange/plan.ts`: what an import would do. Pure.
- `src/lib/exchange/import.server.ts`, `export.server.ts`, `exchange.functions.ts`: the server side.
- `src/lib/parent-rules.ts`: the rules a parent link keeps, shared by the import plan and the link form.
- `src/lib/i18n/areas/exchange.ts`: the page's text and the preview's sentences, in English, German and Afrikaans.
- `src/routes/$tree/settings.import.tsx`: the Import and export page.
