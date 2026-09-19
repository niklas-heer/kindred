use std::{env, process::ExitCode};

const HELP: &str = "Kindred — a local family-history graph built from your notes

Usage: kindred [--help | --version]

Options:
  -h, --help     Show this help
  -V, --version  Show the version

Kindred is in early development. Archive editing, queries, and the graph
viewer are planned; they are not implemented in this foundation release.
Vision: https://github.com/niklas-heer/kindred/blob/main/docs/VISION.md";

fn main() -> ExitCode {
    let mut arguments = env::args_os().skip(1);
    let first = arguments.next();
    if arguments.next().is_some() {
        eprintln!("kindred: expected at most one option; try --help");
        return ExitCode::from(2);
    }

    match first.as_deref().and_then(std::ffi::OsStr::to_str) {
        None if first.is_none() => {
            println!("{HELP}");
            ExitCode::SUCCESS
        }
        Some("--help" | "-h") => {
            println!("{HELP}");
            ExitCode::SUCCESS
        }
        Some("--version" | "-V") => {
            println!("kindred {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        _ => {
            eprintln!("kindred: unrecognized option or command; try --help");
            ExitCode::from(2)
        }
    }
}
