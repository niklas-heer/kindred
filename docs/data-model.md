# Data model

Kindred keeps data in two kinds of database, with one set of migrations each:

- **The accounts database**, one per installation: who people are, their passkeys and sessions, the families they
  belong to, invitations, and each family's AI settings and assistant conversations. `migrations/accounts/`. On Node it
  is `data/accounts.db`; on Cloudflare it is the `ACCOUNTS` D1 binding.
- **A family database**, one per family: the people, their links, stories, places, pictures and houses. `migrations/tree/`.
  On Node it is `data/<id>.db`; on Cloudflare it is the `TREE_<ID>` D1 binding.

Migrations are plain SQL files named `NNNN_name.sql`. They run in order, on Node when a file is opened and on D1 with
`mise run cf:migrate` or `cf:migrate:remote`. Both use the same files and the same `d1_migrations` table. A file that
has shipped is never edited: a change is a new file. A migration must run on SQLite and on D1, so it has no `PRAGMA`,
no `BEGIN` and no `COMMIT`, and a new `NOT NULL` column has a default.

The schema is defined in `src/lib/schema.ts`, which also explains the rules above.

## The family database (`migrations/tree`)

| Migration | What it adds |
| --- | --- |
| `0001_initial.sql` | The first schema, as it was before versioned migrations, so older files pass through it unchanged (every statement is `IF NOT EXISTS`). |
| `0002_guard_and_media.sql` | The `guard` view and its trigger (see below); the `op` table for retry keys; portraits move from `photo` BLOBs to media storage. |
| `0003_person_fields.sql` | The birth name and the current name on `person`, and `person_field`: the list of a person's fields (phone, address, school, diet…). |
| `0004_media.sql` | The gallery: `album`, `media` (pictures and their dates, places and albums) and `media_person` (face boxes). |
| `0005_house_succession.sql` | `house_succession`: each house's head, heir, succession law and country. |

### Tables

- **`meta`**: the family's own facts (`id`, `name`, `tagline`, `theme`, `focus`, the person the tree opens on).
- **`house`**: a house (`id`, `name`, `motto`, `arms` as JSON, `founder`).
- **`person`**: a person. `given`, `surname`, `house`, `sex` (`m`, `f`, `x` or null), `born` and `died` as partial dates
  (`1953`, `1953-08`, `1953-08-08`, with `~` for about), their places, `living`, `epithet`, `title`, `occupation`,
  `bio`, `traits` (JSON), `look` (JSON, the portrait's seed), `nickname`, `favourite`, and `current_given` and
  `current_surname` (null means "the same as the birth name"). `updated_at` is set on each change.
- **`parent`**: a parent link from `child` to `parent`, with `kind` (`biological`, `adoptive`, `foster`, `step`) and
  `confidence` (`certain`, `probable`, `disputed`). The key is the pair.
- **`partnership`**: a union between `a` and `b`, with `kind` (`marriage`, `partnership`, `betrothal`, `other`), `start`,
  `end`, `end_reason` (for example `divorce` or `death`) and `place`. There is no uniqueness on the pair, so a person
  can marry the same person twice.
- **`story`**: a memory, saying, anecdote or recipe, with its author and the date it was written.
- **`contact`**: the first contact table, from before `person_field`. Migration 0003 copied its rows across, and nothing
  reads it now; a later migration removes it.
- **`place`**: a place name with coordinates and a country, for the Atlas.
- **`photo`**: each person's portrait: `person`, `mime`, `key` (where the picture is in media storage) and, only for
  pictures saved before media storage, `data`.
- **`person_field`**: one row per field: `type` (phone, email, address, website, social, names, dates, education,
  occupation, military, religion, nationality, languages, medical, allergies, favourites, gifts, notes, related, custom),
  `label`, `value` (JSON, the shape depends on the type), `ord`, and `private` (1 for editors and stewards only).
- **`album`**, **`media`**, **`media_person`**: the gallery. `media.key` is the picture's key in media storage, `taken` is
  a partial date, and each `media_person` row is a face box (`x`, `y`, `w`, `h` between 0 and 1) with `confirmed` (0 for a
  suggestion, which is never shown as a tag).
- **`house_succession`**: a house's `law` (`absolute-primogeniture`, `seniority` or `elective`), and optional `head`,
  `heir` and `country`. A house with no row uses absolute primogeniture and derives its head from the family graph.
- **`op`**: the retry keys. A change sent with a key records its result in the same batch as the change (see below).
- **`guard`**: a view with a trigger, used to abort a batch (see below).
- **`d1_migrations`**: which migration files have run, kept by Node and by D1 alike.

## The accounts database (`migrations/accounts`)

| Migration | What it adds |
| --- | --- |
| `0001_initial.sql` | The first schema, as before versioned migrations (every statement `IF NOT EXISTS`). |
| `0002_guard.sql` | The `guard` view and trigger. |
| `0003_ai_settings.sql` | The AI settings, the usage counter and the assistant's conversations. |

### Tables

- **`user`**: a person with an account: `name`, an optional `email`, a random `handle` (the passkey's user handle, so a
  passkey reveals nothing about the account), `created` and `last_seen`.
- **`credential`**: a passkey: its id, public key, counter, transports, a device name, whether it is synced, and when it
  was last used. Each user has one or more.
- **`session`**: a sign-in. Its key is the SHA-256 hash of the cookie's token, never the token; it has `expires` and
  `refreshed`, and it slides forward as the user is active.
- **`invite`**: an invitation to a family with a `role`, an optional `email`, an `expires`, who created it and who used
  it, and `revoked_at`. Only a hash of the link's token is stored.
- **`membership`**: a user's role in a family (`viewer`, `contributor`, `editor`, `steward`), and who they are in that
  family (a person id, or `-` for "just browsing").
- **`challenge`**: a passkey ceremony in progress (for setup, an invitation, adding a passkey, or signing in), with its
  expiry.
- **`ai_settings`**: one row per family: the provider, the model, the sealed key (`key_sealed`), its last four
  characters (`key_tail`), the features switched on (JSON), and the daily token budget.
- **`ai_usage`**: tokens used per family per UTC day.
- **`ai_conversation`**: which conversation a reader is in, per family.
- **`ai_chat`**: one row per message, with the message's JSON body (the text and, for an assistant reply, its proposals
  and their status).

## Rules every change follows

These rules keep the data consistent without interactive transactions, which D1 does not have.

- **Reads decide, a batch writes.** A change reads what it needs, checks it, and then sends its writes as one batch
  (`batch()`). The batch starts with **guards** that restate what the decision relied on, for example "the child still
  has one parent" or "the person count is the same as when I read it". A guard is an `INSERT INTO guard (ok) SELECT …`,
  and the trigger on the `guard` view aborts the whole batch when the condition is false. If another request changed
  the facts in between, nothing is written and the change is decided again on fresh reads.
- **Retry keys make a resend safe.** A change sent with an `opKey` stores its result in `op` in the same batch. The same
  key sent again, by the same person with the same change, returns the stored result instead of writing twice. A key
  reused for something else is refused. Rows older than 30 days are pruned.
- **Constraints back the same rules.** Primary keys, foreign keys and `CHECK`s hold in the database itself, so a bug in
  the application cannot store, for example, a parent link to a person who does not exist.
- **Pictures are in media storage.** The database holds only keys (`photo/<uuid>.jpg`, `gallery/<uuid>.jpg`). Node keeps
  them in `data/media/<id>/`, Cloudflare in R2 under `<id>/<key>`. A replaced picture is deleted after the change that
  replaced it is written.

## Seeding and the exchange

`src/lib/seed-format.ts` defines the JSON a family can be seeded from (`scripts/seed.ts`), and `scripts/import-kindred.ts`
produces that JSON from a v1 Markdown archive. GEDCOM and the Markdown archive are the formats for moving a family in and
out; [exchange.md](exchange.md) describes them, and what each one keeps.
