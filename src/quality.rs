//! Nonblocking research-quality checks for otherwise valid archive data.

use crate::archive::{Archive, Record};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

/// An actionable research-quality issue which does not make an archive invalid.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Warning {
    pub code: String,
    pub path: String,
    pub message: String,
}

/// Find useful omissions and clear chronology conflicts without inferring facts.
///
/// Warnings never affect archive validity. Dates are compared only when both are
/// plain four-digit years, and relationship chronology is limited to accepted
/// biological-parent claims.
#[must_use]
pub fn warnings(archive: &Archive) -> Vec<Warning> {
    let mut warnings = Vec::new();
    let mut owners_with_unsourced_claims = BTreeSet::new();
    let mut unsourced_claims = BTreeMap::<String, usize>::new();
    let people_with_parent_claims: BTreeSet<_> = archive
        .edges()
        .into_iter()
        .filter(|edge| {
            ["biological_parent", "adoptive_parent", "foster_parent"]
                .contains(&edge.relation.as_str())
        })
        .map(|edge| edge.to)
        .collect();

    for claim in archive
        .records
        .iter()
        .filter(|record| record.kind == "relationship")
        .filter(|record| !has_sources(record.metadata.get("sources")))
    {
        let path = owner_path(archive, claim);
        let count = unsourced_claims.entry(path).or_default();
        *count = count.saturating_add(1);
        if let Some(owner) = &claim.owner {
            owners_with_unsourced_claims.insert(owner.clone());
        }
    }

    for (path, count) in unsourced_claims {
        warnings.push(Warning {
            code: "missing_claim_sources".into(),
            path,
            message: format!(
                "{count} relationship {} no explicit sources; add evidence to each claim or record why it remains uncertain",
                if count == 1 { "claim has" } else { "claims have" }
            ),
        });
    }

    for person in archive
        .records
        .iter()
        .filter(|record| record.kind == "person" && record.owner.is_none())
    {
        warnings.extend(person_warnings(
            person,
            &owners_with_unsourced_claims,
            &people_with_parent_claims,
        ));
    }

    warnings.extend(chronology_warnings(archive));
    warnings.sort_by(|a, b| (&a.path, &a.code, &a.message).cmp(&(&b.path, &b.code, &b.message)));
    warnings
}

fn person_warnings(
    person: &Record,
    owners_with_unsourced_claims: &BTreeSet<String>,
    people_with_parent_claims: &BTreeSet<String>,
) -> Vec<Warning> {
    let mut warnings = Vec::new();
    if person
        .metadata
        .get("name")
        .and_then(Value::as_str)
        .is_none_or(|name| name.trim().is_empty())
    {
        warnings.push(Warning {
            code: "missing_name".into(),
            path: person.path.clone(),
            message: format!(
                "person {} has no display name; add name when it is known",
                person.id
            ),
        });
    }
    if !has_date(date(person, &["born", "birth"])) && !has_date(date(person, &["died", "death"])) {
        warnings.push(Warning {
            code: "missing_life_dates".into(),
            path: person.path.clone(),
            message: format!(
                "person {} has neither a birth nor death date; add known or explicitly uncertain date wording",
                person.id
            ),
        });
    }
    if !owners_with_unsourced_claims.contains(&person.id)
        && !contains_explicit_sources(&person.metadata)
    {
        warnings.push(Warning {
            code: "missing_sources".into(),
            path: person.path.clone(),
            message: format!(
                "person {} has no explicit citations; add sources for researched facts when available",
                person.id
            ),
        });
    }
    if !people_with_parent_claims.contains(&person.id)
        && !["mother", "father", "parents"]
            .iter()
            .any(|key| person.metadata.contains_key(*key))
    {
        warnings.push(Warning {
            code: "missing_parentage".into(),
            path: person.path.clone(),
            message: format!(
                "person {} has no recorded parentage; add known parents or parents: [] when none are known",
                person.id
            ),
        });
    }
    if let (Some(born), Some(died)) = (
        exact_year(date(person, &["born", "birth"])),
        exact_year(date(person, &["died", "death"])),
    ) && died < born
    {
        warnings.push(Warning {
            code: "death_before_birth".into(),
            path: person.path.clone(),
            message: format!(
                "person {} has exact death year {died} before birth year {born}",
                person.id
            ),
        });
    }
    warnings
}

fn chronology_warnings(archive: &Archive) -> Vec<Warning> {
    let mut warnings = Vec::new();
    for edge in archive
        .edges()
        .into_iter()
        .filter(|edge| edge.relation == "biological_parent" && edge.status == "accepted")
    {
        let (Some(parent), Some(child)) = (archive.record(&edge.from), archive.record(&edge.to))
        else {
            continue;
        };
        let Some(child_born) = exact_year(date(child, &["born", "birth"])) else {
            continue;
        };
        let path = archive
            .record(&edge.id)
            .map_or_else(|| child.path.clone(), |claim| owner_path(archive, claim));
        if let Some(parent_born) = exact_year(date(parent, &["born", "birth"]))
            && parent_born >= child_born
        {
            warnings.push(Warning {
                code: "parent_born_after_child".into(),
                path: path.clone(),
                message: format!(
                    "accepted biological parent {} was born in {parent_born}, not before child {} in {child_born}",
                    parent.id, child.id
                ),
            });
        }
        if let Some(parent_died) = exact_year(date(parent, &["died", "death"]))
            && parent_died.saturating_add(1) < child_born
        {
            warnings.push(Warning {
                code: "parent_died_before_child_birth".into(),
                path,
                message: format!(
                    "accepted biological parent {} died in {parent_died}, more than a year before child {} was born in {child_born}",
                    parent.id, child.id
                ),
            });
        }
    }
    warnings
}

fn owner_path(archive: &Archive, record: &Record) -> String {
    record
        .owner
        .as_deref()
        .and_then(|owner| archive.record(owner))
        .map_or_else(|| record.path.clone(), |owner| owner.path.clone())
}

fn date<'a>(record: &'a Record, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().find_map(|key| record.metadata.get(*key))
}

fn exact_year(value: Option<&Value>) -> Option<u16> {
    let value = value?;
    if let Some(year) = value.as_u64().filter(|year| (1000..=9999).contains(year)) {
        return u16::try_from(year).ok();
    }
    let text = value.as_str()?;
    (text.len() == 4 && text.bytes().all(|byte| byte.is_ascii_digit()))
        .then(|| text.parse().ok())
        .flatten()
}

fn has_date(value: Option<&Value>) -> bool {
    match value {
        Some(Value::String(value)) => !value.trim().is_empty(),
        Some(Value::Number(_)) => true,
        _ => false,
    }
}

fn has_sources(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_array)
        .is_some_and(|sources| !sources.is_empty())
}

fn contains_explicit_sources(metadata: &BTreeMap<String, Value>) -> bool {
    fn visit(key: Option<&str>, value: &Value) -> bool {
        if key == Some("sources") && has_sources(Some(value)) {
            return true;
        }
        match value {
            Value::Array(values) => values.iter().any(|value| visit(None, value)),
            Value::Object(values) => values.iter().any(|(key, value)| visit(Some(key), value)),
            _ => false,
        }
    }

    metadata.iter().any(|(key, value)| visit(Some(key), value))
}
