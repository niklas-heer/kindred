# Kindred

A local family-history graph, built from your notes.

Kindred aims to make family history an archive you own: Markdown biographies,
structured relationships, sources, and photographs, explored through a CLI and
an interactive local graph. Obsidian should be optional, and your files should
remain useful without Kindred.

**Status: project foundation.** The binary currently supports `--help` and
`--version`. Archive editing, genealogy queries, and the web viewer are planned,
not implemented. See [the vision](docs/VISION.md),
[roadmap](docs/ROADMAP.md), and [decisions](docs/DECISIONS.md).

## Development

Install [mise](https://mise.jdx.dev/getting-started.html) and your platform's Rust
linker prerequisites (Xcode Command Line Tools on macOS, a C compiler/linker on
Linux, or Visual Studio C++ Build Tools on Windows). Then:

```sh
git clone https://github.com/niklas-heer/kindred.git
cd kindred
mise trust
mise install
mise run check
mise exec -- cargo run -- --help
```

The project pins stable Rust, Dagger, cargo-dist, and actionlint. Rustfmt, Clippy, Rust
Analyzer, and Rust source are included in the toolchain setup. All contributor
instructions live in this repository; no personal skills or hub checkout are
needed. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Builds and releases

```sh
mise run build
mise run release:check
mise run release:build
```

The release pipeline packages Linux x86-64, macOS Apple Silicon and Intel, and
Windows x86-64 binaries, with checksums and shell/PowerShell installers. It runs
the checks before publishing a matching version tag as a GitHub Release.
These are CLI archives, not signed desktop application bundles. The initial
setup does not publish a release or a crates.io package.

[Release procedure](docs/RELEASING.md) ·
[GitHub releases](https://github.com/niklas-heer/kindred/releases)

## License

[MIT](LICENSE). The software license does not change ownership or licensing of
family records that users store with it.
