# Historical example archive

The archive at
[`examples/historical/european-dynasties`](../examples/historical/european-dynasties)
is a realistic, bounded data set for validation and graph-query testing. It has
45 person records, 51 relationship claims, and 14 source records. All people
are deceased. The prose is original and brief; source pages are linked rather
than copied.

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

The result has `"records": 110` and an empty `diagnostics` array. Query the full
selected Carolingian ancestry of Charles the Bald with a deliberately generous
generation limit. This query explicitly includes disputed claims so it can
follow the traditional Arnulf-to-Ansegisel lineage without presenting it as
settled:

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
at least one source, the archive has 45 people and 51 claims, York ancestry
converges on Edward III when disputed claims are requested, claim-status
filtering excludes the disputed Alpaida partnership by default, and the
selected Lancaster and York branches have a biological connection.

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

## Sources and maintenance

Each relationship links to a source note under `sources/`. Those notes store the
page title, URL, access date, and reuse terms when applicable. The main sources
are the Wikipedia dynasty and biography pages, the Royal Household's Angevin
overview, Westminster Abbey's royal biographies, Encyclopaedia Britannica's
Charlemagne biography, and the University of Leicester's Richard III lines-of-
descent research. All were consulted on 2026-09-19.

If a source changes, preserve the historical uncertainty already represented in
the archive unless the replacement evidence resolves it. Update the source note
and the affected claims together, then rerun `mise run check`. Do not add living
people to this fixture.
