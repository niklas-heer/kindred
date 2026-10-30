//! A self-contained static viewer built from a validated archive. Privacy rules are applied to
//! the data before anything is written, and the written files are checked again before publication.

use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::Value;

use crate::{
    archive::{Archive, Record},
    exchange,
    web::{self, Attachment},
};

/// Keys whose string values are record IDs; a string naming an omitted ID is dangling.
const ID_KEYS: [&str; 6] = ["sources", "people", "place", "parent", "child", "partners"];
/// Original birth-date wording. `born` and `birth` are aliases; the viewer also reads `birth_date`.
const BIRTH_KEYS: [&str; 3] = ["born", "birth", "birth_date"];
/// Viewer files, from the same constants the local server embeds.
const ASSETS: [(&str, &str); 7] = [
    ("app.css", web::STYLES),
    ("family.js", web::FAMILY),
    ("layout.js", web::LAYOUT),
    ("i18n.js", web::I18N),
    ("query.js", web::QUERY),
    ("app.js", web::SCRIPT),
    ("icons.svg", web::ICONS),
];
/// English and German month names in calendar order.
const MONTHS: [(&str, &str); 12] = [
    ("January", "Januar"),
    ("February", "Februar"),
    ("March", "März"),
    ("April", "April"),
    ("May", "Mai"),
    ("June", "Juni"),
    ("July", "Juli"),
    ("August", "August"),
    ("September", "September"),
    ("October", "Oktober"),
    ("November", "November"),
    ("December", "Dezember"),
];
const ADULT_AGE: i64 = 18;

/// Which viewer state the page opens with.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum View {
    Simple,
    Research,
}

impl View {
    const fn name(self) -> &'static str {
        match self {
            Self::Simple => "simple",
            Self::Research => "research",
        }
    }
}

/// Publishing choices, validated before any file is written.
#[derive(Debug)]
pub struct Options {
    view: View,
    suggest: Option<String>,
    today: Date,
}

impl Options {
    /// Validate command-line values. The reference date defaults to today's UTC date.
    /// # Errors
    /// Returns a `usage:` message for an unknown view, an unsafe suggestion URL, or a malformed date.
    pub fn new(
        view: Option<&str>,
        suggest: Option<&str>,
        today: Option<&str>,
    ) -> Result<Self, String> {
        let view = match view.unwrap_or("research") {
            "simple" => View::Simple,
            "research" => View::Research,
            _ => return Err("usage: --view must be simple or research; try --help".into()),
        };
        if suggest.is_some_and(|url| !safe_suggestion(url)) {
            return Err(
                "usage: --suggest-url must be a path starting with / (not //) or an https:// URL; try --help"
                    .into(),
            );
        }
        let today = match today {
            Some(text) => Date::parse_iso(text)
                .ok_or("usage: --today must be a YYYY-MM-DD date; try --help")?,
            None => Date::utc_today()?,
        };
        Ok(Self {
            view,
            suggest: suggest.map(str::to_owned),
            today,
        })
    }
}

/// A suggestion target must stay on this origin or use HTTPS. Backslashes are refused because
/// browsers read `/\host` as a protocol-relative URL.
fn safe_suggestion(url: &str) -> bool {
    let printable = !url
        .chars()
        .any(|character| character.is_whitespace() || character.is_control() || character == '\\');
    printable
        && ((url.starts_with('/') && !url.starts_with("//"))
            || url
                .strip_prefix("https://")
                .is_some_and(|rest| !rest.is_empty()))
}

/// What a published site contains.
#[derive(Debug, Serialize)]
pub struct Report {
    pub records: usize,
    pub edges: usize,
    pub attachments: usize,
    pub protected_people: usize,
}

/// A calendar date. Protected people's birth dates are reduced to their year.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Date {
    year: i64,
    month: i64,
    day: i64,
}

impl Date {
    fn new(year: i64, month: i64, day: i64) -> Option<Self> {
        ((1..=12).contains(&month) && (1..=31).contains(&day)).then_some(Self { year, month, day })
    }

    /// Parse a strict `YYYY-MM-DD` date.
    #[must_use]
    pub fn parse_iso(text: &str) -> Option<Self> {
        let parts: Vec<&str> = text.split('-').collect();
        match parts.as_slice() {
            [year, month, day] if year.len() == 4 && month.len() == 2 && day.len() == 2 => {
                Self::new(digits(year)?, digits(month)?, digits(day)?)
            }
            _ => None,
        }
    }

    fn utc_today() -> Result<Self, String> {
        let seconds = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_secs();
        let days = i64::try_from(seconds / 86_400).map_err(|error| error.to_string())?;
        civil_from_days(days).ok_or_else(|| "cannot determine today's date".into())
    }
}

/// Convert days since 1970-01-01 to a civil date (Howard Hinnant's algorithm). The allowance is
/// narrow: every intermediate value is a bounded calendar quantity, far inside `i64`.
#[allow(clippy::arithmetic_side_effects)]
fn civil_from_days(days: i64) -> Option<Date> {
    let shifted = days.checked_add(719_468)?;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    Date::new(year, month, day)
}

/// Accept the full birth-date forms the leak check also recognizes.
fn parse_full(text: &str) -> Option<Date> {
    let text = text.trim();
    if let Some(date) = Date::parse_iso(text) {
        return Some(date);
    }
    let dotted: Vec<&str> = text.split('.').collect();
    if let [day, month, year] = dotted.as_slice()
        && (1..=2).contains(&day.len())
        && (1..=2).contains(&month.len())
        && year.len() == 4
    {
        return Date::new(digits(year)?, digits(month)?, digits(day)?);
    }
    let words: Vec<&str> = text.split_whitespace().collect();
    named_date(&words)
}

/// `26 September 2017`, `26. September 2017`, and `September 26, 2017`, in either language.
fn named_date(words: &[&str]) -> Option<Date> {
    let [first, second, year] = words else {
        return None;
    };
    if year.len() != 4 {
        return None;
    }
    let (day, month) = match month_number(second) {
        Some(month) => (*first, month),
        None => (*second, month_number(first)?),
    };
    Date::new(
        digits(year)?,
        month,
        digits(day.trim_end_matches([',', '.']))?,
    )
}

fn digits(text: &str) -> Option<i64> {
    if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

fn month_number(name: &str) -> Option<i64> {
    let lower = name.to_lowercase();
    let index = MONTHS.iter().position(|(english, german)| {
        lower == english.to_lowercase() || lower == german.to_lowercase()
    })?;
    i64::try_from(index)
        .ok()
        .map(|index| index.saturating_add(1))
}

fn is_minor(birth: Date, today: Date) -> bool {
    let years = today.year.saturating_sub(birth.year);
    let birthday_reached = (today.month, today.day) >= (birth.month, birth.day);
    let completed = if birthday_reached {
        years
    } else {
        years.saturating_sub(1)
    };
    completed < ADULT_AGE
}

/// Decide whether a person's birth date is reduced to a year. Returns the flag and the full date.
fn protection(person: &Record, today: Date) -> Result<(bool, Option<Date>), String> {
    let year_only = match person.metadata.get("date_display") {
        None => false,
        Some(Value::String(value)) if value == "year" => true,
        Some(_) => {
            return Err(format!(
                "person {} has an unsupported date_display; use year or remove it",
                person.id
            ));
        }
    };
    let texts: Vec<&str> = BIRTH_KEYS
        .iter()
        .filter_map(|key| person.text(key))
        .collect();
    let birth = texts.iter().find_map(|text| parse_full(text));
    let living = person.metadata.get("living") != Some(&Value::Bool(false));
    // An unreadable date with a day or month number may still be a minor's full date:
    // protect it unless its year shows an adult.
    let unreadable_could_be_minor = || {
        texts.iter().any(|text| {
            has_short_number(text)
                && first_year(text).is_none_or(|year| today.year.saturating_sub(year) <= ADULT_AGE)
        })
    };
    let minor =
        living && birth.map_or_else(unreadable_could_be_minor, |date| is_minor(date, today));
    // The leak scan looks for one full date, so every birth field of a protected person must be
    // that date, or carry no day or month at all.
    let unprotectable = texts.iter().any(|text| {
        parse_full(text).map_or_else(|| has_short_number(text), |date| Some(date) != birth)
    });
    if (year_only || minor) && unprotectable {
        return Err(format!(
            "person {} has a birth date the site cannot protect; write it once as YYYY-MM-DD",
            person.id
        ));
    }
    Ok((year_only || minor, birth))
}

/// Replace full dates under `keys` with their year.
fn reduce_dates(metadata: &mut Value, keys: &[&str]) {
    let Some(map) = metadata.as_object_mut() else {
        return;
    };
    for key in keys {
        if let Some(date) = map.get(*key).and_then(Value::as_str).and_then(parse_full) {
            map.insert((*key).to_owned(), Value::from(date.year.to_string()));
        }
    }
}

fn number_runs(text: &str) -> impl Iterator<Item = &str> {
    text.split(|character: char| !character.is_ascii_digit())
        .filter(|run| !run.is_empty())
}

/// The first standalone four-digit number in a date phrase.
fn first_year(text: &str) -> Option<i64> {
    number_runs(text)
        .find(|run| run.len() == 4)
        .and_then(digits)
}

/// Whether a date phrase has a one- or two-digit number, such as a day or month.
fn has_short_number(text: &str) -> bool {
    number_runs(text).any(|run| run.len() <= 2)
}

/// Every textual form in which a full date is commonly written.
fn forms(date: Date) -> BTreeSet<String> {
    let Date { year, month, day } = date;
    // Years are four digits in every accepted form, so they are padded everywhere.
    let year = format!("{year:04}");
    let days = [day.to_string(), format!("{day:02}")];
    let months = [month.to_string(), format!("{month:02}")];
    let mut forms = BTreeSet::from([format!("{year}-{month:02}-{day:02}")]);
    for numeric_day in &days {
        for numeric_month in &months {
            forms.insert(format!("{numeric_day}.{numeric_month}.{year}"));
        }
    }
    let names = usize::try_from(month)
        .ok()
        .and_then(|number| MONTHS.get(number.checked_sub(1)?));
    if let Some((english, german)) = names {
        for name in [english, german] {
            for numeric_day in &days {
                forms.insert(format!("{numeric_day} {name} {year}"));
                forms.insert(format!("{numeric_day}. {name} {year}"));
                forms.insert(format!("{name} {numeric_day}, {year}"));
            }
        }
    }
    forms
}

/// A form matches only when no digit touches it, so `3. März 2000` does not match `13. März 2000`.
fn contains_form(text: &str, form: &str) -> bool {
    text.match_indices(form).any(|(index, _)| {
        let before = text.get(..index).and_then(|head| head.chars().next_back());
        let after = text
            .get(index.saturating_add(form.len())..)
            .and_then(|tail| tail.chars().next());
        !before.is_some_and(|character| character.is_ascii_digit())
            && !after.is_some_and(|character| character.is_ascii_digit())
    })
}

/// An inline declaration (claim, citation, event) marked private.
fn is_private(value: &Value) -> bool {
    value.get("private") == Some(&Value::Bool(true))
}

/// Privacy filter for values that may name omitted records.
struct Pruner<'a> {
    archive: &'a Archive,
    omitted: &'a BTreeSet<String>,
}

impl Pruner<'_> {
    fn dangling_text(&self, key: &str, text: &str) -> bool {
        (ID_KEYS.contains(&key) && self.omitted.contains(text))
            || (text.starts_with("[[")
                && self
                    .archive
                    .resolve_link(text)
                    .is_ok_and(|target| self.omitted.contains(&target.id)))
    }

    fn dangling_value(&self, key: &str, value: &Value) -> bool {
        matches!(value, Value::String(text) if self.dangling_text(key, text))
    }

    /// A list item is dropped when it names an omitted record, or when it is a claim declaration
    /// whose `person` is omitted.
    fn dangling_item(&self, key: &str, item: &Value) -> bool {
        match item {
            Value::Object(map) => {
                is_private(item)
                    || map
                        .get("person")
                        .and_then(Value::as_str)
                        .is_some_and(|text| self.dangling_text("person", text))
            }
            other => self.dangling_value(key, other),
        }
    }

    fn prune(&self, value: &mut Value, key: &str) {
        match value {
            Value::Array(items) => {
                items.retain(|item| !self.dangling_item(key, item));
                for item in items {
                    self.prune(item, key);
                }
            }
            Value::Object(map) => {
                map.retain(|name, item| !self.dangling_value(name, item) && !is_private(item));
                for (name, item) in map.iter_mut() {
                    self.prune(item, name);
                }
            }
            _ => {}
        }
    }
}

/// Record IDs left out of the site: private records, records they own, and claims touching them.
fn omitted_ids(archive: &Archive) -> BTreeSet<String> {
    let mut omitted: BTreeSet<String> = archive
        .records
        .iter()
        .filter(|record| record.metadata.get("private") == Some(&Value::Bool(true)))
        .map(|record| record.id.clone())
        .collect();
    for record in &archive.records {
        if record
            .owner
            .as_ref()
            .is_some_and(|owner| omitted.contains(owner))
        {
            omitted.insert(record.id.clone());
        }
    }
    for edge in archive.edges() {
        if omitted.contains(&edge.from) || omitted.contains(&edge.to) {
            omitted.insert(edge.id);
        }
    }
    omitted
}

fn record_json(
    record: &Record,
    pruner: &Pruner,
    protected: &BTreeMap<String, Option<Date>>,
) -> Result<Value, String> {
    let mut value = serde_json::to_value(record).map_err(|error| error.to_string())?;
    let fields = value
        .as_object_mut()
        .ok_or("record must serialize as an object")?;
    // The viewer cannot edit, so the raw note text stays out. `body` is the Markdown after the frontmatter.
    fields.remove("raw");
    let mut metadata = fields.remove("metadata").unwrap_or_default();
    pruner.prune(&mut metadata, "");
    if record.kind == "person" && protected.contains_key(&record.id) {
        reduce_dates(&mut metadata, &BIRTH_KEYS);
    }
    // The derived birth event is an `event` record whose ID is `derived:<owner>:birth`.
    let birth_event = record.owner.as_ref().is_some_and(|owner| {
        protected.contains_key(owner) && record.id == format!("derived:{owner}:birth")
    });
    if birth_event {
        reduce_dates(&mut metadata, &["date"]);
    }
    fields.insert("metadata".into(), metadata);
    Ok(value)
}

fn edges_json(archive: &Archive, omitted: &BTreeSet<String>) -> Result<Vec<Value>, String> {
    archive
        .edges()
        .into_iter()
        .filter(|edge| {
            !omitted.contains(&edge.id)
                && !omitted.contains(&edge.from)
                && !omitted.contains(&edge.to)
        })
        .map(|mut edge| {
            edge.sources.retain(|id| !omitted.contains(id));
            serde_json::to_value(&edge).map_err(|error| error.to_string())
        })
        .collect()
}

/// The portrait file a kept person shows, if its link target survives the privacy filter.
fn portrait_path(archive: &Archive, pruner: &Pruner, person: &Record) -> Option<String> {
    let portrait = person.text("portrait")?;
    if pruner.dangling_text("portrait", portrait) {
        return None;
    }
    if portrait.starts_with("[[") {
        archive
            .resolve_link(portrait)
            .ok()?
            .text("file")
            .map(str::to_owned)
    } else {
        Some(portrait.to_owned())
    }
}

fn is_image(path: &str) -> bool {
    web::attachment_content_type(Path::new(path)).starts_with("image/")
}

/// Portrait images of kept people, in the archive's manifest shape. Source attachments are never listed.
fn portraits(archive: &Archive, pruner: &Pruner) -> Vec<Attachment> {
    let wanted: BTreeSet<(String, String)> = archive
        .records
        .iter()
        .filter(|record| {
            record.kind == "person"
                && record.owner.is_none()
                && !pruner.omitted.contains(&record.id)
        })
        .filter_map(|person| {
            portrait_path(archive, pruner, person).map(|path| (person.id.clone(), path))
        })
        .collect();
    web::attachment_manifest(archive)
        .into_iter()
        .filter(|attachment| {
            wanted.contains(&(attachment.record.clone(), attachment.path.clone()))
                && is_image(&attachment.path)
        })
        .collect()
}

fn escape_attribute(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// The embedded shell with the site settings and the page policy added to its head.
fn index_html(options: &Options) -> Result<String, String> {
    #[derive(Serialize)]
    struct Settings<'a> {
        view: &'a str,
        suggest: Option<&'a str>,
    }
    let settings = Settings {
        view: options.view.name(),
        suggest: options.suggest.as_deref(),
    };
    let content =
        escape_attribute(&serde_json::to_string(&settings).map_err(|error| error.to_string())?);
    let (head, body) = web::INDEX
        .split_once("</head>")
        .ok_or("viewer shell has no head")?;
    Ok(format!(
        "{head}  <meta name=\"kindred-site\" content=\"{content}\">\n  <meta http-equiv=\"Content-Security-Policy\" content=\"{policy}\">\n</head>{body}",
        policy = page_policy(options.suggest.as_deref())
    ))
}

/// The page policy, with an `https://` suggestion host allowed as a connection target. The host is
/// restricted to plain characters, so a suggestion URL cannot add directives to the policy.
fn page_policy(suggest: Option<&str>) -> String {
    let host = suggest
        .and_then(|url| url.strip_prefix("https://"))
        .and_then(|rest| rest.split(['/', '?', '#']).next())
        .filter(|host| {
            !host.is_empty()
                && host.chars().all(|character| {
                    character.is_ascii_alphanumeric() || ".-:[]".contains(character)
                })
        });
    host.map_or_else(
        || web::PAGE_POLICY.to_owned(),
        |host| {
            web::PAGE_POLICY.replacen(
                "connect-src 'self'",
                &format!("connect-src 'self' https://{host}"),
                1,
            )
        },
    )
}

/// The published graph, in the documented field order.
#[derive(Serialize)]
struct Graph {
    records: Vec<Value>,
    edges: Vec<Value>,
    attachments: Vec<Attachment>,
    diagnostics: Vec<Value>,
}

struct Plan {
    graph: Graph,
    index: String,
    copies: BTreeSet<String>,
    protected: Vec<(String, Date)>,
    report: Report,
}

fn plan(archive: &Archive, options: &Options) -> Result<Plan, String> {
    let mut protected = BTreeMap::new();
    for person in archive
        .records
        .iter()
        .filter(|record| record.kind == "person" && record.owner.is_none())
    {
        let (hidden, birth) = protection(person, options.today)?;
        if hidden {
            protected.insert(person.id.clone(), birth);
        }
    }
    let omitted = omitted_ids(archive);
    let pruner = Pruner {
        archive,
        omitted: &omitted,
    };
    let records = archive
        .records
        .iter()
        .filter(|record| !omitted.contains(&record.id))
        .map(|record| record_json(record, &pruner, &protected))
        .collect::<Result<Vec<_>, _>>()?;
    let edges = edges_json(archive, &omitted)?;
    let attachments = portraits(archive, &pruner);
    let kept_protected = protected.keys().filter(|id| !omitted.contains(*id)).count();
    let report = Report {
        records: records.len(),
        edges: edges.len(),
        attachments: attachments.len(),
        protected_people: kept_protected,
    };
    Ok(Plan {
        copies: attachments.iter().map(|item| item.path.clone()).collect(),
        protected: protected
            .iter()
            .filter_map(|(id, birth)| birth.map(|date| (id.clone(), date)))
            .collect(),
        index: index_html(options)?,
        graph: Graph {
            records,
            edges,
            attachments,
            diagnostics: Vec::new(),
        },
        report,
    })
}

/// Build a static viewer for `root` in a new `destination`. Nothing is published unless every
/// check passes.
/// # Errors
/// Rejects invalid archives and existing destinations, and fails when a protected person's full
/// birth date would appear in the published text. Filesystem failures are reported too.
pub fn build(root: &Path, destination: &Path, options: &Options) -> Result<Report, String> {
    exchange::new_destination(root, destination)?;
    let archive = Archive::load(root)?;
    if !archive.diagnostics.is_empty() {
        return Err("archive has validation errors; run kindred check".into());
    }
    let plan = plan(&archive, options)?;
    exchange::staged_directory(destination, |stage| {
        for (name, contents) in ASSETS {
            fs::write(stage.join(name), contents).map_err(|error| error.to_string())?;
        }
        fs::write(stage.join("index.html"), &plan.index).map_err(|error| error.to_string())?;
        fs::write(
            stage.join("graph.json"),
            serde_json::to_vec(&plan.graph).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        for path in &plan.copies {
            let source = archive.attachment(path)?;
            let target = stage.join("attachments").join(path);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::copy(source, target).map_err(|error| error.to_string())?;
        }
        verify(stage, &plan.protected)?;
        Ok(plan.report)
    })
}

/// Check the staged files as written: references resolve and no protected birth date appears
/// in any text file.
fn verify(stage: &Path, protected: &[(String, Date)]) -> Result<(), String> {
    let graph: Value = serde_json::from_slice(
        &fs::read(stage.join("graph.json")).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    verify_references(&graph)?;
    for entry in fs::read_dir(stage).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        // Month names may be written in any case, so compare lowercased text.
        let text = fs::read_to_string(entry.path())
            .map_err(|error| format!("cannot read {name}: {error}"))?
            .to_lowercase();
        for (id, date) in protected {
            if forms(*date)
                .iter()
                .any(|form| contains_form(&text, &form.to_lowercase()))
            {
                return Err(format!(
                    "site build stopped: protected person {id} has a full birth date in {name}; keep only the year in visible text"
                ));
            }
        }
    }
    Ok(())
}

fn verify_references(graph: &Value) -> Result<(), String> {
    let records = graph
        .get("records")
        .and_then(Value::as_array)
        .ok_or("graph.json has no records")?;
    let ids: BTreeSet<&str> = records
        .iter()
        .filter_map(|record| record.get("id").and_then(Value::as_str))
        .collect();
    let known = |value: Option<&Value>| {
        value
            .and_then(Value::as_str)
            .is_some_and(|id| ids.contains(id))
    };
    if records.iter().any(|record| record.get("raw").is_some()) {
        return Err("graph.json must not contain raw note text".into());
    }
    let owners_known = records.iter().all(|record| {
        record
            .get("owner")
            .and_then(Value::as_str)
            .is_none_or(|id| ids.contains(id))
    });
    if !owners_known {
        return Err("graph.json has a record owned by an omitted record".into());
    }
    let edges = graph
        .get("edges")
        .and_then(Value::as_array)
        .ok_or("graph.json has no edges")?;
    for edge in edges {
        let sources_known = edge
            .get("sources")
            .and_then(Value::as_array)
            .is_some_and(|items| {
                items
                    .iter()
                    .all(|item| item.as_str().is_some_and(|id| ids.contains(id)))
            });
        if !known(edge.get("from")) || !known(edge.get("to")) || !sources_known {
            return Err("graph.json has an edge to an omitted record".into());
        }
    }
    let attachments = graph
        .get("attachments")
        .and_then(Value::as_array)
        .ok_or("graph.json has no attachments")?;
    if attachments.iter().any(|item| !known(item.get("record"))) {
        return Err("graph.json lists an attachment for an omitted record".into());
    }
    Ok(())
}

#[cfg(test)]
mod calendar_tests {
    use super::{Date, civil_from_days, contains_form, forms, parse_full};

    #[test]
    fn converts_day_counts_across_leap_days() {
        let date = |days| civil_from_days(days).map(|date| (date.year, date.month, date.day));
        assert_eq!(date(0), Some((1970, 1, 1)));
        assert_eq!(date(-1), Some((1969, 12, 31)));
        assert_eq!(date(11_016), Some((2000, 2, 29)));
        assert_eq!(date(11_017), Some((2000, 3, 1)));
        assert_eq!(date(19_782), Some((2024, 2, 29)));
    }

    #[test]
    fn reads_every_listed_full_date_form() {
        let expected = Some((2017, 9, 26));
        for text in [
            "2017-09-26",
            "26.09.2017",
            "26.9.2017",
            "26 September 2017",
            "26. September 2017",
            "September 26, 2017",
        ] {
            assert_eq!(parse_full(text).map(as_tuple), expected, "{text}");
        }
        assert_eq!(parse_full("3. März 2000").map(as_tuple), Some((2000, 3, 3)));
        assert_eq!(parse_full("about 1900"), None);
        assert_eq!(parse_full("1818 or 1821"), None);
    }

    #[test]
    fn matches_full_dates_only_when_no_digit_touches_them() {
        let march = Date::parse_iso("2000-03-03").expect("valid test date");
        assert!(forms(march).contains("3. März 2000"));
        assert!(contains_form("Geboren am 3. März 2000.", "3. März 2000"));
        assert!(!contains_form("Am 13. März 2000.", "3. März 2000"));
        assert!(!contains_form("Notiz 2000-03-031", "2000-03-03"));
    }

    fn as_tuple(date: Date) -> (i64, i64, i64) {
        (date.year, date.month, date.day)
    }
}
