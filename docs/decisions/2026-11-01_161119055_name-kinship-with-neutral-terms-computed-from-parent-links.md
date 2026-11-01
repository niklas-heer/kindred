+++
schema_version = 1
id = "01M6BY2B4FVPE5M3PJPX9ABFFE"
title = "Name kinship with neutral terms computed from parent links"
date = "2026-11-01"
status = "accepted"
tags = ["viewer", "kinship"]
supersedes = []
superseded_by = []
depends_on = []
related_to = ["01M66MA189C974D62NW9WR62PE", "01M6BRNQHCZ27NBAEHS133EW8Y"]
+++
## Decision

The viewer names how two people are related with gender-neutral terms ("Tante oder Onkel", "Cousin oder
Cousine", "aunt or uncle", "first cousin") computed from parent links to the closest common ancestor, with
"halbbürtig"/"half" when the lines meet in a single recorded ancestor and a person just below it has two recorded
parents. Failing a blood or adoptive link, one partner link names in-laws ("Partner von X (Kind)", "Elternteil von
Y"). The reader marks themself as "me" in this browser only (localStorage); nothing is written to the archive.

## Context

Relatives want to know "how am I related to her?" more than anything else the tree shows. German and English kinship
words are gendered (Tante, Onkel, Cousine), but the archive records parent roles, not genders, and the viewer
already refuses to infer gender from names (see the simple-view decision). Both council reviewers (Claude Opus, GPT
Sol) recommended neutral wording over adding a gender field.

Alternatives considered:

- Derive gender from `mother`/`father` roles. Rejected: it only covers parents, and a role is not a gender.
- Add an optional gender field to the schema. Deferred: a schema change for a display nicety; neutral terms work now.
- Show only the connecting path (Research's Path view). Kept for research; relatives need a single word.

## Consequences

- `KindredFamily.kinship` and `familyOf` (`src/web/family.js`) hold the rules and are unit-tested.
- Terms past three "great" steps fall back to a count ("4× great-grandchild").
- Choosing "me" is private to the browser; clearing site data forgets it.
- A future gender field could refine the wording without changing the computation.
