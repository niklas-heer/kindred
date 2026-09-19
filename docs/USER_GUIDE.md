# Working with an archive

Build with `mise run build`, then use `target/release/kindred` (or an installed
`kindred`) in the commands below. `kindred --help` lists the complete interface.
Every archive command takes its directory explicitly; no working-directory
configuration or hidden default vault is required.

## Start, read, and query

```sh
kindred init ./family
kindred check ./family --json
kindred show ./family mira
kindred ancestors ./family noa --generations 6 --json
kindred descendants ./family mira --relations biological_parent,adoptive_parent
kindred path ./family mira noa --generations 10
kindred neighbors ./family noa --statuses accepted,tentative,disputed
kindred reindex ./family
```

`init` creates only `people/` and `attachments/`, plus an introductory README.
Keep person notes in any folders, including family subfolders; Kindred scans them
recursively. One person note can contain parents, partners, facts, events, places,
citations, and photo credits. Other graph records are derived when loading, so
you do not need separate folders or notes for them. Add Markdown notes using the
[schema](SCHEMA.md) and examples as templates, then validate. The IDs in the
commands above refer to the fictional example; they are not added by `init`.
Copy `examples/fictional` or the [historical archive](HISTORICAL_EXAMPLES.md) to a
new working folder to start with a populated demo.

`check` is read-only. Errors include a file, diagnostic code, and explanation;
JSON output includes `records` and `diagnostics`. Exit code 0 means success, 1
means a validation or operation failure, and 2 means incorrect command usage.
Queries refuse an invalid archive. `show` returns the exact original note;
`show --json` includes parsed properties and raw text. Derived claims, events,
places, and citations return JSON with an `owner` person ID, since they have no
separate file. In the viewer, Edit person note opens that owning note.

Queries default to accepted claims and all relationship types. Ancestors and
descendants follow parent edges; partner edges only contribute to neighborhoods
and paths. The focus person is included at depth zero. A path is a shortest
undirected connection, bounded by `--generations`, with no automatic kinship
label. JSON includes node records and edges with claim/source IDs. Use `show`
on a claim or source ID to inspect its reasoning or evidence.

## Explore in the browser

```sh
kindred serve ./family --port 3000
```

The server prints its URL and listens only on `127.0.0.1`. Port 0 selects an
available port. Stop with Ctrl-C. All assets are embedded; there is no CDN,
telemetry, login, or external database service. Source URLs open only when you
choose them. Treat an open local session as access to the complete archive.

Search for a person, then choose a family, ancestor, descendant, or path view.
Depth and claim filters control the selection. Family opens with immediate
relatives; switching from Family to Ancestors or Descendants starts at four
generations. Parents appear above children, and explicit partners share a row.
Overview starts with the branch having the most recorded children. Its Branch
selector can choose another person or all family roots. The initial depth shows
two descendant generations plus their co-parents; increase Depth or expand a
selected branch to explore further. Show all reveals
the complete archive selection. Shared ancestors remain one person; cyclic claims are
retained as links without forcing an impossible generation order. Use the zoom
buttons, scroll, and drag to explore; Fit frames the entire selection.
**Arrange → Family sides** groups the chosen person's maternal ancestors on the
left and paternal ancestors on the right. **Compact** uses the general family
layout. Siblings use exact recorded birth years when available. Unknown parent
roles are not guessed; shared ancestors remain single cards. Rounded parent
paths share a trunk and sibling rail, with separate mother/father rails.

Selecting a person highlights their maternal/paternal ancestors, shared ancestry,
descendants, direct partners, and other relatives reachable through shared
ancestors. The matching connection paths are highlighted too; unrelated branches
fade. Color keys, counts, and accessible node labels explain the groups. This
uses only people and claims in the current view and respects the active filters;
increase depth or use Show all to expose more of the family. Path mode keeps the
whole returned connection highlighted, including intermediate partnerships.

Selection changes highlights without moving the cards. Use **Arrange family
sides** in the person's details to reorder around the new selection; the graph
caption identifies whose sides the layout represents.

Select a person or connection for its story,
metadata, events, claims, and evidence. The evidence toggle adds source/event
nodes when useful. Attachments are available from person notes and their citations.

The keyboard help lists navigation: `/` focuses search, arrow keys move between
people, Enter opens a family view, `+` and `-` change depth, and Escape closes
the current overlay. Controls also work through normal Tab navigation.

Mother/father badges come from explicit `mother`/`father` fields, `role` on inline
parent claims, or `parent_role` on legacy relationship notes, never from a person's name or an inferred gender. Unspecified roles stay
Parent. The Parents panel identifies whose mother or father is shown and retains
biological/adoptive/foster type and claim status. The icons have text labels.
Birth, death, and occupation appear on cards and in details. Occupations can be
strings or flat lists, and uncertain date wording remains unchanged.

Write stories and research notes in the person's Markdown body, using headings
such as `## Story` and `## Research notes`. The reader formats headings,
paragraphs, and bullet lists; other Markdown and HTML remain literal text.
**Add a research note** appends a new heading and note to the same file, preserving
existing metadata and prose. It uses the same exact-content conflict check as
the full editor and keeps your draft visible if saving fails. Use Edit note to
change existing facts or prose. The [bundled Lucide icons](THIRD_PARTY_NOTICES.md)
work offline and require no CDN or additional runtime package.

For a picture, put an image inside the archive and set
`portrait: attachments/portrait.jpg`. Add `portrait_caption`, `portrait_credit`,
`portrait_license`, and `portrait_source` to keep provenance beside the person.
JPEG, PNG, GIF, and WebP images appear in cards and the details panel. Images are
served locally, and source links open only when selected. The historical example
includes seven attributed public-domain portraits, with posthumous or uncertain
likenesses identified in the notes.

## Edit and recover

The browser's editor changes the complete Markdown note. It initializes with
the exact original text, so unrelated properties and prose stay intact unless
you intentionally change them. A save validates the resulting archive and
refuses an identity/type change or an external-edit conflict. Reload before
retrying a stale edit; keep your draft separately when resolving a conflict.

For a scriptable edit, save the original note and a proposed replacement:

```sh
kindred show ./family mira > original.md
# Prepare replacement.md in your editor, keeping the same id and type.
kindred edit ./family mira --expected original.md --from replacement.md
```

Use `--body biography.md` instead of `--from` to replace only the Markdown body.
This preserves the original frontmatter bytes, including unknown properties
and comments. A full-note replacement intentionally permits metadata edits.

Kindred locks its own writers, records the original/proposed text in
`.kindred/edit.json`, syncs a temporary replacement, and replaces one note.
If interrupted, run:

```sh
kindred recover ./family
kindred check ./family
kindred reindex ./family
```

Recovery applies a valid pending replacement only if the note still matches the
recorded original; if the replacement already landed, it completes cleanup.
It refuses a conflicting subsequent edit. For such a conflict, inspect and save
both journal versions outside `.kindred`, reconcile in your editor, and remove
the resolved journal before making another Kindred edit. A malformed journal
requires manual inspection; it is never silently discarded. Journals may
contain private text. Do not delete `.kindred` while an edit is pending.

Ordinary external editors do not participate in Kindred's lock. Exact-content
checks detect changes before replacement, but an editor can still write in the
small interval after the final check. Avoid simultaneous saves to the same note.
This is a local single-user archive, not a multiwriter transaction service.
Multi-file import/export operations build a new directory and publish it only
after validation; they never merge into or replace an existing archive.

## Back up or share deliberately

```sh
kindred export ./family ../backup --all
kindred export ./family ../share --public
```

Choose exactly one scope. `--all` copies all user files, attachments, prose,
unknown metadata, hidden workspace configuration, and interpretation notes.
It excludes `.kindred` caches/journals and `.git`; it refuses symlinks and special
files. The destination must be new and outside the source archive. Copying
checks the source manifest and exact bytes before publication, and validates
the staged archive. Avoid active editors during a backup; an external writer
can still change a file after the final check. Keep independent backups before
large manual changes.

`--public` is a metadata projection, not a full backup. It selects only people
with **`living: false`** and without **`private: true`**, and their non-private
relationship claims. Unknown living status is excluded. It includes name,
birth/death wording, stable IDs, relationship types/statuses, and rebuilt links.
It excludes biographies, aliases, sources, events, media, attachments, and all
unknown properties, so private free text cannot slip through via a source or
an attachment. The export report explains this loss. Review the selected names
and date wording before sharing; software cannot infer whether a public-looking
value contains sensitive information.

## GEDCOM interchange

```sh
kindred import-gedcom tree.ged ./imported-family
kindred export-gedcom ./family ../gedcom-package --all
kindred export-gedcom ./family ../public-gedcom --public
```

Import accepts UTF-8/ASCII GEDCOM 5.5.1 or 7.0. It retains the exact input in
`attachments/original.ged` and writes `IMPORT-REPORT.json`. Mapped records include
person notes containing names, birth/death wording, sex, inline source titles,
and explicit supported family claims; attachments use one folder. Missing pedigree and `PEDI BIRTH` alone never establish biological
parentage. Unspecified claim status is tentative; `STAT PROVEN`, `CHALLENGED`,
and `DISPROVEN` map to accepted, disputed, and rejected. `RESN` restrictions map
to private records. The primary name and first date are retained with explicit
reports for alternatives. Supported referenced sources and inline source text
become citations within the person note, with the original GEDCOM attached.
Unsupported structures and uncertain mappings are reported;
external media is not downloaded or copied implicitly. Review the report and
the original before relying on an imported claim. Archives are created through
a staging directory, so malformed input does not leave a published half-import.

Export produces a new directory containing `family.ged` and
`EXPORT-REPORT.json`. It emits GEDCOM 7 names, date phrases, explicit deceased
status, and supported accepted relationship claims. Date wording is carried as
`PHRASE`, rather than guessed into an exact date. Each parent claim has its own
family record with reciprocal membership and pedigree information, preserving
adoptive/foster distinctions. Source evidence, complete prose, aliases, events,
attachments, unknown metadata, and alternative claims require full archive
export. Record IDs change on reimport. Consult the report for the exact subset;
GEDCOM export is never a complete backup.

The implementation follows a conservative subset of the
[FamilySearch GEDCOM specification](https://gedcom.io/specifications/FamilySearchGEDCOMv7.html).
Family membership alone is not biological evidence. The importer retains
ambiguous relationships in the original with an explanation instead of
inventing parentage. Kindred's export declares an extension for explicit relation
semantics/status (`_KINDRED_RELATION` and `_KINDRED_STATUS`) where the standard
pedigree field is insufficient. This extension is
optional to other readers and does not make a partial export lossless.

## Optional Obsidian use

Open the archive folder as a vault. No plugin is required. Simple properties,
quoted wiki links, and biographies remain ordinary Obsidian data. Edit detailed
nested parent/event/citation metadata in Markdown source mode.
Kindred ignores `.obsidian` workspace files. Obsidian's native graph shows notes
and links; Kindred derives genealogy from explicit person metadata and also
reads legacy relationship notes.

A real round-trip was verified on macOS with **Obsidian 1.13.7**, on 2026-09-19,
using a disposable copy of the earlier 23-record, separate-note fictional archive
at commit `6c719eb` (this is not verification of nested property-editor support):

1. Opened the archive as a vault and read Mira's biography and flat properties.
2. Edited the body and the unknown `research_colour` property in Obsidian.
3. Ran Kindred validation (23 records, no diagnostics) and rebuilt the index.
4. Followed a relationship's `sources` property to the register note in Obsidian.
5. Replaced Mira's body with the Kindred CLI; Obsidian displayed the external
   change while preserving the unknown property and approximate birth wording.

This verifies that workflow and version, not every Obsidian plugin or arbitrary
rename strategy. Links are filename-based: after external renames, validate the
archive and repair unresolved links. Stable IDs do not guess new filenames.

## Research-quality warnings

`kindred check` reports structural errors separately from research-quality
warnings. Errors mean Kindred cannot safely trust a note or relationship and
make the command exit with status 1. Warnings identify useful follow-up work but
leave the archive valid and the exit status at 0. In JSON, the two stable arrays
are named `diagnostics` and `warnings`.

Warnings currently cover a missing display name, a person with neither a birth
nor death value, unrecorded parentage, absent citations, relationship claims
without their own explicit sources, and clear chronology conflicts. Optional
metadata remains optional: a warning does not assert a missing fact or invent a
value. Add known or uncertain wording when useful, cite evidence at the claim it
supports, or leave the warning visible as part of an incomplete research record.
For a person whose parents are unknown or intentionally not recorded, add
`parents: []` to mark that omission as reviewed and suppress its warning. Any
valid parent claim counts as recorded parentage, regardless of claim status.

Chronology comparisons are deliberately narrow. Kindred compares only plain
four-digit years such as `1904`; wording such as `about 1904`, ranges, and
alternatives is preserved and skipped. Parent chronology is checked only for
accepted biological-parent claims. Disputed, rejected, adoptive, and foster
claims are not treated as chronological mistakes.
