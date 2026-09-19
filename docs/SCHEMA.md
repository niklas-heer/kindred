# Archive format, version 1

The primary authoring model is **one Markdown note per person**. Put a person’s
relationships, dates, places, citations, portraits, occupations, and research in
that note. Choose folders and filenames yourself; no `people/`, `sources/`, or
other fixed directory layout is required. Attachments remain ordinary local
files. Earlier archives containing separate typed relationship, source, event,
place, and media notes remain readable alongside person notes.

Kindred reads non-hidden `.md` files recursively. It skips hidden directories
(including `.kindred` and `.obsidian`) and symbolic-link notes/directories. Notes
without frontmatter or without `type` remain ordinary untyped notes. Malformed
frontmatter is diagnosed. Wiki-link filenames are interpreted case-sensitively.

## A person note

```yaml
version: 1
id: elin_linden
type: person
name: Elin Linden
born: "about 1900"
birth_place: Lindenby
occupation: [Weaver, Teacher]
mother: "[[Family/Anna Linden]]"
parents:
  - id: robin_adopts_elin
    person: "[[Research/Robin Sommer]]"
    relation: adoptive_parent
    role: father
    status: disputed
    sources: [{id: adoption_register}]
    note: Two incompatible readings remain.
sources:
  - id: adoption_register
    title: Fictional adoption register
    attachments: [attachments/register.txt]
    note: An invented document for this example.
portrait: attachments/elin.jpg
portrait_credit: Fictional artist
living: false
```

The frontmatter is enclosed by lines containing `---`. `version: 1`, a nonempty
unique string `id`, and `type: person` are required. `name` defaults to the ID.
Other properties are optional. Duplicate YAML keys are rejected. Nested metadata
is supported: inline relationship/citation/event objects and unknown properties
are retained. The physical note’s metadata, Markdown body, comments, and original
line endings are preserved exactly when reading and saving supplied note text.

`born` and `died` contain original date wording; `birth` and `death` remain valid
aliases for older archives. Conflicting values in two aliases for the same date
are rejected. Preserve uncertainty in strings such as `"1818 or 1821"`, or record
separate dated events with their explanations. Kindred does not turn uncertain
wording into an exact date. `living` and `private`, when supplied, must be booleans.
Missing living status does not establish that someone is deceased or public.

`occupation` is conventionally a string or list of strings. Use `## Story` and
`## Research notes` Markdown headings if helpful; these headings are optional,
and the body remains ordinary authored prose. Cite facts and distinguish
uncertainty from supported information. A mention in prose never creates a
parent or partner assertion.

## Explicit relationships

`mother` and `father` are quoted person wiki links and create explicit biological
parent claims with the indicated role and default `accepted` status. A claim is
owned by the **child’s note**. Use `parents` objects whenever relation type,
certainty, evidence, or reasoning needs more detail:

| Property | Meaning |
| --- | --- |
| `person` | Required wiki link to the parent’s physical note |
| `id` | Optional explicit claim ID, preserved in queries and migration |
| `relation` | `biological_parent` (default), `adoptive_parent`, or `foster_parent` |
| `role` | `mother`, `father`, or `parent` (default); `parent_role` is an alias |
| `status` | `accepted` (default), `tentative`, `disputed`, or `rejected` |
| `sources` | Explicit supporting citation list |
| `note` | Reasoning and uncertainty, shown with the derived claim |
| `private` | Optional boolean restricting that claim |

`mother`/`father` also accept a rich parent object when needed; its role must agree
with the property name. Conflicting `role`/`parent_role` values are rejected.
Roles are explicit metadata, never inferred from someone’s name or sex.

`partners` is a list of person wiki links or objects containing `person`, `id`,
`status`, `sources`, `note`, and `private`. Partner objects cannot have a parent
role. Put a partnership claim on one partner’s note; avoid independently editable
mirrored copies. Claims never point from a person to themselves. Parentage
sources are explicit on each claim: a person’s general source catalogue is not
automatically treated as support for every relationship.

Links use actual archive-relative filenames, with optional `.md` and display
aliases: `"[[Family/Anna Linden|Anna]]"`. A basename resolves only when it is unique.
Stable IDs are not implicit filename aliases. Renames require updating incoming
links; validation reports broken targets instead of guessing.

## Inline citations, events, and places

A citation is an HTTP(S) URL, an inline object, or a wiki link to a legacy source
note. Citation objects can contain `id`, `title` (or `name`), `url`, `attachments`,
`note`, `credit`, `license`, `accessed`, and additional provenance. A URL is not
required: a local document or oral account can have a title, attachment, and
explanation. No online content or linked media is fetched automatically.

Declare a person’s reusable citation objects in `sources`, then reference them
in claim/event sources with `{id: citation_id}`. Definitions are collected before
references resolve, so note names and list order do not affect forward references;
undefined IDs are diagnosed. An explicit
citation ID repeated across people coalesces when its content matches; conflicting
contents are diagnosed rather than silently replacing evidence. A simple
`portrait_source` URL reuses a matching citation already in the person’s catalogue.

`birth_place` and `death_place` accept a place name, a place object such as
`{id: lindenby, name: Lindenby, latitude: 54.5}`, or a legacy place wiki link.
Birth/death date or place fields produce derived life events. Additional `events`
are objects with optional `id`, `type`, `name`, `date`, `place`, `sources`, `people`,
and `note` properties. `people` is an explicit list of person wiki links; the owner
is included and repeated participants are deduplicated. Sources remain explicit.
Use an event ID when its identity should survive later date or description edits.

Local attachment properties point to files inside the archive. Missing files,
traversal, and symbolic links leading outside the archive are rejected. Citation
`attachments` is a list of local paths, allowing an inline citation to preserve
an imported `attachments/original.ged` file without a separate source note.

## Portraits

`portrait` is a local attachment path, for example `attachments/elin.jpg`.
Optional `portrait_credit`, `portrait_license`, and `portrait_source` properties
keep provenance beside the person; `portrait_source` accepts a URL/citation object.
The legacy form `portrait: "[[media/elin]]"` also works when that media note has
an existing local `file`. Remote portrait URLs and lists are rejected. Portraits
are explicit authored choices; Kindred does not identify faces or infer likenesses.

The viewer displays supported image formats and otherwise retains initials.
Existence of an attachment does not prove it is an image or an accurate depiction.
Full archive export retains notes, credits, and image files. Public projection
excludes portraits, occupations, sources, attachments, and narrative prose by
default, while retaining selected explicit parent roles. Its output also uses
one physical note per included person. GEDCOM omits portraits and their credits;
consult each export’s loss report.

## Derived records and ownership

The graph index projects explicit person metadata into relationship, source,
event, and place records without creating Markdown files for them. Public API
records have `owner: null` for physical notes and an owning person ID for derived
records. Derived `path` and `raw` are empty; they must not be presented as editable
files. Edit the owner note, then rebuild the projection. A shared matching
citation selects the lowest-ID person providing its full definition as owner.

Explicit inline IDs are preserved. Generated claim IDs depend on owner/endpoints,
relation, and role, not list positions or filenames. Generated URL citation IDs
use their URL so a title correction does not change identity. Other generated
citation/event identities use their semantic metadata; give distinct uncertain
claims or evolving events explicit IDs. Different content under the same ID is
a validation error. Derived nodes never take part in filename link resolution.

Derived claim `parent`, `child`, `partners`, and `sources` properties refer to
record IDs. Derived event `people`, `place`, and `sources` likewise contain IDs.
These internal references are rebuilt from the unchanged person frontmatter.

## Legacy typed notes and query semantics

Separate notes with `type: relationship`, `source`, `event`, `place`, or `media`
remain supported. Legacy parent claims use `parent`/`child` wiki links and a
required explicit status; partners use exactly two `partners` links. Optional
`parent_role` is limited to mother/father/parent on parent relationship notes.
Legacy source/event/wiki-link and media-file validation still applies.

Queries default to accepted claims. Explicit relationship-type/status filters
select alternatives without presenting them as accepted facts. Ancestor and
descendant queries follow parent edges in the stated direction; neighborhoods
and connection paths also use partner edges. Depth zero includes only the focus.
Each generation allows one more edge. Paths are shortest undirected connections
within the requested limit, not automatic kinship labels. Shared ancestors are
visited once, cycles terminate, and edges retain claim and source identifiers.

## Editing, recovery, and disposable indexes

Saving compares the exact original text, validates the replacement in its full
archive context, stages a durable replacement, and rechecks before atomic
replacement. This includes rebuilding all derived records from the proposed
person metadata. Interrupted writes leave an explicit recovery journal. Recovery
never overwrites text differing from both the original and proposed replacement.
Journals/indexes have owner-only permissions on Unix; edits preserve note modes.

Reindexing writes `.kindred/index.json`, including derived records and private
research. The snapshot is never required or trusted to load an archive. Deleting
or corrupting it does not lose research; every load rereads authoritative files.

Full export compares file manifests and copied bytes before publishing a staged
archive. Detected changes abort it. These checks are optimistic: ordinary editors
do not participate in Kindred’s lock and could change a file after the final
check. Pause external writes when a stable snapshot is required. Editing replaces
one person note at a time; it does not promise multi-note transactions.

## GEDCOM explicit relation

The declared `_KINDRED_RELATION` extension on a `FAMC` link carries
`biological_parent`, `adoptive_parent`, or `foster_parent`, alongside the respective
`PEDI BIRTH`, `ADOPTED`, or `FOSTER`. GEDCOM 7’s `BIRTH` means family structure at
birth, so Kindred does not infer biological parentage from `BIRTH` alone or an
absent pedigree. Unsupported/ambiguous information remains in the original input
with an explicit report. Each exported parent claim uses a separate family.

## GEDCOM claim status

The declared `_KINDRED_STATUS` extension carries accepted/tentative/disputed/
rejected. Standard `STAT PROVEN`, `CHALLENGED`, and `DISPROVEN` map to accepted,
disputed, and rejected. Unspecified imported status is tentative; conflicting
statuses are rejected. Import does not independently verify a claim. Export
includes accepted claims and reports omitted alternatives. Consumers ignoring
extensions lose exact biological/status meaning. Parent roles, occupations,
portraits, and prose require complete archive export.

The GEDCOM subset retains the exact original attachment and explicitly reports
unmapped content. `RESN` conservatively becomes private; `DEAT N` never establishes
death. Supported input is UTF-8/ASCII GEDCOM 5.5.1 or 7.0. These policies follow the
[GEDCOM 7 specification](https://gedcom.io/specifications/FamilySearchGEDCOMv7.html),
consulted on 2026-09-19. This is a documented subset, not general GEDCOM support.
