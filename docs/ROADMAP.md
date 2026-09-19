# Roadmap and completion evidence

The core single-user vision is implemented. This page distinguishes that scope
from optional later products and from the limits of the verification performed.
Implementation and checks below refer to the changes prepared on 2026-09-19.

| User outcome | Implementation and evidence |
| --- | --- |
| Own readable research files | One Markdown note per person in arbitrary folders, nested fact/claim/citation metadata, derived graph records, local portraits, and legacy typed-note compatibility; original text and unknown properties retained. `tests/archive.rs`. |
| Detect broken research structure | Read-only `check`, structured diagnostics, duplicate/ambiguous/missing links, source types, unsafe/missing attachments, malformed privacy flags. |
| Query relationships with evidence | Ancestors, descendants, neighborhoods, overview, bounded shortest paths; relation/status policies, cycles and shared ancestors; terminal/JSON output. Core and historical tests. |
| Rebuild without losing data | Disposable JSON snapshot; deleting or corrupting it cannot affect commands. External changes reflected on reread. Index tests and [engine evaluation](INDEX_EVALUATION.md). |
| Explore locally | Embedded browser graph, search, generation layout, branch selection, parent-role labels, local portrait thumbnails, occupations, stories, and note composition; relationship filters, details/evidence/events, keyboard navigation, safe attachment access. Native browser checks and loopback HTTP API tests. |
| Edit without silent overwrites | Browser/CLI exact-content checks, complete-archive draft validation, unknown-data preservation, durable single-note journal, recovery. Crash-phase and conflict tests in `tests/editing.rs`. |
| Back up and choose sharing scope | Complete exports include user files and attachments; restricted public projection excludes living/unknown/private people and unreviewed prose. Staged publication and source-change checks. `tests/exchange.rs`. |
| Exchange genealogy data | Conservative GEDCOM 5.5.1/7 UTF-8 import, GEDCOM 7 export subset, original input retention and explicit loss reports. `tests/gedcom.rs`; not exhaustive GEDCOM conformance. |
| Work in Obsidian or a text editor | Actual Obsidian 1.13.7 property/body edits, source-link navigation, Kindred validation/reindex, and Kindred-to-Obsidian external edit verified on the earlier separate-note format in a disposable archive; nested property-editor support is not claimed. [Reproduction record](USER_GUIDE.md#optional-obsidian-use). |
| Exercise representative families | Fictional adoption/conflict/cycle/failure fixtures; 88 sourced deceased people across Carolingian, Plantagenet, Tudor, Stuart, and Hanover branches, shared ancestry and multiple partnerships. [Historical guide](HISTORICAL_EXAMPLES.md). |

## Quality and distribution

`mise run check` covers formatting, compilation, strict Clippy, and native tests.
`mise run ci` runs the same checks and release smoke test in Linux through Dagger.
`mise run release:check` validates cargo-dist generation and artifact planning.
Native GitHub CI remains configured for Linux, macOS, and Windows. Release
archives include docs and examples; no public version has been released as part
of implementing the workflow.

Verification is bounded: automated tests cover deliberate failure states, not
all editors, filesystem behavior, arbitrary historical disputes, or every
GEDCOM producer. The [user guide](USER_GUIDE.md) documents the unavoidable final
check race with non-cooperating external editors and the conservative interchange
and public-export policies. This is early software, not a production-maturity
claim. Large-archive usability and performance need representative workloads
before promising scale.

## Explicitly later, if useful

Desktop wrappers, maps/timelines, saved queries, collaboration, hosted accounts,
automatic online tree merging, DNA analysis, AI-generated facts, and a general
query language remain outside the core scope. The SQLite/LadybugDB comparison
found no need to add a database or read-only Cypher interface to the bounded
queries in this version; reopen that choice when a concrete workload justifies it.
