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

struct ImportedRecords {
    people: BTreeMap<String, BTreeMap<String, Value>>,
    pedigrees: BTreeMap<(String, String), ChildLink>,
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

fn import_records(
    records: &[&[Line]],
    ids: &BTreeMap<String, (String, String)>,
    report: &mut Report,
) -> Result<ImportedRecords, String> {
    let mut citations = BTreeMap::new();
    for record in records {
        if record.first().is_some_and(|line| line.tag == "SOUR") {
            let (pointer, citation) = import_source(record, ids, report)?;
            citations.insert(pointer, citation);
        }
    }
    let mut pedigrees = BTreeMap::new();
    let mut people = BTreeMap::new();
    for record in records {
        if record.first().is_some_and(|line| line.tag == "INDI") {
            let (pointer, person) = import_person(record, ids, &mut pedigrees, report)?;
            people.insert(pointer, person);
        }
    }
    let mut used_sources = BTreeSet::new();
    for record in records {
        if record.first().is_some_and(|line| line.tag == "FAM") {
            import_family(
                record,
                ids,
                &pedigrees,
                &citations,
                &mut used_sources,
                &mut people,
                report,
            )?;
        }
    }
    for (pointer, citation) in &citations {
        if !used_sources.contains(pointer) {
            let title = citation
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("untitled source");
            report.warnings.push(format!(
                "{pointer} SOUR {title}: unreferenced source retained only in original GEDCOM"
            ));
        }
    }
    Ok(ImportedRecords { people, pedigrees })
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
        let ImportedRecords { people, pedigrees } = import_records(&records, &ids, &mut report)?;
        for metadata in people.into_values() {
            let id = metadata
                .get("id")
                .and_then(Value::as_str)
                .ok_or("imported person is missing an ID")?;
            write_note(
                stage,
                &format!("people/{id}.md"),
                &metadata,
                "Imported from attachments/original.ged. Review the original for unmapped details.\n",
            )?;
            report.written = report.written.saturating_add(1);
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
        report.warnings.push("Only UTF-8 primary names, first birth/death date text, sex, privacy restrictions, source titles/URLs/notes, explicit pedigree types/status and family-level citations are mapped. Missing claim status becomes tentative; absent or ambiguous pedigree never becomes biological parentage. Additional names, dates and unsupported structures remain in the original. Original GEDCOM is retained at attachments/original.ged and cited by imported claims; no external media is downloaded. Review all imported claims and privacy before sharing.".into());
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

fn import_source(
    record: &[Line],
    ids: &BTreeMap<String, (String, String)>,
    report: &mut Report,
) -> Result<(String, Value), String> {
    let header = record.first().ok_or("missing source header")?;
    let id = mapped(ids, &header.xref, "SOUR")?;
    let mut title = None;
    let mut url = None;
    let mut note = None;
    for line in record.iter().skip(1) {
        let slot = match (line.level, line.tag.as_str()) {
            (1, "TITL") => &mut title,
            (1, "WWW") => &mut url,
            (1, "NOTE" | "TEXT") => &mut note,
            _ => {
                preserve(report, header, line);
                continue;
            }
        };
        if slot.is_some() {
            preserve(report, header, line);
        } else {
            *slot = Some(line.value.clone());
        }
    }
    let mut citation = serde_json::Map::new();
    citation.insert("id".into(), Value::from(id));
    citation.insert(
        "title".into(),
        Value::from(title.unwrap_or_else(|| id.to_owned())),
    );
    if let Some(url) = url {
        citation.insert("url".into(), Value::from(url));
    }
    citation.insert(
        "note".into(),
        Value::from(note.unwrap_or_else(|| "Imported from the original GEDCOM.".into())),
    );
    citation.insert(
        "attachments".into(),
        serde_json::json!(["attachments/original.ged"]),
    );
    Ok((header.xref.clone(), Value::Object(citation)))
}

fn import_person(
    record: &[Line],
    ids: &BTreeMap<String, (String, String)>,
    pedigrees: &mut BTreeMap<(String, String), ChildLink>,
    report: &mut Report,
) -> Result<(String, BTreeMap<String, Value>), String> {
    let header = record.first().ok_or("missing person header")?;
    let id = mapped(ids, &header.xref, "INDI")?;
    let name = record
        .iter()
        .find(|line| line.level == 1 && line.tag == "NAME")
        .map_or_else(
            || id.to_owned(),
            |line| line.value.replace('/', "").trim().to_owned(),
        );
    let mut metadata = base(id, "person", &name);
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
            (1, "NAME", _) if !seen_name => {
                seen_name = true;
            }
            (1, "RESN", _) => {
                metadata.insert("private".into(), Value::Bool(true));
                report.warnings.push(format!(
                    "{}: RESN mapped conservatively to private: true",
                    header.xref
                ));
            }
            (1, "SEX", _) if !metadata.contains_key("sex") => {
                metadata.insert("sex".into(), Value::from(line.value.clone()));
            }
            (1, "DEAT", _) if selected_event && matches!(line.value.as_str(), "" | "Y") => {
                metadata.insert("living".into(), Value::Bool(false));
            }
            (1, "BIRT", _) if selected_event && line.value.is_empty() => {}
            (2, "DATE", "BIRT" | "DEAT") | (3, "PHRASE", "BIRT" | "DEAT")
                if selected_event && (line.tag == "DATE" || subcontext == "DATE") =>
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
            (1, "FAMC", _) => {
                family = &line.value;
                let _ = mapped(ids, family, "FAM")?;
                pedigrees
                    .entry((header.xref.clone(), family.into()))
                    .or_default();
            }
            (1, "FAMS", _) => {
                let _ = mapped(ids, &line.value, "FAM")?;
            }
            (2, "PEDI" | "STAT" | "_KINDRED_RELATION" | "_KINDRED_STATUS", "FAMC") => {
                let child_link = pedigrees
                    .entry((header.xref.clone(), family.into()))
                    .or_default();
                import_child_link(child_link, header, line, family, report)?;
            }
            _ => preserve(report, header, line),
        }
    }
    Ok((header.xref.clone(), metadata))
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
    record: &[Line],
    ids: &BTreeMap<String, (String, String)>,
    pedigrees: &BTreeMap<(String, String), ChildLink>,
    citations: &BTreeMap<String, Value>,
    used_sources: &mut BTreeSet<String>,
    people: &mut BTreeMap<String, BTreeMap<String, Value>>,
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
    let mut family_source_pointers = BTreeSet::new();
    let sources = family_sources(
        record,
        family_id,
        ids,
        citations,
        &mut family_source_pointers,
        report,
    )?;
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
    validate_status(family_status)?;
    let mut count = 0usize;
    if let [first, second] = parents.as_slice() {
        let id = format!("{family_id}-r{count}");
        count = count.saturating_add(1);
        let claim = partner_claim(
            &id,
            mapped(ids, &second.value, "INDI")?,
            family_status,
            private,
            &sources,
        )?;
        append_claim(people, &first.value, "partners", claim)?;
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
        validate_status(status)?;
        for parent in &parents {
            let id = format!("{family_id}-r{count}");
            count = count.saturating_add(1);
            let claim = parent_claim(
                &id,
                relation,
                mapped(ids, &parent.value, "INDI")?,
                status,
                private,
                &sources,
            )?;
            append_claim(people, &child.value, "parents", claim)?;
        }
    }
    if count == 0 && !sources.is_empty() {
        report.warnings.push(format!(
            "{}: family citations retained only in original because no supported claim was imported",
            header.xref
        ));
    } else {
        used_sources.extend(family_source_pointers);
    }
    warn_unmapped_family(record, header, report);
    Ok(())
}

fn warn_unmapped_family(record: &[Line], header: &Line, report: &mut Report) {
    let mut context = "";
    for line in record.iter().skip(1) {
        if line.level == 1 {
            context = &line.tag;
        }
        let mapped = line.level == 1
            && matches!(
                line.tag.as_str(),
                "HUSB" | "WIFE" | "CHIL" | "SOUR" | "RESN" | "_KINDRED_STATUS"
            )
            || line.level == 2
                && context == "SOUR"
                && matches!(line.tag.as_str(), "TEXT" | "NOTE" | "WWW");
        if !mapped {
            preserve(report, header, line);
        }
    }
}

fn family_sources(
    record: &[Line],
    family_id: &str,
    ids: &BTreeMap<String, (String, String)>,
    citations: &BTreeMap<String, Value>,
    used_sources: &mut BTreeSet<String>,
    report: &mut Report,
) -> Result<Vec<Value>, String> {
    let header = record.first().ok_or("missing family header")?;
    let mut sources = Vec::new();
    for (index, line) in record.iter().enumerate() {
        if line.level != 1 || line.tag != "SOUR" {
            continue;
        }
        let details: Vec<_> = record
            .iter()
            .skip(index.saturating_add(1))
            .take_while(|detail| detail.level > 1)
            .collect();
        let citation_id = format!("{family_id}-s{}", sources.len());
        if line.value.starts_with('@') && line.value.ends_with('@') && line.value != "@VOID@" {
            let _ = mapped(ids, &line.value, "SOUR")?;
            used_sources.insert(line.value.clone());
            let mut citation = citations
                .get(&line.value)
                .cloned()
                .ok_or_else(|| format!("missing imported source {}", line.value))?;
            if !details.is_empty() {
                let original_id = citation
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or("imported citation is missing an ID")?
                    .to_owned();
                let object = citation
                    .as_object_mut()
                    .ok_or("imported citation must be an object")?;
                object.insert("id".into(), Value::from(citation_id.clone()));
                object.insert("source_id".into(), Value::from(original_id));
                apply_citation_details(object, &details, header, report);
            }
            sources.push(citation);
        } else if !line.value.is_empty() && line.value != "@VOID@" {
            let mut citation = serde_json::Map::new();
            citation.insert("id".into(), Value::from(citation_id));
            citation.insert("title".into(), Value::from(line.value.clone()));
            citation.insert(
                "note".into(),
                Value::from("Imported from the original GEDCOM."),
            );
            citation.insert(
                "attachments".into(),
                serde_json::json!(["attachments/original.ged"]),
            );
            apply_citation_details(&mut citation, &details, header, report);
            sources.push(Value::Object(citation));
        } else {
            preserve(report, header, line);
        }
    }
    Ok(sources)
}

fn apply_citation_details(
    citation: &mut serde_json::Map<String, Value>,
    details: &[&Line],
    header: &Line,
    report: &mut Report,
) {
    for line in details {
        let key = match (line.level, line.tag.as_str()) {
            (2, "TEXT" | "NOTE") => "note",
            (2, "WWW") => "url",
            _ => {
                preserve(report, header, line);
                continue;
            }
        };
        if key == "note" {
            let note = match citation.get(key).and_then(Value::as_str) {
                None | Some("Imported from the original GEDCOM.") => line.value.clone(),
                Some(existing) => format!("{existing}\n{}", line.value),
            };
            citation.insert(key.into(), Value::from(note));
        } else if citation.contains_key(key) {
            preserve(report, header, line);
        } else {
            citation.insert(key.into(), Value::from(line.value.clone()));
        }
    }
}

fn validate_status(status: &str) -> Result<(), String> {
    if ["accepted", "tentative", "disputed", "rejected"].contains(&status) {
        Ok(())
    } else {
        Err(format!("unsupported imported claim status: {status}"))
    }
}

fn append_claim(
    people: &mut BTreeMap<String, BTreeMap<String, Value>>,
    owner: &str,
    key: &str,
    claim: Value,
) -> Result<(), String> {
    let metadata = people
        .get_mut(owner)
        .ok_or_else(|| format!("missing imported person {owner}"))?;
    let claims = metadata
        .entry(key.into())
        .or_insert_with(|| Value::Array(Vec::new()))
        .as_array_mut()
        .ok_or_else(|| format!("{key} must be a list"))?;
    claims.push(claim);
    Ok(())
}

fn parent_claim(
    id: &str,
    relation: &str,
    person: &str,
    status: &str,
    private: bool,
    sources: &[Value],
) -> Result<Value, String> {
    validate_status(status)?;
    let mut claim = serde_json::Map::from_iter([
        ("id".into(), Value::from(id)),
        ("person".into(), Value::from(link(person, "people"))),
        ("relation".into(), Value::from(relation)),
        ("role".into(), Value::from("parent")),
        ("status".into(), Value::from(status)),
        ("sources".into(), Value::Array(sources.to_vec())),
        (
            "note".into(),
            Value::from(
                "Imported GEDCOM parent claim. The neutral role does not infer a mother or father from HUSB/WIFE.",
            ),
        ),
    ]);
    if private {
        claim.insert("private".into(), Value::Bool(true));
    }
    Ok(Value::Object(claim))
}

fn partner_claim(
    id: &str,
    person: &str,
    status: &str,
    private: bool,
    sources: &[Value],
) -> Result<Value, String> {
    validate_status(status)?;
    let mut claim = serde_json::Map::from_iter([
        ("id".into(), Value::from(id)),
        ("person".into(), Value::from(link(person, "people"))),
        ("status".into(), Value::from(status)),
        ("sources".into(), Value::Array(sources.to_vec())),
        (
            "note".into(),
            Value::from(
                "Imported GEDCOM partnership claim. Review the original GEDCOM before accepting.",
            ),
        ),
    ]);
    if private {
        claim.insert("private".into(), Value::Bool(true));
    }
    Ok(Value::Object(claim))
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
    report.warnings.push("GEDCOM 7 projection: names, date phrases, explicit death and accepted biological/adoptive/foster/partner links. Role tags HUSB/WIFE do not infer sex. Family claims are separate FAM records to retain per-parent pedigree type. Parent roles, occupations, sources, prose, aliases, unknown metadata, events, attachments, and non-accepted claims require full archive export. Public scope includes only explicitly deceased, non-private people. IDs change on reimport. Declared _KINDRED_RELATION and _KINDRED_STATUS extensions retain exact biological meaning and claim status; consumers ignoring them lose that precision (PEDI BIRTH alone does not establish biology).".into());
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
