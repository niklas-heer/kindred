+++
schema_version = 1
id = "01M2XHZ7BMKM4KV8Z4T4ECVMJ8"
title = "Implement the local archive contract and defer a database"
date = "2026-09-19"
status = "accepted"
tags = ["architecture", "storage"]
supersedes = []
superseded_by = []
depends_on = []
related_to = ["01M2XHZ7BE3FA1DDB0E7GYJTJ8", "01M2XHZ7CBSKY43ZWK4Z9KNMHA"]
+++
Status: accepted and implemented; supersedes the proposed implementation status in 0003. The separate-note/flat-only authoring choice is superseded by 0008; its file-authority and index decisions remain in effect.

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

The [bounded SQLite/LadybugDB evaluation](../INDEX_EVALUATION.md) executes the same
historical ancestor/path tasks in both candidates and compares packaging and
query clarity. Both work; neither is needed for the measured first workload.
This is a deliberate architecture choice, not an unperformed engine selection.
Revisit when archive startup, query latency, memory use, or concrete Cypher needs
justify the additional implementation and distribution cost.
