# Decision log

## 0001 — Public Rust project under MIT

Date: 2026-09-19. Status: accepted and implemented.

Kindred is a public project at `niklas-heer/kindred`, implemented in stable Rust
and licensed under MIT. The project owner explicitly requested the public
repository, Rust setup, release capability, and vision document, and identified
MIT as their normal license choice. The license covers the software, not user
family records. Crates.io publication is disabled until package naming and
distribution needs are deliberately established.

## 0002 — Reproducible checks and version-tag releases

Date: 2026-09-19. Status: accepted for the initial setup.

Use mise for pinned development tools and tasks, rustfmt/Clippy/Cargo tests for
the initial quality gate, and Dagger with Dang for containerized Linux checks.
Run native checks on the release platforms. Use cargo-dist to generate and
maintain release packaging, with the check workflow required before a tag can
publish. See [RELEASING.md](RELEASING.md).

This adopts the owner's development preferences within the requested setup.
Keep project guidance self-contained. Avoid optional tools and application
dependencies until they solve a demonstrated problem. No release is published
merely by setting up this pipeline.

## 0003 — Markdown archive and rebuildable graph index

Date: 2026-09-19. Status: proposed product architecture.

The current vision makes Markdown notes, metadata, and attachments authoritative
and builds a disposable index for querying. CLI and local web views share the
model; Obsidian is optional. This is the design to evaluate in the first working
milestone, not a claim of an implemented storage contract.

The specific archive schema, index engine (LadybugDB or SQLite), web framework,
desktop packaging, and advanced query language remain open. Confirm them with
small experiments and record the resulting decisions here.


## 0004 — Implement the local archive contract and defer a database

Date: 2026-09-19. Status: accepted and implemented; supersedes the proposed
implementation status in 0003.

The owner requested completing the documented core vision. Adopt version 1 flat
YAML frontmatter in Markdown, stable IDs, filename-based wiki links, explicit
relationship claims/statuses, and separate source/event/place/media records.
Files are authoritative. Prose does not create genealogy edges. Shared Rust
validation and traversal serve CLI and browser; default queries use accepted
claims. Unknown properties and original prose remain intact.

Use serde/serde_json/serde_yaml_ng for serialization and parsing, tiny_http for
the loopback server, and embedded dependency-free HTML/CSS/JavaScript for the
browser. These dependencies address the actual archive/HTTP behavior; no frontend
package manager, database server, desktop wrapper, or general query parser is
needed. A disposable private JSON snapshot records validated records, while
commands rebuild their in-memory graph from files.

The [bounded SQLite/LadybugDB evaluation](INDEX_EVALUATION.md) executes the same
historical ancestor/path tasks in both candidates and compares packaging and
query clarity. Both work; neither is needed for the measured first workload.
This is a deliberate architecture choice, not an unperformed engine selection.
Revisit when archive startup, query latency, memory use, or concrete Cypher needs
justify the additional implementation and distribution cost.

## 0005 — Optimistic note editing and staged archive exchange

Date: 2026-09-19. Status: accepted and implemented within the owner's requested
core workflow.

Edit one authoritative note at a time. Require its exact expected contents,
validate the entire proposed archive, lock cooperating Kindred writers, and
persist a recovery journal before atomic replacement. Preserve original file
permissions and restrict private journals/indexes on Unix. Recovery refuses
subsequent external changes. Plain editors cannot participate in a global
transaction; document the final-check race rather than claiming isolation.

Multi-file import/export writes a new staging directory and publishes it only
when complete and valid. Never merge into an existing destination. Full backups
include attachments and all user metadata; manifest and byte comparisons detect
source changes during copying. Pending edits must be resolved before backup.
Require explicit `--all` or `--public` scope. Public scope includes only explicitly
deceased, non-private people and non-private relationships, projecting known
metadata while excluding prose/evidence/media/unknown properties. This avoids
pretending that automatic free-text redaction is reliable.

GEDCOM is a conservative interchange subset, with original imports and explicit
mapping/loss reports. Do not convert vague dates, ambiguous pedigree information,
or disputed claims into established facts. Use complete archive export for
lossless preservation. See [the user guide](USER_GUIDE.md) for concrete semantics.

## 0006 — Sourced deceased historical examples alongside fictional fixtures

Date: 2026-09-19. Status: accepted and implemented by explicit owner request.

The owner requested historical families, with Wikipedia or other sources, to
exercise ancestry over long periods. This supersedes the fictional-only example
rule for a bounded historical demonstration, not for private real-family data.
Keep fictional records for synthetic failure cases. Historical fixtures contain
only deceased people, original brief prose, source notes/URLs/access dates, and
explicit uncertainty. Do not copy biographies or imply the selected genealogy
is complete. The software license does not relicense linked source pages.

The [historical guide](HISTORICAL_EXAMPLES.md) describes 45 people, 51 claims,
14 sources, selected Carolingian/Plantagenet branches, and expected query results.
Tests verify sources/links, long ancestry, shared ancestors, multiple partnerships,
and the disputed-claim policy. Historical evidence may be revised; preserve
uncertainty and recheck the relevant source before changing a claim.

## 0007 — Stable generations and bounded cards for family exploration

Date: 2026-09-19. Status: implemented under the owner's request to improve the
graph layout and card presentation; visual design remains open to iteration.

Replace the alphabetical overview grid with a top-down generation layout.
Explicit partner groups share a row; parents with missing ancestry move down
above their children. Order connected groups using neighboring branches and
separate disconnected components. Keep shared ancestors as single nodes.
Cyclic claims remain visible links but cannot all constrain a generation order.
Path queries retain a horizontal connection layout, and evidence uses a separate
row. A force layout remains an alternative if a future network exploration mode
needs it; it is not required for these bounded family views.

Keep SVG links and embedded assets. Render card contents in bounded HTML inside
SVG so names wrap and dates truncate within the card. No runtime dependencies
were added. Overview opens with connected branches and co-parents; Family starts
with immediate relatives. Zoom and Fit expose larger selections deliberately.

Native browser checks covered a historical family, four-generation ancestry,
long names, branch expansion/collapse, and zoom. Deterministic layout checks
covered shared ancestry, same-rank partners, cycle termination, and nonoverlapping
cards. These checks do not establish readability for arbitrarily large archives.
