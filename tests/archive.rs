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

#[test]
fn parent_roles_are_optional_explicit_claim_metadata_for_each_parent_relation() {
    let fixture = Fixture::new();
    fixture.person("a.md", "a");
    fixture.person("b.md", "b");
    for relation in ["biological_parent", "adoptive_parent", "foster_parent"] {
        for role in ["mother", "father", "parent"] {
            let raw = format!(
                "---\nversion: 1\nid: claim\ntype: relationship\nrelation: {relation}\nparent: '[[a]]'\nchild: '[[b]]'\nparent_role: {role}\nstatus: accepted\n---\nEvidence for the explicitly recorded role.\n"
            );
            fixture.write("claim.md", &raw);
            let archive = fixture.load();
            assert!(archive.diagnostics.is_empty(), "{:?}", archive.diagnostics);
            let claim = archive.record("claim").unwrap();
            assert_eq!(claim.text("parent_role"), Some(role));
            assert_eq!(claim.raw, raw);
            let result = query::ancestors(&archive, "b", &QueryOptions::default()).unwrap();
            assert_eq!(result.edges.len(), 1);
            assert_eq!(result.edges.first().unwrap().relation, relation);
        }
    }
    fixture.edge("claim", "a", "b");
    let archive = fixture.load();
    assert!(archive.diagnostics.is_empty());
    assert!(
        archive
            .record("claim")
            .unwrap()
            .text("parent_role")
            .is_none()
    );
}

#[test]
fn parent_role_rejects_invalid_values_and_nonparent_record_contexts() {
    for value in [
        "grandmother",
        "Mother",
        "''",
        "null",
        "true",
        "42",
        "[mother]",
    ] {
        let raw = format!(
            "---\nversion: 1\nid: claim\ntype: relationship\nrelation: biological_parent\nparent_role: {value}\n---\n"
        );
        assert!(
            validate_text("claim.md", &raw)
                .unwrap_err()
                .contains("parent_role"),
            "{value}"
        );
    }
    for kind in ["person", "source", "event", "place", "media"] {
        let raw = format!("---\nversion: 1\nid: note\ntype: {kind}\nparent_role: mother\n---\n");
        assert!(
            validate_text("note.md", &raw)
                .unwrap_err()
                .contains("only allowed"),
            "{kind}"
        );
    }
    for relation in ["partner", "unknown"] {
        let raw = format!(
            "---\nversion: 1\nid: claim\ntype: relationship\nrelation: {relation}\nparent_role: father\n---\n"
        );
        assert!(
            validate_text("claim.md", &raw)
                .unwrap_err()
                .contains("only allowed"),
            "{relation}"
        );
    }
}

#[test]
fn occupation_and_story_conventions_preserve_authored_content() {
    for occupation in ["Royal gardener", "[Royal gardener, Weaver]"] {
        let raw = format!(
            "---\nversion: 1\nid: mira\ntype: person\nname: Mira Linden\noccupation: {occupation}\n---\n\n## Story\nA fictional gardener’s life.\n\n## Research notes\nThe role remains unverified.\n"
        );
        let record = validate_text("mira.md", &raw).unwrap();
        assert_eq!(record.raw, raw);
        assert!(
            record
                .body
                .contains("## Story\nA fictional gardener’s life.")
        );
        assert!(
            record
                .body
                .contains("## Research notes\nThe role remains unverified.")
        );
        assert!(record.metadata.contains_key("occupation"));
        assert!(!record.metadata.contains_key("parent_role"));
    }
}

#[test]
fn portrait_resolves_only_an_explicit_media_record_with_a_local_file() {
    let fixture = Fixture::new();
    let person = "---\nversion: 1\nid: mira\ntype: person\nname: Mira Linden\nportrait: '[[media/mira|Portrait of Mira]]'\n---\nFictional biography.\n";
    fixture.write("people/mira.md", person);
    fixture.write("media/mira.md", "---\nversion: 1\nid: mira_portrait\ntype: media\nfile: attachments/portrait.txt\ncredit: Fictional test drawing\n---\nA local file used to test media resolution.\n");
    fixture.write(
        "attachments/portrait.txt",
        "Fictional image placeholder; image MIME rendering is a viewer concern.",
    );
    let archive = fixture.load();
    assert!(archive.diagnostics.is_empty(), "{:?}", archive.diagnostics);
    let mira = archive.record("mira").unwrap();
    assert_eq!(mira.raw, person);
    let media = archive
        .resolve_link(mira.text("portrait").unwrap())
        .unwrap();
    assert_eq!(media.id, "mira_portrait");
    assert_eq!(media.text("credit"), Some("Fictional test drawing"));
    assert!(archive.attachment(media.text("file").unwrap()).is_ok());
    assert!(archive.edges().is_empty());
}

#[test]
fn portrait_rejects_remote_urls_lists_wrong_record_kinds_and_missing_files() {
    for value in [
        "'https://example.invalid/portrait.jpg'",
        "['[[media/mira]]']",
        "null",
        "true",
    ] {
        let raw = format!("---\nversion: 1\nid: mira\ntype: person\nportrait: {value}\n---\n");
        assert!(
            validate_text("mira.md", &raw)
                .unwrap_err()
                .contains("portrait")
        );
    }
    for kind in ["relationship", "source", "event", "place", "media"] {
        let raw =
            format!("---\nversion: 1\nid: note\ntype: {kind}\nportrait: '[[media/mira]]'\n---\n");
        assert!(
            validate_text("note.md", &raw)
                .unwrap_err()
                .contains("only allowed")
        );
    }
    let fixture = Fixture::new();
    fixture.write(
        "mira.md",
        "---\nversion: 1\nid: mira\ntype: person\nportrait: '[[portrait]]'\n---\n",
    );
    assert!(
        fixture
            .load()
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.message.contains("missing link"))
    );
    fixture.person("portrait.md", "portrait");
    assert!(
        fixture
            .load()
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "invalid_portrait")
    );
    fixture.write(
        "portrait.md",
        "---\nversion: 1\nid: portrait\ntype: media\n---\n",
    );
    assert!(
        fixture
            .load()
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "invalid_portrait")
    );
    fixture.write(
        "portrait.md",
        "---\nversion: 1\nid: portrait\ntype: media\nfile: '[[mira]]'\n---\n",
    );
    assert!(
        fixture
            .load()
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "invalid_portrait")
    );
    fixture.write(
        "portrait.md",
        "---\nversion: 1\nid: portrait\ntype: media\nfile: attachments/missing.jpg\n---\n",
    );
    assert!(
        fixture
            .load()
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "invalid_attachment")
    );
}

#[test]
fn person_notes_in_user_chosen_folders_project_sourced_claims_events_and_places() {
    let fixture = Fixture::new();
    fixture.person("Our notes/Änne.md", "anne");
    fixture.person("Research/Robin.md", "robin");
    fixture.write("attachments/register.txt", "Fictional evidence");
    fixture.write(
        "attachments/portrait.txt",
        "Local fictional portrait placeholder",
    );
    let raw = "---\nversion: 1\nid: child\ntype: person\nname: Elin\nborn: about 1900\nbirth_place: {id: village, name: Lindenby, latitude: 54.5}\nmother: '[[Our notes/Änne]]'\nparents:\n  - id: adoptive_claim\n    person: '[[Research/Robin]]'\n    relation: adoptive_parent\n    role: father\n    status: disputed\n    sources: [{id: register}]\n    note: Two incompatible readings remain.\nsources:\n  - id: register\n    title: Village register\n    attachments: [attachments/register.txt]\nevents:\n  - id: household_event\n    type: residence\n    date: about 1905\n    people: ['[[Research/Robin]]', '[[Elin]]']\n    place: {id: village, name: Lindenby, latitude: 54.5}\n    sources: [{id: register}]\nportrait: attachments/portrait.txt\nportrait_credit: Fictional artist\nunknown:\n  nested: [one, {two: preserved}]\n---\n\n## Story\nA casual [[Research/Robin]] mention adds no additional claim.\n";
    fixture.write("Elin.md", raw);
    let archive = fixture.load();
    assert!(archive.diagnostics.is_empty(), "{:?}", archive.diagnostics);
    assert_eq!(
        archive
            .records
            .iter()
            .filter(|record| record.owner.is_none())
            .count(),
        3
    );
    assert_eq!(archive.edges().len(), 2);
    assert_eq!(archive.record("child").unwrap().raw, raw);
    assert!(
        archive
            .record("child")
            .unwrap()
            .metadata
            .get("unknown")
            .unwrap()
            .is_object()
    );
    let claim = archive.record("adoptive_claim").unwrap();
    assert_eq!(claim.owner.as_deref(), Some("child"));
    assert!(claim.raw.is_empty() && claim.path.is_empty());
    assert_eq!(claim.text("parent_role"), Some("father"));
    assert_eq!(claim.body, "Two incompatible readings remain.");
    assert_eq!(
        archive
            .edges()
            .iter()
            .find(|edge| edge.id == "adoptive_claim")
            .unwrap()
            .sources,
        vec!["register"]
    );
    let ancestors = query::ancestors(&archive, "child", &QueryOptions::default()).unwrap();
    assert_eq!(ancestors.edges.len(), 1);
    assert_eq!(ancestors.edges.first().unwrap().from, "anne");
    let event = archive.record("household_event").unwrap();
    assert_eq!(event.links("people"), vec!["child", "robin"]);
    assert_eq!(event.text("place"), Some("village"));
    assert_eq!(
        archive.record("derived:child:birth").unwrap().text("date"),
        Some("about 1900")
    );
    assert!(archive.resolve_link("[[adoptive_claim]]").is_err());
    assert!(archive.resolve_link("[[register]]").is_err());
}

#[test]
fn projection_ids_survive_claim_order_and_filename_changes_and_source_title_edits() {
    let fixture = Fixture::new();
    fixture.person("a.md", "a");
    fixture.person("b.md", "b");
    let first = "---\nversion: 1\nid: child\ntype: person\nparents:\n  - {person: '[[a]]'}\n  - {person: '[[b]]', relation: foster_parent}\nsources: [{url: 'https://example.invalid/register', title: Original title}]\n---\n";
    fixture.write("child.md", first);
    let before = fixture.load();
    assert!(before.diagnostics.is_empty());
    let mut before_ids: Vec<_> = before
        .records
        .iter()
        .filter(|record| record.owner.is_some())
        .map(|record| record.id.clone())
        .collect();
    before_ids.sort();
    let second = first
        .replace(
            "  - {person: '[[a]]'}\n  - {person: '[[b]]', relation: foster_parent}",
            "  - {person: '[[b]]', relation: foster_parent}\n  - {person: '[[renamed]]'}",
        )
        .replace("Original title", "Corrected title");
    fs::rename(fixture.0.join("a.md"), fixture.0.join("renamed.md")).unwrap();
    fixture.write("child.md", &second);
    let after = fixture.load();
    assert!(after.diagnostics.is_empty(), "{:?}", after.diagnostics);
    let mut after_ids: Vec<_> = after
        .records
        .iter()
        .filter(|record| record.owner.is_some())
        .map(|record| record.id.clone())
        .collect();
    after_ids.sort();
    assert_eq!(before_ids, after_ids);
    assert_eq!(
        after
            .records
            .iter()
            .find(|record| record.kind == "source")
            .unwrap()
            .name,
        "Corrected title"
    );
}

#[test]
fn repeated_inline_citations_coalesce_and_conflicts_are_reported_on_the_owner() {
    let fixture = Fixture::new();
    let note = "---\nversion: 1\nid: a\ntype: person\nsources: [{id: shared, url: 'https://example.invalid/portrait', title: Catalogue}]\nportrait_source: https://example.invalid/portrait\n---\n";
    fixture.write("a.md", note);
    fixture.write("b.md", &note.replace("id: a", "id: b"));
    let archive = fixture.load();
    assert!(archive.diagnostics.is_empty(), "{:?}", archive.diagnostics);
    assert_eq!(
        archive
            .records
            .iter()
            .filter(|record| record.kind == "source")
            .count(),
        1
    );
    assert_eq!(
        archive.record("shared").unwrap().owner.as_deref(),
        Some("a")
    );
    fixture.write(
        "b.md",
        &note
            .replace("id: a", "id: b")
            .replace("Catalogue", "Different catalogue"),
    );
    assert!(fixture.load().diagnostics.iter().any(|diagnostic| {
        diagnostic.path == "b.md"
            && diagnostic
                .message
                .contains("conflicting derived record ID shared")
    }));
}

#[test]
fn invalid_person_metadata_does_not_silently_infer_claims_or_ignore_missing_attachments() {
    let fixture = Fixture::new();
    fixture.person("a.md", "a");
    for field in [
        "mother: '[[missing]]'",
        "mother: {person: '[[a]]', role: father}",
        "parents: [{person: '[[a]]', role: mother, parent_role: father}]",
        "parents: [{person: '[[a]]', status: perhaps}]",
        "parents: [{person: '[[a]]', role: grandmother}]",
        "partners: [{person: '[[a]]', parent_role: father}]",
        "sources: [{title: Register, attachments: [missing.txt]}]",
        "events: [{people: ['[[missing]]']}]",
        "born: '1900'\nbirth: '1901'",
    ] {
        fixture.write(
            "child.md",
            &format!("---\nversion: 1\nid: child\ntype: person\n{field}\n---\n"),
        );
        let archive = fixture.load();
        assert!(
            archive
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.path == "child.md"),
            "{field}"
        );
        assert!(query::ancestors(&archive, "child", &QueryOptions::default()).is_err());
    }
}

#[test]
fn legacy_notes_and_inline_claims_share_queries_without_prose_inference() {
    let fixture = Fixture::new();
    fixture.person("a.md", "a");
    fixture.person("b.md", "b");
    fixture.edge("legacy", "a", "b");
    fixture.write("c.md", "---\nversion: 1\nid: c\ntype: person\nfather: '[[b]]'\n---\nA story mentions [[a]], but only father is asserted.\n");
    let archive = fixture.load();
    assert!(archive.diagnostics.is_empty());
    assert_eq!(archive.edges().len(), 2);
    let result = query::ancestors(&archive, "c", &QueryOptions::default()).unwrap();
    assert_eq!(result.nodes.len(), 3);
    assert_eq!(result.edges.len(), 2);
    assert!(archive.record("legacy").unwrap().owner.is_none());
}

#[test]
fn inline_source_references_resolve_definitions_independently_of_person_and_list_order() {
    let fixture = Fixture::new();
    fixture.write("a.md", "---\nversion: 1\nid: a\ntype: person\nsources: [{id: shared}]\nportrait_source: https://example.invalid/catalogue\n---\n");
    fixture.write("z.md", "---\nversion: 1\nid: z\ntype: person\nsources: [{id: shared}, {id: shared, title: Register, url: 'https://example.invalid/catalogue'}]\n---\n");
    let archive = fixture.load();
    assert!(archive.diagnostics.is_empty(), "{:?}", archive.diagnostics);
    assert_eq!(
        archive
            .records
            .iter()
            .filter(|record| record.kind == "source")
            .count(),
        1
    );
    assert_eq!(archive.record("shared").unwrap().name, "Register");
    assert_eq!(
        archive.record("shared").unwrap().owner.as_deref(),
        Some("z")
    );
    fixture.write(
        "z.md",
        "---\nversion: 1\nid: z\ntype: person\nsources: [{id: undefined}]\n---\n",
    );
    assert!(
        fixture
            .load()
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.message.contains("undefined citation ID"))
    );
}

#[test]
fn inline_sources_reject_invalid_recognized_shapes() {
    let fixture = Fixture::new();
    for fields in [
        "title: Register, attachments: false",
        "title: Register, attachments: [false]",
        "title: Register, living: 'false'",
        "title: Register, private: 'true'",
        "name: [wrong], title: Register",
    ] {
        fixture.write(
            "a.md",
            &format!(
                "---\nversion: 1\nid: a\ntype: person\nsources: [{{id: source, {fields}}}]\n---\n"
            ),
        );
        assert!(
            fixture
                .load()
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.path == "a.md"),
            "{fields}"
        );
    }
}
