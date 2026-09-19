"""Compare bounded Kindred graph queries without adding application dependencies."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import sqlite3
import statistics
import subprocess
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any


def wiki_target(value: str) -> str:
    if not value.startswith("[[") or not value.endswith("]]"):
        raise ValueError(f"not a wiki link: {value}")
    return value[2:-2].split("|", 1)[0]


def load_graph(index: Path) -> tuple[list[str], list[dict[str, str]]]:
    payload = json.loads(index.read_text(encoding="utf-8"))
    records = payload["records"]
    by_path = {record["path"].removesuffix(".md"): record["id"] for record in records}
    people = [record["id"] for record in records if record["type"] == "person"]
    edges = []
    for record in records:
        metadata = record["metadata"]
        if (
            record["type"] != "relationship"
            or metadata.get("relation") != "biological_parent"
        ):
            continue
        edges.append(
            {
                "id": record["id"],
                "parent": by_path[wiki_target(metadata["parent"])],
                "child": by_path[wiki_target(metadata["child"])],
                "status": metadata["status"],
            }
        )
    return people, edges


def measurements(operation: Callable[[], Any], iterations: int) -> dict[str, float]:
    for _ in range(min(10, iterations)):
        operation()
    samples = []
    for _ in range(iterations):
        started = time.perf_counter_ns()
        operation()
        samples.append((time.perf_counter_ns() - started) / 1_000)
    samples.sort()
    p95 = samples[min(len(samples) - 1, int(len(samples) * 0.95))]
    return {
        "iterations": iterations,
        "median_us": round(statistics.median(samples), 3),
        "p95_us": round(p95, 3),
    }


def sqlite_evaluation(
    people: list[str], edges: list[dict[str, str]], iterations: int
) -> dict[str, Any]:
    started = time.perf_counter_ns()
    connection = sqlite3.connect(":memory:")
    connection.executescript(
        """
        CREATE TABLE person(id TEXT PRIMARY KEY);
        CREATE TABLE edge(
            id TEXT PRIMARY KEY,
            parent TEXT NOT NULL REFERENCES person(id),
            child TEXT NOT NULL REFERENCES person(id),
            status TEXT NOT NULL
        );
        CREATE INDEX edge_parent ON edge(parent);
        CREATE INDEX edge_child ON edge(child);
        """
    )
    connection.executemany(
        "INSERT INTO person VALUES (?)", ((person,) for person in people)
    )
    connection.executemany(
        "INSERT INTO edge VALUES (:id, :parent, :child, :status)", edges
    )
    load_us = (time.perf_counter_ns() - started) / 1_000
    ancestors_sql = """
        WITH RECURSIVE ancestors(id) AS (
            SELECT parent
            FROM edge
            WHERE child = ? AND status IN ('accepted', 'disputed')
            UNION
            SELECT edge.parent
            FROM edge JOIN ancestors ON edge.child = ancestors.id
            WHERE edge.status IN ('accepted', 'disputed')
        )
        SELECT id FROM ancestors ORDER BY id
    """
    path_sql = """
        WITH RECURSIVE walk(id, depth, trail) AS (
            VALUES (?, 0, ',' || ? || ',')
            UNION ALL
            SELECT
                CASE WHEN edge.parent = walk.id THEN edge.child ELSE edge.parent END,
                walk.depth + 1,
                trail || CASE WHEN edge.parent = walk.id THEN edge.child ELSE edge.parent END || ','
            FROM walk JOIN edge ON edge.parent = walk.id OR edge.child = walk.id
            WHERE edge.status = 'accepted'
              AND walk.depth < ?
              AND instr(
                  trail,
                  ',' || CASE WHEN edge.parent = walk.id THEN edge.child ELSE edge.parent END || ','
              ) = 0
        )
        SELECT min(depth) FROM walk WHERE id = ?
    """

    def ancestors() -> list[str]:
        return [
            row[0] for row in connection.execute(ancestors_sql, ("p_charles_bald",))
        ]

    def path() -> int:
        row = connection.execute(
            path_sql, ("p_henry_iv", "p_henry_iv", 6, "p_richard_iii")
        ).fetchone()
        return row[0]

    if len(ancestors()) != 15 or path() != 4:
        raise RuntimeError("SQLite results do not match the Kindred fixture landmarks")
    return {
        "version": sqlite3.sqlite_version,
        "load_us": round(load_us, 3),
        "ancestors": measurements(ancestors, iterations),
        "shortest_path": measurements(path, iterations),
    }


def ladybug_evaluation(
    people: list[str], edges: list[dict[str, str]], iterations: int
) -> dict[str, Any]:
    import ladybug as lb

    started = time.perf_counter_ns()
    database = lb.Database(":memory:")
    connection = lb.Connection(database)
    connection.execute("CREATE NODE TABLE Person(id STRING PRIMARY KEY)")
    connection.execute(
        "CREATE REL TABLE Parent(FROM Person TO Person, id STRING, status STRING)"
    )
    for person in people:
        connection.execute("CREATE (:Person {id: $id})", {"id": person})
    for edge in edges:
        connection.execute(
            """
            MATCH (parent:Person), (child:Person)
            WHERE parent.id = $parent AND child.id = $child
            CREATE (parent)-[:Parent {id: $id, status: $status}]->(child)
            """,
            edge,
        )
    load_us = (time.perf_counter_ns() - started) / 1_000
    ancestors_query = """
        MATCH (ancestor:Person)-[
            :Parent*1..30 (claim, node |
                WHERE claim.status IN ['accepted', 'disputed']
            )
        ]->(person:Person)
        WHERE person.id = 'p_charles_bald'
        RETURN DISTINCT ancestor.id ORDER BY ancestor.id
    """
    path_query = """
        MATCH path = (a:Person)-[
            :Parent* SHORTEST 1..6 (claim, node |
                WHERE claim.status = 'accepted'
            )
        ]-(b:Person)
        WHERE a.id = 'p_henry_iv' AND b.id = 'p_richard_iii'
        RETURN length(path)
    """

    def ancestors() -> list[str]:
        return [row[0] for row in connection.execute(ancestors_query)]

    def path() -> int:
        rows = list(connection.execute(path_query))
        return rows[0][0]

    if len(ancestors()) != 15 or path() != 4:
        raise RuntimeError("Ladybug results do not match the Kindred fixture landmarks")
    return {
        "version": importlib.metadata.version("ladybug"),
        "load_us": round(load_us, 3),
        "ancestors": measurements(ancestors, iterations),
        "shortest_path": measurements(path, iterations),
    }


def cli_evaluation(binary: Path, archive: Path, iterations: int) -> dict[str, Any]:
    ancestors_command = [
        str(binary),
        "ancestors",
        str(archive),
        "p_charles_bald",
        "--generations",
        "30",
        "--relations",
        "biological_parent",
        "--statuses",
        "accepted,disputed",
        "--json",
    ]
    path_command = [
        str(binary),
        "path",
        str(archive),
        "p_henry_iv",
        "p_richard_iii",
        "--generations",
        "6",
        "--relations",
        "biological_parent",
        "--statuses",
        "accepted",
        "--json",
    ]

    def query(command: list[str], expected_nodes: int, expected_edges: int) -> None:
        output = subprocess.run(command, check=True, capture_output=True).stdout
        result = json.loads(output)
        if (
            len(result["nodes"]) != expected_nodes
            or len(result["edges"]) != expected_edges
        ):
            raise RuntimeError(
                "Kindred CLI result does not match the fixture landmarks"
            )

    return {
        "scope": "new process, Markdown load and validation, traversal, JSON serialization",
        "ancestors": measurements(lambda: query(ancestors_command, 16, 15), iterations),
        "shortest_path": measurements(lambda: query(path_command, 5, 4), iterations),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("index", type=Path)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--kindred-bin", type=Path)
    parser.add_argument("--iterations", type=int, default=1_000)
    parser.add_argument("--cli-iterations", type=int, default=30)
    parser.add_argument("--ladybug", action="store_true")
    arguments = parser.parse_args()
    people, edges = load_graph(arguments.index)
    result: dict[str, Any] = {
        "fixture": {
            "people": len(people),
            "biological_parent_claims": len(edges),
            "index_bytes": arguments.index.stat().st_size,
        },
        "sqlite": sqlite_evaluation(people, edges, arguments.iterations),
    }
    if arguments.ladybug:
        result["ladybug"] = ladybug_evaluation(people, edges, arguments.iterations)
    if arguments.kindred_bin and arguments.archive:
        result["kindred_cli"] = cli_evaluation(
            arguments.kindred_bin, arguments.archive, arguments.cli_iterations
        )
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
