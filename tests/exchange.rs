use kindred::{archive::Archive, exchange};
use std::{
    collections::BTreeMap,
    fs,
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};
static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Fixture(PathBuf);
#[allow(clippy::unwrap_used)]
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "kindred-export-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(path.join("archive")).unwrap();
        Self(path)
    }
    fn root(&self) -> PathBuf {
        self.0.join("archive")
    }
    fn write(&self, path: &str, text: &str) {
        let path = self.root().join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
    fn person(&self, id: &str, properties: &str) {
        self.write(&format!("people/{id}.md"),&format!("---\nversion: 1\nid: {id}\ntype: person\nname: {id}\n{properties}aliases: [SECRET_ALIAS]\noccupation: SECRET_OCCUPATION\nunknown: SECRET_UNKNOWN\n---\nSECRET_PROSE about living family.\n"));
    }
    fn edge(&self, id: &str, from: &str, to: &str, properties: &str) {
        self.write(&format!("relationships/{id}.md"),&format!("---\nversion: 1\nid: {id}\ntype: relationship\nrelation: biological_parent\nstatus: disputed\nparent: '[[people/{from}]]'\nchild: '[[people/{to}]]'\nsources: ['[[sources/private-source]]']\n{properties}---\nSECRET_CLAIM reasoning\n"));
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn full_archive_export_retains_exact_notes_attachments_and_unknown_files() {
    let fixture = Fixture::new();
    fixture.person("anna", "living: true\nprivate: true\n");
    fixture.write("attachments/document.txt", "PRIVATE_ATTACHMENT\n");
    fixture.write(".obsidian/app.json", "{\"setting\":true}");
    fixture.write(
        "ordinary.md",
        "Untyped prose and unknown links [[missing]]\n",
    );
    fixture.write(".kindred/index.json", "disposable");
    fixture.write(".git/config", "internal git state");
    let destination = fixture.0.join("backup");
    let report = exchange::export(&fixture.root(), &destination, true).unwrap();
    assert_eq!(report.written, 4);
    for path in [
        "people/anna.md",
        "attachments/document.txt",
        ".obsidian/app.json",
        "ordinary.md",
    ] {
        assert_eq!(
            fs::read(fixture.root().join(path)).unwrap(),
            fs::read(destination.join(path)).unwrap()
        );
    }
    assert!(!destination.join(".kindred").exists());
    assert!(!destination.join(".git").exists());
    assert!(Archive::load(&destination).unwrap().diagnostics.is_empty());
}
#[test]
fn public_projection_excludes_living_private_unknown_and_all_prose() {
    let fixture = Fixture::new();
    fixture.person("public-parent", "living: false\n");
    fixture.person("public-child", "living: false\nprivate: false\n");
    fixture.person("SECRET_LIVING", "living: true\n");
    fixture.person("SECRET_PRIVATE", "living: false\nprivate: true\n");
    fixture.person("SECRET_UNKNOWN_PERSON", "");
    fixture.write("sources/private-source.md","---\nversion: 1\nid: SECRET_SOURCE\ntype: source\nprivate: true\nattachments: [attachments/secret.txt]\n---\nSECRET_SOURCE_PROSE\n");
    fixture.write("attachments/secret.txt", "SECRET_ATTACHMENT");
    fixture.write("ordinary.md", "SECRET_UNTYPED_PROSE");
    fixture.edge(
        "public-claim",
        "public-parent",
        "public-child",
        "parent_role: mother\n",
    );
    fixture.edge(
        "SECRET_PRIVATE_CLAIM",
        "public-parent",
        "public-child",
        "private: true\n",
    );
    fixture.edge("SECRET_LIVING_CLAIM", "public-parent", "SECRET_LIVING", "");
    let destination = fixture.0.join("public");
    exchange::export(&fixture.root(), &destination, false).unwrap();
    let archive = Archive::load(&destination).unwrap();
    assert!(archive.diagnostics.is_empty(), "{:?}", archive.diagnostics);
    assert_eq!(archive.records.len(), 3);
    assert_eq!(
        archive
            .records
            .iter()
            .filter(|record| record.owner.is_none())
            .count(),
        2
    );
    assert!(!destination.join("relationships").exists());
    assert_eq!(archive.edges().first().unwrap().status, "disputed");
    assert_eq!(
        archive.record("public-claim").unwrap().text("parent_role"),
        Some("mother")
    );
    assert!(
        archive
            .records
            .iter()
            .all(|record| !record.metadata.contains_key("occupation"))
    );
    let mut published = fs::read_to_string(destination.join("EXPORT-REPORT.json")).unwrap();
    for record in archive.records {
        published.push_str(&record.raw);
    }
    assert!(!published.contains("SECRET"), "{published}");
    assert!(!destination.join("attachments").exists());
    assert!(!destination.join("ordinary.md").exists());
}
#[test]
fn invalid_privacy_flags_cannot_bypass_public_filtering() {
    let fixture = Fixture::new();
    fixture.person("anna", "living: false\nprivate: 'true'\n");
    assert!(exchange::export(&fixture.root(), &fixture.0.join("public"), false).is_err());
    assert!(!fixture.0.join("public").exists());
}
#[test]
fn export_rejects_existing_or_nested_destinations_without_data_loss() {
    let fixture = Fixture::new();
    fixture.person("anna", "living: false\n");
    let existing = fixture.0.join("existing");
    fs::create_dir(&existing).unwrap();
    fs::write(existing.join("valuable.txt"), "keep").unwrap();
    assert!(exchange::export(&fixture.root(), &existing, true).is_err());
    assert_eq!(
        fs::read_to_string(existing.join("valuable.txt")).unwrap(),
        "keep"
    );
    assert!(exchange::export(&fixture.root(), &fixture.root().join("nested"), true).is_err());
    assert!(!fixture.root().join("nested").exists());
}
#[test]
fn failed_staging_is_cleaned_and_existing_stage_is_never_overwritten() {
    let fixture = Fixture::new();
    let destination = fixture.0.join("result");
    let error = exchange::staged_directory(&destination, |stage| {
        fs::write(stage.join("partial"), "partial").map_err(|e| e.to_string())?;
        Err::<(), String>("injected failure".into())
    })
    .unwrap_err();
    assert_eq!(error, "injected failure");
    assert!(!destination.exists());
    assert!(!fixture.0.join(".result.kindred-staging").exists());
    fs::create_dir(fixture.0.join(".result.kindred-staging")).unwrap();
    fs::write(
        fixture.0.join(".result.kindred-staging/important"),
        "retained",
    )
    .unwrap();
    assert!(exchange::staged_directory(&destination, |_| Ok(())).is_err());
    assert_eq!(
        fs::read_to_string(fixture.0.join(".result.kindred-staging/important")).unwrap(),
        "retained"
    );
}
#[test]
fn note_writer_rejects_traversal_and_overwriting_existing_files() {
    let fixture = Fixture::new();
    let metadata = BTreeMap::new();
    assert!(exchange::write_note(&fixture.root(), "../outside.md", &metadata, "").is_err());
    exchange::write_note(&fixture.root(), "note.md", &metadata, "original").unwrap();
    assert!(exchange::write_note(&fixture.root(), "note.md", &metadata, "replacement").is_err());
    assert!(
        fs::read_to_string(fixture.root().join("note.md"))
            .unwrap()
            .ends_with("original")
    );
}
#[cfg(unix)]
#[test]
fn full_export_refuses_symlinks_and_public_projection_does_not_copy_them() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    fixture.person("anna", "living: false\n");
    let external = fixture.0.join("secret.txt");
    fs::write(&external, "SECRET_EXTERNAL").unwrap();
    symlink(&external, fixture.root().join("linked.txt")).unwrap();
    let full = fixture.0.join("full");
    assert!(
        exchange::export(&fixture.root(), &full, true)
            .unwrap_err()
            .contains("symlink")
    );
    assert!(!full.exists());
    assert!(!fixture.0.join(".full.kindred-staging").exists());
    let public = fixture.0.join("public");
    exchange::export(&fixture.root(), &public, false).unwrap();
    assert!(!public.join("linked.txt").exists());
    assert_eq!(fs::read_to_string(&external).unwrap(), "SECRET_EXTERNAL");
    let dangling = fixture.0.join("dangling");
    symlink(fixture.0.join("missing"), &dangling).unwrap();
    assert!(exchange::export(&fixture.root(), &dangling, false).is_err());
    assert!(
        fs::symlink_metadata(&dangling)
            .unwrap()
            .file_type()
            .is_symlink()
    );
}

#[test]
fn backup_refuses_to_discard_an_unfinished_edit_journal() {
    let fixture = Fixture::new();
    fixture.person("anna", "living: false\n");
    fs::create_dir(fixture.root().join(".kindred")).unwrap();
    fs::write(
        fixture.root().join(".kindred/edit.json"),
        "pending research",
    )
    .unwrap();
    let destination = fixture.0.join("backup");
    assert!(
        exchange::export(&fixture.root(), &destination, true)
            .unwrap_err()
            .contains("unfinished edit")
    );
    assert!(!destination.exists());
    assert_eq!(
        fs::read_to_string(fixture.root().join(".kindred/edit.json")).unwrap(),
        "pending research"
    );
}
