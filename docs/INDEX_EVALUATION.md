# Disposable index evaluation

The measurements below use the original 110-record historical fixture, before
the expansion in the current example. That baseline is available at commit
`6c719eb`. Rerunning the script on the larger current fixture gives different
record counts and should be recorded as a new measurement.

Date: 2026-09-19. Status: evaluated for the first local-archive milestone.

## Recommendation

Keep the current JSON snapshot and in-memory Rust traversal for the first
version. Do not add SQLite or LadybugDB yet.

The validated Markdown files remain authoritative. `kindred reindex` writes a
roughly 118 KiB JSON snapshot for the 110-record historical fixture, and the CLI
already answers the required bounded ancestor, descendant, neighborhood, and
shortest-path queries directly from the files. At this scale, a database would
add schema duplication, packaging work, and another failure mode without making
the user workflow meaningfully faster.

If a representative archive later exceeds the in-memory approach, evaluate
SQLite first. It is a small, zero-configuration, in-process database, and its
recursive common table expressions can perform Kindred's bounded traversals.
Choose Ladybug only when a measured large-graph workload or a concrete need for
read-only Cypher justifies its native build and packaging cost.

Reopen this decision when at least one of these conditions is observed on a
representative archive:

- archive load and validation makes interactive startup noticeably slow;
- a bounded domain query misses an agreed latency target;
- memory use prevents useful whole-family exploration;
- users have concrete advanced queries that are substantially clearer in
  Cypher than in Kindred's domain commands.

The next evaluation should use generated and real opt-in archives at several
sizes, record memory as well as latency, separate cold start from warm queries,
and include release binaries on every supported platform.

## What was compared

The reproducible prototype is [`scripts/evaluate_indexes.py`](../scripts/evaluate_indexes.py).
It reads the disposable snapshot produced by `kindred reindex`, resolves the
same 45 people and 46 biological-parent claims into each candidate, and verifies
two results before measuring them:

1. all 15 selected biological ancestors of Charles the Bald when `accepted`
   and `disputed` claims are requested; and
2. the four-edge undirected biological path from Henry IV to Richard III using
   only `accepted` claims.

The candidate queries deliberately use the same fixture, limits, and status
policies. They do not compare durable writes, concurrency, large graphs, memory
use, or application binary size, so the numbers below are not a general
database benchmark.

### Current Kindred traversal

Kindred's breadth-first traversal keeps claim status and relationship policy in
the domain layer and returns the relationship record IDs and source IDs needed
by the UI. It needs no database dependency. The measured CLI scope starts a new
process, reads and validates Markdown, traverses the graph, and serializes JSON
on every iteration. That is a useful end-to-end baseline, but it is intentionally
broader than the warm in-process database-query timings.

### SQLite prototype

The SQLite prototype uses indexed `person` and `edge` tables. Ancestors require
a recursive CTE. The undirected shortest path also needs explicit depth and
visited-node handling in SQL. This works and is deterministic, but the path SQL
is longer and easier to get subtly wrong than the existing Rust breadth-first
search.

SQLite's official documentation describes recursive CTEs as a way to walk trees
and graphs, and describes SQLite itself as an in-process, serverless,
zero-configuration database. These properties make it the lower-risk database
fallback for a local application. See the official [recursive CTE
documentation](https://www.sqlite.org/lang_with.html) and [SQLite
overview](https://www.sqlite.org/about.html).

### Ladybug prototype

Ladybug models a person and parent claim directly as a property graph. Its
bounded variable-length and `SHORTEST` Cypher patterns express the two queries
more clearly than the SQLite path CTE. Ladybug also supports in-memory operation,
which fits a rebuildable index. See the official [MATCH and shortest-path
syntax](https://docs.ladybugdb.com/cypher/query-clauses/match/) and [Python API
guide](https://docs.ladybugdb.com/client-apis/python/).

The cost is packaging. The official [system requirements](https://docs.ladybugdb.com/system-requirements/)
list Python wheels for CPython 3.7 through 3.11; this machine's project Python is
3.14, so the evaluation used a separately downloaded 3.11 interpreter in a
temporary `uv` environment. The resolved `ladybug` 0.20.4 package occupied about
14 MiB installed. The official [Rust installation
guide](https://docs.ladybugdb.com/installation/) says the Rust crate builds and
statically links Ladybug's C++ library from source by default. That is a material
cross-platform build commitment for a feature the current archive does not need.

Ladybug's strengths remain relevant for future large, join-heavy analytical
graphs; its own documentation describes that as its target. Kindred's first
version has a small graph, bounded traversals, and domain-specific evidence
rules, so those strengths do not outweigh the current integration cost.

## Measurements

The measured machine was an Apple M4 running arm64 macOS 27.0. The release CLI
was built with the repository's pinned Rust toolchain. SQLite timings used
Python 3.11's SQLite 3.53.1 module; Ladybug used its CPython 3.11 wheel, version
0.20.4. Database query results were consumed on every iteration.

| Scope | Operation | Iterations | Median | p95 |
| --- | --- | ---: | ---: | ---: |
| Kindred release CLI, full process and archive load | ancestors | 100 | 7.094 ms | 9.853 ms |
| Kindred release CLI, full process and archive load | shortest path | 100 | 6.826 ms | 9.582 ms |
| SQLite, warm in-process query | ancestors | 10,000 | 9.208 µs | 9.541 µs |
| SQLite, warm in-process query | shortest path | 10,000 | 24.750 µs | 26.167 µs |
| Ladybug, warm in-process query | ancestors | 10,000 | 837.688 µs | 1.179 ms |
| Ladybug, warm in-process query | shortest path | 10,000 | 509.500 µs | 784.500 µs |

Constructing and loading the in-memory structures in the recorded run took
0.321 ms for SQLite and 34.325 ms for Ladybug. These load figures come from a
small Python prototype and should not be projected to the Rust APIs. The warm
query gap also should not be used to claim that SQLite is generally faster than
Ladybug: 45 nodes are far below the analytical graph sizes Ladybug targets, and
Python binding overhead dominates such tiny operations.

## Reproduction

Create the disposable snapshot and release binary:

```sh
cargo run -- reindex examples/historical/european-dynasties
cargo build --release --locked
```

SQLite and the end-to-end CLI baseline use only Python's standard library:

```sh
python3 scripts/evaluate_indexes.py \
  examples/historical/european-dynasties/.kindred/index.json \
  --archive examples/historical/european-dynasties \
  --kindred-bin target/release/kindred
```

To include Ladybug without changing the application dependencies, create an
isolated temporary environment using a supported Python and add `--ladybug`:

```sh
uv venv --python 3.11 /tmp/kindred-ladybug-evaluation
uv pip install --python /tmp/kindred-ladybug-evaluation/bin/python ladybug==0.20.4
/tmp/kindred-ladybug-evaluation/bin/python scripts/evaluate_indexes.py \
  examples/historical/european-dynasties/.kindred/index.json \
  --archive examples/historical/european-dynasties \
  --kindred-bin target/release/kindred --ladybug
```

The script fails if any engine disagrees with the fixture landmarks. Timings
will vary across runs and machines; correctness is the durable part of this
prototype.
