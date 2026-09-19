use kindred::{archive::Archive, editing};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};
static NEXT: AtomicUsize = AtomicUsize::new(0);
const ORIGINAL: &str = "---\r\nversion: 1\r\nid: anna\r\ntype: person\r\nname: Anna\r\nresearch_colour: amber # keep this comment\r\n---\r\n\r\n# Life\r\nOriginal prose.\r\n";
struct Fixture(PathBuf);
#[allow(clippy::unwrap_used)]
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "kindred-edit-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("anna.md"), ORIGINAL).unwrap();
        Self(path)
    }
    fn raw(&self) -> String {
        fs::read_to_string(self.0.join("anna.md")).unwrap()
    }
    fn journal(&self, replacement: &str) {
        fs::create_dir_all(self.0.join(".kindred")).unwrap();
        fs::write(self.0.join(".kindred/edit.json"),serde_json::to_vec(&serde_json::json!({"path":"anna.md","expected":ORIGINAL,"replacement":replacement})).unwrap()).unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn edit_preserves_unknown_properties_comments_and_exact_prose_bytes() {
    let fixture = Fixture::new();
    let replacement = ORIGINAL.replace("name: Anna", "name: Anna Linden");
    editing::replace(&fixture.0, "anna", ORIGINAL, &replacement).unwrap();
    assert_eq!(fixture.raw(), replacement);
    assert!(
        fixture
            .raw()
            .contains("research_colour: amber # keep this comment\r\n")
    );
    assert!(fixture.raw().ends_with("\r\n# Life\r\nOriginal prose.\r\n"));
    assert!(!fixture.0.join(".kindred/edit.json").exists());
}
#[test]
fn external_edits_and_identity_changes_are_rejected_without_overwrite() {
    let fixture = Fixture::new();
    let external = ORIGINAL.replace("Original prose.", "Externally updated prose.");
    fs::write(fixture.0.join("anna.md"), &external).unwrap();
    assert!(
        editing::replace(
            &fixture.0,
            "anna",
            ORIGINAL,
            &ORIGINAL.replace("Anna", "Ann")
        )
        .unwrap_err()
        .contains("conflict")
    );
    assert_eq!(fixture.raw(), external);
    assert!(
        editing::replace(
            &fixture.0,
            "anna",
            &external,
            &external.replace("id: anna", "id: changed")
        )
        .is_err()
    );
    assert_eq!(fixture.raw(), external);
}
#[test]
fn replacement_is_validated_against_the_complete_archive() {
    let fixture = Fixture::new();
    let invalid = ORIGINAL.replace("name: Anna", "name: Anna\r\nsources: ['[[missing]]']");
    let error = editing::replace(&fixture.0, "anna", ORIGINAL, &invalid).unwrap_err();
    assert!(error.contains("missing link"));
    assert_eq!(fixture.raw(), ORIGINAL);
    assert!(!fixture.0.join(".kindred/edit.json").exists());
    let wrong_type = ORIGINAL.replace("name: Anna", "name: Anna\r\nsources: ['[[anna]]']");
    assert!(editing::replace(&fixture.0, "anna", ORIGINAL, &wrong_type).is_err());
    assert_eq!(fixture.raw(), ORIGINAL);
}
#[test]
fn a_replacement_can_repair_an_existing_broken_link() {
    let fixture = Fixture::new();
    let broken = ORIGINAL.replace("name: Anna", "name: Anna\r\nsources: ['[[missing]]']");
    fs::write(fixture.0.join("anna.md"), &broken).unwrap();
    assert!(!Archive::load(&fixture.0).unwrap().diagnostics.is_empty());
    editing::replace(&fixture.0, "anna", &broken, ORIGINAL).unwrap();
    assert!(Archive::load(&fixture.0).unwrap().diagnostics.is_empty());
}
#[test]
fn deterministic_recovery_covers_each_persisted_crash_stage() {
    // Inject the actual persisted journal/staging states, then exercise production recovery.
    for phase in 0..3 {
        let fixture = Fixture::new();
        let replacement = ORIGINAL.replace("Original prose.", "Recovered prose.");
        fixture.journal(&replacement);
        if phase == 1 {
            fs::write(
                fixture.0.join(".kindred/replacement.tmp"),
                "interrupted partial staging",
            )
            .unwrap();
        }
        if phase == 2 {
            fs::write(fixture.0.join("anna.md"), &replacement).unwrap();
        }
        editing::recover(&fixture.0).unwrap();
        assert_eq!(fixture.raw(), replacement, "crash phase {phase}");
        assert!(!fixture.0.join(".kindred/edit.json").exists());
        editing::recover(&fixture.0).unwrap();
        assert_eq!(fixture.raw(), replacement);
    }
}
#[test]
fn recovery_retains_conflicting_journals_and_external_text() {
    let fixture = Fixture::new();
    fixture.journal(&ORIGINAL.replace("Original prose.", "Pending prose."));
    let external = ORIGINAL.replace("Original prose.", "New external prose.");
    fs::write(fixture.0.join("anna.md"), &external).unwrap();
    assert!(
        editing::recover(&fixture.0)
            .unwrap_err()
            .contains("conflict")
    );
    assert_eq!(fixture.raw(), external);
    assert!(fixture.0.join(".kindred/edit.json").exists());
    assert!(
        editing::replace(&fixture.0, "anna", &external, ORIGINAL)
            .unwrap_err()
            .contains("unfinished edit")
    );
}
#[test]
fn recovery_revalidates_links_and_rejects_malformed_journals() {
    let fixture = Fixture::new();
    fixture.journal(&ORIGINAL.replace("name: Anna", "name: Anna\r\nsources: ['[[missing]]']"));
    assert!(editing::recover(&fixture.0).is_err());
    assert_eq!(fixture.raw(), ORIGINAL);
    fs::write(fixture.0.join(".kindred/edit.json"), "{incomplete").unwrap();
    assert!(
        editing::recover(&fixture.0)
            .unwrap_err()
            .contains("invalid recovery journal")
    );
    assert_eq!(fixture.raw(), ORIGINAL);
}
#[cfg(unix)]
#[test]
fn symlink_staging_is_refused_and_journal_permissions_are_private() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let fixture = Fixture::new();
    fs::create_dir(fixture.0.join(".kindred")).unwrap();
    let external = fixture.0.join("untouched.txt");
    fs::write(&external, "do not alter").unwrap();
    symlink(&external, fixture.0.join(".kindred/replacement.tmp")).unwrap();
    let replacement = ORIGINAL.replace("Anna", "Ann");
    assert!(
        editing::replace(&fixture.0, "anna", ORIGINAL, &replacement)
            .unwrap_err()
            .contains("symlink")
    );
    assert_eq!(fs::read_to_string(&external).unwrap(), "do not alter");
    assert_eq!(fixture.raw(), ORIGINAL);
    assert_eq!(
        fs::metadata(fixture.0.join(".kindred/edit.json"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    fs::remove_file(fixture.0.join(".kindred/replacement.tmp")).unwrap();
    fs::set_permissions(fixture.0.join("anna.md"), fs::Permissions::from_mode(0o600)).unwrap();
    editing::recover(&fixture.0).unwrap();
    assert_eq!(
        fs::metadata(fixture.0.join("anna.md"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
}
#[cfg(unix)]
#[test]
fn symlink_journals_and_cache_directories_are_refused() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    fs::create_dir(fixture.0.join(".kindred")).unwrap();
    symlink(
        fixture.0.join("anna.md"),
        fixture.0.join(".kindred/edit.json"),
    )
    .unwrap();
    assert!(
        editing::recover(&fixture.0)
            .unwrap_err()
            .contains("symlink")
    );
    assert_eq!(fixture.raw(), ORIGINAL);
    fs::remove_dir_all(fixture.0.join(".kindred")).unwrap();
    fs::create_dir(fixture.0.join("elsewhere")).unwrap();
    symlink(fixture.0.join("elsewhere"), fixture.0.join(".kindred")).unwrap();
    assert!(editing::replace(&fixture.0, "anna", ORIGINAL, ORIGINAL).is_err());
}

#[test]
fn editing_a_person_rebuilds_projections_and_synthetic_records_cannot_be_written() {
    let fixture = Fixture::new();
    fs::write(
        fixture.0.join("child.md"),
        "---\nversion: 1\nid: child\ntype: person\n---\nOriginal child story.\n",
    )
    .unwrap();
    let original = fs::read_to_string(fixture.0.join("child.md")).unwrap();
    let replacement = original.replace("type: person", "type: person\nparents: [{id: claim, person: '[[anna]]', role: mother, status: tentative}]\ncustom: {nested: [keep, this]}");
    editing::replace(&fixture.0, "child", &original, &replacement).unwrap();
    let archive = Archive::load(&fixture.0).unwrap();
    assert!(archive.diagnostics.is_empty());
    assert_eq!(
        archive.record("claim").unwrap().owner.as_deref(),
        Some("child")
    );
    assert!(
        editing::replace(&fixture.0, "claim", "", "anything")
            .unwrap_err()
            .contains("owning person: child")
    );
    let invalid = replacement.replace("[[anna]]", "[[missing]]");
    assert!(editing::replace(&fixture.0, "child", &replacement, &invalid).is_err());
    assert_eq!(
        fs::read_to_string(fixture.0.join("child.md")).unwrap(),
        replacement
    );
    editing::replace(&fixture.0, "child", &replacement, &original).unwrap();
    assert!(Archive::load(&fixture.0).unwrap().record("claim").is_none());
}
