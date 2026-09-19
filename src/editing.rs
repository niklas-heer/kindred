//! Optimistic file editing with a durable, explicitly recoverable journal.
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::archive::{Archive, validate_text};

#[derive(Serialize, Deserialize)]
struct Journal {
    path: String,
    expected: String,
    replacement: String,
}

/// Resolve a regular file without following any symlink inside the archive.
/// # Errors
/// Rejects missing files, traversal, symlinks, and non-file targets.
pub fn safe_file(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.contains('\\') {
        return Err("archive paths must use forward slashes".into());
    }
    let mut target = root.canonicalize().map_err(|e| e.to_string())?;
    for part in Path::new(relative).components() {
        let Component::Normal(part) = part else {
            return Err("archive paths must be relative without traversal".into());
        };
        target.push(part);
        if fs::symlink_metadata(&target)
            .map_err(|e| format!("{}: {e}", target.display()))?
            .file_type()
            .is_symlink()
        {
            return Err("symlinks are not allowed in archive paths".into());
        }
    }
    if !target.is_file() {
        return Err("expected a regular archive file".into());
    }
    Ok(target)
}

fn lock(root: &Path) -> Result<(PathBuf, File), String> {
    let cache = root.join(".kindred");
    if let Ok(meta) = fs::symlink_metadata(&cache)
        && (meta.file_type().is_symlink() || !meta.is_dir())
    {
        return Err(".kindred must be a regular directory".into());
    }
    fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    let lock_path = cache.join("write.lock");
    if fs::symlink_metadata(&lock_path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("write.lock must not be a symlink".into());
    }
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(lock_path)
        .map_err(|e| e.to_string())?;
    file.try_lock()
        .map_err(|e| format!("archive is being edited: {e}"))?;
    Ok((cache, file))
}

fn create_durable(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    // A journal contains complete private notes; do not depend on the umask.
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|e| e.to_string())
}

fn apply(root: &Path, cache: &Path, journal: &Journal) -> Result<(), String> {
    let target = safe_file(root, &journal.path)?;
    let current = fs::read_to_string(&target).map_err(|e| e.to_string())?;
    if current == journal.replacement {
        fs::remove_file(cache.join("edit.json")).map_err(|e| e.to_string())?;
        return sync_directory(cache);
    }
    if current != journal.expected {
        return Err("conflict: note changed externally; journal retained for inspection".into());
    }
    let temporary = cache.join("replacement.tmp");
    if temporary.exists() {
        // Only remove our known temporary file; never follow a symlink.
        if fs::symlink_metadata(&temporary)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("replacement.tmp must not be a symlink".into());
        }
        fs::remove_file(&temporary).map_err(|e| e.to_string())?;
    }
    create_durable(&temporary, journal.replacement.as_bytes())?;
    fs::set_permissions(
        &temporary,
        fs::metadata(&target)
            .map_err(|e| e.to_string())?
            .permissions(),
    )
    .map_err(|e| e.to_string())?;
    // Recheck after staging, so edits made while preparing the write are detected.
    if fs::read_to_string(&target).map_err(|e| e.to_string())? != journal.expected {
        return Err("conflict: note changed while preparing edit; journal retained".into());
    }
    fs::rename(&temporary, &target).map_err(|e| format!("replacement failed; run recover: {e}"))?;
    sync_directory(target.parent().ok_or("note has no parent")?)?;
    fs::remove_file(cache.join("edit.json")).map_err(|e| e.to_string())?;
    sync_directory(cache)
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), String> {
    File::open(path)
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), String> {
    Ok(())
}

/// Replace one note only when its exact original contents still match.
/// # Errors
/// Rejects conflicts, invalid replacements, pending recovery, unsafe paths, or I/O failures.
pub fn replace(root: &Path, id: &str, expected: &str, replacement: &str) -> Result<(), String> {
    let (cache, _lock) = lock(root)?;
    if cache.join("edit.json").exists() {
        return Err("unfinished edit: run kindred recover before editing".into());
    }
    let archive = Archive::load(root)?;
    let record = archive
        .record(id)
        .ok_or_else(|| format!("unknown record: {id}"))?;
    if record.raw != expected {
        return Err("conflict: note changed externally; reload before saving".into());
    }
    let draft = validate_text(&record.path, replacement)?;
    if draft.id != record.id || draft.kind != record.kind {
        return Err("editing must preserve the record id and type".into());
    }
    archive.validate_replacement(draft)?;
    let journal = Journal {
        path: record.path.clone(),
        expected: expected.into(),
        replacement: replacement.into(),
    };
    create_durable(
        &cache.join("edit.json"),
        &serde_json::to_vec_pretty(&journal).map_err(|e| e.to_string())?,
    )?;
    sync_directory(&cache)?;
    apply(root, &cache, &journal)
}

/// Finish an interrupted edit without overwriting a subsequent external change.
/// # Errors
/// Rejects malformed/unsafe journals, invalid archives, conflicts, or I/O failures.
pub fn recover(root: &Path) -> Result<(), String> {
    let (cache, _lock) = lock(root)?;
    let journal_path = cache.join("edit.json");
    if !journal_path.exists() {
        return Ok(());
    }
    let journal: Journal = serde_json::from_str(
        &fs::read_to_string(safe_file(root, ".kindred/edit.json")?).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("invalid recovery journal: {e}"))?;
    if Path::new(&journal.path)
        .components()
        .any(|p| p.as_os_str() == ".kindred")
    {
        return Err("journal must target an archive note".into());
    }
    let before = validate_text(&journal.path, &journal.expected)?;
    let after = validate_text(&journal.path, &journal.replacement)?;
    if before.id != after.id || before.kind != after.kind {
        return Err("invalid journal identity change".into());
    }
    Archive::load(root)?.validate_replacement(after)?;
    apply(root, &cache, &journal)
}
