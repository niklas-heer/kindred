+++
schema_version = 1
id = "01M2XHZ7BT7T1H3MKKMWQ0N9SK"
title = "Optimistic note editing and staged archive exchange"
date = "2026-09-19"
status = "accepted"
tags = ["storage"]
supersedes = []
superseded_by = []
depends_on = []
related_to = []
+++
Status: accepted and implemented within the owner's requested core workflow.

Edit one authoritative note at a time. Require its exact expected contents,
validate the entire proposed archive, lock cooperating Kindred writers, and
persist a recovery journal before atomic replacement. Preserve original file
permissions and restrict private journals/indexes on Unix. Recovery refuses
subsequent external changes. Plain editors cannot participate in a global
transaction; document the final-check race rather than claiming isolation.

Multi-file import/export writes a new staging directory and publishes it only
when complete and valid. Never merge into an existing destination. Full backups
include attachments and all user metadata; manifest and byte comparisons detect
source changes during copying. Pending edits must be resolved before backup.
Require explicit `--all` or `--public` scope. Public scope includes only explicitly
deceased, non-private people and non-private relationships, projecting known
metadata while excluding prose/evidence/media/unknown properties. This avoids
pretending that automatic free-text redaction is reliable.

GEDCOM is a conservative interchange subset, with original imports and explicit
mapping/loss reports. Do not convert vague dates, ambiguous pedigree information,
or disputed claims into established facts. Use complete archive export for
lossless preservation. See [the user guide](../USER_GUIDE.md) for concrete semantics.
