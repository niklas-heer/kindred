use kindred::{
    archive::{Archive, validate_text},
    query::{self, QueryOptions},
};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicUsize, Ordering},
};
static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Fixture(PathBuf);
// Fixture setup failures should fail tests immediately.
#[allow(clippy::unwrap_used)]
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "kindred-core-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn write(&self, path: &str, text: &str) {
        let path = self.0.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
    fn person(&self, path: &str, id: &str) {
        self.write(
            path,
            &format!("---\nversion: 1\nid: {id}\ntype: person\nname: {id}\n---\n"),
        );
    }
    fn edge(&self, id: &str, from: &str, to: &str) {
        self.write(&format!("{id}.md"),&format!("---\nversion: 1\nid: {id}\ntype: relationship\nrelation: biological_parent\nparent: '[[{from}]]'\nchild: '[[{to}]]'\nstatus: accepted\n---\n"));
    }
    fn load(&self) -> Archive {
        Archive::load(&self.0).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
#[allow(clippy::unwrap_used)]
fn demo() -> Archive {
    Archive::load(Path::new("examples/fictional")).unwrap()
}

#[test]
fn fictional_archive_preserves_uncertain_dates_unknown_properties_and_prose() {
    let archive = demo();
    assert!(archive.diagnostics.is_empty(), "{:?}", archive.diagnostics);
    let mira = archive.record("mira").unwrap();
    assert_eq!(mira.text("birth"), Some("about 1820"));
    assert_eq!(mira.text("research_colour"), Some("amber"));
    assert!(mira.body.contains("casual mention"));
    let result = query::ancestors(&archive, "lea", &QueryOptions::default()).unwrap();
    assert_eq!(
        result
            .nodes
            .iter()
            .map(|n| n.id.as_str())
            .collect::<Vec<_>>(),
        vec!["lea", "mira"]
    );
    assert!(!result.nodes.iter().any(|n| n.id == "tove"));
    assert_eq!(result.edges.first().unwrap().sources, vec!["register"]);
}
#[test]
fn filters_keep_disputed_claims_out_until_requested() {
    let archive = demo();
    let mut options = QueryOptions::default();
    let accepted = query::ancestors(&archive, "nils", &options).unwrap();
    assert!(!accepted.nodes.iter().any(|n| n.id == "otto"));
    options.statuses = vec!["accepted".into(), "disputed".into()];
    let disputed = query::ancestors(&archive, "nils", &options).unwrap();
    assert!(disputed.edges.iter().any(|e| e.status == "disputed"));
    options.relations = vec!["adoptive_parent".into()];
    let adopted = query::ancestors(&archive, "noa", &options).unwrap();
    assert_eq!(adopted.nodes.len(), 2);
    assert_eq!(adopted.edges.first().unwrap().from, "tove");
}
#[test]
fn shared_ancestors_remain_unique_and_generation_zero_is_just_focus() {
    let archive = demo();
    let mut options = QueryOptions::default();
    let result = query::ancestors(&archive, "noa", &options).unwrap();
    assert_eq!(result.nodes.iter().filter(|r| r.id == "mira").count(), 1);
    assert_eq!(result.edges.iter().filter(|r| r.from == "mira").count(), 2);
    options.generations = 0;
    assert_eq!(
        query::ancestors(&archive, "noa", &options)
            .unwrap()
            .nodes
            .len(),
        1
    );
    options.generations = 1;
    assert_eq!(
        query::ancestors(&archive, "noa", &options)
            .unwrap()
            .nodes
            .len(),
        4
    );
}
#[test]
fn shortest_mixed_path_retains_claims_and_is_bounded() {
    let archive = demo();
    let mut options = QueryOptions::default();
    let result = query::path(&archive, "tove", "ida", &options).unwrap();
    assert_eq!(result.edges.len(), 2);
    assert!(result.edges.iter().any(|e| e.relation == "adoptive_parent"));
    options.generations = 1;
    assert!(query::path(&archive, "tove", "ida", &options).is_err());
    assert!(query::path(&archive, "missing", "ida", &options).is_err());
    assert!(query::path(&archive, "register", "ida", &options).is_err());
}
#[test]
fn cycles_terminate_without_losing_a_claim() {
    let fixture = Fixture::new();
    for id in ["a", "b", "c"] {
        fixture.person(&format!("{id}.md"), id);
    }
    fixture.edge("ab", "a", "b");
    fixture.edge("bc", "b", "c");
    fixture.edge("ca", "c", "a");
    let archive = fixture.load();
    assert!(archive.diagnostics.is_empty());
    let options = QueryOptions {
        generations: usize::MAX,
        ..QueryOptions::default()
    };
    let result = query::descendants(&archive, "a", &options).unwrap();
    assert_eq!(result.nodes.len(), 3);
    assert_eq!(result.edges.len(), 3);
}
#[test]
fn duplicate_ids_and_missing_or_ambiguous_links_are_diagnostics() {
    let fixture = Fixture::new();
    fixture.person("one/a.md", "a");
    fixture.person("two/a.md", "duplicate");
    fixture.person("b.md", "a");
    fixture.edge("ab", "a", "missing");
    let archive = fixture.load();
    assert!(archive.diagnostics.iter().any(|d| d.code == "duplicate_id"));
    assert!(
        archive
            .diagnostics
            .iter()
            .any(|d| d.message.contains("ambiguous"))
    );
    assert!(
        archive
            .diagnostics
            .iter()
            .any(|d| d.message.contains("missing"))
    );
    assert!(archive.record("a").is_none());
    assert!(query::ancestors(&archive, "duplicate", &QueryOptions::default()).is_err());
    assert!(archive.reindex().is_err());
}
#[test]
fn external_rename_is_not_silently_repaired_by_stable_id() {
    let fixture = Fixture::new();
    fixture.person("a.md", "stable-a");
    fixture.person("b.md", "stable-b");
    fixture.edge("ab", "a", "b");
    assert!(fixture.load().diagnostics.is_empty());
    fs::rename(fixture.0.join("a.md"), fixture.0.join("renamed.md")).unwrap();
    assert!(
        fixture
            .load()
            .diagnostics
            .iter()
            .any(|d| d.message.contains("missing link"))
    );
}
#[test]
fn malformed_records_do_not_hide_other_validation_errors() {
    let fixture = Fixture::new();
    fixture.write("broken.md", "---\nversion: 1\nid: [\n---\n");
    fixture.write("unclosed.md", "---\nversion: 1\n");
    fixture.write(
        "ordinary.md",
        "A note without frontmatter mentions [[missing]].\n",
    );
    fixture.write("obsidian.md", "---\ntags: [research]\n---\n");
    let archive = fixture.load();
    assert_eq!(archive.diagnostics.len(), 2);
    assert!(archive.records.is_empty());
}
#[test]
fn source_fields_require_actual_source_links() {
    let fixture = Fixture::new();
    fixture.person("a.md", "a");
    fixture.write(
        "event.md",
        "---\nversion: 1\nid: event\ntype: event\nsources: ['[[a]]', 'not a link']\n---\n",
    );
    let archive = fixture.load();
    assert!(
        archive
            .diagnostics
            .iter()
            .any(|d| d.code == "invalid_source")
    );
    assert!(
        archive
            .diagnostics
            .iter()
            .any(|d| d.message.contains("expected quoted wiki link"))
    );
}
#[test]
fn index_is_disposable_and_external_changes_take_effect() {
    let fixture = Fixture::new();
    fixture.person("a.md", "a");
    let archive = fixture.load();
    let index = archive.reindex().unwrap();
    let original = fs::read(&index).unwrap();
    fs::remove_file(&index).unwrap();
    archive.reindex().unwrap();
    assert_eq!(fs::read(&index).unwrap(), original);
    fs::write(&index, "broken index").unwrap();
    assert_eq!(fixture.load().records.len(), 1);
    fixture.person("b.md", "b");
    assert_eq!(fixture.load().records.len(), 2);
    fixture.load().reindex().unwrap();
    assert!(serde_json::from_slice::<serde_json::Value>(&fs::read(index).unwrap()).is_ok());
}
#[test]
fn crlf_and_markdown_body_are_retained_exactly() {
    let raw = "---\r\nversion: 1\r\nid: person\r\ntype: person\r\nname: Zoë\r\n---\r\n\r\n# Biography\r\n\r\n---\r\n";
    let record = validate_text("person.md", raw).unwrap();
    assert_eq!(record.raw, raw);
    assert_eq!(record.body, "\r\n# Biography\r\n\r\n---\r\n");
    assert_eq!(record.name, "Zoë");
}

#[test]
fn attachments_are_local_existing_files_and_event_links_are_typed() {
    let fixture = Fixture::new();
    fixture.person("a.md", "a");
    fixture.write("source.md", "---\nversion: 1\nid: source\ntype: source\nattachments: [../secret.txt, missing.txt]\n---\n");
    fixture.write(
        "event.md",
        "---\nversion: 1\nid: event\ntype: event\nplace: '[[a]]'\npeople: ['[[source]]']\n---\n",
    );
    let archive = fixture.load();
    assert_eq!(
        archive
            .diagnostics
            .iter()
            .filter(|d| d.code == "invalid_attachment")
            .count(),
        2
    );
    assert_eq!(
        archive
            .diagnostics
            .iter()
            .filter(|d| d.code == "invalid_link_type")
            .count(),
        2
    );
}

#[test]
fn duplicate_yaml_keys_are_rejected() {
    assert!(
        validate_text(
            "person.md",
            "---\nversion: 1\nid: a\nid: b\ntype: person\n---\n"
        )
        .is_err()
    );
}
