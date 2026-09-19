+++
schema_version = 1
id = "01M2XHZ7CHE87SXYD3KVGPF9T8"
title = "Research warnings remain separate from invalid archives"
date = "2026-09-19"
status = "accepted"
tags = ["tooling"]
supersedes = []
superseded_by = []
depends_on = []
related_to = []
+++
Status: accepted by explicit owner confirmation and implemented.

The owner requested CLI checks for mistakes and forgotten metadata, then confirmed
that incomplete optional details should produce warnings while broken links and
invalid metadata remain errors. `kindred check` reports actionable research
warnings separately from structural diagnostics, including in JSON. Warnings
alone retain exit code 0; structural errors retain exit code 1.

Check omitted names, life dates, parentage, and citations, plus clear chronology
conflicts using only exact year values and accepted biological claims. Explicit
`parents: []` records that no parentage is currently known. Do not invent dates,
roles, sources, or certainty; uncertainty wording is preserved and not compared
as an exact year. These checks flag research to revisit, not historical proof.
See [the user guide](../USER_GUIDE.md#research-quality-warnings) and CLI tests.
