//! Reading and validating the versioned Markdown archive.
mod person;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Write as _;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

/// A note with its original content and interpreted metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Record {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub name: String,
    pub path: String,
    pub metadata: BTreeMap<String, Value>,
    pub body: String,
    pub raw: String,
    /// The physical person note owning this derived record; absent for real notes.
    #[serde(default)]
    pub owner: Option<String>,
}

impl Record {
    /// A string property, without coercing uncertain dates or other values.
    #[must_use]
    pub fn text(&self, key: &str) -> Option<&str> {
        self.metadata.get(key).and_then(Value::as_str)
    }

    /// String members of a list property.
    #[must_use]
    pub fn links(&self, key: &str) -> Vec<&str> {
        self.metadata
            .get(key)
            .and_then(Value::as_array)
            .map_or_else(Vec::new, |items| {
                items.iter().filter_map(Value::as_str).collect()
            })
    }
}

/// An error which prevents a note from being trusted as a genealogy claim.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diagnostic {
    pub code: String,
    pub path: String,
    pub message: String,
}

/// A person-to-person edge, retaining its claim and evidence identifiers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Edge {
    pub id: String,
    pub from: String,
    pub to: String,
    pub relation: String,
    pub status: String,
    pub sources: Vec<String>,
}

/// A fresh view of authoritative files. Cache files are never required to load.
#[derive(Debug, Clone, Serialize)]
pub struct Archive {
    #[serde(skip)]
    pub root: PathBuf,
    pub records: Vec<Record>,
    pub diagnostics: Vec<Diagnostic>,
}

impl Archive {
    /// Read all non-hidden Markdown notes and validate typed records.
    /// # Errors
    /// Returns an error if the directory cannot be read. Malformed notes appear
    /// in `diagnostics` so one broken note cannot hide other problems.
    pub fn load(root: &Path) -> Result<Self, String> {
        if !root.is_dir() {
            return Err(format!(
                "archive directory does not exist: {}",
                root.display()
            ));
        }
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        let mut paths = Vec::new();
        collect_notes(&root, &mut paths)?;
        paths.sort();
        let mut archive = Self {
            root,
            records: Vec::new(),
            diagnostics: Vec::new(),
        };
        for path in paths {
            let relative = path
                .strip_prefix(&archive.root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            match fs::read_to_string(&path) {
                Ok(raw) => match frontmatter(&raw) {
                    Ok(Some((yaml, _))) => {
                        // Untyped Obsidian notes are useful in the same vault.
                        match serde_yaml_ng::from_str::<BTreeMap<String, Value>>(yaml) {
                            Ok(metadata) if !metadata.contains_key("type") => {}
                            _ => match validate_text(&relative, &raw) {
                                Ok(record) => archive.records.push(record),
                                Err(message) => {
                                    archive.diagnostic("invalid_record", &relative, message);
                                }
                            },
                        }
                    }
                    Ok(None) => {}
                    Err(message) => archive.diagnostic("invalid_frontmatter", &relative, message),
                },
                Err(error) => archive.diagnostic("read_error", &relative, error.to_string()),
            }
        }
        person::expand(&mut archive);
        archive.validate();
        Ok(archive)
    }

    /// Check a prospective replacement against all current records and links.
    /// Parse errors in other notes are retained, while derived diagnostics are
    /// recomputed so a valid edit can repair a previously broken link.
    /// # Errors
    /// Reports unknown note paths or any resulting archive validation error.
    pub fn validate_replacement(&self, replacement: Record) -> Result<(), String> {
        let mut draft = self.clone();
        draft.records.retain(|record| record.owner.is_none());
        let record = draft
            .records
            .iter_mut()
            .find(|record| record.path == replacement.path)
            .ok_or_else(|| format!("unknown archive note: {}", replacement.path))?;
        *record = replacement;
        draft.diagnostics.retain(|diagnostic| {
            matches!(
                diagnostic.code.as_str(),
                "invalid_record" | "invalid_frontmatter" | "read_error"
            )
        });
        person::expand(&mut draft);
        draft.validate();
        if draft.diagnostics.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "replacement would leave archive validation errors: {}",
                serde_json::to_string(&draft.diagnostics).map_err(|error| error.to_string())?
            ))
        }
    }

    /// Find a unique stable ID; duplicate IDs are never silently resolved.
    #[must_use]
    pub fn record(&self, id: &str) -> Option<&Record> {
        let mut records = self.records.iter().filter(|record| record.id == id);
        let first = records.next()?;
        if records.next().is_some() {
            None
        } else {
            Some(first)
        }
    }

    /// Resolve a wiki link by archive-relative path, or by unique basename.
    /// Stable IDs are deliberately not filename aliases.
    /// # Errors
    /// Rejects malformed, missing, unsafe, and ambiguous targets.
    pub fn resolve_link(&self, link: &str) -> Result<&Record, String> {
        let target = link_target(link)?;
        let mut matches = self
            .records
            .iter()
            .filter(|record| record.owner.is_none())
            .filter(|record| {
                let stem = record.path.strip_suffix(".md").unwrap_or(&record.path);
                stem == target || (!target.contains('/') && stem.rsplit('/').next() == Some(target))
            });
        let found = matches
            .next()
            .ok_or_else(|| format!("missing link target: {link}"))?;
        if matches.next().is_some() {
            return Err(format!("ambiguous link target: {link}"));
        }
        Ok(found)
    }

    /// Materialize validated relationship claims. Query entry points refuse
    /// archives with diagnostics before using these edges.
    #[must_use]
    pub fn edges(&self) -> Vec<Edge> {
        self.records
            .iter()
            .filter(|record| record.kind == "relationship")
            .filter_map(|record| self.edge(record).ok())
            .collect()
    }

    /// Rebuild a disposable JSON snapshot without changing archive notes.
    /// # Errors
    /// Rejects invalid archives and reports filesystem failures.
    pub fn reindex(&self) -> Result<PathBuf, String> {
        if !self.diagnostics.is_empty() {
            return Err("fix archive diagnostics before rebuilding the index".into());
        }
        let directory = self.root.join(".kindred");
        if fs::symlink_metadata(&directory).is_ok_and(|meta| meta.file_type().is_symlink()) {
            return Err("index directory must not be a symbolic link".into());
        }
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let index = directory.join("index.json");
        let pending = directory.join(format!("index-{}.tmp", std::process::id()));
        let bytes = serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?;
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        // The disposable snapshot includes private note contents.
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.mode(0o600);
        }
        let mut file = options.open(&pending).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|e| e.to_string())?;
        fs::rename(&pending, &index).map_err(|e| e.to_string())?;
        Ok(index)
    }

    fn diagnostic(&mut self, code: &str, path: &str, message: String) {
        self.diagnostics.push(Diagnostic {
            code: code.into(),
            path: path.into(),
            message,
        });
    }

    fn validate(&mut self) {
        let mut diagnostics = Vec::new();
        let mut ids = BTreeSet::new();
        for record in &self.records {
            let diagnostic_path = record
                .owner
                .as_deref()
                .and_then(|owner| self.record(owner))
                .map_or_else(|| record.path.clone(), |owner| owner.path.clone());
            if !ids.insert(&record.id) {
                diagnostics.push((
                    "duplicate_id",
                    diagnostic_path.clone(),
                    format!("duplicate ID: {}", record.id),
                ));
            }
            if record.kind == "relationship"
                && let Err(error) = self.edge(record)
            {
                diagnostics.push(("invalid_relationship", diagnostic_path.clone(), error));
            }
            for (key, value) in &record.metadata {
                if projected_property(record, key) {
                    continue;
                }
                let values: Vec<&Value> = value
                    .as_array()
                    .map_or_else(|| vec![value], |items| items.iter().collect());
                for value in values {
                    if let Some(link) = value.as_str().filter(|v| {
                        v.starts_with("[[")
                            || ["sources", "people", "parent", "child", "partners", "place"]
                                .contains(&key.as_str())
                    }) {
                        match self.resolve_link(link) {
                            Err(message) => diagnostics.push((
                                "invalid_link",
                                diagnostic_path.clone(),
                                format!("{key}: {message}"),
                            )),
                            Ok(target) if key == "sources" && target.kind != "source" => {
                                diagnostics.push((
                                    "invalid_source",
                                    diagnostic_path.clone(),
                                    format!("source link must target a source: {link}"),
                                ));
                            }
                            Ok(target) if key == "people" && target.kind != "person" => {
                                diagnostics.push((
                                    "invalid_link_type",
                                    diagnostic_path.clone(),
                                    format!("people must link to person records: {link}"),
                                ));
                            }
                            Ok(target) if key == "place" && target.kind != "place" => {
                                diagnostics.push((
                                    "invalid_link_type",
                                    diagnostic_path.clone(),
                                    format!("place must link to a place record: {link}"),
                                ));
                            }
                            Ok(target)
                                if key == "portrait"
                                    && (target.kind != "media"
                                        || target
                                            .text("file")
                                            .is_none_or(|file| self.attachment(file).is_err())) =>
                            {
                                diagnostics.push((
                                    "invalid_portrait",
                                    diagnostic_path.clone(),
                                    format!("portrait must link to a media record with a local file: {link}"),
                                ));
                            }
                            _ => {}
                        }
                    }
                    if (["attachments", "file"].contains(&key.as_str())
                        || record.kind == "person" && key == "portrait")
                        && let Some(path) = value.as_str()
                        && !path.starts_with("[[")
                        && let Err(message) = self.attachment(path)
                    {
                        diagnostics.push(("invalid_attachment", diagnostic_path.clone(), message));
                    }
                }
            }
        }
        for (code, path, message) in diagnostics {
            self.diagnostic(code, &path, message);
        }
    }

    /// Resolve an attachment inside the archive, rejecting traversal and symlinks
    /// that lead outside it.
    /// # Errors
    /// Reports unsafe, missing, or non-file attachment paths.
    pub fn attachment(&self, relative: &str) -> Result<PathBuf, String> {
        let path = Path::new(relative);
        if path.is_absolute()
            || relative.contains('\\')
            || path
                .components()
                .any(|part| !matches!(part, std::path::Component::Normal(_)))
        {
            return Err(format!("unsafe attachment path: {relative}"));
        }
        let full = self
            .root
            .join(path)
            .canonicalize()
            .map_err(|error| format!("attachment {relative}: {error}"))?;
        if !full.starts_with(&self.root) || !full.is_file() {
            return Err(format!(
                "attachment must be a file inside the archive: {relative}"
            ));
        }
        Ok(full)
    }

    fn edge(&self, record: &Record) -> Result<Edge, String> {
        if record.owner.is_some() {
            return person::edge(self, record);
        }
        let relation = record
            .text("relation")
            .ok_or("relationship requires relation")?;
        let status = record
            .text("status")
            .ok_or("relationship requires explicit status")?;
        if !["accepted", "tentative", "disputed", "rejected"].contains(&status) {
            return Err(format!("unsupported claim status: {status}"));
        }
        let (from, to) = match relation {
            "biological_parent" | "adoptive_parent" | "foster_parent" => (
                record.text("parent").ok_or("parent link required")?,
                record.text("child").ok_or("child link required")?,
            ),
            "partner" => {
                let partners = record.links("partners");
                match partners.as_slice() {
                    [a, b] => (*a, *b),
                    _ => return Err("partner relationship requires exactly two partners".into()),
                }
            }
            _ => return Err(format!("unsupported relation: {relation}")),
        };
        let from = self.resolve_link(from)?;
        let to = self.resolve_link(to)?;
        if from.kind != "person" || to.kind != "person" {
            return Err("relationship endpoints must be people".into());
        }
        if from.id == to.id {
            return Err("relationship endpoints must be different people".into());
        }
        let sources = record
            .links("sources")
            .into_iter()
            .map(|link| self.resolve_link(link).map(|source| source.id.clone()))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Edge {
            id: record.id.clone(),
            from: from.id.clone(),
            to: to.id.clone(),
            relation: relation.into(),
            status: status.into(),
            sources,
        })
    }
}

fn projected_property(record: &Record, key: &str) -> bool {
    record.owner.is_some()
        && ["sources", "people", "parent", "child", "partners", "place"].contains(&key)
        || record.kind == "person"
            && [
                "sources",
                "mother",
                "father",
                "parents",
                "partners",
                "birth_place",
                "death_place",
                "events",
                "portrait_source",
            ]
            .contains(&key)
}

fn collect_notes(directory: &Path, paths: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|e| format!("{}: {e}", directory.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            collect_notes(&entry.path(), paths)?;
        } else if entry.path().extension().is_some_and(|ext| ext == "md") {
            paths.push(entry.path());
        }
    }
    Ok(())
}

fn frontmatter(raw: &str) -> Result<Option<(&str, &str)>, String> {
    let Some(rest) = raw
        .strip_prefix("---\r\n")
        .or_else(|| raw.strip_prefix("---\n"))
    else {
        return Ok(None);
    };
    let mut offset = 0usize;
    for line in rest.split_inclusive('\n') {
        if line.trim_end_matches(['\r', '\n']) == "---" {
            let yaml = rest.get(..offset).ok_or("invalid frontmatter boundary")?;
            let body = rest
                .get(offset.saturating_add(line.len())..)
                .ok_or("invalid body boundary")?;
            return Ok(Some((yaml, body)));
        }
        offset = offset.saturating_add(line.len());
    }
    Err("frontmatter has no closing --- delimiter".into())
}

/// Validate one typed note while retaining the original text exactly.
/// # Errors
/// Reports missing frontmatter, malformed YAML, invalid schema, or non-flat
/// properties. Link targets require a subsequent full archive validation.
pub fn validate_text(path: &str, raw: &str) -> Result<Record, String> {
    let (yaml, body) = frontmatter(raw)?.ok_or("typed note requires YAML frontmatter")?;
    let yaml_value: serde_yaml_ng::Value =
        serde_yaml_ng::from_str(yaml).map_err(|e| e.to_string())?;
    let metadata: BTreeMap<String, Value> =
        serde_yaml_ng::from_value(yaml_value).map_err(|e| e.to_string())?;
    if metadata.get("version").and_then(Value::as_u64) != Some(1) {
        return Err("unsupported or missing schema version; expected version: 1".into());
    }
    let id = metadata
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
        .ok_or("nonempty string id required")?
        .to_owned();
    let kind = metadata
        .get("type")
        .and_then(Value::as_str)
        .ok_or("type required")?
        .to_owned();
    if ![
        "person",
        "relationship",
        "source",
        "event",
        "place",
        "media",
    ]
    .contains(&kind.as_str())
    {
        return Err(format!("unsupported record type: {kind}"));
    }
    for key in ["sources", "partners", "people", "aliases", "attachments"] {
        if kind == "person" && ["sources", "partners"].contains(&key) {
            continue;
        }
        if let Some(value) = metadata.get(key)
            && !value
                .as_array()
                .is_some_and(|items| items.iter().all(Value::is_string))
        {
            return Err(format!("{key} must be a list of strings"));
        }
    }
    for key in ["parent", "child", "place", "file"] {
        if metadata.get(key).is_some_and(|value| !value.is_string()) {
            return Err(format!("{key} must be a string"));
        }
    }
    for key in ["living", "private"] {
        if metadata.get(key).is_some_and(|value| !value.is_boolean()) {
            return Err(format!("{key} must be a boolean"));
        }
    }
    validate_parent_role(&metadata, &kind)?;
    validate_portrait(&metadata, &kind)?;
    let name = metadata
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or(&id)
        .to_owned();
    Ok(Record {
        id,
        kind,
        name,
        path: path.into(),
        metadata,
        body: body.into(),
        raw: raw.into(),
        owner: None,
    })
}

fn validate_parent_role(metadata: &BTreeMap<String, Value>, kind: &str) -> Result<(), String> {
    let Some(value) = metadata.get("parent_role") else {
        return Ok(());
    };
    if kind != "relationship"
        || !matches!(
            metadata.get("relation").and_then(Value::as_str),
            Some("biological_parent" | "adoptive_parent" | "foster_parent")
        )
    {
        return Err("parent_role is only allowed on parent relationship claims".into());
    }
    if !matches!(value.as_str(), Some("mother" | "father" | "parent")) {
        return Err("parent_role must be a string: mother, father, or parent".into());
    }
    Ok(())
}

fn validate_portrait(metadata: &BTreeMap<String, Value>, kind: &str) -> Result<(), String> {
    let Some(value) = metadata.get("portrait") else {
        return Ok(());
    };
    if kind != "person" {
        return Err("portrait is only allowed on person records".into());
    }
    let link = value
        .as_str()
        .ok_or("portrait must be a single wiki-link string")?;
    if link.starts_with("[[") {
        link_target(link).map_err(|error| format!("portrait: {error}"))?;
    } else if link.is_empty()
        || link.contains("://")
        || link.contains('\\')
        || Path::new(link)
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
    {
        return Err("portrait must be a local attachment path or a media wiki link".into());
    }
    Ok(())
}

fn link_target(link: &str) -> Result<&str, String> {
    let target = link
        .strip_prefix("[[")
        .and_then(|s| s.strip_suffix("]]"))
        .ok_or_else(|| format!("expected quoted wiki link: {link}"))?
        .split('|')
        .next()
        .unwrap_or_default();
    let target = target.strip_suffix(".md").unwrap_or(target);
    if target.is_empty()
        || target.starts_with('/')
        || target.contains('\\')
        || target.split('/').any(|part| part == ".." || part == ".")
    {
        return Err(format!("invalid link target: {link}"));
    }
    Ok(target)
}
