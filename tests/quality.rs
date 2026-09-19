use kindred::{archive::Archive, quality};
use std::{fs, path::PathBuf, process::Command};

struct Fixture(PathBuf);

// Fixture setup failures should fail tests immediately.
#[allow(clippy::expect_used)]
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "kindred-quality-{}-{}",
            std::process::id(),
            std::thread::current().name().unwrap_or("test")
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("fixture should be created");
        Self(root)
    }

    fn write(&self, name: &str, contents: &str) {
        fs::write(self.0.join(name), contents).expect("fixture note should be written");
    }

    fn load(&self) -> Archive {
        Archive::load(&self.0).expect("fixture should load")
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn person(id: &str, extra: &str) -> String {
    format!("---\nversion: 1\nid: {id}\ntype: person\n{extra}---\n")
}

#[test]
fn warns_about_actionable_omissions_without_invalidating_the_archive() {
    let fixture = Fixture::new();
    fixture.write("unknown.md", &person("unknown", ""));

    let archive = fixture.load();
    assert!(archive.diagnostics.is_empty());
    let warnings = quality::warnings(&archive);
    let codes: Vec<_> = warnings
        .iter()
        .map(|warning| warning.code.as_str())
        .collect();
    assert_eq!(
        codes,
        vec![
            "missing_life_dates",
            "missing_name",
            "missing_parentage",
            "missing_sources"
        ]
    );

    let output = Command::new(env!("CARGO_BIN_EXE_kindred"))
        .args(["check", fixture.0.to_str().expect("UTF-8 fixture path")])
        .output()
        .expect("kindred check should run");
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("Valid archive: 1 records"));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("Research warnings:"));
    assert!(stderr.contains("missing_life_dates"));
}

#[test]
fn groups_unsourced_claims_and_does_not_repeat_a_general_source_warning() {
    let fixture = Fixture::new();
    fixture.write(
        "parent.md",
        &person(
            "parent",
            "name: Parent\nborn: '1970'\nsources: [https://example.test/parent]\n",
        ),
    );
    fixture.write(
        "child.md",
        &person(
            "child",
            "name: Child\nborn: '2000'\nmother: '[[parent]]'\nfather: '[[parent]]'\n",
        ),
    );

    let warnings = quality::warnings(&fixture.load());
    let child_warnings: Vec<_> = warnings
        .iter()
        .filter(|warning| warning.path == "child.md")
        .collect();
    assert_eq!(child_warnings.len(), 1);
    assert_eq!(child_warnings[0].code, "missing_claim_sources");
    assert!(child_warnings[0].message.contains("2 relationship claims"));
}

#[test]
fn explicit_empty_inline_and_legacy_parentage_suppress_the_omission_warning() {
    let fixture = Fixture::new();
    fixture.write(
        "parent.md",
        &person(
            "parent",
            "name: Parent\nborn: '1970'\nparents: []\nsources: [https://example.test/parent]\n",
        ),
    );
    fixture.write(
        "inline-child.md",
        &person(
            "inline-child",
            "name: Inline Child\nborn: '2000'\nmother: '[[parent]]'\n",
        ),
    );
    fixture.write(
        "legacy-child.md",
        &person("legacy-child", "name: Legacy Child\nborn: '2001'\n"),
    );
    fixture.write(
        "legacy-claim.md",
        "---\nversion: 1\nid: legacy-claim\ntype: relationship\nrelation: biological_parent\nparent: '[[parent]]'\nchild: '[[legacy-child]]'\nstatus: disputed\n---\n",
    );

    let warnings = quality::warnings(&fixture.load());
    for path in ["parent.md", "inline-child.md", "legacy-child.md"] {
        assert!(
            warnings
                .iter()
                .all(|warning| { warning.path != path || warning.code != "missing_parentage" })
        );
    }
}

#[test]
fn warns_only_for_definite_exact_year_chronology_conflicts() {
    let fixture = Fixture::new();
    fixture.write(
        "parent.md",
        &person(
            "parent",
            "name: Parent\nborn: '2001'\ndied: '2003'\nsources: [https://example.test/parent]\n",
        ),
    );
    fixture.write(
        "child.md",
        &person(
            "child",
            "name: Child\nborn: '2000'\nparents:\n  - person: '[[parent]]'\n    status: accepted\n    sources: [https://example.test/claim]\n",
        ),
    );

    let warnings = quality::warnings(&fixture.load());
    assert!(
        warnings
            .iter()
            .any(|warning| warning.code == "parent_born_after_child")
    );

    fixture.write(
        "parent.md",
        &person(
            "parent",
            "name: Parent\nborn: 'about 2001'\ndied: 'before 1990'\nsources: [https://example.test/parent]\n",
        ),
    );
    let warnings = quality::warnings(&fixture.load());
    assert!(warnings.iter().all(|warning| {
        warning.code != "parent_born_after_child"
            && warning.code != "parent_died_before_child_birth"
    }));
}

#[test]
fn cli_checks_parent_death_without_requiring_a_parent_birth_date() {
    let fixture = Fixture::new();
    fixture.write(
        "parent.md",
        &person(
            "parent",
            "name: Parent\ndied: '1990'\nsources: [https://example.test/parent]\n",
        ),
    );
    fixture.write(
        "child.md",
        &person(
            "child",
            "name: Child\nborn: '2000'\nparents:\n  - person: '[[parent]]'\n    status: accepted\n    sources: [https://example.test/claim]\n",
        ),
    );

    let output = Command::new(env!("CARGO_BIN_EXE_kindred"))
        .args([
            "check",
            fixture.0.to_str().expect("UTF-8 fixture path"),
            "--json",
        ])
        .output()
        .expect("kindred check should run");
    assert!(output.status.success());
    let report: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("check should emit JSON");
    assert!(report["warnings"].as_array().is_some_and(|warnings| {
        warnings
            .iter()
            .any(|warning| warning["code"] == "parent_died_before_child_birth")
    }));

    fixture.write(
        "parent.md",
        &person(
            "parent",
            "name: Parent\ndied: 'before 1990'\nsources: [https://example.test/parent]\n",
        ),
    );
    let output = Command::new(env!("CARGO_BIN_EXE_kindred"))
        .args([
            "check",
            fixture.0.to_str().expect("UTF-8 fixture path"),
            "--json",
        ])
        .output()
        .expect("kindred check should run");
    let report: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("check should emit JSON");
    assert!(report["warnings"].as_array().is_some_and(|warnings| {
        warnings
            .iter()
            .all(|warning| warning["code"] != "parent_died_before_child_birth")
    }));
}

#[test]
fn json_keeps_errors_and_warnings_in_separate_stable_fields() {
    let fixture = Fixture::new();
    fixture.write(
        "person.md",
        &person("person", "name: Person\nborn: '2000'\n"),
    );
    let output = Command::new(env!("CARGO_BIN_EXE_kindred"))
        .args([
            "check",
            fixture.0.to_str().expect("UTF-8 fixture path"),
            "--json",
        ])
        .output()
        .expect("kindred check should run");
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let report: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("check should emit JSON");
    assert_eq!(report["diagnostics"], serde_json::json!([]));
    assert!(report["warnings"].as_array().is_some_and(|warnings| {
        warnings
            .iter()
            .any(|warning| warning["code"] == "missing_sources")
    }));
}

#[test]
fn hard_errors_keep_a_failing_exit_status_alongside_warnings() {
    let fixture = Fixture::new();
    fixture.write("person.md", &person("person", "name: Person\nborn: 2000\n"));
    fixture.write(
        "broken.md",
        "---\nversion: 1\nid: broken\ntype: unsupported\n---\n",
    );
    let text_output = Command::new(env!("CARGO_BIN_EXE_kindred"))
        .args(["check", fixture.0.to_str().expect("UTF-8 fixture path")])
        .output()
        .expect("kindred check should run");
    assert_eq!(text_output.status.code(), Some(1));
    assert!(!String::from_utf8_lossy(&text_output.stdout).contains("Valid archive"));
    let stderr = String::from_utf8_lossy(&text_output.stderr);
    assert!(stderr.contains("Errors:"));
    assert!(stderr.contains("Research warnings:"));

    let output = Command::new(env!("CARGO_BIN_EXE_kindred"))
        .args([
            "check",
            fixture.0.to_str().expect("UTF-8 fixture path"),
            "--json",
        ])
        .output()
        .expect("kindred check should run");
    assert_eq!(output.status.code(), Some(1));
    let report: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("check should emit JSON");
    assert_eq!(report["diagnostics"][0]["code"], "invalid_record");
    assert!(report["warnings"].as_array().is_some_and(|warnings| {
        warnings
            .iter()
            .any(|warning| warning["code"] == "missing_sources")
    }));
}
