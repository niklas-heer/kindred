---
version: 1
id: noa
type: person
name: Noa Sørensen
birth: '1898'
parents:
- id: emil_noa
  status: accepted
  sources:
  - id: register
  note: Fictional claim for traversal and evidence testing. Review the claim status
    before relying on it.
  person: "[[people/emil]]"
  relation: biological_parent
- id: ida_noa
  status: accepted
  sources:
  - id: register
  note: Fictional claim for traversal and evidence testing. Review the claim status
    before relying on it.
  person: "[[people/ida]]"
  relation: biological_parent
- id: tove_noa
  status: accepted
  sources:
  - id: register
  note: Fictional claim for traversal and evidence testing. Review the claim status
    before relying on it.
  person: "[[people/tove]]"
  relation: adoptive_parent
events:
- version: 1
  id: adoption
  type: event
  name: Noa joins Tove’s household
  date: about 1901
  people:
  - "[[people/noa]]"
  - "[[people/tove]]"
  place:
    version: 1
    id: village
    type: place
    name: Fictional Lindenby
    latitude: 54.5
    longitude: 10.2
    note: An invented village.
  sources:
  - id: register
  note: A fictional event accompanies the explicit adoptive-parent claim.
sources:
- version: 1
  id: register
  type: source
  name: Fictional village register
  attachments:
  - attachments/register.txt
  file: attachments/register.txt
  transcription_id: register_media
  transcription_name: Register transcription
  note: |-
    This document and every person in this example are fictional. The alternative birth years are intentionally unresolved.

    Plain text is sufficient to test attachment preservation.
---

Fictional research example. A casual mention of [[people/tove|Tove]] does not assert parentage.

## Register transcription

Plain text is sufficient to test attachment preservation.
