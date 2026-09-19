+++
schema_version = 1
id = "01M2XHZ7B9SS6NKW24A9PYXBA6"
title = "Reproducible checks and version-tag releases"
date = "2026-09-19"
status = "accepted"
tags = ["release"]
supersedes = []
superseded_by = []
depends_on = []
related_to = []
+++
Status: accepted for the initial setup.

Use mise for pinned development tools and tasks, rustfmt/Clippy/Cargo tests for
the initial quality gate, and Dagger with Dang for containerized Linux checks.
Run native checks on the release platforms. Use cargo-dist to generate and
maintain release packaging, with the check workflow required before a tag can
publish. See [RELEASING.md](../RELEASING.md).

This adopts the owner's development preferences within the requested setup.
Keep project guidance self-contained. Avoid optional tools and application
dependencies until they solve a demonstrated problem. No release is published
merely by setting up this pipeline.

Update on 2026-09-19: the owner explicitly requested immediate publication of
`0.1.0`, Conventional Commit release notes, and distribution through the existing
`niklas-heer/homebrew-tap`. Pin git-cliff in mise and generate the changelog before
tagging; cargo-dist uses that section for the release announcement. Update the
tap from verified published archive checksums using existing maintainer Git
access. This adds no cross-repository token to CI. Publication and Homebrew
installation must each be verified separately; see the release procedure.
