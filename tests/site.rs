// Fixture helpers fail fast on setup errors; clippy.toml relaxes expect only inside #[test] bodies.
#![allow(clippy::expect_used)]

use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::atomic::{AtomicUsize, Ordering},
};

static NEXT: AtomicUsize = AtomicUsize::new(0);
const TODAY: &str = "2026-10-30";

/// Fictional archive plus a publication directory beside it.
struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "kindred-site-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(path.join("archive")).expect("fixture should be created");
        Self(path)
    }

    fn root(&self) -> PathBuf {
        self.0.join("archive")
    }

    fn target(&self) -> PathBuf {
        self.0.join("site")
    }

    fn write(&self, path: &str, contents: &[u8]) {
        let path = self.root().join(path);
        fs::create_dir_all(path.parent().expect("fixture path has a parent"))
            .expect("fixture directory should be created");
        fs::write(path, contents).expect("fixture file should be written");
    }

    /// A person note; `properties` are extra frontmatter lines, `body` is the story.
    fn person(&self, id: &str, name: &str, properties: &str, body: &str) {
        self.write(
            &format!("people/{id}.md"),
            format!(
                "---\nversion: 1\nid: {id}\ntype: person\nname: \"{name}\"\n{properties}---\n\n{body}\n"
            )
            .as_bytes(),
        );
    }

    fn kindred(&self, target: &Path, extra: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_kindred"))
            .arg("site")
            .arg(self.root())
            .arg(target)
            .args(extra)
            .output()
            .expect("CLI should start")
    }

    fn build(&self, extra: &[&str]) -> Output {
        self.kindred(&self.target(), extra)
    }

    /// Build with the fixed reference date and parse the published graph.
    fn graph(&self) -> Value {
        let output = self.build(&["--today", TODAY]);
        assert_success(&output);
        let text = fs::read_to_string(self.target().join("graph.json"))
            .expect("graph.json should be written");
        serde_json::from_str(&text).expect("graph.json should parse")
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn assert_success(output: &Output) {
    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn record<'a>(graph: &'a Value, id: &str) -> Option<&'a Value> {
    graph["records"]
        .as_array()?
        .iter()
        .find(|record| record["id"] == id)
}

/// Every edge endpoint, source, and record owner must name a record in the same file.
fn assert_references_resolve(graph: &Value) {
    let ids: Vec<&str> = graph["records"]
        .as_array()
        .expect("records should be a list")
        .iter()
        .filter_map(|record| record["id"].as_str())
        .collect();
    for edge in graph["edges"].as_array().expect("edges should be a list") {
        for endpoint in ["from", "to"] {
            let id = edge[endpoint].as_str().expect("edge endpoint");
            assert!(ids.contains(&id), "dangling {endpoint}: {id}");
        }
        for source in edge["sources"].as_array().expect("edge sources") {
            let id = source.as_str().expect("source ID");
            assert!(ids.contains(&id), "dangling source: {id}");
        }
    }
    for record in graph["records"].as_array().expect("records") {
        if let Some(owner) = record["owner"].as_str() {
            assert!(ids.contains(&owner), "dangling owner: {owner}");
        }
    }
}

#[test]
fn writes_viewer_assets_and_escaped_settings() {
    let fixture = Fixture::new();
    fixture.person(
        "ada",
        "Ada Linde",
        "born: \"1950-03-04\"\nliving: false\n",
        "Ada kept the orchard.",
    );
    let output = fixture.build(&[
        "--view",
        "simple",
        "--suggest-url",
        "/help?a=1&b=2",
        "--today",
        TODAY,
    ]);
    assert_success(&output);
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/web");
    for name in [
        "app.css",
        "family.js",
        "layout.js",
        "i18n.js",
        "query.js",
        "app.js",
        "icons.svg",
    ] {
        assert_eq!(
            fs::read(fixture.target().join(name)).expect("asset should be written"),
            fs::read(source.join(name)).expect("source asset should exist"),
            "{name} should match the embedded asset"
        );
    }
    let index = fs::read_to_string(fixture.target().join("index.html"))
        .expect("index.html should be written");
    assert!(index.contains(
        "<meta name=\"kindred-site\" content=\"{&quot;view&quot;:&quot;simple&quot;,&quot;suggest&quot;:&quot;/help?a=1&amp;b=2&quot;}\">"
    ));
    assert!(index.contains("<meta http-equiv=\"Content-Security-Policy\""));
    assert!(index.contains("default-src 'none'"));
    assert!(index.contains("Family relationship graph"));
    assert!(index.find("kindred-site") < index.find("</head>"));

    let defaults = Fixture::new();
    defaults.person("ada", "Ada Linde", "living: false\n", "Story.");
    assert_success(&defaults.build(&["--today", TODAY]));
    let index = fs::read_to_string(defaults.target().join("index.html"))
        .expect("index.html should be written");
    assert!(
        index.contains(
            "content=\"{&quot;view&quot;:&quot;research&quot;,&quot;suggest&quot;:null}\""
        )
    );
}

#[test]
fn refuses_existing_target_without_touching_it() {
    let fixture = Fixture::new();
    fixture.person("ada", "Ada Linde", "living: false\n", "Story.");
    fs::create_dir(fixture.target()).expect("existing target should be created");
    fs::write(fixture.target().join("valuable.txt"), "keep").expect("file should be written");
    let output = fixture.build(&[]);
    assert_eq!(output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&output.stderr).contains("destination already exists"));
    assert_eq!(
        fs::read_to_string(fixture.target().join("valuable.txt")).expect("file should remain"),
        "keep"
    );
    assert!(!fixture.0.join(".site.kindred-staging").exists());
}

#[test]
fn invalid_archive_publishes_nothing() {
    let fixture = Fixture::new();
    fixture.person("ada", "Ada Linde", "living: false\n", "Story.");
    fixture.write(
        "people/broken.md",
        b"---\nversion: 2\nid: broken\ntype: person\n---\n",
    );
    let output = fixture.build(&[]);
    assert_eq!(output.status.code(), Some(1));
    assert!(!fixture.target().exists());
    assert!(!fixture.0.join(".site.kindred-staging").exists());
}

#[test]
fn bad_view_or_suggestion_is_a_usage_error() {
    let fixture = Fixture::new();
    fixture.person("ada", "Ada Linde", "living: false\n", "Story.");
    for extra in [
        vec!["--view", "owl"],
        vec!["--suggest-url", "//evil.example/path"],
        vec!["--suggest-url", "http://example.org/"],
        vec!["--suggest-url", "/back\\slash"],
        vec!["--suggest-url", "https://"],
        vec!["--suggest-url", "relative/path"],
        vec!["--today", "2026/10/30"],
    ] {
        let output = fixture.build(&extra);
        assert_eq!(output.status.code(), Some(2), "{extra:?}");
        assert!(String::from_utf8_lossy(&output.stderr).contains("usage:"));
        assert!(!fixture.target().exists());
    }
}

#[test]
fn private_people_and_their_claims_leave_no_trace() {
    let fixture = Fixture::new();
    fixture.person(
        "ada",
        "Ada Linde",
        "living: false\n",
        "Ada kept the orchard.",
    );
    fixture.person(
        "bo",
        "Bo Linde",
        "living: false\nfather: \"[[people/ada]]\"\nparents:\n  - person: \"[[people/vellum]]\"\n    relation: adoptive_parent\n    status: disputed\nevents:\n  - type: baptism\n    name: Church record\n    people: [\"[[people/vellum]]\"]\n    sources: [\"[[sources/vellum-note]]\"]\n",
        "Bo restored the cottage.",
    );
    fixture.person(
        "vellum",
        "Zelda Vellum",
        "living: true\nprivate: true\n",
        "PRIVATE_STORY_TEXT",
    );
    fixture.write(
        "sources/vellum-note.md",
        b"---\nversion: 1\nid: vellum-note\ntype: source\nname: Private note\nprivate: true\n---\n\nPRIVATE_SOURCE_TEXT\n",
    );
    fixture.write(
        "people/ada-claim.md",
        b"---\nversion: 1\nid: ada-claim\ntype: relationship\nrelation: biological_parent\nstatus: tentative\nparent: \"[[people/ada]]\"\nchild: \"[[people/bo]]\"\nsources: [\"[[sources/vellum-note]]\"]\n---\n\nPublic claim.\n",
    );
    let graph = fixture.graph();
    let text = fs::read_to_string(fixture.target().join("graph.json")).expect("graph.json");
    for secret in [
        "vellum",
        "PRIVATE_STORY_TEXT",
        "PRIVATE_SOURCE_TEXT",
        "Private note",
    ] {
        assert!(!text.contains(secret), "{secret} leaked");
    }
    assert!(record(&graph, "vellum").is_none());
    assert!(record(&graph, "ada").is_some());
    assert!(record(&graph, "bo").is_some());
    let edges = graph["edges"].as_array().expect("edges");
    assert!(edges.iter().any(|edge| edge["id"] == "ada-claim"
        && edge["status"] == "tentative"
        && edge["sources"].as_array().is_some_and(Vec::is_empty)));
    assert!(
        edges
            .iter()
            .all(|edge| edge["from"] != "vellum" && edge["to"] != "vellum")
    );
    let baptism = graph["records"]
        .as_array()
        .expect("records")
        .iter()
        .find(|record| record["metadata"]["event_type"] == "baptism")
        .expect("baptism event should remain");
    assert_eq!(baptism["metadata"]["people"], serde_json::json!(["bo"]));
    assert_eq!(baptism["metadata"]["sources"], serde_json::json!([]));
    assert_references_resolve(&graph);
}

#[test]
fn raw_note_text_is_not_published_but_the_story_is() {
    let fixture = Fixture::new();
    fixture.person(
        "ada",
        "Ada Linde",
        "living: false\nunknown: KEPT_PROPERTY\n",
        "STORY_SENTENCE about the orchard.",
    );
    let graph = fixture.graph();
    let ada = record(&graph, "ada").expect("ada should be published");
    assert!(ada.get("raw").is_none());
    assert_eq!(ada["metadata"]["unknown"], "KEPT_PROPERTY");
    assert!(
        ada["body"]
            .as_str()
            .expect("body")
            .contains("STORY_SENTENCE")
    );
    let text = fs::read_to_string(fixture.target().join("graph.json")).expect("graph.json");
    assert!(!text.contains("version: 1\nid: ada"));
    assert!(!text.contains("\"raw\""));
}

#[test]
fn minors_show_only_a_year_and_adults_keep_their_dates() {
    let fixture = Fixture::new();
    fixture.person(
        "ada",
        "Ada Linde",
        "born: \"1950-03-04\"\nliving: false\n",
        "Story.",
    );
    fixture.person(
        "lena",
        "Lena Linde",
        "born: \"2017-09-26\"\n",
        "Lena likes gardens.",
    );
    fixture.person(
        "tomas",
        "Tomas Linde",
        "birth: \"26.09.2017\"\n",
        "Tomas likes boats.",
    );
    fixture.person(
        "eve",
        "Eve Linde",
        "born: \"2008-10-30\"\n",
        "Turns eighteen today.",
    );
    fixture.person(
        "mira",
        "Mira Linde",
        "born: \"1980-05-06\"\ndate_display: year\nliving: false\n",
        "Story.",
    );
    let graph = fixture.graph();
    assert_eq!(
        record(&graph, "ada").expect("ada")["metadata"]["born"],
        "1950-03-04"
    );
    assert_eq!(
        record(&graph, "eve").expect("eve")["metadata"]["born"],
        "2008-10-30"
    );
    assert_eq!(
        record(&graph, "mira").expect("mira")["metadata"]["born"],
        "1980"
    );
    assert_eq!(
        record(&graph, "mira").expect("mira")["metadata"]["date_display"],
        "year"
    );
    let lena = record(&graph, "lena").expect("lena");
    assert_eq!(lena["metadata"]["born"], "2017");
    let tomas = record(&graph, "tomas").expect("tomas");
    assert_eq!(tomas["metadata"]["birth"], "2017");
    for id in ["lena", "tomas"] {
        assert_eq!(
            record(&graph, &format!("derived:{id}:birth")).expect("birth event")["metadata"]["date"],
            "2017"
        );
    }
    assert_eq!(
        record(&graph, "derived:ada:birth").expect("adult birth")["metadata"]["date"],
        "1950-03-04"
    );
    assert_eq!(
        record(&graph, "derived:mira:birth").expect("year-only birth")["metadata"]["date"],
        "1980"
    );
    let text = fs::read_to_string(fixture.target().join("graph.json")).expect("graph.json");
    assert!(!text.contains("2017-09-26"));
    assert!(!text.contains("26.09.2017"));
}

#[test]
fn full_minor_date_in_visible_text_fails_and_names_the_person() {
    let fixture = Fixture::new();
    fixture.person("ada", "Ada Linde", "living: false\n", "Story.");
    fixture.person(
        "lena",
        "Lena Linde",
        "born: \"2017-09-26\"\n",
        "Lena was born on 26.09.2017 in Lindenby.",
    );
    let output = fixture.build(&["--today", TODAY]);
    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("lena"), "{stderr}");
    assert!(stderr.contains("graph.json"), "{stderr}");
    assert!(!stderr.contains("26.09.2017"), "{stderr}");
    assert!(!fixture.target().exists());
    assert!(!fixture.0.join(".site.kindred-staging").exists());
}

#[test]
fn full_minor_date_in_source_note_fails_and_names_the_person() {
    let fixture = Fixture::new();
    fixture.person("ada", "Ada Linde", "living: false\n", "Story.");
    fixture.person("lena", "Lena Linde", "born: \"2017-09-26\"\n", "Story.");
    fixture.write(
        "sources/register.md",
        b"---\nversion: 1\nid: register\ntype: source\nname: Parish register\n---\n\nEntry for 26 September 2017.\n",
    );
    let output = fixture.build(&["--today", TODAY]);
    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("lena"), "{stderr}");
    assert!(!fixture.target().exists());
}

#[test]
fn only_portrait_images_are_copied_and_listed() {
    let fixture = Fixture::new();
    fixture.write("attachments/portrait.png", b"PORTRAIT_BYTES");
    fixture.write("attachments/scan.png", b"SOURCE_SCAN_BYTES");
    fixture.write("attachments/vellum.png", b"PRIVATE_PORTRAIT_BYTES");
    fixture.person(
        "ada",
        "Ada Linde",
        "living: false\nportrait: attachments/portrait.png\nportrait_credit: Fictional painter\n",
        "Story.",
    );
    fixture.person(
        "vellum",
        "Zelda Vellum",
        "living: true\nprivate: true\nportrait: attachments/vellum.png\n",
        "Hidden.",
    );
    fixture.write(
        "sources/scan.md",
        b"---\nversion: 1\nid: scan\ntype: source\nname: Scan\nattachments: [attachments/scan.png]\n---\n\nA fictional scan.\n",
    );
    let graph = fixture.graph();
    assert_eq!(
        fs::read(
            fixture
                .target()
                .join("attachments/attachments/portrait.png")
        )
        .expect("portrait should be copied"),
        b"PORTRAIT_BYTES"
    );
    assert!(
        !fixture
            .target()
            .join("attachments/attachments/scan.png")
            .exists()
    );
    assert!(
        !fixture
            .target()
            .join("attachments/attachments/vellum.png")
            .exists()
    );
    assert_eq!(
        graph["attachments"],
        serde_json::json!([{ "record": "ada", "path": "attachments/portrait.png", "label": "attachments/portrait.png" }])
    );
}

#[test]
fn graph_lists_every_claim_status_with_resolvable_references() {
    let fixture = Fixture::new();
    fixture.person(
        "ada",
        "Ada Linde",
        "living: false\n",
        "Ada kept the orchard.",
    );
    fixture.person(
        "bo",
        "Bo Linde",
        "living: false\nfather: \"[[people/ada]]\"\nparents:\n  - person: \"[[people/ada]]\"\n    relation: adoptive_parent\n    status: disputed\n",
        "Bo restored the cottage.",
    );
    let graph = fixture.graph();
    assert_eq!(graph["diagnostics"], serde_json::json!([]));
    assert!(
        graph["records"]
            .as_array()
            .is_some_and(|records| !records.is_empty())
    );
    let statuses: Vec<&str> = graph["edges"]
        .as_array()
        .expect("edges")
        .iter()
        .filter_map(|edge| edge["status"].as_str())
        .collect();
    assert!(statuses.contains(&"accepted"));
    assert!(statuses.contains(&"disputed"));
    assert_references_resolve(&graph);
}
