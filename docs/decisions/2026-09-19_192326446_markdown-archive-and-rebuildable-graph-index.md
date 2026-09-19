+++
schema_version = 1
id = "01M2XHZ7BE3FA1DDB0E7GYJTJ8"
title = "Markdown archive and rebuildable graph index"
date = "2026-09-19"
status = "proposed"
tags = ["storage"]
supersedes = []
superseded_by = []
depends_on = []
related_to = []
+++
Status: proposed product architecture.

The current vision makes Markdown notes, metadata, and attachments authoritative
and builds a disposable index for querying. CLI and local web views share the
model; Obsidian is optional. This is the design to evaluate in the first working
milestone, not a claim of an implemented storage contract.

The specific archive schema, index engine (LadybugDB or SQLite), web framework,
desktop packaging, and advanced query language remain open. Confirm them with
small experiments and record the resulting decisions here.
