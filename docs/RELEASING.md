# Releasing Kindred

The first release is `0.1.0`. Read [the roadmap](ROADMAP.md) for the implemented
scope and verification limits, and [GitHub Releases](https://github.com/niklas-heer/kindred/releases)
for published artifacts.

## Conventional Commits and release notes

Use Conventional Commits. Pinned git-cliff 2.14.2 generates `CHANGELOG.md` with
commit links, requires conventional messages, and preserves breaking changes.
The initial version is explicitly `0.1.0`; subsequent versions follow Semantic
Versioning, with pre-1.0 compatibility changes documented in the notes.

Before creating a version tag, run `mise run changelog -- --tag v0.1.0` with the
intended version and review the result. Commit release preparation with
`chore(release): prepare v0.1.0` (excluded from the notes). Cargo-dist reads that
version's changelog section into the GitHub release. `mise run release:notes`
prints the current tagged version's notes without modifying files.

## What the pipeline does

`dist-workspace.toml` is the source of truth for cargo-dist 0.32.0. Its generated
`.github/workflows/release.yml` plans releases on pull requests and publishes
when a matching version tag is pushed. A custom artifact-stage job invokes
`check.yml`, including Dagger and native tests. Its result is a direct dependency
of the publishing job, so failed checks block publication.

Targets: Linux x86-64 (GNU), macOS ARM64 and x86-64, and Windows x86-64 (MSVC).
Archives include the binary, README, MIT license, documentation, and example
archives. Releases include SHA-256
checksums and shell/PowerShell installers. The GitHub-provided token is sufficient
for GitHub Releases; no personal token or registry secret is required.

These are unsigned CLI distributions. Signing/notarization, desktop packages,
and crates.io publication are not configured. Homebrew publication uses the
separate tap procedure below, without a cross-repository CI credential. Inspect the
generated plan for platform/runtime requirements; do not advertise support for
unbuilt targets.

## Preview without publishing

```sh
mise run check
mise run ci
mise run release:check
mise run release:build
mise run workflow:check
```

`release:check` detects stale generated CI and prints the artifact plan.
`release:build` creates host archives under `target/distrib/` without uploading.
Build release artifacts from a clean isolated checkout. Cargo-dist copies
included directories recursively, including ignored files: local `.kindred`
indexes, recovery journals, `.obsidian` state, and other scratch data must not
be present under `docs` or `examples`. Do not remove a pending edit journal just
to package a release; use a fresh checkout instead. See cargo-dist's
[include behavior](https://axodotdev.github.io/cargo-dist/book/reference/config.html#include).

Inspect the archive, its license and checksum, extract it to a temporary
directory, and run `kindred --version`, `kindred --help`, and `kindred check`
on each bundled example. Confirm no generated caches or local configuration
were included. Source archives use Git's committed tree, so uncommitted source
changes are not a valid release candidate.

## Publish a version

1. Update `version` in `Cargo.toml`. Run `mise exec -- cargo generate-lockfile`
   to update the package entry in `Cargo.lock`. Generate and review the changelog
   using the intended tag. Use Semantic Versioning;
   pre-1.0 format changes still need clear migration notes.
2. Run the preview checks above and inspect the plan with the intended tag,
   for example `mise exec -- dist plan --tag v0.1.0`. Review the release contents,
   then commit and push the version change. Wait for the main-branch checks.
3. From that tested commit, create and push only the intended tag:

   ```sh
   git tag -a v0.1.0 -m "Kindred 0.1.0"
   git push origin v0.1.0
   ```

4. Watch the Release workflow in GitHub Actions. Confirm the published release
   contains all four target archives, checksums, installers, and accurate notes.
   Test a downloaded archive and installer before announcing it.

## Publish to Homebrew

The existing tap is [`niklas-heer/homebrew-tap`](https://github.com/niklas-heer/homebrew-tap).
After the GitHub release succeeds, update `Formula/kindred.rb` there with the
published macOS ARM64/x86-64 and Linux x86-64 archives and their SHA-256 hashes.
Download and independently hash every referenced archive. Inspect the distribution
manifest for minimum macOS/glibc requirements; do not infer them from the target
triple. Keep the install method's bundled examples/docs and the CLI smoke test.

Run Homebrew style/audit checks, install the formula, and run `brew test` before
pushing the formula and README update to the tap. The tap's Kindred workflow
repeats those checks against the published commit. Users install with:

```sh
brew install niklas-heer/tap/kindred
```

Publishing the app tag does not update the tap automatically. This intentionally
uses the maintainer's existing Git access rather than adding a cross-repository
token to release CI.

For a prerelease use a matching Cargo version and tag such as
`0.1.0-alpha.1` / `v0.1.0-alpha.1`. Do not move or overwrite a published version
tag. Inspect failed workflow stages before retrying; if artifacts or a release
already exist, preserve them and decide whether a new patch version is needed.

## Change release automation

Edit `dist-workspace.toml`, then run:

```sh
mise exec -- dist generate
mise run release:check
```

Do not hand-edit the generated release workflow. Update its action pins in the
dist configuration and regenerate; Dependabot proposals touching that workflow
also need to be reflected in the generator input. Keep cargo-dist's mise pin
and config version aligned. Recheck the reused checks after updating Dagger,
Rust, mise, runner images, or cargo-dist. On a pull request, set
`pr-run-mode = "upload"` temporarily to exercise the complete packaging workflow
without publishing a release, then return it to `"plan"` for routine changes.
