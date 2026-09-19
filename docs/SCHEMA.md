# Archive format, version 1

An archive is an ordinary directory of Markdown notes and attachments. Kindred
reads non-hidden `.md` files recursively. Hidden folders (including `.kindred`
and `.obsidian`) and symbolic-link notes/directories are not followed. Notes
without frontmatter or without a `type` property remain ordinary untyped notes.
Malformed frontmatter is a validation error. Filenames and link targets are
case-sensitive in Kindred's interpretation.

## Records

Typed notes start with YAML frontmatter delimited by lines containing `---`.
These properties are required:

```yaml
version: 1
id: person_anna
type: person
name: Anna Linden
```

`id` is a nonempty string, unique across the archive. `type` is one of `person`,
`relationship`, `source`, `event`, `place`, or `media`. `name` is optional and
falls back to the ID. YAML duplicate keys are rejected. Metadata is flat: scalar
properties and lists of scalars. Unknown properties are retained. The body and
original note text, including line endings, are retained exactly when reading.
Quoted date strings preserve uncertainty, for example `birth: "about 1820"` or
`birth: "1818 or 1821"`. Kindred does not turn these into exact dates.

`aliases` is an optional list of strings. `living` and `private` must be booleans when present. `living: true` and `private: true` are
available as explicit privacy metadata; consult export command documentation for
filtering behavior. Omitting a privacy property is not proof a record is public.

## Links and claims

Links in typed properties use quoted wiki links: `"[[people/anna|Anna Linden]]"`.
Targets are filenames relative to the archive root; `.md` is optional. A basename
without a slash is accepted only if it resolves to exactly one typed note.
Display aliases after `|` do not affect resolution. IDs are not implicit filename
aliases. Renaming a target externally requires updating its incoming links;
validation reports broken links rather than guessing from an ID.

A parent claim has one authoritative relationship note:

```yaml
version: 1
id: claim_anna_emil
type: relationship
relation: biological_parent
parent: "[[people/anna]]"
child: "[[people/emil]]"
status: tentative
sources: ["[[sources/register]]"]
```

Parent relations are `biological_parent`, `adoptive_parent`, or `foster_parent`.
A `partner` relation instead has exactly two `partners` links. Endpoints must be
distinct people. Every claim needs an explicit status: `accepted`, `tentative`,
`disputed`, or `rejected`. Prose carries reasoning and alternatives. Sources are
optional lists of links to source records; one source can support many claims.
Ordinary links in prose never create genealogy edges.

Event notes can use `people` (list of person links), `place` (a place link),
`sources` (list of source links), and an opaque `date` string. Source records can
carry `url`, `license`, citation metadata, and evidence prose. No online content
is fetched implicitly.

Source `attachments` is a list of archive-relative file paths; a media note can
use `file: attachments/register.txt`. These files must exist inside the archive.
Traversal paths and symbolic links that lead outside the archive are rejected.
An attachment can instead be represented by a wiki link to a media record.

## Validation and traversal

Duplicate IDs, missing/ambiguous links, invalid record types, invalid claim
statuses, malformed endpoint properties, and inappropriate source/event target
types are diagnostics. Queries refuse archives with validation errors.

Queries default to accepted claims and all relation types. Explicit status and
relation filters select alternatives without presenting them as accepted facts.
Ancestor/descendant queries follow only parent edges in the indicated direction;
partner edges are used in neighborhoods and connection paths. Depth zero selects
only the focus person. Each additional generation permits one edge. Paths are
shortest undirected connections bounded by the requested number of steps, and
are not assigned a kinship label.

Each person is visited once at its shortest distance. Shared ancestors are not
duplicated, and cycles terminate. Traversed edges retain their relationship IDs,
status, type, and source IDs. Multiple independently sourced claims can remain
visible rather than being collapsed into one unsupported fact.

## Disposable index

Reindexing writes `.kindred/index.json`, a JSON snapshot of the validated records
and their original text. It is derived data and may contain private research just
like the archive. It is never required or trusted to load an archive: commands
reread Markdown files. Deleting or corrupting the snapshot does not lose research.
Rebuilding incorporates external edits and refuses malformed records. The
snapshot is written through a temporary file and atomic replacement.

## Editing and snapshot concurrency

Saving a note compares its exact original text, validates the proposed note in
its full archive context, stages a durable replacement, and rechecks the text
before atomic replacement. An interrupted write leaves a journal for explicit
recovery. Recovery never overwrites text that differs from both the original and
the proposed replacement. Journals and indexes are created with owner-only file
permissions on Unix; editing preserves the note's existing permissions.

Full archive export compares the source file manifest before and after staging
and verifies copied bytes against the source before publishing the destination.
Detected external changes abort the export and remove its staging directory.
These checks are optimistic: ordinary editors do not participate in Kindred's
write lock, so a change after the final check is still possible. Pause ordinary
editor writes while saving/recovering or making an archive backup when a stable
snapshot is required. Multi-file exports are published together; edits currently
replace one note at a time and do not promise multi-note transactions.

## GEDCOM explicit relation

The declared `_KINDRED_RELATION` extension on an individual’s `FAMC` link carries
`biological_parent`, `adoptive_parent`, or `foster_parent`. It accompanies standard
`PEDI BIRTH`, `ADOPTED`, or `FOSTER`, respectively. An importer must not interpret
`PEDI BIRTH` alone as proof of biological parentage: GEDCOM 7 describes a family
structure at birth. Kindred leaves absent, ambiguous, or unsupported pedigrees in
the original import attachment and reports that no parentage was inferred.
Each exported parent claim uses a separate family so its relation is explicit.

## GEDCOM claim status

The declared `_KINDRED_STATUS` extension on `FAMC` links and family records carries
one of `accepted`, `tentative`, `disputed`, or `rejected`. Standard child-link
`STAT PROVEN`, `CHALLENGED`, and `DISPROVEN` map to `accepted`, `disputed`, and
`rejected`, respectively. Unspecified status imports as `tentative`; conflicting
statuses are rejected. Importing an accepted claim does not independently verify
it. Export includes accepted claims only and reports the omitted alternatives.
Consumers that ignore the extensions lose exact biological and status semantics.

The importer retains the exact input as `attachments/original.ged`, explicitly
reports unmapped fields and records, and never fetches linked media. It selects
the primary name and first date wording, reporting alternatives rather than
silently overwriting them. `RESN` is conservatively mapped to `private: true`,
and private records export with `RESN PRIVACY`. `DEAT N` never makes a person
explicitly deceased. Supported encodings are UTF-8/ASCII; declared schema versions
are 5.5.1 and 7.0. This remains a documented subset, not general GEDCOM support.

These policies follow the [GEDCOM 7 specification](https://gedcom.io/specifications/FamilySearchGEDCOMv7.html),
consulted on 2026-09-19, particularly its pedigree and child-family status definitions.
