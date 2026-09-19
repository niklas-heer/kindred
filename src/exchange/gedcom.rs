//! GEDCOM 5.5.1/7 UTF-8 interchange. Unsupported input remains in the original file.
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::fs;
use std::path::Path;

use serde_json::Value;

use super::{Report, public_people, staged_directory, write_note};
use crate::archive::{Archive, Record};

#[derive(Debug)]
struct Line {
    level: usize,
    xref: String,
    tag: String,
    value: String,
}

#[derive(Default)]
struct ChildLink {
    pedigree: Option<String>,
    relation: Option<String>,
    status: Option<String>,
}

fn preserve(report: &mut Report, record: &Line, line: &Line) {
    report.warnings.push(format!(
        "{} {}: {} {} retained only in original GEDCOM",
        record.xref, record.tag, line.tag, line.value
    ));
}

fn parse(text: &str) -> Result<Vec<Line>, String> {
    let mut lines = Vec::new();
    if text
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err("GEDCOM contains prohibited control characters".into());
    }
    for (index, raw) in text.trim_start_matches('\u{feff}').lines().enumerate() {
        if raw.trim().is_empty() {
            continue;
        }
        let mut parts = raw.splitn(3, ' ');
        let level = parts
            .next()
            .unwrap_or("")
            .parse::<usize>()
            .map_err(|_| format!("GEDCOM line {}: invalid level", index.saturating_add(1)))?;
        let first = parts.next().ok_or("GEDCOM line missing tag")?;
        let remainder = parts.next().unwrap_or("");
        let (xref, tag, value) = if first.starts_with('@') && first.ends_with('@') {
            let (tag, value) = remainder.split_once(' ').unwrap_or((remainder, ""));
            (first.to_owned(), tag.to_owned(), value.to_owned())
        } else {
            (String::new(), first.to_owned(), remainder.to_owned())
        };
        if tag.is_empty() {
            return Err("GEDCOM line missing tag".into());
        }
        if level > lines.last().map_or(0, |l: &Line| l.level.saturating_add(1)) {
            return Err("GEDCOM levels skip a parent".into());
        }
        let value = if value.starts_with("@@") {
            value.strip_prefix('@').unwrap_or(&value).to_owned()
        } else {
            value
        };
        lines.push(Line {
            level,
            xref,
            tag,
            value,
        });
    }
    if lines
        .first()
        .is_none_or(|l| l.level != 0 || l.tag != "HEAD")
        || lines.last().is_none_or(|l| l.level != 0 || l.tag != "TRLR")
    {
        return Err("GEDCOM must start with HEAD and end with TRLR".into());
    }
    Ok(lines)
}

fn records(lines: &[Line]) -> Vec<&[Line]> {
    let mut result = Vec::new();
    let mut start = 0;
    for (index, line) in lines.iter().enumerate().skip(1) {
        if line.level == 0 {
            if let Some(record) = lines.get(start..index) {
                result.push(record);
            }
            start = index;
        }
    }
    if let Some(record) = lines.get(start..) {
        result.push(record);
    }
    result
}

fn base(id: &str, kind: &str, name: &str) -> BTreeMap<String, Value> {
    BTreeMap::from([
        ("version".into(), Value::from(1)),
        ("id".into(), Value::from(id)),
        ("type".into(), Value::from(kind)),
        ("name".into(), Value::from(name)),
    ])
}

fn link(id: &str, directory: &str) -> String {
    format!("[[{directory}/{id}]]")
}

/// Import a conservative subset into a new archive and retain the unmodified input.
/// # Errors
/// Rejects malformed input, dangling pointers, invalid records, and existing destinations.
pub fn import(input: &Path, destination: &Path) -> Result<Report, String> {
    let original = fs::read_to_string(input).map_err(|e| e.to_string())?;
    let lines = parse(&original)?;
    let records = records(&lines);
    let header = records.first().ok_or("missing GEDCOM header")?;
    validate_header(&records, header)?;
    let mut ids = BTreeMap::new();
    for (index, record) in records.iter().enumerate() {
        let Some(header) = record.first() else {
            continue;
        };
        if !header.xref.is_empty() {
            if ids.contains_key(&header.xref) {
                return Err(format!("duplicate GEDCOM pointer {}", header.xref));
            }
            ids.insert(
                header.xref.clone(),
                (format!("g{index}"), header.tag.clone()),
            );
        }
    }
    staged_directory(destination, |stage| {
        let mut report = Report::default();
        let mut context = "";
        for line in header.iter().skip(1) {
            if line.level == 1 {
                context = &line.tag;
            }
            if !(line.level == 1 && matches!(line.tag.as_str(), "GEDC" | "CHAR")
                || line.level == 2 && line.tag == "VERS" && context == "GEDC")
            {
                preserve(&mut report, header.first().ok_or("missing header")?, line);
            }
        }
        for record in &records {
            if let Some(header) = record.first()
                && !matches!(
                    header.tag.as_str(),
                    "HEAD" | "TRLR" | "INDI" | "FAM" | "SOUR"
                )
            {
                report.warnings.push(format!(
                    "{} {}: entire record retained only in original GEDCOM",
                    header.xref, header.tag
                ));
            }
        }
        fs::create_dir(stage.join("attachments")).map_err(|e| e.to_string())?;
        fs::write(stage.join("attachments/original.ged"), &original).map_err(|e| e.to_string())?;
        let mut pedigrees = BTreeMap::new();
        for record in &records {
            import_record(stage, record, &ids, &mut pedigrees, &mut report)?;
        }
        for record in &records {
            if record.first().is_some_and(|l| l.tag == "FAM") {
                import_family(stage, record, &ids, &pedigrees, &mut report)?;
            }
        }
        for (child, family) in pedigrees.keys() {
            if !records.iter().any(|record| {
                record.first().is_some_and(|line| &line.xref == family)
                    && record
                        .iter()
                        .any(|line| line.level == 1 && line.tag == "CHIL" && &line.value == child)
            }) {
                report.warnings.push(format!("{child}: FAMC {family} has no reciprocal CHIL; membership retained only in original GEDCOM"));
            }
        }
        report.warnings.push("Only UTF-8 primary names, first birth/death date text, sex, privacy restrictions, source titles, explicit pedigree types/status and family-level source pointers are mapped. Missing claim status becomes tentative; absent or ambiguous pedigree never becomes biological parentage. Additional names, dates, inline citations and unsupported structures remain in the original. Original GEDCOM is retained at attachments/original.ged; no external media is downloaded. Review all imported claims and privacy before sharing.".into());
        let archive = Archive::load(stage)?;
        if !archive.diagnostics.is_empty() {
            return Err(format!(
                "import produced validation errors: {}",
                serde_json::to_string(&archive.diagnostics).map_err(|e| e.to_string())?
            ));
        }
        fs::write(
            stage.join("IMPORT-REPORT.json"),
            serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        Ok(report)
    })
}

fn validate_header(records: &[&[Line]], header: &[Line]) -> Result<(), String> {
    let mut context = "";
    let mut version = None;
    for line in header.iter().skip(1) {
        if line.level == 1 {
            context = &line.tag;
        }
        if line.level == 1
            && line.tag == "CHAR"
            && !matches!(line.value.as_str(), "UTF-8" | "ASCII")
        {
            return Err(
                "only UTF-8/ASCII GEDCOM input is supported; convert the encoding first".into(),
            );
        }
        if line.level == 2
            && line.tag == "VERS"
            && context == "GEDC"
            && version.replace(line.value.as_str()).is_some()
        {
            return Err("duplicate GEDCOM schema version".into());
        }
    }
    if !matches!(version, Some("5.5.1" | "7.0" | "7.0.0")) {
        return Err(
            "supported GEDCOM versions are 5.5.1 and 7.0, declared under HEAD.GEDC.VERS".into(),
        );
    }
    if records
        .iter()
        .skip(1)
        .any(|record| record.first().is_some_and(|line| line.tag == "HEAD"))
        || records
            .iter()
            .take(records.len().saturating_sub(1))
            .any(|record| record.first().is_some_and(|line| line.tag == "TRLR"))
    {
        return Err("GEDCOM contains multiple headers or trailers".into());
    }
    Ok(())
}

fn mapped<'a>(
    ids: &'a BTreeMap<String, (String, String)>,
    pointer: &str,
    kind: &str,
) -> Result<&'a str, String> {
    match ids.get(pointer) {
        Some((id, actual)) if actual == kind => Ok(id),
        _ => Err(format!(
            "missing or wrong-type GEDCOM pointer {pointer} (expected {kind})"
        )),
    }
}

fn import_record(
    stage: &Path,
    record: &[Line],
    ids: &BTreeMap<String, (String, String)>,
    pedigrees: &mut BTreeMap<(String, String), ChildLink>,
    report: &mut Report,
) -> Result<(), String> {
    let Some(header) = record.first() else {
        return Ok(());
    };
    if !matches!(header.tag.as_str(), "INDI" | "SOUR") {
        return Ok(());
    }
    let id = mapped(ids, &header.xref, &header.tag)?;
    let person = header.tag == "INDI";
    let name_tag = if person { "NAME" } else { "TITL" };
    let name = record
        .iter()
        .find(|line| line.level == 1 && line.tag == name_tag)
        .map_or_else(
            || id.to_owned(),
            |line| {
                if person {
                    line.value.replace('/', "").trim().to_owned()
                } else {
                    line.value.clone()
                }
            },
        );
    let mut metadata = base(id, if person { "person" } else { "source" }, &name);
    let mut context = "";
    let mut subcontext = "";
    let mut family = "";
    let mut seen_name = false;
    let mut selected_event = false;
    let mut events = BTreeSet::new();
    for line in record.iter().skip(1) {
        if line.level == 1 {
            context = &line.tag;
            subcontext = "";
            if matches!(context, "BIRT" | "DEAT") {
                selected_event = events.insert(context);
            }
        } else if line.level == 2 {
            subcontext = &line.tag;
        }
        match (line.level, line.tag.as_str(), context) {
            (1, tag, _) if tag == name_tag && !seen_name => {
                seen_name = true;
            }
            (1, "RESN", _) => {
                metadata.insert("private".into(), Value::Bool(true));
                report.warnings.push(format!(
                    "{}: RESN mapped conservatively to private: true",
                    header.xref
                ));
            }
            (1, "SEX", _) if person && !metadata.contains_key("sex") => {
                metadata.insert("sex".into(), Value::from(line.value.clone()));
            }
            (1, "DEAT", _)
                if person && selected_event && matches!(line.value.as_str(), "" | "Y") =>
            {
                metadata.insert("living".into(), Value::Bool(false));
            }
            (1, "BIRT", _) if person && selected_event && line.value.is_empty() => {}
            (2, "DATE", "BIRT" | "DEAT") | (3, "PHRASE", "BIRT" | "DEAT")
                if person && selected_event && (line.tag == "DATE" || subcontext == "DATE") =>
            {
                let key = if context == "BIRT" { "birth" } else { "death" };
                if line.value.is_empty() {
                    continue;
                }
                if metadata.contains_key(key) {
                    preserve(report, header, line);
                } else {
                    metadata.insert(key.into(), Value::from(line.value.clone()));
                }
            }
            (1, "FAMC", _) if person => {
                family = &line.value;
                let _ = mapped(ids, family, "FAM")?;
                pedigrees
                    .entry((header.xref.clone(), family.into()))
                    .or_default();
            }
            (1, "FAMS", _) if person => {
                let _ = mapped(ids, &line.value, "FAM")?;
            }
            (2, "PEDI" | "STAT" | "_KINDRED_RELATION" | "_KINDRED_STATUS", "FAMC") if person => {
                let child_link = pedigrees
                    .entry((header.xref.clone(), family.into()))
                    .or_default();
                import_child_link(child_link, header, line, family, report)?;
            }
            _ => preserve(report, header, line),
        }
    }
    write_note(
        stage,
        &format!("{}/{id}.md", if person { "people" } else { "sources" }),
        &metadata,
        "Imported from attachments/original.ged. Review the original for unmapped details.\n",
    )?;
    report.written = report.written.saturating_add(1);
    Ok(())
}

fn import_child_link(
    child_link: &mut ChildLink,
    header: &Line,
    line: &Line,
    family: &str,
    report: &mut Report,
) -> Result<(), String> {
    let value = match line.tag.as_str() {
        "STAT" => match line.value.as_str() {
            "PROVEN" => "accepted",
            "CHALLENGED" => "disputed",
            "DISPROVEN" => "rejected",
            _ => {
                preserve(report, header, line);
                "tentative"
            }
        }
        .to_owned(),
        "PEDI" => line.value.to_uppercase(),
        _ => line.value.clone(),
    };
    let slot = match line.tag.as_str() {
        "PEDI" => &mut child_link.pedigree,
        "_KINDRED_RELATION" => &mut child_link.relation,
        _ => &mut child_link.status,
    };
    if slot.as_ref().is_some_and(|old| old != &value) {
        return Err(format!(
            "conflicting {} values for {} in {family}",
            line.tag, header.xref
        ));
    }
    *slot = Some(value);
    Ok(())
}

fn import_family(
    stage: &Path,
    record: &[Line],
    ids: &BTreeMap<String, (String, String)>,
    pedigrees: &BTreeMap<(String, String), ChildLink>,
    report: &mut Report,
) -> Result<(), String> {
    let Some(header) = record.first() else {
        return Ok(());
    };
    let family_id = mapped(ids, &header.xref, "FAM")?;
    let parents: Vec<_> = record
        .iter()
        .filter(|l| l.level == 1 && matches!(l.tag.as_str(), "HUSB" | "WIFE"))
        .collect();
    for parent in &parents {
        let _ = mapped(ids, &parent.value, "INDI")?;
    }
    if parents.len() > 2 {
        return Err(format!(
            "{}: more than two family parent-role entries are unsupported",
            header.xref
        ));
    }
    let sources = family_sources(record, ids, report)?;
    let private = record
        .iter()
        .any(|line| line.level == 1 && line.tag == "RESN");
    let statuses: BTreeSet<_> = record
        .iter()
        .filter(|line| line.level == 1 && line.tag == "_KINDRED_STATUS")
        .map(|line| line.value.as_str())
        .collect();
    if statuses.len() > 1 {
        return Err(format!(
            "{}: conflicting family claim statuses",
            header.xref
        ));
    }
    let family_status = statuses.first().copied().unwrap_or("tentative");
    let mut count = 0usize;
    let mut write_claim = |relation: &str,
                           from: &str,
                           to: &str,
                           status: &str|
     -> Result<(), String> {
        let id = format!("{family_id}-r{count}");
        count = count.saturating_add(1);
        let metadata = claim_metadata(&id, relation, status, from, to, private, &sources)?;
        write_note(
            stage,
            &format!("relationships/{id}.md"),
            &metadata,
            "Imported claim. Explicit source status is retained; unspecified status is tentative. Review the original GEDCOM before accepting.\n",
        )?;
        report.written = report.written.saturating_add(1);
        Ok(())
    };
    if let [first, second] = parents.as_slice() {
        write_claim(
            "partner",
            mapped(ids, &first.value, "INDI")?,
            mapped(ids, &second.value, "INDI")?,
            family_status,
        )?;
    }
    for child in record.iter().filter(|l| l.level == 1 && l.tag == "CHIL") {
        let _ = mapped(ids, &child.value, "INDI")?;
        let child_link = pedigrees.get(&(child.value.clone(), header.xref.clone()));
        let explicit = child_link.and_then(|link| link.relation.as_deref());
        let pedigree = child_link.and_then(|link| link.pedigree.as_deref());
        let relation = match (explicit, pedigree) {
            (Some("biological_parent"), Some("BIRTH")) => "biological_parent",
            (Some("adoptive_parent") | None, Some("ADOPTED")) => "adoptive_parent",
            (Some("foster_parent") | None, Some("FOSTER")) => "foster_parent",
            _ => {
                report.warnings.push(format!("{} child {}: absent, ambiguous, or unsupported pedigree {:?} / explicit relation {:?}; no parentage inferred. GEDCOM BIRTH describes a family at birth, not necessarily biological parentage.", header.xref, child.value, pedigree, explicit));
                continue;
            }
        };
        let status = child_link
            .and_then(|link| link.status.as_deref())
            .unwrap_or("tentative");
        for parent in &parents {
            write_claim(
                relation,
                mapped(ids, &parent.value, "INDI")?,
                mapped(ids, &child.value, "INDI")?,
                status,
            )?;
        }
    }
    for line in record.iter().skip(1).filter(|l| {
        l.level != 1
            || !matches!(
                l.tag.as_str(),
                "HUSB" | "WIFE" | "CHIL" | "SOUR" | "_KINDRED_STATUS"
            )
    }) {
        report.warnings.push(format!(
            "{}: {} {} retained only in original GEDCOM",
            header.xref, line.tag, line.value
        ));
    }
    Ok(())
}

fn family_sources(
    record: &[Line],
    ids: &BTreeMap<String, (String, String)>,
    report: &mut Report,
) -> Result<Vec<Value>, String> {
    let header = record.first().ok_or("missing family header")?;
    let mut sources = Vec::new();
    for line in record
        .iter()
        .filter(|line| line.level == 1 && line.tag == "SOUR")
    {
        if line.value.starts_with('@') && line.value.ends_with('@') && line.value != "@VOID@" {
            sources.push(Value::from(link(
                mapped(ids, &line.value, "SOUR")?,
                "sources",
            )));
        } else {
            preserve(report, header, line);
        }
    }
    Ok(sources)
}

fn claim_metadata(
    id: &str,
    relation: &str,
    status: &str,
    from: &str,
    to: &str,
    private: bool,
    sources: &[Value],
) -> Result<BTreeMap<String, Value>, String> {
    let mut metadata = base(id, "relationship", "Imported relationship");
    metadata.insert("relation".into(), Value::from(relation));
    if !["accepted", "tentative", "disputed", "rejected"].contains(&status) {
        return Err(format!("unsupported imported claim status: {status}"));
    }
    metadata.insert("status".into(), Value::from(status));
    if private {
        metadata.insert("private".into(), Value::Bool(true));
    }
    metadata.insert("sources".into(), Value::Array(sources.to_vec()));
    if relation == "partner" {
        metadata.insert(
            "partners".into(),
            serde_json::json!([link(from, "people"), link(to, "people")]),
        );
    } else {
        metadata.insert("parent".into(), Value::from(link(from, "people")));
        metadata.insert("child".into(), Value::from(link(to, "people")));
    }
    Ok(metadata)
}

fn ged_line(value: &str) -> String {
    let value = value.replace(['\r', '\n'], " ");
    if value.starts_with('@') {
        format!("@{value}")
    } else {
        value
    }
}

/// Export established relationships and date wording, reporting deliberate mapping losses.
/// # Errors
/// Rejects invalid archives, existing destinations, and filesystem failures.
pub fn export(root: &Path, destination: &Path, all: bool) -> Result<Report, String> {
    super::new_destination(root, destination)?;
    let archive = Archive::load(root)?;
    if !archive.diagnostics.is_empty() {
        return Err("fix archive diagnostics before exporting".into());
    }
    let people: BTreeSet<_> = if all {
        archive
            .records
            .iter()
            .filter(|r| r.kind == "person")
            .map(|r| r.id.clone())
            .collect()
    } else {
        public_people(&archive)
    };
    let pointers: BTreeMap<_, _> = people
        .iter()
        .enumerate()
        .map(|(i, id)| (id.clone(), format!("@I{i}@")))
        .collect();
    let mut report = Report::default();
    let families: Vec<_> = archive
        .edges()
        .into_iter()
        .filter(|e| people.contains(&e.from) && people.contains(&e.to))
        .filter(|e| {
            all || archive
                .record(&e.id)
                .is_none_or(|r| r.metadata.get("private") != Some(&Value::Bool(true)))
        })
        .filter(|edge| {
            if edge.status == "accepted" {
                true
            } else {
                report.warnings.push(format!(
                    "{}: {} claim omitted; complete archive export retains alternatives",
                    edge.id, edge.status
                ));
                false
            }
        })
        .enumerate()
        .collect();
    let mut output = String::from(
        "0 HEAD\n1 SOUR Kindred\n1 GEDC\n2 VERS 7.0\n1 SCHMA\n2 TAG _KINDRED_RELATION https://github.com/niklas-heer/kindred/blob/main/docs/SCHEMA.md#gedcom-explicit-relation\n2 TAG _KINDRED_STATUS https://github.com/niklas-heer/kindred/blob/main/docs/SCHEMA.md#gedcom-claim-status\n",
    );
    for record in archive.records.iter().filter(|r| people.contains(&r.id)) {
        let pointer = pointers.get(&record.id).ok_or("missing pointer")?;
        export_person(&mut output, record, pointer);
        for (index, edge) in &families {
            if edge.from == record.id || edge.relation == "partner" && edge.to == record.id {
                let _ = writeln!(output, "1 FAMS @F{index}@");
            } else if edge.to == record.id {
                let pedigree = match edge.relation.as_str() {
                    "adoptive_parent" => "ADOPTED",
                    "foster_parent" => "FOSTER",
                    _ => "BIRTH",
                };
                let _ = write!(
                    output,
                    "1 FAMC @F{index}@\n2 PEDI {pedigree}\n2 _KINDRED_RELATION {}\n2 _KINDRED_STATUS {}\n",
                    edge.relation, edge.status
                );
            }
        }
        report.written = report.written.saturating_add(1);
    }
    for (index, edge) in &families {
        let from = pointers.get(&edge.from).ok_or("missing parent pointer")?;
        let to = pointers.get(&edge.to).ok_or("missing child pointer")?;
        let _ = write!(
            output,
            "0 @F{index}@ FAM\n1 _KINDRED_STATUS accepted\n1 HUSB {from}\n1 {} {to}\n",
            if edge.relation == "partner" {
                "WIFE"
            } else {
                "CHIL"
            }
        );
        if archive
            .record(&edge.id)
            .is_some_and(|record| record.metadata.get("private") == Some(&Value::Bool(true)))
        {
            output.push_str("1 RESN PRIVACY\n");
        }
        report.written = report.written.saturating_add(1);
    }
    output.push_str("0 TRLR\n");
    report.warnings.push("GEDCOM 7 projection: names, date phrases, explicit death and accepted biological/adoptive/foster/partner links. Role tags HUSB/WIFE do not infer sex. Family claims are separate FAM records to retain per-parent pedigree type. Sources, prose, aliases, unknown metadata, events, attachments, and non-accepted claims require full archive export. Public scope includes only explicitly deceased, non-private people. IDs change on reimport. Declared _KINDRED_RELATION and _KINDRED_STATUS extensions retain exact biological meaning and claim status; consumers ignoring them lose that precision (PEDI BIRTH alone does not establish biology).".into());
    publish_export(destination, &output, &report)?;
    Ok(report)
}

fn export_person(output: &mut String, record: &Record, pointer: &str) {
    let _ = write!(
        output,
        "0 {pointer} INDI\n1 NAME {}\n",
        ged_line(&record.name)
    );
    if record.metadata.get("private") == Some(&Value::Bool(true)) {
        output.push_str("1 RESN PRIVACY\n");
    }
    for (key, tag) in [("birth", "BIRT"), ("death", "DEAT")] {
        if let Some(date) = record.metadata.get(key).and_then(Value::as_str) {
            let _ = write!(output, "1 {tag}\n2 DATE\n3 PHRASE {}\n", ged_line(date));
        }
    }
    if record.metadata.get("living") == Some(&Value::Bool(false))
        && !record.metadata.contains_key("death")
    {
        output.push_str("1 DEAT Y\n");
    }
}

fn publish_export(destination: &Path, output: &str, report: &Report) -> Result<(), String> {
    staged_directory(destination, |stage| {
        fs::write(stage.join("family.ged"), output).map_err(|e| e.to_string())?;
        fs::write(
            stage.join("EXPORT-REPORT.json"),
            serde_json::to_vec_pretty(report).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
    })
}
