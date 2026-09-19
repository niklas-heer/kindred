---
version: 1
id: emil
type: person
name: Emil Sørensen
birth: '1874'
parents:
- id: nils_emil
  status: accepted
  sources:
  - id: register
  note: Fictional claim for traversal and evidence testing. Review the claim status
    before relying on it.
  person: "[[people/nils]]"
  relation: biological_parent
- id: tove_emil
  status: rejected
  sources:
  - id: register
  note: Fictional claim for traversal and evidence testing. Review the claim status
    before relying on it.
  person: "[[people/tove]]"
  relation: foster_parent
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
