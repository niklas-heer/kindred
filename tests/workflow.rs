use std::{
    fs,
    path::Path,
    process::{Command, Output},
};

// Process-launch failures should fail the end-to-end test immediately.
#[allow(clippy::expect_used)]
fn cli(root: &Path, arguments: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_kindred"))
        .current_dir(root)
        .args(arguments)
        .output()
        .expect("CLI should start")
}

#[test]
fn archive_workflow_through_the_cli_preserves_research_and_rebuilds() {
    let temporary = std::env::temp_dir().join(format!("kindred-workflow-{}", std::process::id()));
    fs::create_dir(&temporary).unwrap();
    let initialized = cli(&temporary, &["init", "family"]);
    assert!(
        initialized.status.success(),
        "{}",
        String::from_utf8_lossy(&initialized.stderr)
    );
    let root = temporary.join("family");
    assert!(root.join("people").is_dir());
    assert!(root.join("attachments").is_dir());
    for obsolete in ["relationships", "sources", "events", "places", "media"] {
        assert!(!root.join(obsolete).exists());
    }
    fs::create_dir_all(root.join("families/summer")).unwrap();
    let original = "---\nversion: 1\nid: a\ntype: person\nname: Élise Fiction\nliving: false\nresearch_colour: amber # retain this comment\n---\nOriginal biography with [[people/b]] as a casual mention.\n";
    fs::write(root.join("people/a.md"), original).unwrap();
    fs::write(
        root.join("families/summer/b.md"),
        "---\nversion: 1\nid: b\ntype: person\nname: Bea Fiction\nliving: false\nparents:\n  - id: ab\n    person: '[[people/a]]'\n    relation: adoptive_parent\n    role: mother\n    status: accepted\n    note: Adoption reasoning.\n---\n",
    )
    .unwrap();
    fs::write(root.join("attachments/letter.txt"), "Fictional attachment").unwrap();
    assert!(
        cli(&temporary, &["check", "family", "--json"])
            .status
            .success()
    );
    let before = cli(&temporary, &["ancestors", "family", "b", "--json"]);
    assert!(before.status.success());
    let parsed: serde_json::Value = serde_json::from_slice(&before.stdout).unwrap();
    assert_eq!(parsed["nodes"].as_array().unwrap().len(), 2);
    assert_eq!(parsed["edges"].as_array().unwrap().len(), 1);
    let shown = cli(&temporary, &["show", "family", "a"]);
    assert_eq!(shown.stdout, original.as_bytes());
    fs::write(temporary.join("expected.md"), &shown.stdout).unwrap();
    fs::write(temporary.join("body.md"), "Revised story.\n").unwrap();
    assert!(
        cli(
            &temporary,
            &[
                "edit",
                "family",
                "a",
                "--expected",
                "expected.md",
                "--body",
                "body.md"
            ]
        )
        .status
        .success()
    );
    let edited = fs::read_to_string(root.join("people/a.md")).unwrap();
    assert!(edited.contains("research_colour: amber # retain this comment"));
    assert!(edited.ends_with("Revised story.\n"));
    let conflict = cli(
        &temporary,
        &[
            "edit",
            "family",
            "a",
            "--expected",
            "expected.md",
            "--body",
            "body.md",
        ],
    );
    assert_eq!(conflict.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&conflict.stderr).contains("conflict"));
    assert!(cli(&temporary, &["reindex", "family"]).status.success());
    fs::remove_file(root.join(".kindred/index.json")).unwrap();
    let without_index = cli(&temporary, &["ancestors", "family", "b", "--json"]);
    assert!(cli(&temporary, &["reindex", "family"]).status.success());
    let rebuilt = cli(&temporary, &["ancestors", "family", "b", "--json"]);
    assert_eq!(without_index.stdout, rebuilt.stdout);
    assert!(
        cli(&temporary, &["export", "family", "backup", "--all"])
            .status
            .success()
    );
    assert_eq!(
        fs::read_to_string(temporary.join("backup/people/a.md")).unwrap(),
        edited
    );
    assert_eq!(
        fs::read_to_string(temporary.join("backup/attachments/letter.txt")).unwrap(),
        "Fictional attachment"
    );
    assert!(cli(&temporary, &["check", "backup"]).status.success());
    assert!(cli(&temporary, &["recover", "family"]).status.success());
    fs::remove_dir_all(temporary).unwrap();
}
