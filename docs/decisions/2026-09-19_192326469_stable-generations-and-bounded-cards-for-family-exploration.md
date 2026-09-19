+++
schema_version = 1
id = "01M2XHZ7C5WNJCAG3ZCRNE9ADE"
title = "Stable generations and bounded cards for family exploration"
date = "2026-09-19"
status = "accepted"
tags = []
supersedes = []
superseded_by = []
depends_on = []
related_to = []
+++
Status: implemented under the owner's request to improve the graph layout and card presentation; visual design remains open to iteration.

Replace the alphabetical overview grid with a top-down generation layout.
Explicit partner groups share a row; parents with missing ancestry move down
above their children. Order connected groups using neighboring branches and
separate disconnected components. Keep shared ancestors as single nodes.
Cyclic claims remain visible links but cannot all constrain a generation order.
Path queries retain a horizontal connection layout, and evidence uses a separate
row. A force layout remains an alternative if a future network exploration mode
needs it; it is not required for these bounded family views.

Keep SVG links and embedded assets. Render card contents in bounded HTML inside
SVG so names wrap and dates truncate within the card. No runtime dependencies
were added. Overview opens with connected branches and co-parents; Family starts
with immediate relatives. Zoom and Fit expose larger selections deliberately.

Native browser checks covered a historical family, four-generation ancestry,
long names, branch expansion/collapse, and zoom. Deterministic layout checks
covered shared ancestry, same-rank partners, cycle termination, and nonoverlapping
cards. These checks do not establish readability for arbitrarily large archives.


Update on 2026-09-19, under the owner's request for less tangled family sides and
related-person highlighting: group maternal ancestry left and paternal ancestry
right around an explicit focus, preserving unknown roles and shared ancestors.
Selection highlights ancestors, descendants, direct partners, collateral relatives,
and supporting paths within the filtered view. Rearranging around a new person
is explicit, so selection itself does not move the cards. Parent paths share
rounded sibling rails; large partner groups put the focus within the group.
Pure browser algorithms use Node's built-in test runner in native and Dagger
checks. Node is pinned as a development tool, with no npm/runtime dependency.
