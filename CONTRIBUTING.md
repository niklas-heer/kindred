# Contributing

Read [VISION.md](docs/VISION.md) and [ROADMAP.md](docs/ROADMAP.md) before starting
a feature. The project is at the foundation stage: archive/schema and interface
work should begin with the small end-to-end workflow described there.

## Setup and checks

Install [mise](https://mise.jdx.dev/getting-started.html) 2026.9.5 or a compatible
newer version; CI pins 2026.9.5. Install your platform's native Rust build tools:
Xcode Command Line Tools on macOS, a C compiler/linker on Linux, or Visual Studio
C++ Build Tools on Windows. From a checkout of this repository, run:

```sh
mise trust
mise install
mise run fmt
mise run check
mise run build
```

`check` runs rustfmt, `cargo check`, Clippy with warnings denied, and tests using
the committed lockfile. Rust 1.97.1 is the development/release toolchain; Rust
1.97 is the declared minimum. Keep the toolchain, mise, Cargo metadata, and
release configuration aligned when upgrading. Use Rust Analyzer in your editor.

The CLI tests execute the real binary and assert its output and error behavior.
Keep tests fast, isolated, and deterministic. Add unit or property tests for
edge cases where they provide better coverage; add documentation tests when a
library API exists. Evaluate deterministic simulation when file persistence,
conflicting edits, and recovery become real behaviors.

## Containerized checks

`mise run ci` invokes Dagger 0.21.9 with the Dang SDK. On Linux, use a running
Docker-compatible engine. On macOS, Colima's Docker runtime is the tested path;
Apple's native container tooling is an alternative only after verifying its
Dagger integration. Check `docker context show` and `docker info` first.

The module invokes the same Rust tasks in a versioned Linux container and
smoke-tests the release binary. No Dagger Cloud account or token is required.
GitHub also runs native checks and archive builds on Linux, macOS, and Windows;
a Linux container on a Mac does not replace native macOS testing.

When editing the module, run `mise exec -- dagger functions` and `mise run ci`.
Verify failure propagation by running the pipeline against a disposable source
copy with a deliberately failing check, without changing the working sources.

## Rust and dependencies

- Prefer stable Rust, the standard library, and a small dependency surface.
- Keep dependency features minimal; commit `Cargo.lock` for this application.
- Formatting and strict Clippy policy are checked in. Unsafe Rust is forbidden.
  Fix issues or document narrow allowances rather than weakening all checks.
- Developer tools belong in mise, not application dependencies. Cargo's test
  runner is enough for the current suite; add nextest, Bacon, or benchmarks when
  there is a concrete benefit. No web or database framework has been selected.
- Preserve structured errors and useful CLI exit codes. Current usage errors
  return 2; future validation/setup errors need a documented contract.

## Data and changes

Use fictional family records in examples and tests. Preserve unknown metadata
and user-authored prose when implementing editing. Do not treat ordinary links
in prose as genealogical assertions. Validate typed records before indexing.

Keep changes coherent, explain observable behavior, and include relevant test
results. Update the roadmap and decision log when the architecture changes.
Do not claim a proposal is implemented. Before committing, run `git diff --check`.

For release configuration, edit `dist-workspace.toml`, run
`mise exec -- dist generate`, and run `mise run release:check`. The generated
release workflow must match its source configuration. See
[RELEASING.md](docs/RELEASING.md).

`mise run workflow:check` validates Actions syntax and expressions with pinned
actionlint. ShellCheck is not required by this task; native CI executes the
workflow commands on each supported platform.
