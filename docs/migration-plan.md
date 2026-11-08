# Migration plan: this repository becomes Kindred v2

This repository (the spike) becomes **Kindred v2** in [niklas-heer/kindred](https://github.com/niklas-heer/kindred), which
is Kindred v1: a Rust CLI and browser graph over a Markdown family archive, MIT-licensed, distributed through a Homebrew
tap, Nix and GitHub Releases. v2 is a different product on the same name: a multi-user web app on Cloudflare (or Node).
The Markdown archive stays as an export format, so nothing a v1 user has is lost.

This page is the plan. Some steps are decisions for the owner, and they are marked as such.

## Decisions for the owner

1. **Where v2 lives.** Recommended: v2 replaces `main` in niklas-heer/kindred, and v1 is kept on a `v1` branch and a
   tag, so its links, its Homebrew formula and its releases keep working. The alternative is a new repository, which
   keeps the history clean but splits the name.
2. **What happens to the Rust CLI.** v1's CLI (`kindred check`, `serve`, `export`) is the v1 product. Options: keep it
   in the v1 branch only (recommended, since v2 does not depend on it); keep it on `main` beside v2; or drop it. The
   Markdown archive works with both.
3. **The Homebrew tap and Nix flake.** They install v1. Keep them pointing at the v1 tag, or retire them when v2 ships.
   Changes to the tap go through a pull request, not a direct push to its main branch.
4. **A production server for Node.** The Node build produces a fetch handler and nothing serves it yet (see
   [self-host.md](self-host.md)). Either write a small runner, or document Cloudflare as the only hosted route.
5. **The licence file.** v1 is MIT. This repository has no LICENSE file yet, so add the MIT file (copyright Niklas Heer)
   when the code moves. The README already says so.
6. **Versioning and changelog.** v1 generates its changelog from Conventional Commits with git-cliff (`cliff.toml`) and
   publishes binaries (`dist-workspace.toml`). Decide whether v2 keeps git-cliff and what the first v2
   version is called.

## Before anything is pushed

- **Check the history for private data.** This repository has no remote and holds the owner's real family in
  `data/`, which is gitignored. Before the code is pushed anywhere, confirm that no commit contains family data, names
  from `data/`, or `data/seed/smith.json`: `git log --all --stat` and `git log -p --all -- data/` are the checks, and
  `git grep` for a name from the real archive. If anything is there, rewrite the history before the push, not after.
- **Check the ignore rules still cover the secrets.** `.gitignore` covers `data/*.db`, `data/seed/smith.json`,
  `data/secret`, `data/backups/`, `.dev.vars`, `.wrangler/` and `data/media/`.
- **Run the checks:** `mise run check`, `mise run test`, and `mise run build` (the Worker build). The exchange tests are
  not in `npm test` until `package.json` lists `src/lib/exchange/*.test.ts`.

## Step by step

### 1. Freeze v1

In niklas-heer/kindred:

1. Make sure the last v1 release is tagged. Tag it if it is not.
2. Create a `v1` branch at the same commit, and push it.
3. Note in v1's README that v2 is coming and where v1 lives now.

Nothing in v1 changes after this except fixes that the owner chooses to backport.

### 2. Land v2

1. Create a `v2` branch in niklas-heer/kindred with this repository's history (or with a single import commit, if
   decision 1 chose a clean start).
2. Replace the v1 README with the v2 README (this repository's `README.md`), and move the v1 documentation that still
   applies (the archive format, `docs/SCHEMA.md`) into `docs/`.
3. Open a pull request from `v2` into `main`. Merge when the checks pass. Tag the first v2 release from `main`.

### 3. Bring a v1 archive into v2

A v1 archive is a folder of Markdown notes. Kindred v2 reads a v1 archive through `scripts/import-kindred.ts`, which
reads the notes in `people/` only. So:

1. **Put the notes in `people/`.** v1 lets you organise notes in any folder. If yours are elsewhere, move the person
   notes into `people/` first (the file names can stay the same, as long as they are unique).
2. **Convert it to the seed format.** From the v2 checkout:

   ```sh
   node scripts/import-kindred.ts /path/to/archive data/seed/<family>.json
   ```

   This reports how many people, parent links, partnerships and houses it made.
3. **Load it locally.** `node scripts/seed.ts data/seed/<family>.json` builds `data/<family>.db`. It never overwrites a
   database that exists unless you pass `--force`, which copies the old file to `data/backups/` first.
4. **Check the result in the app** (`mise run dev`), then compare the counts with `kindred check` on the v1 archive.
5. **For Cloudflare**, once the family has a `TREE_<FAMILY>` binding (see [deploy-cloudflare.md](deploy-cloudflare.md)):

   ```sh
   node scripts/import-to-d1.ts <family> --remote
   ```

What `import-kindred.ts` does not carry is listed in [exchange.md](exchange.md#limits-of-scriptsimport-kindredts): step
parents become nothing, partnership dates are not read, and houses are made from surnames. Stories and sources in the v1
notes are not imported either; keep the v1 archive as the source of truth until you have checked the v2 result.

An alternative for a v1 family that already has a GEDCOM export: import the `.ged` file on the **Import and export**
page. That needs a steward, and it shows a preview before anything is written.

### 4. Check the round trip before you rely on it

- **v2 → v1:** export the family as a Markdown archive from v2 and run v1's `kindred check` on it. The archive is in the
  v1 format, so it should pass. Step-parent links are missing by design.
- **v1 → v2 → v1:** import a v1 archive into v2, export it again, and compare the people and links with the original.
- **Backups:** `kindred export ./my-family ../complete-backup --all` (v1) makes a complete archive; keep one before you
  migrate, and keep the v2 family's database (`data/` or the D1 export) as well.

### 5. Release

1. Run `mise run check`, `mise run test`, `mise run build`.
2. Deploy to Cloudflare with `mise run deploy` (see [deploy-cloudflare.md](deploy-cloudflare.md)), or publish the Node
   route once it exists.
3. Tag the release on `main` and write the release notes (from the commits, if git-cliff is kept).
4. Update the Homebrew tap and the Nix flake only if they point at v2 (decision 3).
5. Record the decision in the project's decision log: v1's log is in `docs/decisions/`, and a new entry should say
   what v2 is, why it replaced v1 on `main`, and what happened to the CLI.

## What stays the same for v1 users

- The Markdown archive format (version 1), which v2 reads and writes.
- The `kindred export` commands, which stay in v1.
- Your notes. v2 writes its own notes in the same format; it does not keep a v1 note byte for byte (only its
  metadata and its biography survive), so keep the original archive as the source of truth.

## What is new in v2

- A family you can share with relatives, with roles, invitations and passkeys.
- Houses, arms, the dynasty view, the Atlas, the Almanac, the Chronicle, photographs, *Needed*.
- Optional AI features, each switched on by a steward.
- GEDCOM 5.5.1 in and out, next to the Markdown archive.
