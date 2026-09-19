use kindred::{
    archive::Archive,
    editing, exchange,
    query::{self, QueryOptions, QueryResult},
    web,
};
use std::{env, fs, path::Path, process::ExitCode};

const HELP: &str = "Kindred — a local family-history graph built from your notes
Usage: kindred <command> <archive> [arguments] [options]

Commands:
  init <archive>                            Create an empty archive
  check <archive> [--json]                   Validate records and links
  reindex <archive>                          Rebuild the disposable index
  show <archive> <id> [--json]                Read a complete note
  ancestors|descendants|neighbors <archive> <id>
  path <archive> <from> <to>                 Find a shortest relationship path
  overview <archive>                         Select the whole family
  serve <archive> [--port 3000]               Explore and edit on localhost
  edit <archive> <id> --expected FILE --from FILE
  edit <archive> <id> --expected FILE --body FILE
  recover <archive>                          Finish an interrupted note edit
  export <archive> <new-directory> --all|--public
  export-gedcom <archive> <new-directory> --all|--public
  import-gedcom <file.ged> <new-archive>      Import with a mapping/loss report

Query options:
  --generations N       Maximum generations/hops (default 4)
  --relations LIST      Comma-separated biological_parent,adoptive_parent,
                        foster_parent,partner (default all)
  --statuses LIST       accepted,tentative,disputed,rejected (default accepted)
  --json                Structured results with claims and evidence references

Export scope is required. --all includes private/living records and attachments;
--public emits a minimal projection of explicitly deceased, non-private people.
GEDCOM is a lossy interchange subset; use export --all for complete backups.
Exit codes: 0 success, 1 validation/operation failure, 2 usage error.
  -h, --help            Show this help
  -V, --version         Show the version";

struct Arguments {
    positional: Vec<String>,
    options: std::collections::BTreeMap<String, String>,
}
impl Arguments {
    fn parse(values: impl Iterator<Item = String>) -> Result<Self, String> {
        let mut result = Self {
            positional: Vec::new(),
            options: std::collections::BTreeMap::new(),
        };
        let mut values = values.peekable();
        while let Some(value) = values.next() {
            if value.starts_with('-') {
                if !matches!(
                    value.as_str(),
                    "--json"
                        | "--all"
                        | "--public"
                        | "--generations"
                        | "--relations"
                        | "--statuses"
                        | "--port"
                        | "--expected"
                        | "--from"
                        | "--body"
                ) {
                    return Err(format!("usage: unknown option {value}; try --help"));
                }
                let argument = if matches!(value.as_str(), "--json" | "--all" | "--public") {
                    String::new()
                } else {
                    if values.peek().is_none_or(|s| s.starts_with("--")) {
                        return Err(format!("usage: {value} needs a value; try --help"));
                    }
                    values
                        .next()
                        .ok_or("usage: missing option value; try --help")?
                };
                if result.options.insert(value.clone(), argument).is_some() {
                    return Err(format!("usage: repeated option {value}; try --help"));
                }
            } else {
                result.positional.push(value);
            }
        }
        Ok(result)
    }
    fn validate(&self, count: usize, options: &[&str]) -> Result<(), String> {
        if self.positional.len() != count {
            return Err("usage: wrong number of arguments; try --help".into());
        }
        for key in self.options.keys() {
            if !options.contains(&key.as_str()) {
                return Err(format!(
                    "usage: option {key} does not apply to this command; try --help"
                ));
            }
        }
        Ok(())
    }
    fn at(&self, index: usize) -> Result<&str, String> {
        self.positional
            .get(index)
            .map(String::as_str)
            .ok_or_else(|| "usage: missing argument; try --help".into())
    }
    fn option(&self, name: &str) -> Option<&str> {
        self.options.get(name).map(String::as_str)
    }
}
fn json(value: &impl serde::Serialize) -> Result<(), String> {
    println!(
        "{}",
        serde_json::to_string_pretty(value).map_err(|e| e.to_string())?
    );
    Ok(())
}
fn load(root: &Path) -> Result<Archive, String> {
    let archive = Archive::load(root)?;
    if !archive.diagnostics.is_empty() {
        return Err("archive has validation errors; run kindred check".into());
    }
    Ok(archive)
}
fn query_options(args: &Arguments) -> Result<QueryOptions, String> {
    let mut options = QueryOptions::default();
    if let Some(value) = args.option("--generations") {
        options.generations = value
            .parse()
            .map_err(|_| "usage: --generations must be a nonnegative integer; try --help")?;
    }
    if let Some(value) = args.option("--relations") {
        options.relations = value.split(',').map(str::to_owned).collect();
    }
    if let Some(value) = args.option("--statuses") {
        options.statuses = value.split(',').map(str::to_owned).collect();
    }
    for relation in &options.relations {
        if ![
            "biological_parent",
            "adoptive_parent",
            "foster_parent",
            "partner",
        ]
        .contains(&relation.as_str())
        {
            return Err(format!("usage: unknown relation {relation}; try --help"));
        }
    }
    for status in &options.statuses {
        if !["accepted", "tentative", "disputed", "rejected"].contains(&status.as_str()) {
            return Err(format!("usage: unknown status {status}; try --help"));
        }
    }
    Ok(options)
}
fn print_query(result: &QueryResult, structured: bool) -> Result<(), String> {
    if structured {
        return json(result);
    }
    for record in &result.nodes {
        println!("{}\t{}", record.id, record.name);
    }
    for edge in &result.edges {
        println!(
            "{}\t{} → {}\t{} [{}] sources: {}",
            edge.id,
            edge.from,
            edge.to,
            edge.relation,
            edge.status,
            edge.sources.join(", ")
        );
    }
    Ok(())
}
fn initialize(root: &Path) -> Result<(), String> {
    exchange::staged_directory(root, |stage| {
        for directory in ["people", "attachments"] {
            fs::create_dir(stage.join(directory)).map_err(|e| e.to_string())?;
        }
        fs::write(stage.join("README.md"), "# Family archive\n\nWrite one Markdown note per person with version: 1, id, type: person, and name. Add mother/father/partners links, dates, places, sources, and stories in that note; Kindred builds the graph. The people folder is optional: organize notes in any folders, including family subfolders. Keep pictures and documents together in attachments (or another folder you choose). See https://github.com/niklas-heer/kindred/blob/main/docs/SCHEMA.md.\n").map_err(|e| e.to_string())
    })
}
fn run(args: &Arguments) -> Result<u8, String> {
    let command = args.at(0)?;
    let root = Path::new(args.at(1)?);
    match command {
        "init" => {
            args.validate(2, &[])?;
            initialize(root)?;
            println!("Created {}", root.display());
        }
        "check" => {
            args.validate(2, &["--json"])?;
            let archive = Archive::load(root)?;
            if args.option("--json").is_some() {
                json(
                    &serde_json::json!({"records":archive.records.len(),"diagnostics":archive.diagnostics}),
                )?;
            } else if archive.diagnostics.is_empty() {
                println!("Valid archive: {} records", archive.records.len());
            } else {
                for diagnostic in &archive.diagnostics {
                    eprintln!(
                        "{}: {}: {}",
                        diagnostic.path, diagnostic.code, diagnostic.message
                    );
                }
            }
            return Ok(u8::from(!archive.diagnostics.is_empty()));
        }
        "reindex" => {
            args.validate(2, &[])?;
            println!("Rebuilt {}", load(root)?.reindex()?.display());
        }
        "show" => {
            args.validate(3, &["--json"])?;
            let archive = load(root)?;
            let record = archive.record(args.at(2)?).ok_or("unknown record ID")?;
            if args.option("--json").is_some() || record.raw.is_empty() {
                json(record)?;
            } else {
                print!("{}", record.raw);
            }
        }
        "ancestors" | "descendants" | "neighbors" | "path" | "overview" => {
            args.validate(
                if command == "overview" {
                    2
                } else if command == "path" {
                    4
                } else {
                    3
                },
                &["--json", "--generations", "--relations", "--statuses"],
            )?;
            let archive = load(root)?;
            let options = query_options(args)?;
            let result = match command {
                "ancestors" => query::ancestors(&archive, args.at(2)?, &options)?,
                "descendants" => query::descendants(&archive, args.at(2)?, &options)?,
                "neighbors" => query::neighborhood(&archive, args.at(2)?, &options)?,
                "path" => query::path(&archive, args.at(2)?, args.at(3)?, &options)?,
                _ => query::overview(&archive, &options),
            };
            print_query(&result, args.option("--json").is_some())?;
        }
        "serve" => {
            args.validate(2, &["--port"])?;
            let port = args
                .option("--port")
                .unwrap_or("3000")
                .parse()
                .map_err(|_| "usage: invalid --port; try --help")?;
            web::serve(root, port)?;
        }
        "edit" => edit(root, args)?,
        "recover" => {
            args.validate(2, &[])?;
            editing::recover(root)?;
            println!("Recovery complete");
        }
        "export" | "export-gedcom" => {
            args.validate(3, &["--all", "--public"])?;
            let all = args.option("--all").is_some();
            if all == args.option("--public").is_some() {
                return Err("usage: choose exactly one of --all or --public; try --help".into());
            }
            let destination = Path::new(args.at(2)?);
            json(&if command == "export" {
                exchange::export(root, destination, all)?
            } else {
                exchange::gedcom::export(root, destination, all)?
            })?;
        }
        "import-gedcom" => {
            args.validate(3, &[])?;
            json(&exchange::gedcom::import(root, Path::new(args.at(2)?))?)?;
        }
        _ => return Err("usage: unrecognized command; try --help".into()),
    }
    Ok(0)
}
fn edit(root: &Path, args: &Arguments) -> Result<(), String> {
    args.validate(3, &["--expected", "--from", "--body"])?;
    let expected = fs::read_to_string(
        args.option("--expected")
            .ok_or("usage: --expected FILE is required; try --help")?,
    )
    .map_err(|e| e.to_string())?;
    if args.option("--from").is_some() == args.option("--body").is_some() {
        return Err("usage: choose --from FILE or --body FILE; try --help".into());
    }
    let replacement = if let Some(path) = args.option("--from") {
        fs::read_to_string(path).map_err(|e| e.to_string())?
    } else {
        let body = fs::read_to_string(args.option("--body").ok_or("missing body")?)
            .map_err(|e| e.to_string())?;
        let mut end = 0usize;
        let mut delimiters = 0usize;
        for line in expected.split_inclusive('\n') {
            end = end.saturating_add(line.len());
            if line.trim_end() == "---" {
                delimiters = delimiters.saturating_add(1);
                if delimiters == 2 {
                    break;
                }
            }
        }
        if delimiters != 2 {
            return Err("expected file has no YAML frontmatter".into());
        }
        format!(
            "{}{body}",
            expected.get(..end).ok_or("invalid frontmatter boundary")?
        )
    };
    editing::replace(root, args.at(2)?, &expected, &replacement)?;
    println!("Saved {}", args.at(2)?);
    Ok(())
}
fn main() -> ExitCode {
    let Ok(values) = env::args_os()
        .skip(1)
        .map(std::ffi::OsString::into_string)
        .collect::<Result<Vec<_>, _>>()
    else {
        eprintln!("kindred: arguments must be UTF-8; try --help");
        return ExitCode::from(2);
    };
    if values.is_empty()
        || matches!(values.as_slice(), [value] if value == "--help" || value == "-h")
    {
        println!("{HELP}");
        return ExitCode::SUCCESS;
    }
    if matches!(values.as_slice(), [value] if value == "--version" || value == "-V") {
        println!("kindred {}", env!("CARGO_PKG_VERSION"));
        return ExitCode::SUCCESS;
    }
    match Arguments::parse(values.into_iter()).and_then(|args| run(&args)) {
        Ok(code) => ExitCode::from(code),
        Err(error) => {
            eprintln!("kindred: {error}");
            ExitCode::from(if error.starts_with("usage:") { 2 } else { 1 })
        }
    }
}
