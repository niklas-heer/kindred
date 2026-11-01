+++
schema_version = 1
id = "01M6BRNQHCZ27NBAEHS133EW8Y"
title = "Presume people living without a recorded death and list missing details on request"
date = "2026-11-01"
status = "accepted"
tags = ["viewer", "privacy"]
supersedes = []
superseded_by = []
depends_on = []
related_to = ["01M66MA189C974D62NW9WR62PE", "01M66RDQRC0ASVVKMT5AH82C6P"]
+++
## Decision

The viewer treats a person as living unless a death is recorded (`died`, `death`, or `death_date`) or the
note says `living: false`. Ages are completed years today for the living and the age at death otherwise;
a year-only date makes the age approximate. From 100 years on the viewer shows no age for a presumed-living
person and, in the **What's missing?** mode, asks whether the person is still alive.

The same mode lists each person's unrecorded details from the person's own metadata and parent links: birth
date or its exact day, place of birth, occupation for adults, parents, death date and place for the deceased,
and a photo. It is off by default, because readers who only want to browse should not see a to-do list.

## Context

Relatives asked for ages on the cards and for a way to see what is still unknown, so the tree fills up over
time. Family archives rarely record that someone is alive; they record deaths. Requiring `living: true`
before showing an age would hide it for almost everyone, and treating every unknown as deceased would give
living relatives a dash for a death date. Niklas set the rule: no recorded death means probably alive, and
only an implausible age should become a question.

Alternatives considered:

- Infer death from a fixed lifespan and show "probably deceased". Rejected: a guess presented as data.
- Show the gaps permanently. Rejected: the cards are for reading, and the list is long for in-laws.
- Count gaps in the CLI's quality warnings only. Kept separate: those warnings serve researchers; this mode
  serves relatives answering through the suggestion form.

## Consequences

- `KindredLife` (`src/web/life.js`) holds the rule and is unit-tested; the cards, details, and the mode use it.
- Static sites mark every protected person with `date_display: year`, so a birth day the site withholds is
  not listed as missing.
- A person recorded as `living: true` past 100 is still asked about; the rule reads only deaths and
  `living: false`.
- The threshold is a constant (`OLD_AGE`); changing it changes only display and questions, never data.
