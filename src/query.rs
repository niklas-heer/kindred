//! Bounded traversals with explicit claim-status and relation policies.
use crate::archive::{Archive, Edge, Record};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

/// An empty relation list means all relation types. Empty statuses means accepted.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryOptions {
    pub generations: usize,
    pub relations: Vec<String>,
    pub statuses: Vec<String>,
}
impl Default for QueryOptions {
    fn default() -> Self {
        Self {
            generations: 4,
            relations: Vec::new(),
            statuses: vec!["accepted".into()],
        }
    }
}
/// A graph selection. Edge IDs point to the full relationship/evidence notes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub nodes: Vec<Record>,
    pub edges: Vec<Edge>,
}

fn filtered(archive: &Archive, options: &QueryOptions) -> Vec<Edge> {
    archive
        .edges()
        .into_iter()
        .filter(|edge| {
            (options.relations.is_empty() || options.relations.contains(&edge.relation))
                && (if options.statuses.is_empty() {
                    edge.status == "accepted"
                } else {
                    options.statuses.contains(&edge.status)
                })
        })
        .collect()
}
fn check<'a>(archive: &'a Archive, id: &str) -> Result<&'a Record, String> {
    if !archive.diagnostics.is_empty() {
        return Err("archive contains validation errors; run kindred check".into());
    }
    let record = archive
        .record(id)
        .ok_or_else(|| format!("unknown or ambiguous person ID: {id}"))?;
    if record.kind != "person" {
        return Err(format!("expected person ID: {id}"));
    }
    Ok(record)
}
fn selection(archive: &Archive, ids: &BTreeSet<String>, edges: Vec<Edge>) -> QueryResult {
    QueryResult {
        nodes: archive
            .records
            .iter()
            .filter(|r| ids.contains(&r.id))
            .cloned()
            .collect(),
        edges,
    }
}

/// Ancestors along parent edges; the starting person is included at depth zero.
/// # Errors
/// Rejects invalid archives and unknown/non-person IDs.
pub fn ancestors(
    archive: &Archive,
    id: &str,
    options: &QueryOptions,
) -> Result<QueryResult, String> {
    traverse(archive, id, options, Direction::Ancestors)
}
/// Descendants along parent edges, preserving shared ancestors and claim edges.
/// # Errors
/// Rejects invalid archives and unknown/non-person IDs.
pub fn descendants(
    archive: &Archive,
    id: &str,
    options: &QueryOptions,
) -> Result<QueryResult, String> {
    traverse(archive, id, options, Direction::Descendants)
}
/// Undirected neighborhood including partner edges.
/// # Errors
/// Rejects invalid archives and unknown/non-person IDs.
pub fn neighborhood(
    archive: &Archive,
    id: &str,
    options: &QueryOptions,
) -> Result<QueryResult, String> {
    traverse(archive, id, options, Direction::Both)
}
#[derive(Clone, Copy)]
enum Direction {
    Ancestors,
    Descendants,
    Both,
}
fn traverse(
    archive: &Archive,
    id: &str,
    options: &QueryOptions,
    direction: Direction,
) -> Result<QueryResult, String> {
    check(archive, id)?;
    let edges = filtered(archive, options);
    let mut ids = BTreeSet::from([id.to_owned()]);
    let mut selected = BTreeSet::new();
    let mut queue = VecDeque::from([(id.to_owned(), 0usize)]);
    while let Some((current, depth)) = queue.pop_front() {
        if depth >= options.generations {
            continue;
        }
        for edge in &edges {
            let next = match direction {
                Direction::Ancestors if edge.relation != "partner" && edge.to == current => {
                    Some(&edge.from)
                }
                Direction::Descendants if edge.relation != "partner" && edge.from == current => {
                    Some(&edge.to)
                }
                Direction::Both if edge.from == current => Some(&edge.to),
                Direction::Both if edge.to == current => Some(&edge.from),
                _ => None,
            };
            if let Some(next) = next {
                selected.insert(edge.id.clone());
                if ids.insert(next.clone()) {
                    queue.push_back((next.clone(), depth.saturating_add(1)));
                }
            }
        }
    }
    Ok(selection(
        archive,
        &ids,
        edges
            .into_iter()
            .filter(|edge| selected.contains(&edge.id))
            .collect(),
    ))
}

/// Find a shortest undirected path with at most `generations` edges. A mixed
/// relationship path is a connection, not a genealogical kinship label.
/// # Errors
/// Rejects invalid archives, unknown people, and disconnected pairs.
pub fn path(
    archive: &Archive,
    from: &str,
    to: &str,
    options: &QueryOptions,
) -> Result<QueryResult, String> {
    check(archive, from)?;
    check(archive, to)?;
    let edges = filtered(archive, options);
    let mut visited = BTreeSet::from([from.to_owned()]);
    let mut previous: BTreeMap<String, (String, Edge)> = BTreeMap::new();
    let mut queue = VecDeque::from([(from.to_owned(), 0usize)]);
    while let Some((current, depth)) = queue.pop_front() {
        if current == to {
            break;
        }
        if depth >= options.generations {
            continue;
        }
        for edge in &edges {
            let next = if edge.from == current {
                &edge.to
            } else if edge.to == current {
                &edge.from
            } else {
                continue;
            };
            if visited.insert(next.clone()) {
                previous.insert(next.clone(), (current.clone(), edge.clone()));
                queue.push_back((next.clone(), depth.saturating_add(1)));
            }
        }
    }
    if !visited.contains(to) {
        return Err(format!(
            "no connection within {} steps under the selected claim policy",
            options.generations
        ));
    }
    let mut ids = BTreeSet::from([to.to_owned()]);
    let mut selected = Vec::new();
    let mut current = to;
    while let Some((parent, edge)) = previous.get(current) {
        ids.insert(parent.clone());
        selected.push(edge.clone());
        current = parent;
    }
    selected.reverse();
    Ok(selection(archive, &ids, selected))
}

/// All people, with edges filtered by explicit relation/status policy.
#[must_use]
pub fn overview(archive: &Archive, options: &QueryOptions) -> QueryResult {
    let nodes = archive
        .records
        .iter()
        .filter(|r| r.kind == "person")
        .cloned()
        .collect();
    QueryResult {
        nodes,
        edges: filtered(archive, options),
    }
}
