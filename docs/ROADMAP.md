# Roadmap

These milestones describe intended work, not shipped functionality.

## 0. Project foundation

- Rust CLI with help/version and explicit errors for unsupported commands.
- Reproducible tools, local and CI checks, native archive builds, release process.
- MIT license, project vision, and contributor/agent guidance.

## 1. Read and validate a fictional archive

- Specify and version a minimal flat metadata format for people, relationships,
  and sources. Decide stable IDs and link-resolution rules.
- Implement `kindred check <directory>` with useful diagnostics, documented exit
  codes, and structured output. Preserve read-only behavior.
- Cover unknown metadata, duplicate IDs, missing links, Unicode names, uncertain
  dates, adoption, shared ancestors, and contradictory claims in fixtures.
- Prove that ordinary notes open and can be edited in Obsidian and a text editor.

## 2. Query the relationships

- Evaluate LadybugDB against SQLite on the same bounded tasks; record the choice.
- Build a disposable index and ancestor/descendant/path queries.
- Define direction, depth, relationship-type, and uncertainty semantics.
- Prove that deleting/rebuilding the index reproduces results from the files.
- Return source/claim references with relationships. Avoid timing promises until
  measured with representative data.

## 3. Explore locally

- Implement `kindred serve` with a loopback listener and shared query logic.
- Provide a focused graph, whole-family overview, and evidence/details panel.
- Test keyboard navigation, readable labels, expansion/collapse, and shared
  ancestors. A useful view must remain understandable as records grow.

## 4. Edit safely and exchange data

- Write edits to files while preserving unknown properties and prose.
- Detect concurrent edits and test interrupted writes, recovery, and rebuilds.
- Export a complete archive with attachments; add GEDCOM interoperability with
  explicit reports of unsupported or lossy mappings.
- Add deliberate filters for sharing records about living people.

## Later, if useful

Desktop packaging, maps/timelines, saved queries, and collaboration. Add them
when the core workflow establishes a need. Choose one small end-to-end behavior
per change rather than trying to implement a milestone all at once.
