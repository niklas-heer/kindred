use kindred::{
    archive::Archive,
    query::{self, QueryOptions},
};
use serde_json::Value;
use std::{path::Path, process::Command};

const ARCHIVE: &str = "examples/historical/european-dynasties";

// A missing binary or malformed CLI response should fail the fixture immediately.
#[allow(clippy::expect_used)]
fn cli_json(arguments: &[&str]) -> Value {
    let output = Command::new(env!("CARGO_BIN_EXE_kindred"))
        .args(arguments)
        .output()
        .expect("kindred should run");
    assert!(
        output.status.success(),
        "kindred failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("kindred should emit JSON")
}

#[test]
fn historical_archive_is_valid_and_sourced() {
    let archive = Archive::load(Path::new(ARCHIVE)).expect("historical archive should load");
    assert!(archive.diagnostics.is_empty(), "{:#?}", archive.diagnostics);
    let people: Vec<_> = archive
        .records
        .iter()
        .filter(|record| record.kind == "person")
        .collect();
    assert_eq!(people.len(), 45);
    assert!(people.iter().all(|person| {
        person.metadata.get("living").and_then(Value::as_bool) == Some(false)
            && person
                .metadata
                .get("sources")
                .and_then(Value::as_array)
                .is_some_and(|sources| !sources.is_empty())
    }));
    assert_eq!(
        archive
            .records
            .iter()
            .filter(|record| record.kind == "source")
            .count(),
        14
    );
    assert_eq!(archive.edges().len(), 51);
    assert!(archive.edges().iter().all(|edge| !edge.sources.is_empty()));
}

#[test]
fn york_ancestry_converges_on_edward_iii_when_disputed_claims_are_included() {
    let archive = Archive::load(Path::new(ARCHIVE)).expect("historical archive should load");
    let options = QueryOptions {
        generations: 4,
        relations: vec!["biological_parent".into()],
        statuses: vec!["accepted".into(), "disputed".into()],
    };
    let result = query::ancestors(&archive, "p_edward_iv", &options).expect("valid query");
    let ids: Vec<_> = result
        .nodes
        .iter()
        .map(|record| record.id.as_str())
        .collect();
    assert!(ids.contains(&"p_edward_iii"));
    assert!(ids.contains(&"p_john_gaunt"));
    assert!(ids.contains(&"p_edmund_langley"));
    assert_eq!(ids.iter().filter(|id| **id == "p_edward_iii").count(), 1);
}

#[test]
fn claim_status_controls_the_disputed_carolingian_partnership() {
    let archive = Archive::load(Path::new(ARCHIVE)).expect("historical archive should load");
    let accepted = query::neighborhood(
        &archive,
        "p_pepin_herstal",
        &QueryOptions {
            generations: 1,
            ..QueryOptions::default()
        },
    )
    .expect("valid query");
    assert!(
        !accepted
            .edges
            .iter()
            .any(|edge| { edge.id == "r_partner_pepin_herstal_alpaida" })
    );

    let with_disputed = query::neighborhood(
        &archive,
        "p_pepin_herstal",
        &QueryOptions {
            generations: 1,
            relations: Vec::new(),
            statuses: vec!["accepted".into(), "disputed".into()],
        },
    )
    .expect("valid query");
    assert!(
        with_disputed
            .edges
            .iter()
            .any(|edge| { edge.id == "r_partner_pepin_herstal_alpaida" })
    );
}

#[test]
fn biological_path_connects_lancaster_and_york_branches() {
    let archive = Archive::load(Path::new(ARCHIVE)).expect("historical archive should load");
    let result = query::path(
        &archive,
        "p_henry_iv",
        "p_richard_iii",
        &QueryOptions {
            generations: 6,
            relations: vec!["biological_parent".into()],
            statuses: vec!["accepted".into()],
        },
    )
    .expect("the branches should connect through John of Gaunt's descendants");
    assert_eq!(result.edges.len(), 4);
    assert!(
        result
            .nodes
            .iter()
            .any(|record| record.id == "p_john_gaunt")
    );
}

#[test]
fn cli_validates_and_queries_the_historical_archive() {
    let checked = cli_json(&["check", ARCHIVE, "--json"]);
    assert_eq!(checked["records"], 110);
    assert_eq!(checked["diagnostics"], serde_json::json!([]));

    let carolingian = cli_json(&[
        "ancestors",
        ARCHIVE,
        "p_charles_bald",
        "--generations",
        "30",
        "--relations",
        "biological_parent",
        "--statuses",
        "accepted,disputed",
        "--json",
    ]);
    assert_eq!(carolingian["nodes"].as_array().map(Vec::len), Some(16));
    assert_eq!(carolingian["edges"].as_array().map(Vec::len), Some(15));

    let york = cli_json(&[
        "ancestors",
        ARCHIVE,
        "p_edward_iv",
        "--generations",
        "4",
        "--relations",
        "biological_parent",
        "--statuses",
        "accepted,disputed",
        "--json",
    ]);
    let york_nodes = york["nodes"].as_array().expect("nodes should be an array");
    assert_eq!(
        york_nodes
            .iter()
            .filter(|node| node["id"] == "p_edward_iii")
            .count(),
        1
    );
    assert!(york_nodes.iter().any(|node| node["id"] == "p_john_gaunt"));
    assert!(
        york_nodes
            .iter()
            .any(|node| node["id"] == "p_edmund_langley")
    );

    let partnerships = cli_json(&[
        "neighbors",
        ARCHIVE,
        "p_louis_pious",
        "--generations",
        "1",
        "--relations",
        "partner",
        "--statuses",
        "accepted",
        "--json",
    ]);
    assert_eq!(partnerships["nodes"].as_array().map(Vec::len), Some(3));
    assert_eq!(partnerships["edges"].as_array().map(Vec::len), Some(2));
}
