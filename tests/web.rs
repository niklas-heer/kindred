use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{Shutdown, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::atomic::{AtomicUsize, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

static NEXT_FIXTURE: AtomicUsize = AtomicUsize::new(0);

struct RunningServer {
    child: Child,
    root: PathBuf,
    port: u16,
}

// Web fixture failures should stop the test at the setup boundary.
#[allow(clippy::expect_used)]
impl RunningServer {
    fn start() -> Self {
        let sequence = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should follow the Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "kindred-web-{}-{timestamp}-{sequence}",
            std::process::id()
        ));
        fs::create_dir(&root).expect("fixture root should be exclusively created");
        create_archive(&root);
        let mut child = Command::new(env!("CARGO_BIN_EXE_kindred"))
            .args([
                "serve",
                root.to_str().expect("temporary path should be UTF-8"),
                "--port",
                "0",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("server should start");
        let stdout = child
            .stdout
            .take()
            .expect("server stdout should be captured");
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .expect("server should report its URL");
        let port = line
            .trim()
            .strip_prefix("Kindred is ready at http://127.0.0.1:")
            .and_then(|value| value.strip_suffix('/'))
            .expect("server should report a loopback URL")
            .parse()
            .expect("server should report its port");
        Self { child, root, port }
    }

    fn request(
        &self,
        method: &str,
        path: &str,
        headers: &[(&str, &str)],
        body: &str,
    ) -> HttpResponse {
        let mut stream = TcpStream::connect(("127.0.0.1", self.port))
            .expect("test should connect to loopback server");
        write!(
            stream,
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n",
            self.port
        )
        .expect("request line should be written");
        for (name, value) in headers {
            write!(stream, "{name}: {value}\r\n").expect("header should be written");
        }
        if !body.is_empty() {
            write!(stream, "Content-Length: {}\r\n", body.len())
                .expect("content length should be written");
        }
        write!(stream, "\r\n{body}").expect("request body should be written");
        stream
            .shutdown(Shutdown::Write)
            .expect("request should finish");
        let mut response = Vec::new();
        stream
            .read_to_end(&mut response)
            .expect("response should be readable");
        HttpResponse::parse(&response)
    }
}

impl Drop for RunningServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = fs::remove_dir_all(&self.root);
    }
}

struct HttpResponse {
    status: u16,
    headers: String,
    body: Vec<u8>,
}

// Response parsing is test infrastructure; malformed responses should fail fast.
#[allow(clippy::expect_used)]
impl HttpResponse {
    fn parse(response: &[u8]) -> Self {
        let boundary = response
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .expect("HTTP response should contain headers");
        let header_bytes = response
            .get(..boundary)
            .expect("header boundary should be valid");
        let headers = String::from_utf8(header_bytes.to_vec()).expect("headers should be UTF-8");
        let status = headers
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .expect("response should contain a status")
            .parse()
            .expect("response status should be numeric");
        let body = response
            .get(boundary.saturating_add(4)..)
            .expect("body boundary should be valid")
            .to_vec();
        Self {
            status,
            headers,
            body,
        }
    }

    fn text(&self) -> String {
        String::from_utf8(self.body.clone()).expect("text response should be UTF-8")
    }

    fn json(&self) -> serde_json::Value {
        serde_json::from_slice(&self.body).expect("response should be JSON")
    }
}

// Web fixture failures should stop the test at the setup boundary.
#[allow(clippy::expect_used)]
fn create_archive(root: &Path) {
    for directory in ["people", "relationships", "sources", "attachments"] {
        fs::create_dir_all(root.join(directory)).expect("fixture directory should be created");
    }
    fs::write(
        root.join("people/ada.md"),
        person_note(
            "ada",
            "Ada Linde",
            "Ada kept a careful account of the orchard.",
        ),
    )
    .expect("person fixture should be written");
    fs::write(
        root.join("people/bo.md"),
        person_note("bo", "Bo Linde", "Bo restored the east cottage."),
    )
    .expect("person fixture should be written");
    fs::write(
        root.join("sources/register.md"),
        "---\nversion: 1\nid: register\ntype: source\nname: Orchard register\nattachments: [\"attachments/register.txt\"]\n---\n\nA fictional register.\n",
    )
    .expect("source fixture should be written");
    fs::write(
        root.join("relationships/ada_bo.md"),
        "---\nversion: 1\nid: ada_bo\ntype: relationship\nname: Ada and Bo\nrelation: biological_parent\nparent: \"[[people/ada]]\"\nchild: \"[[people/bo]]\"\nstatus: accepted\nsources: [\"[[sources/register]]\"]\n---\n\nThe register supports this claim.\n",
    )
    .expect("relationship fixture should be written");
    fs::write(
        root.join("attachments/register.txt"),
        "Fictional evidence\n",
    )
    .expect("attachment fixture should be written");
}

fn person_note(id: &str, name: &str, body: &str) -> String {
    format!(
        "---\nversion: 1\nid: {id}\ntype: person\nname: \"{name}\"\nbirth: \"1901?\"\n---\n\n{body}\n"
    )
}

#[test]
fn serves_static_shell_and_reloads_the_archive_for_each_query() {
    let server = RunningServer::start();
    let shell = server.request("GET", "/", &[], "");
    assert_eq!(shell.status, 200);
    assert!(shell.headers.contains("Content-Security-Policy"));
    assert!(shell.text().contains("Family relationship graph"));
    assert!(!shell.text().contains("Ada Linde"));

    for asset in ["/family.js", "/layout.js"] {
        let response = server.request("GET", asset, &[], "");
        assert_eq!(response.status, 200);
        assert!(response.headers.contains("text/javascript"));
        assert!(shell.text().contains(asset));
    }

    let icons = server.request("GET", "/icons.svg", &[], "");
    assert_eq!(icons.status, 200);
    assert!(icons.headers.contains("image/svg+xml"));
    assert!(icons.text().contains("id=\"baby\""));
    assert!(icons.text().contains("id=\"flower-2\""));
    assert!(!icons.text().contains("<script"));

    let graph = server.request("GET", "/api/graph?mode=overview", &[], "");
    assert_eq!(graph.status, 200);
    let payload = graph.json();
    assert_eq!(payload["query"]["nodes"].as_array().map(Vec::len), Some(2));
    assert_eq!(payload["query"]["edges"].as_array().map(Vec::len), Some(1));

    fs::write(
        server.root.join("people/ada.md"),
        person_note("ada", "Ada Nyström", "An externally revised story."),
    )
    .expect("external edit should be written");
    let reloaded = server.request("GET", "/api/graph?mode=focus&person=ada", &[], "");
    assert_eq!(reloaded.status, 200);
    assert!(reloaded.text().contains("Ada Nyström"));
}

#[test]
fn edits_require_same_origin_and_detect_concurrent_changes() {
    let server = RunningServer::start();
    let original = fs::read_to_string(server.root.join("people/ada.md"))
        .expect("fixture note should be readable");
    let replacement = person_note("ada", "Ada Lind", "Saved from the browser.");
    let edit = serde_json::json!({
        "id": "ada",
        "expected": original,
        "replacement": replacement,
    })
    .to_string();
    let hostile = server.request(
        "POST",
        "/api/edit",
        &[
            ("Content-Type", "application/json"),
            ("Origin", "https://example.invalid"),
        ],
        &edit,
    );
    assert_eq!(hostile.status, 403);

    let origin = format!("http://127.0.0.1:{}", server.port);
    let saved = server.request(
        "POST",
        "/api/edit",
        &[("Content-Type", "application/json"), ("Origin", &origin)],
        &edit,
    );
    assert_eq!(saved.status, 200, "{}", saved.text());
    assert!(
        fs::read_to_string(server.root.join("people/ada.md"))
            .expect("saved note should be readable")
            .contains("Saved from the browser")
    );

    let conflict = server.request(
        "POST",
        "/api/edit",
        &[("Content-Type", "application/json"), ("Origin", &origin)],
        &edit,
    );
    assert_eq!(conflict.status, 409);
    assert!(conflict.text().contains("conflict"));
}

#[test]
fn attachments_are_whitelisted_and_cannot_escape_the_archive() {
    let server = RunningServer::start();
    let attachment = server.request(
        "GET",
        "/api/attachment?path=attachments%2Fregister.txt",
        &[],
        "",
    );
    assert_eq!(attachment.status, 200);
    assert_eq!(attachment.text(), "Fictional evidence\n");
    assert!(
        attachment
            .headers
            .contains("Content-Security-Policy: sandbox")
    );

    let traversal = server.request("GET", "/api/attachment?path=..%2FCargo.toml", &[], "");
    assert_eq!(traversal.status, 404);
    let unlisted = server.request("GET", "/api/attachment?path=people%2Fada.md", &[], "");
    assert_eq!(unlisted.status, 404);
}

#[test]
fn invalid_query_parameters_receive_an_http_error() {
    let server = RunningServer::start();
    let response = server.request(
        "GET",
        "/api/graph?mode=ancestors&person=ada&generations=deep",
        &[],
        "",
    );
    assert_eq!(response.status, 400);
    assert!(response.text().contains("generations"));

    let wrong_host = {
        let mut stream = TcpStream::connect(("127.0.0.1", server.port))
            .expect("test should connect to loopback server");
        write!(
            stream,
            "GET /api/graph?mode=overview HTTP/1.1\r\nHost: example.invalid\r\nConnection: close\r\n\r\n"
        )
        .expect("request should be written");
        let mut response = Vec::new();
        stream
            .read_to_end(&mut response)
            .expect("response should be readable");
        HttpResponse::parse(&response)
    };
    assert_eq!(wrong_host.status, 403);
}

#[test]
fn person_metadata_projects_into_http_graph_and_serves_local_portraits() {
    let server = RunningServer::start();
    // Bytes are deliberately opaque here: this verifies HTTP preservation and MIME.
    let portrait = b"fictional portrait attachment bytes";
    fs::write(server.root.join("attachments/portrait.jpg"), portrait).expect("write portrait");
    let person = "---\nversion: 1\nid: bo\ntype: person\nname: Bo Linde\nmother: '[[people/ada]]'\nportrait: attachments/portrait.jpg\nborn: 'about 1901'\nbirth_place: Orchard village\nsources:\n  - id: inline_source\n    title: Family album\n    attachments: [attachments/portrait.jpg]\n---\nA fictional story.\n";
    fs::write(server.root.join("people/bo.md"), person).expect("write person metadata");
    let response = server.request("GET", "/api/graph?mode=focus&person=bo", &[], "");
    assert_eq!(response.status, 200, "{}", response.text());
    let payload = response.json();
    let records = payload["records"].as_array().expect("graph records");
    let birth = records
        .iter()
        .find(|record| record["id"] == "derived:bo:birth")
        .expect("derived birth");
    assert_eq!(birth["owner"], "bo");
    assert_eq!(birth["raw"], "");
    assert_eq!(birth["metadata"]["date"], "about 1901");
    assert!(
        records.iter().any(|record| record["type"] == "relationship"
            && record["metadata"]["parent_role"] == "mother")
    );
    let attachments = payload["attachments"]
        .as_array()
        .expect("attachment manifest");
    assert!(
        attachments
            .iter()
            .any(|file| file["record"] == "bo" && file["path"] == "attachments/portrait.jpg")
    );
    let image = server.request(
        "GET",
        "/api/attachment?path=attachments%2Fportrait.jpg",
        &[],
        "",
    );
    assert_eq!(image.status, 200);
    assert!(image.headers.contains("image/jpeg"));
    assert_eq!(image.body, portrait);
    let edit = serde_json::json!({"id": "derived:bo:birth", "expected": "", "replacement": person})
        .to_string();
    let origin = format!("http://127.0.0.1:{}", server.port);
    let rejected = server.request(
        "POST",
        "/api/edit",
        &[("Content-Type", "application/json"), ("Origin", &origin)],
        &edit,
    );
    assert_ne!(rejected.status, 200);
    assert!(
        rejected.text().contains("owning person"),
        "{}",
        rejected.text()
    );
    assert_eq!(
        fs::read_to_string(server.root.join("people/bo.md")).expect("read person"),
        person
    );
}
