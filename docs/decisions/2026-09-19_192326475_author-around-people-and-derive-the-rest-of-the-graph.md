+++
schema_version = 1
id = "01M2XHZ7CBSKY43ZWK4Z9KNMHA"
title = "Author around people and derive the rest of the graph"
date = "2026-09-19"
status = "accepted"
tags = []
supersedes = []
superseded_by = []
depends_on = []
related_to = []
+++
Status: accepted by explicit owner instruction and implemented.

The owner requested that people choose their folder organization and write one
note per person containing known facts and metadata, with Kindred making the
connections. This supersedes 0004's separate-note and flat-only authoring
requirement. New archives start with `people/` and `attachments/`; any non-hidden
folder arrangement works. Rich metadata may contain objects and lists.

Parents, partners, events, places, and citations can be declared in a person
note. Derived records have stable IDs and an owning person, but no independent
file or editable copy. Reading, querying, and indexing rebuild them; editing a
derived item leads back to its owning note. Existing separate typed notes remain
supported. Explicit metadata creates connections; casual prose mentions do not.
Simple mother/father links mean accepted biological assertions; detailed entries
retain adoptive/foster types, roles, status, claim citations, and reasoning.
Person-level source lists are not evidence for every claim automatically.

Local portrait paths, provenance, occupations, stories, and notes remain beside
the person. Images use the attachment boundary and are never fetched implicitly.
The historical example expands to 88 deceased people across selected sixth–
eighteenth-century families, including seven attributed public-domain portraits.
Lucide SVG icons are bundled with their [license notices](../THIRD_PARTY_NOTICES.md).
This extends 0006's historical example and 0007's presentation choices.

The implementation and validation contract are documented in [SCHEMA.md](../SCHEMA.md).
Full exports preserve original person files and attachment bytes. Public and
GEDCOM projections retain their deliberately narrower, reported scope.
