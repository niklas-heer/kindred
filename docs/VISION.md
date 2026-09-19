# Kindred: a family archive you can explore

Kindred is a local family-history tool built around a simple promise: your
research lives in readable files, and you can explore the relationships without
losing the stories and evidence behind them.

This document describes the intended product. The current implementation is a
Rust CLI foundation; the archive model, queries, and graph UI still need to be
built and tested. The project name, public repository, Rust foundation, and MIT
license are established. Specific schemas, database engines, and UI frameworks
remain proposals until validated.

## The problem

Family history is richer than a tree. People share ancestors, form multiple
partnerships, adopt children, move between households, and leave contradictory
records. A rigid pedigree view loses some of these connections; an unrestricted
graph quickly becomes overwhelming. Lists of dates and documents can obscure
the people and relationships they describe.

Kindred should let someone move naturally between a person's story, a focused
family view, the larger graph, and the evidence for a particular claim.

## Who it serves

- A family historian collecting documents, photographs, and oral histories.
- An Obsidian user who wants ordinary linked notes with a genealogy-aware view.
- A terminal user who wants to validate and query the same archive through a CLI.
- Someone who wants a local browser interface without adopting a hosted service
  or a particular note-taking application.

The first version targets a single person working on a local archive. Sharing
and collaboration can follow after file integrity and portability are reliable.

## Product principles

1. **Own the archive.** Markdown, metadata, and attachments remain useful without
   Kindred. No account, hosted service, or Obsidian installation is required.
2. **Preserve the evidence.** A disputed parent or approximate date must not be
   presented as an established fact. Keep sources, alternatives, and reasoning.
3. **Reveal relevant connections.** Start with a person or question; expand the
   graph deliberately. Support an overview without drawing every detail at once.
4. **Use several interfaces to the same data.** CLI, local web UI, and optional
   desktop packaging share one model and validation behavior.
5. **Make indexes disposable.** Files are authoritative. Deleting a database
   cache must not destroy research; every application edit writes to the archive.
6. **Respect people's information.** The tool runs locally by default. Sharing or
   export needs explicit scope, especially for living people and private sources.

## Proposed archive model

Use Markdown notes with flat YAML frontmatter. A person has a stable ID, a
display name, aliases, and a prose biography. Relationships or claims can be
separate notes, with typed links to people, sources, review status, and reasoning.
Events, places, documents, and media can have their own identities where useful.

An illustrative relationship note, not a finalized schema:

```markdown
---
id: r_001
type: relationship
relation: biological_parent
parent: "[[people/p_001|Anna Müller]]"
child: "[[people/p_002|Emil Müller]]"
status: tentative
sources:
  - "[[sources/s_001|Birth register]]"
---

The register names Anna, but the surname is difficult to read.
Compare with another source before accepting this relationship.
```

All people in examples are fictional. Stable IDs identify records; filenames
are actual link targets. IDs alone cannot repair broken links after arbitrary
renames. Validation must detect missing targets, ambiguous links, and duplicate
IDs. A casual mention in prose must never become a parentage assertion.

Model biological, adoptive, foster, and partner relationships explicitly. Store
uncertain dates as uncertain dates, preserving original wording. A relationship
claim may have several sources, and a source may support several claims.
Do not store two independently editable copies of the same relationship.

Preserve prose and unknown properties when editing. Detect external changes
before overwriting a note. Multi-file changes need a recovery strategy; a file
watcher and atomic replacement of one file do not solve the whole problem.

## Experiences to build

### Read and research

Open a person to read their story, see relationships and events, and inspect
attached evidence. Edit notes with Kindred or an ordinary editor. Reindexing
should reconcile valid external changes and explain malformed records.

### Explore the graph

- Ancestors or descendants, with a generation limit and relationship filters.
- Connections between two people, retaining the evidence for each step.
- Whole-family overview with collapsed branches and progressive detail.
- A details panel for a selected person, event, or relationship.

Use generation-aware layouts for ancestry and other layouts for neighborhoods
and paths. A shortest path through mixed relationship types is not automatically
a genealogical kinship label. Shared ancestors and cycles need deliberate
traversal semantics. Evidence nodes should be available without cluttering the
default person-to-person view.

### Query from the terminal or the graph

Illustrative commands, not implemented commands:

```sh
kindred check ./family
kindred ancestors p_002 --generations 4
kindred path p_001 p_042
kindred serve ./family
```

A query should produce a terminal list, structured JSON, or the same selection
in the graph. Start with useful domain commands. Evaluate read-only Cypher for
advanced exploration; design a new query language only if concrete needs justify
it. Queries need explicit policies for relationship types and disputed claims.

### Optional Obsidian use

An archive should open as a useful Obsidian vault without a required plugin.
Obsidian's YAML properties and file links can support editing and inventories;
its native graph displays notes and links. Kindred would interpret relationship
notes as typed edges and provide genealogy-specific navigation. Test real
round-trips before claiming interoperability. Keep the core independent of
Obsidian-specific APIs and avoid nested metadata that its property editor cannot
comfortably edit.

## Technical direction and open choices

Rust is the implementation language. Begin with the CLI and a locally served
web graph; consider a desktop wrapper later if installation and OS integration
justify it. The local server should listen on loopback by default.

LadybugDB is a promising rebuildable graph index because it embeds in-process
and supports Cypher. SQLite is a viable alternative for indexing and traversal.
DuckDB is more attractive for bulk historical analysis. No engine is selected:
compare query clarity, packaging, startup, data recovery, and representative
workloads before adopting one. Avoid two independently authoritative stores.

GEDCOM import/export is a planned interchange capability, not the internal
authoring format. Document unsupported fields and export loss. An export or
backup must include attachments and interpretation metadata, not just an index.

## First milestone and boundaries

Build one small fictional archive through the actual workflow: read notes,
validate a sourced relationship, query ancestors, inspect a graph, edit a note
externally, and rebuild the index without losing data. Add adoption, shared
ancestors, conflicting dates, and broken links to the fixtures. See
[ROADMAP.md](ROADMAP.md) for acceptance criteria.

Do not begin with hosted accounts, automatic online tree merging, DNA analysis,
AI-generated family facts, plugin infrastructure, or a general query language.
The initial work should establish a useful, trustworthy archive and exploration
experience.

## References informing the proposal

- [Obsidian properties](https://help.obsidian.md/properties) and
  [links](https://help.obsidian.md/links).
- [Obsidian graph](https://help.obsidian.md/plugins/graph) and
  [Bases](https://help.obsidian.md/bases).
- [LadybugDB documentation](https://docs.ladybugdb.com/).
- [SQLite recursive queries](https://www.sqlite.org/lang_with.html).
- [GEDCOM 7](https://gedcom.io/specifications/FamilySearchGEDCOMv7.html).

External documentation was consulted on 2026-09-19. Verify current APIs and
compatibility when implementing; these references are not benchmark evidence.
