use kindred::archive::Archive;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicUsize, Ordering},
};

static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Temp(PathBuf);
// Fixture setup failures should fail tests immediately.
#[allow(clippy::unwrap_used)]
impl Temp {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "kindred-gedcom-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        Self(root)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[allow(clippy::unwrap_used)]
fn cli(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_kindred"))
        .args(args)
        .output()
        .unwrap()
}
#[allow(clippy::unwrap_used)]
fn path(path: &Path) -> &str {
    path.to_str().unwrap()
}

#[test]
fn gedcom_cli_roundtrip_preserves_supported_claim_types_and_date_wording() {
    let temp = Temp::new();
    let exported = temp.0.join("exported");
    let output = cli(&[
        "export-gedcom",
        "examples/fictional",
        path(&exported),
        "--all",
    ]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report = fs::read_to_string(exported.join("EXPORT-REPORT.json")).unwrap();
    assert!(report.contains("non-accepted"));
    assert!(report.contains("Parent roles, occupations"));
    let imported = temp.0.join("imported");
    let input = exported.join("family.ged");
    let output = cli(&["import-gedcom", path(&input), path(&imported)]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let archive = Archive::load(&imported).unwrap();
    assert!(archive.diagnostics.is_empty(), "{:?}", archive.diagnostics);
    let original = Archive::load(Path::new("examples/fictional")).unwrap();
    assert_eq!(
        archive
            .records
            .iter()
            .filter(|r| r.kind == "person")
            .count(),
        8
    );
    assert_eq!(fs::read_dir(imported.join("people")).unwrap().count(), 8);
    assert!(!imported.join("relationships").exists());
    assert!(!imported.join("sources").exists());
    assert_eq!(
        archive.edges().len(),
        original
            .edges()
            .iter()
            .filter(|e| e.status == "accepted")
            .count()
    );
    assert!(
        archive
            .edges()
            .iter()
            .any(|e| e.relation == "adoptive_parent")
    );
    for person in original.records.iter().filter(|r| r.kind == "person") {
        let other = archive
            .records
            .iter()
            .find(|r| r.name == person.name)
            .unwrap();
        for key in ["birth", "death"] {
            assert_eq!(
                person.metadata.get(key),
                other.metadata.get(key),
                "{} {key}",
                person.name
            );
        }
    }
    assert_eq!(
        fs::read(input).unwrap(),
        fs::read(imported.join("attachments/original.ged")).unwrap()
    );
    assert!(cli(&["check", path(&imported)]).status.success());
}

#[test]
fn import_reports_unmapped_data_and_keeps_original() {
    let temp = Temp::new();
    let input = temp.0.join("family.ged");
    let output = temp.0.join("archive");
    let text = "0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Elin /Test/\n1 _CUSTOM Important detail\n0 @I2@ INDI\n1 NAME Robin /Test/\n1 FAMC @F1@\n2 PEDI ADOPTED\n0 @S1@ SOUR\n1 TITL Adoption register\n1 WWW https://example.test/register\n1 NOTE Transcribed from the bound volume\n0 @F1@ FAM\n1 HUSB @I1@\n1 CHIL @I2@\n1 SOUR @S1@\n0 @N1@ NOTE Details outside the subset\n0 TRLR\n";
    fs::write(&input, text).unwrap();
    let result = cli(&["import-gedcom", path(&input), path(&output)]);
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let archive = Archive::load(&output).unwrap();
    assert_eq!(archive.edges().len(), 1);
    assert_eq!(archive.edges()[0].relation, "adoptive_parent");
    assert_eq!(archive.edges()[0].id, "g4-r0");
    assert_eq!(archive.edges()[0].sources.len(), 1);
    let child = archive
        .records
        .iter()
        .find(|record| record.kind == "person" && record.name == "Robin Test")
        .unwrap();
    let claim = child
        .metadata
        .get("parents")
        .and_then(serde_json::Value::as_array)
        .and_then(|claims| claims.first())
        .and_then(serde_json::Value::as_object)
        .unwrap();
    assert_eq!(
        claim.get("role").and_then(serde_json::Value::as_str),
        Some("parent")
    );
    let citation = claim
        .get("sources")
        .and_then(serde_json::Value::as_array)
        .and_then(|sources| sources.first())
        .and_then(serde_json::Value::as_object)
        .unwrap();
    assert_eq!(
        citation.get("id").and_then(serde_json::Value::as_str),
        Some("g3")
    );
    assert_eq!(
        citation.get("title").and_then(serde_json::Value::as_str),
        Some("Adoption register")
    );
    assert_eq!(
        citation.get("url").and_then(serde_json::Value::as_str),
        Some("https://example.test/register")
    );
    assert_eq!(
        citation.get("note").and_then(serde_json::Value::as_str),
        Some("Transcribed from the bound volume")
    );
    assert_eq!(
        citation
            .get("attachments")
            .and_then(serde_json::Value::as_array)
            .and_then(|attachments| attachments.first())
            .and_then(serde_json::Value::as_str),
        Some("attachments/original.ged")
    );
    assert!(!output.join("relationships").exists());
    assert!(!output.join("sources").exists());
    let report = fs::read_to_string(output.join("IMPORT-REPORT.json")).unwrap();
    assert!(report.contains("_CUSTOM"));
    assert!(report.contains("@N1@"));
    assert_eq!(
        fs::read_to_string(output.join("attachments/original.ged")).unwrap(),
        text
    );
}

#[test]
fn invalid_import_never_publishes_a_partial_archive() {
    for contents in [
        "not GEDCOM",
        "0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @F1@ FAM\n1 HUSB @missing@\n1 CHIL @missing@\n0 TRLR\n",
    ] {
        let temp = Temp::new();
        let input = temp.0.join("bad.ged");
        let destination = temp.0.join("archive");
        fs::write(&input, contents).unwrap();
        let result = cli(&["import-gedcom", path(&input), path(&destination)]);
        assert_eq!(result.status.code(), Some(1));
        assert!(!destination.exists());
    }
}

#[test]
fn export_requires_explicit_scope_and_never_overwrites_destination() {
    let temp = Temp::new();
    let destination = temp.0.join("out");
    assert_eq!(
        cli(&["export-gedcom", "examples/fictional", path(&destination)])
            .status
            .code(),
        Some(2)
    );
    fs::create_dir(&destination).unwrap();
    fs::write(destination.join("keep.txt"), "keep").unwrap();
    assert_eq!(
        cli(&[
            "export-gedcom",
            "examples/fictional",
            path(&destination),
            "--all"
        ])
        .status
        .code(),
        Some(1)
    );
    assert_eq!(
        fs::read_to_string(destination.join("keep.txt")).unwrap(),
        "keep"
    );
}

#[allow(clippy::unwrap_used)]
fn import_text(temp: &Temp, body: &str) -> (Archive, String) {
    let input = temp.0.join("input.ged");
    let destination = temp.0.join("archive");
    fs::write(
        &input,
        format!("0 HEAD\n1 GEDC\n2 VERS 7.0\n{body}0 TRLR\n"),
    )
    .unwrap();
    let output = cli(&["import-gedcom", path(&input), path(&destination)]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    (
        Archive::load(&destination).unwrap(),
        fs::read_to_string(destination.join("IMPORT-REPORT.json")).unwrap(),
    )
}

#[test]
fn absent_or_birth_pedigree_never_silently_establishes_biology() {
    for pedigree in ["", "2 PEDI BIRTH\n"] {
        let temp = Temp::new();
        let (archive, report) = import_text(
            &temp,
            &format!(
                "0 @I1@ INDI\n1 NAME Parent\n0 @I2@ INDI\n1 NAME Child\n1 FAMC @F1@\n{pedigree}0 @F1@ FAM\n1 HUSB @I1@\n1 CHIL @I2@\n"
            ),
        );
        assert!(archive.edges().is_empty());
        assert!(report.contains("no parentage inferred"));
    }
}

#[test]
fn explicit_adoption_status_is_preserved_and_missing_status_is_tentative() {
    for (statement, expected) in [
        ("", "tentative"),
        ("2 STAT PROVEN\n", "accepted"),
        ("2 STAT CHALLENGED\n", "disputed"),
        ("2 STAT DISPROVEN\n", "rejected"),
    ] {
        let temp = Temp::new();
        let (archive, _) = import_text(
            &temp,
            &format!(
                "0 @I1@ INDI\n1 NAME Parent\n0 @I2@ INDI\n1 NAME Child\n1 FAMC @F1@\n2 PEDI ADOPTED\n{statement}0 @F1@ FAM\n1 HUSB @I1@\n1 CHIL @I2@\n"
            ),
        );
        assert_eq!(archive.edges().first().unwrap().status, expected);
    }
}

#[test]
fn death_negation_and_privacy_restrictions_do_not_become_public_deceased_people() {
    let temp = Temp::new();
    let (archive, _) = import_text(
        &temp,
        "0 @I1@ INDI\n1 NAME Not known deceased\n1 DEAT N\n0 @I2@ INDI\n1 NAME Restricted deceased\n1 RESN PRIVACY\n1 DEAT Y\n0 @I3@ INDI\n1 NAME Public deceased\n1 DEAT Y\n",
    );
    let not_dead = archive
        .records
        .iter()
        .find(|r| r.name == "Not known deceased")
        .unwrap();
    assert_ne!(
        not_dead.metadata.get("living"),
        Some(&serde_json::Value::Bool(false))
    );
    let private = archive
        .records
        .iter()
        .find(|r| r.name == "Restricted deceased")
        .unwrap();
    assert_eq!(
        private.metadata.get("private"),
        Some(&serde_json::Value::Bool(true))
    );
    let public = kindred::exchange::public_people(&archive);
    assert_eq!(public.len(), 1);
    assert_eq!(
        archive.record(public.first().unwrap()).unwrap().name,
        "Public deceased"
    );
}

#[test]
fn alternative_names_dates_inline_citations_and_media_have_explicit_loss_reports() {
    let temp = Temp::new();
    let (archive, report) = import_text(
        &temp,
        "0 @I1@ INDI\n1 NAME First /Name/\n1 NAME Alternative /Name/\n1 BIRT\n2 DATE 1800\n3 PHRASE Around 1800\n2 PLAC Somewhere\n3 PHRASE A place phrase must not become a date\n1 BIRT\n2 DATE 1801\n1 OBJE\n2 FILE https://example.invalid/never-download.jpg\n0 @I2@ INDI\n1 NAME Child\n1 FAMC @F1@\n2 PEDI FOSTER\n0 @F1@ FAM\n1 HUSB @I1@\n1 CHIL @I2@\n1 SOUR Oral recollection\n2 TEXT Details\n0 @S1@ SOUR\n1 TITL Registry 1820/1821\n",
    );
    let person = archive
        .records
        .iter()
        .find(|r| r.name == "First Name")
        .unwrap();
    assert_eq!(person.text("birth"), Some("1800"));
    for lost in ["Alternative", "1801", "Around 1800", "never-download.jpg"] {
        assert!(report.contains(lost), "{lost}");
    }
    assert!(report.contains("Registry 1820/1821"));
    assert!(
        !archive
            .records
            .iter()
            .any(|r| r.name == "Registry 1820/1821")
    );
    let child = archive
        .records
        .iter()
        .find(|record| record.kind == "person" && record.name == "Child")
        .unwrap();
    let citation = child
        .metadata
        .get("parents")
        .and_then(serde_json::Value::as_array)
        .and_then(|claims| claims.first())
        .and_then(|claim| claim.get("sources"))
        .and_then(serde_json::Value::as_array)
        .and_then(|sources| sources.first())
        .unwrap();
    assert_eq!(
        citation.get("title").and_then(serde_json::Value::as_str),
        Some("Oral recollection")
    );
    assert_eq!(
        citation.get("note").and_then(serde_json::Value::as_str),
        Some("Details")
    );
    assert_eq!(
        fs::read_dir(temp.0.join("archive/attachments"))
            .unwrap()
            .count(),
        1
    );
}

#[test]
fn kindred_roundtrip_keeps_private_flags_and_exact_accepted_claim_semantics() {
    let temp = Temp::new();
    let (archive, _) = import_text(
        &temp,
        "0 @I1@ INDI\n1 NAME Private parent\n1 RESN CONFIDENTIAL\n1 DEAT Y\n0 @I2@ INDI\n1 NAME Public child\n1 DEAT Y\n1 FAMC @F1@\n2 PEDI FOSTER\n2 STAT PROVEN\n0 @F1@ FAM\n1 HUSB @I1@\n1 CHIL @I2@\n1 RESN PRIVACY\n",
    );
    assert_eq!(archive.edges().first().unwrap().status, "accepted");
    let exported = temp.0.join("exported");
    assert!(
        cli(&[
            "export-gedcom",
            path(&temp.0.join("archive")),
            path(&exported),
            "--all"
        ])
        .status
        .success()
    );
    let imported = temp.0.join("again");
    assert!(
        cli(&[
            "import-gedcom",
            path(&exported.join("family.ged")),
            path(&imported)
        ])
        .status
        .success()
    );
    let result = Archive::load(&imported).unwrap();
    assert_eq!(result.edges().first().unwrap().relation, "foster_parent");
    assert_eq!(result.edges().first().unwrap().status, "accepted");
    assert_eq!(
        result
            .records
            .iter()
            .filter(|r| r.metadata.get("private") == Some(&serde_json::Value::Bool(true)))
            .count(),
        2
    );
}

#[test]
fn malformed_schema_headers_and_conflicting_statuses_do_not_publish() {
    for text in [
        "0 HEAD\n1 SOUR Misleading software\n2 VERS 7.0\n0 TRLR\n",
        "0 HEAD\n1 GEDC\n2 VERS 7.0fake\n0 TRLR\n",
        "0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 NAME Parent\n0 @I2@ INDI\n1 NAME Child\n1 FAMC @F1@\n2 PEDI ADOPTED\n2 STAT PROVEN\n2 STAT DISPROVEN\n0 @F1@ FAM\n1 HUSB @I1@\n1 CHIL @I2@\n0 TRLR\n",
    ] {
        let temp = Temp::new();
        let input = temp.0.join("bad.ged");
        let destination = temp.0.join("out");
        fs::write(&input, text).unwrap();
        assert!(
            !cli(&["import-gedcom", path(&input), path(&destination)])
                .status
                .success()
        );
        assert!(!destination.exists());
    }
}

#[test]
fn missing_reciprocal_family_membership_is_reported() {
    let temp = Temp::new();
    let (archive, report) = import_text(
        &temp,
        "0 @I1@ INDI\n1 NAME Child\n1 FAMC @F1@\n2 PEDI ADOPTED\n0 @F1@ FAM\n",
    );
    assert!(archive.edges().is_empty());
    assert!(report.contains("no reciprocal CHIL"));
}
