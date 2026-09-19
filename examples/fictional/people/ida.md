---
version: 1
id: ida
type: person
name: Ida Sørensen
birth: '1870'
parents:
- id: lea_ida
  status: accepted
  sources:
  - id: register
  note: Fictional claim for traversal and evidence testing. Review the claim status
    before relying on it.
  person: "[[people/lea]]"
  relation: biological_parent
partners:
- id: ida_emil
  status: accepted
  sources:
  - id: register
  note: The shared ancestor intentionally makes this a graph, not a tree.
  person: "[[people/emil]]"
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
