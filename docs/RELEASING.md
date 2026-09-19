# Releasing Kindred

The initial repository has release automation but no published release. The
current `0.1.0` package version is a starting version, not a promise that the
genealogy features exist.

## What the pipeline does

`dist-workspace.toml` is the source of truth for cargo-dist 0.32.0. Its generated
`.github/workflows/release.yml` plans releases on pull requests and publishes
when a matching version tag is pushed. A custom artifact-stage job invokes
`check.yml`, including Dagger and native tests. Its result is a direct dependency
of the publishing job, so failed checks block publication.

Targets: Linux x86-64 (GNU), macOS ARM64 and x86-64, and Windows x86-64 (MSVC).
Archives include the binary, README, and MIT license. Releases include SHA-256
checksums and shell/PowerShell installers. The GitHub-provided token is sufficient
for GitHub Releases; no personal token or registry secret is required.

These are unsigned CLI distributions. Signing/notarization, desktop packages,
Homebrew publication, and crates.io publication are not configured. Inspect the
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
Inspect the archive, its license and checksum, extract it to a temporary
directory, and run its `kindred --version` and `kindred --help`.

## Publish a version

1. Update `version` in `Cargo.toml`. Run `mise exec -- cargo generate-lockfile`
   to update the package entry in `Cargo.lock`. Move the relevant changelog
   entries from Unreleased to a dated version heading. Use Semantic Versioning;
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
