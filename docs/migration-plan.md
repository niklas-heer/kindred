# Moving from Kindred v1 to v2

Kindred 2.0.0 replaces v1 on `main`. v1 is the Rust CLI and browser graph over Markdown notes;
v2 is a multi-user web app with a database. Installing a v1 CLI binary does not install the v2 server.
See the [release notes](releases/v2.0.0.md) for the changes.

## Keep the original archive

Make a separate copy of your entire v1 archive, including attachments, before importing. Work from that copy.
The importer does not modify it, but it carries only part of its contents into v2. Keep the original after migration.
The v2 database becomes the record you edit in the app; v2 does not watch or sync Markdown files.

## Import a Markdown archive

Install the Node version in `mise.toml` with `mise install`, then run `npm install` in the v2 checkout.
Use a lower-case family id containing letters, digits and dashes; `family` matches the default setup.

1. Put the person notes directly in the copy's `people/` folder. The importer reads `.md` files there only,
   not subfolders. Keep filenames unique and update links if you move or rename notes.
2. Convert and seed the archive:

   ```sh
   node scripts/import-kindred.ts /path/to/archive data/seed/family.json
   node scripts/seed.ts data/seed/family.json
   ```

   An optional third argument to `import-kindred.ts` is the filename of the starting person's note, without `.md`.
   Seeding keeps an existing database. `--force` replaces it after making a copy in `data/backups/`.
3. Run the app with `mise run dev`, open the address it prints, and create the first account with a passkey.
   The first account is steward of the existing families. Invite other members from Access.
4. Compare people, links, dates and biographies with the original. Check ambiguous names and all partnerships by hand.
5. For production, follow [self-host.md](self-host.md) or [deploy-cloudflare.md](deploy-cloudflare.md).
   For Cloudflare, configure the matching `TREE_FAMILY` binding and apply migrations before transferring:

   ```sh
   node scripts/import-to-d1.ts family --plan
   node scripts/import-to-d1.ts family --remote
   ```

   Transfer before first setup, or read the deployment guide's `--replace` instructions if setup already created
   the empty family's details. Accounts and passkeys are not transferred.

## What the Markdown importer carries

It reads ids, splits names into given name and last-word surname, reads birth/death dates and places,
living status, occupations, a single-word nickname from aliases, the note body as biography, parent links
and partnerships. A marriage event supplies its date and place. Houses and arms are generated from surnames.

It does not restore portraits or other attachments, structured stories or sources, current names, titles,
epithets, or explicit sex fields. Sex is inferred from parent roles, which needs checking. Parent confidence is
not restored. Partnerships are keyed by the pair, so repeated unions of the same people collapse into one;
non-marriage start dates, divorce and other end details are not read. Coordinate pins require a separate seed file.
See [exchange.md](exchange.md#limits-of-scriptsimport-kindredts).

The Markdown export is also partial: it includes portraits but omits step-parent links, fields, houses and
stories. Exporting and reimporting is not a lossless backup. Keep the databases, media and sealing secret as described
in the hosting guides.

## GEDCOM alternative

If you already have a GEDCOM file, a steward can import it on **Import and export**. Preview it first;
Kindred lists matches, conflicts and skipped information before any write. Import adds people and links;
it never updates existing people. Check [exchange.md](exchange.md) for supported fields and limits.

## Upgrading an existing v2 installation

Back up accounts, each family database, media and the sealing secret. Node applies pending migrations when a
database opens and saves a copy before migration. Cloudflare needs `mise run cf:migrate:remote` before deployment.
The provider migration preserves the existing AI switches and budget, and moves saved keys and models into provider
connections and feature routes. Check AI settings after upgrading, especially if you previously used a separate
OpenRouter key for portraits alongside an OpenRouter assistant key.
