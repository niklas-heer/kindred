//! Explicitly scoped archive copies and a documented GEDCOM interchange subset.
pub mod gedcom;

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;
use serde_json::Value;

use crate::archive::Archive;

#[derive(Debug, Default, Serialize)]
pub struct Report {
    pub written: usize,
    pub warnings: Vec<String>,
}

/// Prepare a new destination. Existing data is never merged or replaced.
/// # Errors
/// Rejects existing destinations, paths inside the source, or inaccessible parents.
pub fn new_destination(source: &Path, destination: &Path) -> Result<(), String> {
    if fs::symlink_metadata(source.join(".kindred/edit.json")).is_ok() {
        return Err("unfinished edit: run kindred recover before exporting".into());
    }
    if fs::symlink_metadata(destination).is_ok() {
        return Err("destination already exists".into());
    }
    let parent = destination
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let parent = parent
        .canonicalize()
        .map_err(|e| format!("destination parent: {e}"))?;
    let source = source.canonicalize().map_err(|e| e.to_string())?;
    if parent.starts_with(source) {
        return Err("destination must be outside the source archive".into());
    }
    Ok(())
}

/// Write a complete new archive in a staging directory, then publish it in one rename.
/// # Errors
/// Reports existing paths, failed writes, and failed publication; failed stages are cleaned up.
pub fn staged_directory<T>(
    destination: &Path,
    write: impl FnOnce(&Path) -> Result<T, String>,
) -> Result<T, String> {
    let name = destination
        .file_name()
        .ok_or("destination needs a name")?
        .to_string_lossy();
    let stage = destination.with_file_name(format!(".{name}.kindred-staging"));
    if fs::symlink_metadata(destination).is_ok() {
        return Err("destination already exists".into());
    }
    fs::create_dir(&stage)
        .map_err(|e| format!("cannot create staging directory {}: {e}", stage.display()))?;
    let result = write(&stage);
    match result {
        Ok(result) => {
            if fs::symlink_metadata(destination).is_ok() {
                return Err(format!(
                    "destination appeared; staged files retained at {}",
                    stage.display()
                ));
            }
            fs::rename(&stage, destination)
                .map_err(|e| format!("staged files retained at {}: {e}", stage.display()))?;
            Ok(result)
        }
        Err(error) => {
            let _ = fs::remove_dir_all(&stage);
            Err(error)
        }
    }
}

/// Create a new flat-metadata Markdown note inside a staging directory.
/// # Errors
/// Rejects unsafe paths, existing files, serialization failures, and I/O failures.
pub fn write_note(
    root: &Path,
    path: &str,
    metadata: &BTreeMap<String, Value>,
    body: &str,
) -> Result<(), String> {
    let relative = Path::new(path);
    if path.contains('\\')
        || relative
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
    {
        return Err("note path must be relative without traversal".into());
    }
    let mut parent = root.to_path_buf();
    for component in relative.parent().ok_or("note needs a parent")?.components() {
        parent.push(component);
        match fs::symlink_metadata(&parent) {
            Ok(metadata) if !metadata.is_dir() || metadata.file_type().is_symlink() => {
                return Err("note parent must be a regular directory".into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&parent).map_err(|error| error.to_string())?;
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    let yaml = serde_yaml_ng::to_string(metadata).map_err(|e| e.to_string())?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(root.join(relative))
        .map_err(|e| e.to_string())?;
    file.write_all(format!("---\n{yaml}---\n{body}").as_bytes())
        .map_err(|e| e.to_string())
}

fn copy_tree(source: &Path, destination: &Path, report: &mut Report) -> Result<(), String> {
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if matches!(entry.file_name().to_str(), Some(".kindred" | ".git")) {
            continue;
        }
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        let target = destination.join(entry.file_name());
        if kind.is_symlink() {
            return Err(format!("refusing symlink: {}", entry.path().display()));
        }
        if kind.is_dir() {
            fs::create_dir(&target).map_err(|e| e.to_string())?;
            copy_tree(&entry.path(), &target, report)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), target).map_err(|e| e.to_string())?;
            report.written = report.written.saturating_add(1);
        } else {
            return Err("unsupported special file in archive".into());
        }
    }
    Ok(())
}

#[derive(PartialEq, Eq)]
struct FileStamp {
    directory: bool,
    length: u64,
    modified: Option<SystemTime>,
}

fn manifest(root: &Path) -> Result<BTreeMap<PathBuf, FileStamp>, String> {
    let mut result = BTreeMap::new();
    scan_manifest(root, Path::new(""), &mut result)?;
    Ok(result)
}

fn scan_manifest(
    root: &Path,
    relative: &Path,
    result: &mut BTreeMap<PathBuf, FileStamp>,
) -> Result<(), String> {
    for entry in fs::read_dir(root.join(relative)).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if matches!(entry.file_name().to_str(), Some(".kindred" | ".git")) {
            continue;
        }
        let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() {
            return Err(format!("refusing symlink: {}", entry.path().display()));
        }
        if !metadata.is_dir() && !metadata.is_file() {
            return Err("unsupported special file in archive".into());
        }
        let path = relative.join(entry.file_name());
        result.insert(
            path.clone(),
            FileStamp {
                directory: metadata.is_dir(),
                length: if metadata.is_dir() { 0 } else { metadata.len() },
                modified: if metadata.is_dir() {
                    None
                } else {
                    Some(metadata.modified().map_err(|error| error.to_string())?)
                },
            },
        );
        if metadata.is_dir() {
            scan_manifest(root, &path, result)?;
        }
    }
    Ok(())
}

fn equal_files(source: &Path, copied: &Path, length: u64) -> Result<bool, String> {
    let mut source = fs::File::open(source).map_err(|error| error.to_string())?;
    let mut copied = fs::File::open(copied).map_err(|error| error.to_string())?;
    if copied.metadata().map_err(|error| error.to_string())?.len() != length {
        return Ok(false);
    }
    let mut left = [0u8; 8192];
    let mut right = [0u8; 8192];
    let mut remaining = length;
    while remaining > 0 {
        let amount = usize::try_from(remaining.min(8192)).map_err(|error| error.to_string())?;
        let left = left.get_mut(..amount).ok_or("invalid comparison buffer")?;
        let right = right.get_mut(..amount).ok_or("invalid comparison buffer")?;
        source.read_exact(left).map_err(|error| error.to_string())?;
        copied
            .read_exact(right)
            .map_err(|error| error.to_string())?;
        if left != right {
            return Ok(false);
        }
        remaining = remaining.saturating_sub(8192);
    }
    Ok(true)
}

fn verify_snapshot(
    root: &Path,
    stage: &Path,
    expected: &BTreeMap<PathBuf, FileStamp>,
) -> Result<(), String> {
    if &manifest(root)? != expected {
        return Err(
            "archive changed during export; retry when external edits have finished".into(),
        );
    }
    for (path, stamp) in expected {
        if !stamp.directory && !equal_files(&root.join(path), &stage.join(path), stamp.length)? {
            return Err(format!(
                "archive file changed during export: {}",
                path.display()
            ));
        }
    }
    if &manifest(root)? != expected {
        return Err(
            "archive changed during export; retry when external edits have finished".into(),
        );
    }
    Ok(())
}

/// A full backup includes all user files. Public export emits only a safe metadata projection.
/// # Errors
/// Rejects invalid archives, unsafe paths/symlinks, existing destinations, and I/O failures.
pub fn export(root: &Path, destination: &Path, all: bool) -> Result<Report, String> {
    new_destination(root, destination)?;
    let archive = Archive::load(root)?;
    if !archive.diagnostics.is_empty() {
        return Err("fix archive diagnostics before exporting".into());
    }
    let expected = if all { Some(manifest(root)?) } else { None };
    staged_directory(destination, |stage| {
        let mut report = Report::default();
        if all {
            copy_tree(root, stage, &mut report)?;
        } else {
            public_projection(&archive, stage, &mut report)?;
        }
        let exported = Archive::load(stage)?;
        if !exported.diagnostics.is_empty() {
            return Err(
                "exported files failed validation; source may have changed during export".into(),
            );
        }
        if let Some(expected) = &expected {
            verify_snapshot(root, stage, expected)?;
        }
        Ok(report)
    })
}

/// Select explicitly deceased people whose privacy flag does not prohibit sharing.
#[must_use]
pub fn public_people(archive: &Archive) -> BTreeSet<String> {
    archive
        .records
        .iter()
        .filter(|r| {
            r.kind == "person"
                && r.metadata.get("living") == Some(&Value::Bool(false))
                && r.metadata.get("private") != Some(&Value::Bool(true))
        })
        .map(|r| r.id.clone())
        .collect()
}

fn public_projection(archive: &Archive, stage: &Path, report: &mut Report) -> Result<(), String> {
    let people = public_people(archive);
    let mut paths = BTreeMap::new();
    for (index, id) in people.iter().enumerate() {
        paths.insert(id.clone(), format!("people/person-{index}.md"));
    }
    for person in archive.records.iter().filter(|r| people.contains(&r.id)) {
        let mut metadata = BTreeMap::new();
        for key in ["version", "id", "type", "name", "birth", "death", "living"] {
            if let Some(value) = person.metadata.get(key) {
                metadata.insert(key.into(), value.clone());
            }
        }
        let path = paths.get(&person.id).ok_or("missing public path")?;
        write_note(stage, path, &metadata, "")?;
        report.written = report.written.saturating_add(1);
    }
    for (index, edge) in archive
        .edges()
        .iter()
        .filter(|e| people.contains(&e.from) && people.contains(&e.to))
        .enumerate()
    {
        let Some(claim) = archive.record(&edge.id) else {
            continue;
        };
        if claim.metadata.get("private") == Some(&Value::Bool(true)) {
            continue;
        }
        let from = format!(
            "[[{}]]",
            paths
                .get(&edge.from)
                .ok_or("missing public parent")?
                .trim_end_matches(".md")
        );
        let to = format!(
            "[[{}]]",
            paths
                .get(&edge.to)
                .ok_or("missing public child")?
                .trim_end_matches(".md")
        );
        let mut metadata = BTreeMap::from([
            ("version".into(), Value::from(1)),
            ("id".into(), Value::from(edge.id.clone())),
            ("type".into(), Value::from("relationship")),
            ("relation".into(), Value::from(edge.relation.clone())),
            ("status".into(), Value::from(edge.status.clone())),
        ]);
        if edge.relation == "partner" {
            metadata.insert("partners".into(), serde_json::json!([from, to]));
        } else {
            metadata.insert("parent".into(), Value::from(from));
            metadata.insert("child".into(), Value::from(to));
        }
        write_note(
            stage,
            &format!("relationships/claim-{index}.md"),
            &metadata,
            "Evidence withheld from this public metadata projection. Consult the archive owner.\n",
        )?;
        report.written = report.written.saturating_add(1);
    }
    report.warnings.push("Public projection includes only explicitly non-living, non-private people and their non-private relationships. It omits prose, aliases, sources, events, places, media, attachments, unknown metadata, and people of unknown living status. Review names and dates before sharing.".into());
    fs::write(
        stage.join("EXPORT-REPORT.json"),
        serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod snapshot_tests {
    use super::{manifest, verify_snapshot};
    use std::{
        fs,
        sync::atomic::{AtomicUsize, Ordering},
    };
    static NEXT: AtomicUsize = AtomicUsize::new(0);

    #[test]
    fn snapshot_verification_detects_content_changes_even_with_restored_file_metadata() {
        let temporary = std::env::temp_dir().join(format!(
            "kindred-snapshot-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let source = temporary.join("source");
        let stage = temporary.join("stage");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir(&stage).unwrap();
        fs::write(source.join("file.txt"), "original bytes").unwrap();
        fs::write(stage.join("file.txt"), "original bytes").unwrap();
        let expected = manifest(&source).unwrap();
        verify_snapshot(&source, &stage, &expected).unwrap();
        let modified = fs::metadata(source.join("file.txt"))
            .unwrap()
            .modified()
            .unwrap();
        fs::write(source.join("file.txt"), "modified bytes").unwrap();
        fs::File::options()
            .write(true)
            .open(source.join("file.txt"))
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(modified))
            .unwrap();
        assert!(
            verify_snapshot(&source, &stage, &expected)
                .unwrap_err()
                .contains("file changed")
        );
        fs::create_dir(source.join("new empty directory")).unwrap();
        assert!(
            verify_snapshot(&source, &stage, &expected)
                .unwrap_err()
                .contains("archive changed")
        );
        fs::remove_dir_all(temporary).unwrap();
    }
}
