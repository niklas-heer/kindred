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
