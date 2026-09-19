//! Explicit person metadata projected into disposable graph records.
use super::{Archive, Edge, Record};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn expand(archive: &mut Archive) {
    let mut people: Vec<_> = archive
        .records
        .iter()
        .filter(|record| record.kind == "person" && record.owner.is_none())
        .cloned()
        .collect();
    people.sort_by(|a, b| a.id.cmp(&b.id));
    let mut definitions = BTreeMap::new();
    for owner in &people {
        for citation in citation_values(owner) {
            if let Some(map) = citation.as_object()
                && map.len() > 1
                && let Some(id) = map.get("id").and_then(Value::as_str)
            {
                definitions
                    .entry(id.to_owned())
                    .or_insert_with(|| (owner.id.clone(), citation.clone()));
            }
        }
    }
    let mut builder = Builder {
        archive,
        records: BTreeMap::new(),
        citation_urls: BTreeMap::new(),
        definitions,
    };
    for person in people {
        if let Err(message) = builder.person(&person) {
            builder
                .archive
                .diagnostic("invalid_person_metadata", &person.path, message);
        }
    }
    builder
        .archive
        .records
        .extend(builder.records.into_values());
}

struct Builder<'a> {
    archive: &'a mut Archive,
    records: BTreeMap<String, Record>,
    citation_urls: BTreeMap<(String, String), String>,
    definitions: BTreeMap<String, (String, Value)>,
}

impl Builder<'_> {
    fn person(&mut self, owner: &Record) -> Result<(), String> {
        for key in ["sources", "portrait_source"] {
            if let Some(value) = owner.metadata.get(key) {
                if key == "sources" {
                    self.citations(owner, Some(value))?;
                } else {
                    self.citation(owner, value)?;
                }
            }
        }
        for (key, role) in [("mother", "mother"), ("father", "father")] {
            if let Some(value) = owner.metadata.get(key) {
                self.claim(owner, value, false, role)?;
            }
        }
        if let Some(value) = owner.metadata.get("parents") {
            for parent in array(value, "parents")? {
                self.claim(owner, parent, false, "parent")?;
            }
        }
        if let Some(value) = owner.metadata.get("partners") {
            for partner in array(value, "partners")? {
                self.claim(owner, partner, true, "parent")?;
            }
        }
        for (kind, date_keys, place_key) in [
            ("birth", ["born", "birth"], "birth_place"),
            ("death", ["died", "death"], "death_place"),
        ] {
            let date = owner
                .metadata
                .get(date_keys.first().copied().unwrap_or_default())
                .or_else(|| {
                    owner
                        .metadata
                        .get(date_keys.last().copied().unwrap_or_default())
                });
            if let (Some(first), Some(second)) = (
                owner
                    .metadata
                    .get(date_keys.first().copied().unwrap_or_default()),
                owner
                    .metadata
                    .get(date_keys.last().copied().unwrap_or_default()),
            ) && first != second
            {
                return Err(format!(
                    "conflicting {kind} date aliases; use one date field and preserve alternatives in events or prose"
                ));
            }
            let place = owner.metadata.get(place_key);
            if date.is_some() || place.is_some() {
                let mut metadata = Map::new();
                metadata.insert(
                    "id".into(),
                    Value::from(format!("derived:{}:{kind}", owner.id)),
                );
                metadata.insert("type".into(), Value::from(kind));
                metadata.insert(
                    "name".into(),
                    Value::from(format!(
                        "{} of {}",
                        if kind == "birth" { "Birth" } else { "Death" },
                        owner.name
                    )),
                );
                if let Some(date) = date {
                    metadata.insert("date".into(), date.clone());
                }
                if let Some(place) = place {
                    metadata.insert("place".into(), place.clone());
                }
                self.event(owner, &Value::Object(metadata))?;
            }
        }
        if let Some(value) = owner.metadata.get("events") {
            for event in array(value, "events")? {
                self.event(owner, event)?;
            }
        }
        Ok(())
    }

    fn claim(
        &mut self,
        owner: &Record,
        value: &Value,
        partner: bool,
        default_role: &str,
    ) -> Result<(), String> {
        let mut metadata = match value {
            Value::String(link) => BTreeMap::from([("person".into(), Value::from(link.clone()))]),
            Value::Object(map) => map
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
            _ => return Err("parent/partner declarations must be wiki links or objects".into()),
        };
        let person = text(&metadata, "person")?
            .ok_or("parent/partner declaration requires person wiki link")?;
        let target = self.archive.resolve_link(person)?;
        if target.kind != "person" || target.id == owner.id {
            return Err("parent/partner must reference a different person".into());
        }
        let target_id = target.id.clone();
        let relation = text(&metadata, "relation")?
            .unwrap_or(if partner {
                "partner"
            } else {
                "biological_parent"
            })
            .to_owned();
        if partner && relation != "partner"
            || !partner
                && !["biological_parent", "adoptive_parent", "foster_parent"]
                    .contains(&relation.as_str())
        {
            return Err(format!("invalid inline relationship type: {relation}"));
        }
        let role = text(&metadata, "role")?
            .or(text(&metadata, "parent_role")?)
            .unwrap_or(default_role)
            .to_owned();
        if let (Some(role), Some(parent_role)) =
            (text(&metadata, "role")?, text(&metadata, "parent_role")?)
            && role != parent_role
        {
            return Err("inline role and parent_role disagree".into());
        }
        if !partner && default_role != "parent" && role != default_role {
            return Err(format!(
                "{default_role} declaration cannot override its role as {role}"
            ));
        }
        if !partner && !["mother", "father", "parent"].contains(&role.as_str()) {
            return Err(format!("invalid inline parent role: {role}"));
        }
        if partner && (metadata.contains_key("role") || metadata.contains_key("parent_role")) {
            return Err("partner claims cannot have a parent role".into());
        }
        let status = text(&metadata, "status")?.unwrap_or("accepted").to_owned();
        if !["accepted", "tentative", "disputed", "rejected"].contains(&status.as_str()) {
            return Err(format!("invalid inline claim status: {status}"));
        }
        let sources = self.citations(owner, metadata.get("sources"))?;
        let identity = format!("{relation}\0{target_id}\0{}\0{role}", owner.id);
        let id = identifier(&metadata, owner, "claim", &identity)?;
        metadata.insert("relation".into(), Value::from(relation));
        metadata.insert("status".into(), Value::from(status));
        metadata.insert("sources".into(), serde_json::json!(sources));
        if partner {
            metadata.insert("partners".into(), serde_json::json!([owner.id, target_id]));
        } else {
            metadata.insert("parent".into(), Value::from(target_id));
            metadata.insert("child".into(), Value::from(owner.id.clone()));
            metadata.insert("parent_role".into(), Value::from(role));
        }
        if owner.metadata.get("private") == Some(&Value::Bool(true)) {
            metadata.insert("private".into(), Value::Bool(true));
        }
        if metadata
            .get("private")
            .is_some_and(|value| !value.is_boolean())
        {
            return Err("claim private must be a boolean".into());
        }
        let body = text(&metadata, "note")?.unwrap_or_default().to_owned();
        self.insert(derived(owner, id, "relationship", metadata, body))
    }

    fn citations(&mut self, owner: &Record, value: Option<&Value>) -> Result<Vec<String>, String> {
        value.map_or_else(
            || Ok(Vec::new()),
            |value| {
                array(value, "sources")?
                    .iter()
                    .map(|citation| self.citation(owner, citation))
                    .collect()
            },
        )
    }

    fn citation(&mut self, owner: &Record, value: &Value) -> Result<String, String> {
        if let Some(link) = value.as_str().filter(|link| link.starts_with("[[")) {
            let source = self.archive.resolve_link(link)?;
            if source.kind != "source" {
                return Err("citation wiki link must target a source note".into());
            }
            return Ok(source.id.clone());
        }
        if let Some(url) = value.as_str()
            && let Some(id) = self.citation_urls.get(&(owner.id.clone(), url.into()))
        {
            return Ok(id.clone());
        }
        let mut metadata: BTreeMap<String, Value> = match value {
            Value::String(url) if url.starts_with("https://") || url.starts_with("http://") => {
                BTreeMap::from([("url".into(), Value::from(url.clone()))])
            }
            Value::Object(map) => map
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
            _ => {
                return Err(
                    "citation must be a URL, source wiki link, or inline citation object".into(),
                );
            }
        };
        if metadata.len() == 1
            && let Some(id) = text(&metadata, "id")?
        {
            let id = id.to_owned();
            if !self.records.contains_key(&id) {
                let (definition_owner, value) =
                    self.definitions.get(&id).cloned().ok_or_else(|| {
                        format!("undefined citation ID: {id}; provide its full inline definition")
                    })?;
                let definition_owner = self
                    .archive
                    .record(&definition_owner)
                    .ok_or("missing citation owner")?
                    .clone();
                self.citation(&definition_owner, &value)?;
            }
            let existing = self.records.get(&id).ok_or("missing citation definition")?;
            if existing.kind != "source" {
                return Err(format!("citation id targets a non-source record: {id}"));
            }
            if let Some(url) = existing.text("url") {
                self.citation_urls
                    .entry((owner.id.clone(), url.into()))
                    .or_insert_with(|| id.clone());
            }
            return Ok(id);
        }
        if metadata.is_empty() {
            return Err(
                "inline citation must include an id, title, URL, or other evidence metadata".into(),
            );
        }
        if let Some(url) = text(&metadata, "url")?
            && !url.starts_with("https://")
            && !url.starts_with("http://")
        {
            return Err("citation URL must use http or https".into());
        }
        validate_source_attachments(self.archive, &metadata)?;
        let url = text(&metadata, "url")?.map(str::to_owned);
        let identity = url.clone().map_or_else(
            || serde_json::to_string(&metadata).map_err(|error| error.to_string()),
            Ok,
        )?;
        let id = identifier(&metadata, owner, "source", &identity)?;
        if !metadata.contains_key("name") {
            let name = text(&metadata, "title")?
                .or(text(&metadata, "url")?)
                .unwrap_or(&id)
                .to_owned();
            metadata.insert("name".into(), Value::from(name));
        }
        let body = text(&metadata, "note")?.unwrap_or_default().to_owned();
        self.insert(derived(owner, id.clone(), "source", metadata, body))?;
        if let Some(url) = url {
            self.citation_urls
                .entry((owner.id.clone(), url))
                .or_insert_with(|| id.clone());
        }
        Ok(id)
    }

    fn place(&mut self, owner: &Record, value: &Value) -> Result<String, String> {
        if let Some(link) = value.as_str().filter(|link| link.starts_with("[[")) {
            let place = self.archive.resolve_link(link)?;
            if place.kind != "place" {
                return Err("place link must target a place note".into());
            }
            return Ok(place.id.clone());
        }
        let metadata = match value {
            Value::String(name) if !name.trim().is_empty() => {
                BTreeMap::from([("name".into(), Value::from(name.clone()))])
            }
            Value::Object(map) => map
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
            _ => return Err("place must be a name, place wiki link, or object".into()),
        };
        let name = text(&metadata, "name")?.ok_or("place object requires name")?;
        let id = identifier(&metadata, owner, "place", name)?;
        self.insert(derived(owner, id.clone(), "place", metadata, String::new()))?;
        Ok(id)
    }

    fn event(&mut self, owner: &Record, value: &Value) -> Result<(), String> {
        let Value::Object(map) = value else {
            return Err("events must be a list of event objects".into());
        };
        let mut metadata: BTreeMap<_, _> = map
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        let event_type = text(&metadata, "type")?.unwrap_or("event").to_owned();
        if let Some(date) = metadata.get("date")
            && !date.is_string()
            && !date.is_number()
        {
            return Err("event date must be original date text or a year".into());
        }
        let identity = serde_json::to_string(&metadata).map_err(|error| error.to_string())?;
        let id = identifier(&metadata, owner, "event", &identity)?;
        let sources = self.citations(owner, metadata.get("sources"))?;
        if let Some(value) = metadata.get("place") {
            let place = self.place(owner, value)?;
            metadata.insert("place".into(), Value::from(place));
        }
        metadata.insert("sources".into(), serde_json::json!(sources));
        let mut people = BTreeSet::from([owner.id.clone()]);
        if let Some(value) = metadata.get("people") {
            for value in array(value, "event people")? {
                let link = value.as_str().ok_or("event people must be wiki links")?;
                let person = self.archive.resolve_link(link)?;
                if person.kind != "person" {
                    return Err("event people must target person notes".into());
                }
                people.insert(person.id.clone());
            }
        }
        metadata.insert("people".into(), serde_json::json!(people));
        metadata.insert("event_type".into(), Value::from(event_type));
        let body = text(&metadata, "note")?.unwrap_or_default().to_owned();
        self.insert(derived(owner, id, "event", metadata, body))
    }

    fn insert(&mut self, record: Record) -> Result<(), String> {
        for key in ["living", "private"] {
            if record
                .metadata
                .get(key)
                .is_some_and(|value| !value.is_boolean())
            {
                return Err(format!("inline {key} must be a boolean"));
            }
        }

        if self
            .archive
            .records
            .iter()
            .any(|existing| existing.id == record.id)
        {
            return Err(format!(
                "derived ID conflicts with a physical record: {}",
                record.id
            ));
        }
        if let Some(existing) = self.records.get(&record.id) {
            if existing.kind == record.kind
                && existing.metadata == record.metadata
                && existing.body == record.body
            {
                return Ok(());
            }
            return Err(format!(
                "conflicting derived record ID {}; give distinct claims/citations explicit IDs or make repeated citations consistent",
                record.id
            ));
        }
        self.records.insert(record.id.clone(), record);
        Ok(())
    }
}

fn citation_values(owner: &Record) -> Vec<&Value> {
    let mut values = Vec::new();
    if let Some(sources) = owner.metadata.get("sources").and_then(Value::as_array) {
        values.extend(sources);
    }
    if let Some(source) = owner.metadata.get("portrait_source") {
        values.push(source);
    }
    for field in ["mother", "father", "parents", "partners", "events"] {
        if let Some(value) = owner.metadata.get(field) {
            let declarations: Vec<_> = value
                .as_array()
                .map_or_else(|| vec![value], |values| values.iter().collect());
            for declaration in declarations {
                if let Some(sources) = declaration.get("sources").and_then(Value::as_array) {
                    values.extend(sources);
                }
            }
        }
    }
    values
}

fn validate_source_attachments(
    archive: &Archive,
    metadata: &BTreeMap<String, Value>,
) -> Result<(), String> {
    for key in ["name", "title", "note"] {
        text(metadata, key)?;
    }
    if let Some(value) = metadata.get("attachments") {
        for value in array(value, "citation attachments")? {
            let path = value
                .as_str()
                .ok_or("citation attachments must be local file paths")?;
            archive.attachment(path)?;
        }
    }
    if let Some(file) = text(metadata, "file")? {
        archive.attachment(file)?;
    }
    if metadata
        .get("private")
        .is_some_and(|value| !value.is_boolean())
    {
        return Err("citation private must be a boolean".into());
    }
    Ok(())
}

fn derived(
    owner: &Record,
    id: String,
    kind: &str,
    mut metadata: BTreeMap<String, Value>,
    body: String,
) -> Record {
    let name = metadata
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or(&id)
        .to_owned();
    metadata.insert("version".into(), Value::from(1));
    metadata.insert("id".into(), Value::from(id.clone()));
    metadata.insert("type".into(), Value::from(kind));
    Record {
        id,
        kind: kind.into(),
        name,
        path: String::new(),
        metadata,
        body,
        raw: String::new(),
        owner: Some(owner.id.clone()),
    }
}

fn array<'a>(value: &'a Value, field: &str) -> Result<&'a Vec<Value>, String> {
    value
        .as_array()
        .ok_or_else(|| format!("{field} must be a list"))
}
fn text<'a>(metadata: &'a BTreeMap<String, Value>, key: &str) -> Result<Option<&'a str>, String> {
    metadata
        .get(key)
        .map(|value| {
            value
                .as_str()
                .ok_or_else(|| format!("{key} must be a string"))
        })
        .transpose()
}
fn identifier(
    metadata: &BTreeMap<String, Value>,
    owner: &Record,
    kind: &str,
    identity: &str,
) -> Result<String, String> {
    if let Some(id) = text(metadata, "id")? {
        if id.trim().is_empty() {
            return Err("explicit derived id cannot be empty".into());
        }
        return Ok(id.into());
    }
    // Fixed FNV-1a, unlike process/library-dependent hashing; no list offsets or filenames.
    let hash = identity
        .bytes()
        .fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
            (hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3)
        });
    Ok(format!("derived:{}:{kind}:{hash:016x}", owner.id))
}

pub(super) fn edge(archive: &Archive, record: &Record) -> Result<Edge, String> {
    let relation = record
        .text("relation")
        .ok_or("derived claim missing relation")?;
    let status = record
        .text("status")
        .ok_or("derived claim missing status")?;
    let (from, to) = if relation == "partner" {
        let partners = record.links("partners");
        match partners.as_slice() {
            [from, to] => (*from, *to),
            _ => return Err("derived partner claim needs two endpoints".into()),
        }
    } else {
        (
            record
                .text("parent")
                .ok_or("derived claim missing parent")?,
            record.text("child").ok_or("derived claim missing child")?,
        )
    };
    for id in [from, to] {
        if archive
            .record(id)
            .is_none_or(|record| record.kind != "person")
        {
            return Err(format!("unknown derived endpoint: {id}"));
        }
    }
    let sources = record
        .links("sources")
        .into_iter()
        .map(str::to_owned)
        .collect();
    Ok(Edge {
        id: record.id.clone(),
        from: from.into(),
        to: to.into(),
        relation: relation.into(),
        status: status.into(),
        sources,
    })
}
