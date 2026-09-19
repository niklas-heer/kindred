# Historical example archive

The archive at
[`examples/historical/european-dynasties`](../examples/historical/european-dynasties)
is a realistic, bounded data set for validation and graph-query testing. It has
88 person notes containing 125 relationship claims and 42 distinct inline
citations. All people are deceased. Kindred derives relationship, source, and
life-event records from those notes when it loads the archive; the only other
fixture files are seven locally stored, public-domain portraits. The prose is
original and brief; source pages are linked rather than copied.

## What the archive exercises

The Carolingian graph begins with the Pippinid and Arnulfing branches and joins
them through Begga and Ansegisel. It continues through Pepin of Herstal, Charles
Martel, Pepin the Short, Charlemagne, and Louis the Pious. Louis has children
represented from two accepted partnerships. Pepin of Herstal's relationship
with Alpaida is marked `disputed`: the biological parent claims for Charles
Martel are accepted, while the historical characterization of the partnership
as marriage, concubinage, or another relationship is not settled here. The
traditional biological link from Arnulf of Metz to Ansegisel is also
`disputed`; the surviving accounts are late and inconsistent.

The Plantagenet graph follows Henry II to Edward III, then splits into branches
through John of Gaunt and Edmund of Langley. John of Gaunt has selected children
from his partnerships with Blanche of Lancaster and Katherine Swynford. The
Beaufort and York branches converge when Richard of York and Cecily Neville have
Edward IV and Richard III. This gives query tests shared ancestors, repeated
descent from Edward III, and more than one valid route through the graph.
Edmund of Langley was Richard of Conisburgh's recorded father, but historians
have questioned the biological attribution, so that parent claim is
`disputed`.

The larger connected branch continues from John of Gaunt and Katherine
Swynford through their Beaufort descendants to Margaret Beaufort and Henry VII.
Henry VII's children with Elizabeth of York give the graph a wide Tudor sibling
generation. Henry VIII's children have three different mothers, while Margaret
Tudor's children by James IV and Archibald Douglas create two lines that reunite
in James VI and I. The Stuart branch then splits again through Charles I and
Elizabeth Stuart before reaching William III, Mary II, Queen Anne, and George I.

Every person has an `occupation` field. Each biological-parent object has a
sourced `role` of `mother` or `father`; Kindred exposes it as `parent_role` on
the derived relationship record, so the display can show roles without
guessing from names. More than twenty key people have short, original
`## Story` sections, and uncertain dates or deliberately bounded coverage are
explained under `## Research notes`. Seven Tudor and Stuart people also have a
local portrait with artist, date, collection, source, credit, license, and
provenance recorded in the same person note.

## One note per person

The fixture models the people-first authoring workflow. A person note keeps its
dates, occupation, narrative, citations, portraits, and claims together. The
`parents` list belongs to the child; every object records a stable claim ID, a
wiki link to the parent, relationship type, parent role, evidence status,
supporting citations, and a short evidence note. The `partners` list stores
each partnership once on one of the two people with the same evidence fields.

Citation objects preserve stable IDs, titles, URLs, access dates, reuse terms,
and research notes. Each person keeps complete definitions in their top-level
`sources` catalog; parent, partner, and event objects use the compact
`- id: source_id` form to cite that catalog. Repeating the same citation ID in
several people produces one disposable source node. `born` and `died` remain
the researcher's original date strings; Kindred projects them into birth and
death events for the graph without creating separate event files.

The archive is intentionally selective. It does not imply that omitted parents,
partners, or children did not exist. Birth dates are kept as strings such as
`c. 1310–1315`; Kindred must not silently convert them into exact dates. The
sources are a mixture of tertiary summaries and institutional pages. They are
adequate for a transparent software fixture, but a publication-quality family
history should trace each claim to scholarly editions and primary records.

## Reproducible checks

Run the repository's normal quality gate to validate the archive and its focused
integration tests:

```sh
mise run check
```

The same fixture can be exercised through the public CLI. From the repository
root, first validate it:

```sh
cargo run -- check examples/historical/european-dynasties --json
```

The result has an empty `diagnostics` array. Its record count includes the 88
physical person notes plus the relationships, citations, and life events
derived from their metadata. Query the full selected Carolingian ancestry of
Charles the Bald with a deliberately generous generation limit. This query
explicitly includes disputed claims so it can follow the traditional
Arnulf-to-Ansegisel lineage without presenting it as settled:

```sh
cargo run -- ancestors examples/historical/european-dynasties \
  p_charles_bald --generations 30 \
  --relations biological_parent --statuses accepted,disputed --json
```

That selection has 16 nodes and 15 sourced relationship edges. The York branch
demonstrates converging ancestry and likewise includes the disputed
recorded-father claim for Richard of Conisburgh:

```sh
cargo run -- ancestors examples/historical/european-dynasties \
  p_edward_iv --generations 4 \
  --relations biological_parent --statuses accepted,disputed --json
```

That selection has 12 nodes and 13 edges. `p_edward_iii` and
`p_philippa_hainault` each appear once even though two branches reach them.

The shortest biological-only connection between the selected Lancaster and
York descendants is reproducible with:

```sh
cargo run -- path examples/historical/european-dynasties \
  p_henry_iv p_richard_iii --generations 6 \
  --relations biological_parent --statuses accepted --json
```

It has four edges: Henry IV → John of Gaunt → Joan Beaufort → Cecily Neville →
Richard III. This is a graph connection, not a generated kinship label.

The new Stuart convergence is visible in a four-generation ancestry query:

```sh
cargo run -- ancestors examples/historical/european-dynasties \
  p_james_vi_i --generations 4 \
  --relations biological_parent --statuses accepted --json
```

The result has 12 nodes and 12 edges. It includes both `p_james_v` and
`p_margaret_douglas`; their shared mother `p_margaret_tudor` appears once.
The selected descent from Elizabeth of York to George I is seven edges:

```sh
cargo run -- path examples/historical/european-dynasties \
  p_elizabeth_york p_george_i --generations 10 \
  --relations biological_parent --statuses accepted --json
```

To inspect a wide sibling generation, request Henry VII's accepted children:

```sh
cargo run -- descendants examples/historical/european-dynasties \
  p_henry_vii --generations 1 \
  --relations biological_parent --statuses accepted --json
```

That result has Henry VII plus Arthur, Margaret, Henry VIII, and Mary: five
nodes joined by four parent claims. A one-generation accepted `partner`
neighborhood for `p_henry_viii` has four nodes and three partnerships,
representing Catherine of Aragon, Anne Boleyn, and Jane Seymour.

Finally, query Louis the Pious's two selected partnerships:

```sh
cargo run -- neighbors examples/historical/european-dynasties \
  p_louis_pious --generations 1 \
  --relations partner --statuses accepted --json
```

The result contains Louis, Ermengarde of Hesbaye, and Judith of Bavaria with two
partner edges. To inspect the deliberately disputed Carolingian claim, replace
the person with `p_pepin_herstal` and use `--statuses accepted,disputed`.

The `historical` integration test checks that all links resolve, every edge has
at least one source, all 88 physical person notes are deceased and sourced with
occupation metadata, all 125 derived relationship records retain an owning
person, and all 100 biological claims have an explicit parent role. It checks
that the 42 preserved citations, 176 projected life events, seven portraits,
and at least 20 stories remain observable. It also verifies the original York
and Carolingian landmarks, the wide Tudor sibling generation, the double
descent from Margaret Tudor to James VI and I, and the seven-edge route to
George I.

## Expected query landmarks

These stable IDs are useful when exploring the archive:

- With `--statuses accepted,disputed`, `p_edward_iv` has both `p_john_gaunt`
  and `p_edmund_langley` in a four-generation biological-ancestor result. Their
  shared parents `p_edward_iii` and `p_philippa_hainault` appear once each even
  though the graph reaches them by two branches.
- A biological-only shortest path from `p_henry_iv` to `p_richard_iii` has four
  edges: Henry IV → John of Gaunt → Joan Beaufort → Cecily Neville → Richard III.
- An accepted-only one-step neighborhood of `p_pepin_herstal` omits
  `r_partner_pepin_herstal_alpaida`. Adding `disputed` status includes it.
- An accepted-only ancestry query stops before Arnulf of Metz on Ansegisel's
  branch and before Edmund of Langley on Richard of Conisburgh's branch.
- `p_charles_bald` and `p_lothair_i` share `p_louis_pious` as a parent but have
  different mothers, exercising multiple partnerships without duplicating the
  parent claim.
- `p_henry_vii` has four selected children in one generation, while
  `p_henry_viii` has selected children with three partners.
- `p_james_vi_i` reaches `p_margaret_tudor` through both Mary, Queen of Scots
  and Lord Darnley, but the ancestor appears once in query output.
- The accepted biological path from `p_elizabeth_york` to `p_george_i` has
  seven edges and crosses the Tudor, Stuart, Palatinate, and Hanover branches.

## Sources and maintenance

Each person carries complete citation objects inline, while relationship claims
refer to those objects by ID. The source catalog stores the page title, URL,
access date, research scope, evidence note, and reuse terms when applicable.
Shared stable IDs let Kindred coalesce repeated citations into one derived
source record. The main sources are the Wikipedia
dynasty and biography pages, Royal Museums Greenwich's Tudor research, the
Royal Household's Angevin overview, Westminster Abbey's royal biographies,
Encyclopaedia Britannica's Charlemagne biography, and the University of
Leicester's Richard III lines-of-descent research. The portrait citations link
to Wikimedia Commons file-description pages and retain their public-domain
reuse statements. All were consulted on 2026-09-19.

If a source changes, preserve the historical uncertainty already represented in
the archive unless the replacement evidence resolves it. Update the citation
and affected claims in the relevant person notes together, then rerun
`mise run check`. Do not add living people to this fixture.
