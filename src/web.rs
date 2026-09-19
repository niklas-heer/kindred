//! Loopback-only HTTP server and browser graph for a Kindred archive.

use std::{
    fs,
    io::{Read, Write},
    path::Path,
};

use serde::Deserialize;
use serde_json::{Value, json};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

use crate::{
    archive::Archive,
    query::{self, QueryOptions, QueryResult},
};

const INDEX: &str = include_str!("web/index.html");
const STYLES: &str = include_str!("web/app.css");
const FAMILY: &str = include_str!("web/family.js");
const LAYOUT: &str = include_str!("web/layout.js");
const SCRIPT: &str = include_str!("web/app.js");
const ICONS: &str = include_str!("web/icons.svg");
const MAX_EDIT_BYTES: u64 = 4 * 1024 * 1024;

/// Serves the archive on IPv4 loopback until the process is stopped.
///
/// Passing port `0` asks the operating system to select an available port.
///
/// # Errors
///
/// Returns an error when the archive cannot be opened, the loopback listener
/// cannot be created, or the server cannot report its address.
pub fn serve(root: &Path, port: u16) -> Result<(), String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("cannot open archive {}: {error}", root.display()))?;
    if !root.is_dir() {
        return Err(format!("archive is not a directory: {}", root.display()));
    }

    let server = Server::http(("127.0.0.1", port))
        .map_err(|error| format!("cannot start local server: {error}"))?;
    let address = server
        .server_addr()
        .to_ip()
        .ok_or_else(|| "local server did not return a TCP address".to_owned())?;
    let actual_port = address.port();

    println!("Kindred is ready at http://127.0.0.1:{actual_port}/");
    std::io::stdout()
        .flush()
        .map_err(|error| format!("cannot report local server address: {error}"))?;

    for request in server.incoming_requests() {
        if let Err(error) = handle_request(request, &root, actual_port) {
            eprintln!("kindred: local request failed: {error}");
        }
    }
    Ok(())
}

fn handle_request(request: Request, root: &Path, port: u16) -> Result<(), String> {
    if !request
        .remote_addr()
        .is_some_and(|address| address.ip().is_loopback())
    {
        return respond_text(
            request,
            403,
            "loopback access only",
            "text/plain; charset=utf-8",
        );
    }

    let host = header_value(&request, "Host");
    if !host.is_some_and(|value| allowed_host(value, port)) {
        return respond_text(
            request,
            403,
            "invalid Host header",
            "text/plain; charset=utf-8",
        );
    }

    let (path, query_string) = split_url(request.url());
    let path = path.to_owned();
    let query_string = query_string.to_owned();
    match (request.method(), path.as_str()) {
        (&Method::Get, "/") => respond_static(request, INDEX, "text/html; charset=utf-8"),
        (&Method::Get, "/app.css") => respond_static(request, STYLES, "text/css; charset=utf-8"),
        (&Method::Get, "/app.js") => {
            respond_static(request, SCRIPT, "text/javascript; charset=utf-8")
        }
        (&Method::Get, "/family.js") => {
            respond_static(request, FAMILY, "text/javascript; charset=utf-8")
        }
        (&Method::Get, "/layout.js") => {
            respond_static(request, LAYOUT, "text/javascript; charset=utf-8")
        }
        (&Method::Get, "/icons.svg") => respond_static(request, ICONS, "image/svg+xml"),
        (&Method::Get, "/api/graph") => graph_response(request, root, &query_string),
        (&Method::Get, "/api/attachment") => attachment_response(request, root, &query_string),
        (&Method::Post, "/api/edit") => edit_response(request, root, port),
        _ => respond_text(request, 404, "not found", "text/plain; charset=utf-8"),
    }
}

fn graph_response(request: Request, root: &Path, query_string: &str) -> Result<(), String> {
    let archive = match Archive::load(root) {
        Ok(archive) => archive,
        Err(error) => return respond_json_error(request, 422, &error),
    };
    if !archive.diagnostics.is_empty() {
        let messages = archive
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>()
            .join(" · ");
        return respond_json(
            request,
            422,
            &json!({
                "error": "fix archive diagnostics before exploring the graph",
                "diagnostics": archive.diagnostics,
                "details": messages,
            }),
        );
    }
    let parameters = match parse_query(query_string) {
        Ok(parameters) => parameters,
        Err(error) => return respond_json_error(request, 400, &error),
    };
    let mode = parameter(&parameters, "mode").unwrap_or("overview");
    let options = match query_options(&parameters) {
        Ok(options) => options,
        Err(error) => return respond_json_error(request, 400, &error),
    };
    let result = match select_graph(&archive, mode, &parameters, &options) {
        Ok(result) => result,
        Err(error) => return respond_json_error(request, 422, &error),
    };

    let attachments = attachment_manifest(&archive);
    let payload = json!({
        "query": result,
        "records": archive.records,
        "diagnostics": archive.diagnostics,
        "attachments": attachments,
        "mode": mode,
    });
    respond_json(request, 200, &payload)
}

fn query_options(parameters: &[(String, String)]) -> Result<QueryOptions, String> {
    let mut options = QueryOptions::default();
    if let Some(generations) = parameter(parameters, "generations") {
        options.generations = generations
            .parse::<usize>()
            .map_err(|_| "generations must be a non-negative integer".to_owned())?
            .min(64);
    }
    if let Some(relations) = parameter(parameters, "relations") {
        options.relations = list_parameter(relations);
        if let Some(unknown) = options.relations.iter().find(|relation| {
            ![
                "biological_parent",
                "adoptive_parent",
                "foster_parent",
                "partner",
            ]
            .contains(&relation.as_str())
        }) {
            return Err(format!("unsupported relationship filter: {unknown}"));
        }
    }
    if let Some(statuses) = parameter(parameters, "statuses") {
        options.statuses = if statuses == "all" {
            ["accepted", "tentative", "disputed", "rejected"]
                .into_iter()
                .map(str::to_owned)
                .collect()
        } else {
            list_parameter(statuses)
        };
        if let Some(unknown) = options.statuses.iter().find(|status| {
            !["accepted", "tentative", "disputed", "rejected"].contains(&status.as_str())
        }) {
            return Err(format!("unsupported status filter: {unknown}"));
        }
    }
    Ok(options)
}

fn select_graph(
    archive: &Archive,
    mode: &str,
    parameters: &[(String, String)],
    options: &QueryOptions,
) -> Result<QueryResult, String> {
    match mode {
        "overview" => Ok(query::overview(archive, options)),
        "focus" => required_parameter(parameters, "person")
            .and_then(|person| query::neighborhood(archive, person, options)),
        "ancestors" => required_parameter(parameters, "person")
            .and_then(|person| query::ancestors(archive, person, options)),
        "descendants" => required_parameter(parameters, "person")
            .and_then(|person| query::descendants(archive, person, options)),
        "path" => required_parameter(parameters, "person").and_then(|person| {
            required_parameter(parameters, "to")
                .and_then(|to| query::path(archive, person, to, options))
        }),
        _ => Err(format!("unknown graph mode: {mode}")),
    }
}

fn edit_response(mut request: Request, root: &Path, port: u16) -> Result<(), String> {
    if !header_value(&request, "Content-Type").is_some_and(|value| {
        value.eq_ignore_ascii_case("application/json") || value.starts_with("application/json;")
    }) {
        return respond_text(
            request,
            415,
            "Content-Type must be application/json",
            "text/plain; charset=utf-8",
        );
    }
    let Some(host) = header_value(&request, "Host").map(str::to_owned) else {
        return respond_text(request, 403, "missing Host", "text/plain; charset=utf-8");
    };
    let expected_origin = format!("http://{host}");
    if header_value(&request, "Origin") != Some(expected_origin.as_str())
        || !allowed_host(&host, port)
    {
        return respond_text(
            request,
            403,
            "edit requires the same local origin",
            "text/plain; charset=utf-8",
        );
    }
    if request
        .body_length()
        .is_some_and(|length| u64::try_from(length).map_or(true, |length| length > MAX_EDIT_BYTES))
    {
        return respond_text(
            request,
            413,
            "edit request is too large",
            "text/plain; charset=utf-8",
        );
    }

    let mut body = Vec::new();
    request
        .as_reader()
        .take(MAX_EDIT_BYTES.saturating_add(1))
        .read_to_end(&mut body)
        .map_err(|error| format!("cannot read edit request: {error}"))?;
    if u64::try_from(body.len()).map_or(true, |length| length > MAX_EDIT_BYTES) {
        return respond_text(
            request,
            413,
            "edit request is too large",
            "text/plain; charset=utf-8",
        );
    }
    let edit: EditRequest = match serde_json::from_slice(&body) {
        Ok(edit) => edit,
        Err(error) => {
            return respond_json_error(request, 400, &format!("invalid edit request: {error}"));
        }
    };
    let response = match crate::editing::replace(root, &edit.id, &edit.expected, &edit.replacement)
    {
        Ok(()) => json!({ "ok": true }),
        Err(error) if error.starts_with("conflict:") => {
            return respond_json_error(request, 409, &error);
        }
        Err(error) => return respond_json_error(request, 422, &error),
    };
    respond_json(request, 200, &response)
}

#[derive(Deserialize)]
struct EditRequest {
    id: String,
    expected: String,
    replacement: String,
}

fn attachment_response(request: Request, root: &Path, query_string: &str) -> Result<(), String> {
    let parameters = match parse_query(query_string) {
        Ok(parameters) => parameters,
        Err(error) => return respond_json_error(request, 400, &error),
    };
    let requested = match required_parameter(&parameters, "path") {
        Ok(requested) => requested,
        Err(error) => return respond_json_error(request, 400, &error),
    };
    let archive = match Archive::load(root) {
        Ok(archive) => archive,
        Err(error) => return respond_json_error(request, 422, &error),
    };
    let allowed: std::collections::BTreeSet<String> = attachment_manifest(&archive)
        .into_iter()
        .map(|attachment| attachment.path)
        .collect();
    if !allowed.contains(requested) {
        return respond_text(
            request,
            404,
            "attachment not found",
            "text/plain; charset=utf-8",
        );
    }
    let Ok(canonical) = archive.attachment(requested) else {
        return respond_text(
            request,
            404,
            "attachment not found",
            "text/plain; charset=utf-8",
        );
    };
    let data = fs::read(&canonical)
        .map_err(|error| format!("cannot read attachment {}: {error}", canonical.display()))?;
    let content_type = attachment_content_type(&canonical);
    let mut response = Response::from_data(data).with_status_code(StatusCode(200));
    add_header(&mut response, "Content-Type", content_type)?;
    add_header(&mut response, "Cache-Control", "no-store")?;
    add_header(&mut response, "X-Content-Type-Options", "nosniff")?;
    add_header(&mut response, "Content-Security-Policy", "sandbox")?;
    request
        .respond(response)
        .map_err(|error| format!("cannot send attachment: {error}"))
}

#[derive(serde::Serialize)]
struct Attachment {
    record: String,
    path: String,
    label: String,
}

fn attachment_manifest(archive: &Archive) -> Vec<Attachment> {
    let mut attachments = Vec::new();
    for record in &archive.records {
        for field in ["attachments", "media", "file", "portrait"] {
            if let Some(value) = record.metadata.get(field)
                && let Ok(value) = serde_json::to_value(value)
            {
                collect_attachment_values(archive, &record.id, &value, &mut attachments);
            }
        }
    }
    attachments.sort_by(|left, right| {
        left.record
            .cmp(&right.record)
            .then(left.path.cmp(&right.path))
    });
    attachments.dedup_by(|left, right| left.record == right.record && left.path == right.path);
    attachments
}

fn collect_attachment_values(
    archive: &Archive,
    record: &str,
    value: &Value,
    output: &mut Vec<Attachment>,
) {
    match value {
        Value::String(value) => {
            if value.trim().starts_with("[[") {
                if let Ok(media) = archive.resolve_link(value)
                    && let Some(path) = media.text("file")
                    && archive.attachment(path).is_ok()
                {
                    output.push(Attachment {
                        record: record.to_owned(),
                        path: path.to_owned(),
                        label: label_for_attachment(media, path),
                    });
                }
            } else if let Some((path, label)) = parse_attachment_path(value)
                && archive.attachment(&path).is_ok()
            {
                output.push(Attachment {
                    record: record.to_owned(),
                    path,
                    label,
                });
            }
        }
        Value::Array(values) => {
            for value in values {
                collect_attachment_values(archive, record, value, output);
            }
        }
        Value::Object(values) => {
            for value in values.values() {
                collect_attachment_values(archive, record, value, output);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}

fn parse_attachment_path(value: &str) -> Option<(String, String)> {
    let trimmed = value.trim();
    let (path, label) = trimmed.split_once('|').unwrap_or((trimmed, trimmed));
    let path = path.split('#').next()?.trim();
    if path.is_empty() {
        return None;
    }
    Some((path.to_owned(), label.trim().to_owned()))
}

fn label_for_attachment(record: &crate::archive::Record, path: &str) -> String {
    if record.name.is_empty() {
        Path::new(path)
            .file_name()
            .and_then(std::ffi::OsStr::to_str)
            .unwrap_or(path)
            .to_owned()
    } else {
        record.name.clone()
    }
}

fn attachment_content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(std::ffi::OsStr::to_str)
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("pdf") => "application/pdf",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn respond_static(request: Request, body: &str, content_type: &str) -> Result<(), String> {
    let mut response = Response::from_string(body).with_status_code(StatusCode(200));
    add_header(&mut response, "Content-Type", content_type)?;
    add_header(&mut response, "Cache-Control", "no-store")?;
    add_header(&mut response, "X-Content-Type-Options", "nosniff")?;
    add_header(&mut response, "Referrer-Policy", "no-referrer")?;
    add_header(
        &mut response,
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    )?;
    request
        .respond(response)
        .map_err(|error| format!("cannot send browser asset: {error}"))
}

fn respond_json(request: Request, status: u16, value: &Value) -> Result<(), String> {
    let body = serde_json::to_vec(value)
        .map_err(|error| format!("cannot serialize local response: {error}"))?;
    let mut response = Response::from_data(body).with_status_code(StatusCode(status));
    add_header(
        &mut response,
        "Content-Type",
        "application/json; charset=utf-8",
    )?;
    add_header(&mut response, "Cache-Control", "no-store")?;
    add_header(&mut response, "X-Content-Type-Options", "nosniff")?;
    request
        .respond(response)
        .map_err(|error| format!("cannot send JSON response: {error}"))
}

fn respond_json_error(request: Request, status: u16, error: &str) -> Result<(), String> {
    respond_json(request, status, &json!({ "error": error }))
}

fn respond_text(
    request: Request,
    status: u16,
    body: &str,
    content_type: &str,
) -> Result<(), String> {
    let mut response = Response::from_string(body).with_status_code(StatusCode(status));
    add_header(&mut response, "Content-Type", content_type)?;
    add_header(&mut response, "Cache-Control", "no-store")?;
    add_header(&mut response, "X-Content-Type-Options", "nosniff")?;
    request
        .respond(response)
        .map_err(|error| format!("cannot send response: {error}"))
}

fn add_header<R: Read>(response: &mut Response<R>, name: &str, value: &str) -> Result<(), String> {
    let header = Header::from_bytes(name, value)
        .map_err(|()| format!("invalid HTTP response header: {name}"))?;
    response.add_header(header);
    Ok(())
}

fn header_value<'a>(request: &'a Request, name: &'static str) -> Option<&'a str> {
    request
        .headers()
        .iter()
        .find(|header| header.field.equiv(name))
        .map(|header| header.value.as_str())
}

fn allowed_host(host: &str, port: u16) -> bool {
    host == format!("127.0.0.1:{port}")
        || host == format!("localhost:{port}")
        || host == format!("[::1]:{port}")
}

fn split_url(url: &str) -> (&str, &str) {
    url.split_once('?').unwrap_or((url, ""))
}

fn parse_query(query: &str) -> Result<Vec<(String, String)>, String> {
    query
        .split('&')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let (key, value) = part.split_once('=').unwrap_or((part, ""));
            Ok((percent_decode(key)?, percent_decode(value)?))
        })
        .collect()
}

fn percent_decode(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let Some(byte) = bytes.get(index).copied() else {
            break;
        };
        if byte == b'%' {
            let high = bytes
                .get(index.saturating_add(1))
                .copied()
                .and_then(hex_digit)
                .ok_or_else(|| "invalid URL escape".to_owned())?;
            let low = bytes
                .get(index.saturating_add(2))
                .copied()
                .and_then(hex_digit)
                .ok_or_else(|| "invalid URL escape".to_owned())?;
            decoded.push(high.saturating_mul(16).saturating_add(low));
            index = index.saturating_add(3);
        } else {
            decoded.push(if byte == b'+' { b' ' } else { byte });
            index = index.saturating_add(1);
        }
    }
    String::from_utf8(decoded).map_err(|_| "URL query must be UTF-8".to_owned())
}

const fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte.wrapping_sub(b'0')),
        b'a'..=b'f' => Some(byte.wrapping_sub(b'a').wrapping_add(10)),
        b'A'..=b'F' => Some(byte.wrapping_sub(b'A').wrapping_add(10)),
        _ => None,
    }
}

fn parameter<'a>(parameters: &'a [(String, String)], name: &str) -> Option<&'a str> {
    parameters
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.as_str())
}

fn required_parameter<'a>(
    parameters: &'a [(String, String)],
    name: &str,
) -> Result<&'a str, String> {
    parameter(parameters, name)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("missing {name} parameter"))
}

fn list_parameter(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect()
}
