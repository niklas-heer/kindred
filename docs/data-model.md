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
| `0006_occupation.sql` | `person.occupation_code`, and `occupation_translation`, the cache of AI-translated occupations. |
| `0007_prefer_avatar.sql` | `person.prefer_avatar`: show the drawn portrait even when there is a photo. |
| `0008_drop_legacy_contact.sql` | Drops the old `contact` table and `person.favourite`, both replaced by `person_field` in 0003. |
| `0009_person_revision.sql` | `person.revision`, bumped by triggers on person and `person_field` changes, so the Edit tab can refuse a stale save. |
| `0010_revision_scope.sql` | Limits the person trigger to the columns the Edit tab writes, so a portrait or picture change doesn't block your own save. |
| `0011_ancestry_revision.sql` | `ancestry_rev`, one number bumped by triggers on every change to `parent`, which the GEDCOM import guards instead of the whole list of links. |
| `0012_house_meaning.sql` | `house_meaning`: what each house's name means, as a steward researched and chose it. `house_arms_review`: the steward's latest check of the arms against it, and whether they were kept. |
| `0013_portrait.sql` | Painted portrait candidates and the accepted portrait; `person.prefer_portrait`. |
| `0014_ai_background.sql` | `story_translation`: the background AI translations of stories, kept beside each original (see [ai.md](ai.md), "Background tasks"). |
| `0015_collected_meanings.sql` | `house_meaning.collect_failures`: failed tries of the background name research for a house. |
| `0016_arms_review_history.sql` | `house_arms_review.history`: what each arms check advised and what the steward decided, oldest first. |
| `0017_research.sql` | The Research page: `research_project`, `research_document`, `research_note`, `research_picture`, `research_person`, `research_place`. |

### Tables

- **`meta`**: the family's own facts (`id`, `name`, `tagline`, `theme`, `focus`, the person the tree opens on).
- **`house`**: a house (`id`, `name`, `motto`, `arms` as JSON, `founder`).
- **`person`**: a person. `given`, `surname`, `house`, `sex` (`m`, `f`, `x` or null), `born` and `died` as partial dates
  (`1953`, `1953-08`, `1953-08-08`, with `~` for about), their places, `living`, `epithet`, `title`, `occupation`,
  `bio`, `traits` (JSON), `look` (JSON, the portrait's seed), `nickname`, `further_given` (a JSON list of the second, third … given names; null means none), `current_given` and `current_surname` (null means "the same as
  the birth name"), `occupation_code` (an entry in the occupation vocabulary, 0006) and `prefer_avatar` (0007). `updated_at` is set on each change.
- **`parent`**: a parent link from `child` to `parent`, with `kind` (`biological`, `adoptive`, `foster`, `step`) and
  `confidence` (`certain`, `probable`, `disputed`). The key is the pair.
- **`partnership`**: a union between `a` and `b`, with `kind` (`marriage`, `partnership`, `betrothal`, `other`), `start`,
  `end`, `end_reason` (for example `divorce` or `death`) and `place`. There is no uniqueness on the pair, so a person
  can marry the same person twice.
- **`story`**: a memory, saying, anecdote or recipe, with its author and the date it was written.
- **`story_translation`** (migration 0014): an AI translation of a story into one language (`story`, `locale`), with the `title`
  (null when the story has none) and the `body`, in Markdown. `source_hash` is a hash of the story's title and body when it
  was translated: a translation is shown only while it still matches the story. `same` is 1 when the story was already in
  that language, so nothing is shown and the story is not asked again. The story row itself is never changed. Copied with the
  family, after its story.
- **`house_translation`** (migration 0019): an AI translation of a house's researched meanings or its arms check (`kind`) into one
  language (`locale`). `content` is JSON; `source_hash` works as for `story_translation`, so editing or researching a name again
  replaces it. The original rows are never changed. Copied with the family, after its house.
- **`place`**: a place name with coordinates and a country, for the Atlas.
- **`photo`**: each person's portrait: `person`, `mime`, `key` (where the picture is in media storage) and, only for
  pictures saved before media storage, `data`.
- **`person_field`**: one row per field: `type` (phone, email, address, website, social, names, dates, education,
  occupation, military, religion, nationality, languages, medical, allergies, favourites, gifts, notes, related, custom),
  `label`, `value` (JSON, the shape depends on the type), `ord`, and `private` (1 for editors and stewards only).
- **`album`**, **`media`**, **`media_person`**: the gallery. `media.key` is the picture's key in media storage, `taken` is
  a partial date, and each `media_person` row is a face box (`x`, `y`, `w`, `h` between 0 and 1) with `confirmed` (0 for a
  suggestion, which is never shown as a tag).
- **`portrait`** (migration 0013): a painted portrait made from one of a person's photos. `key` is the picture in media storage (`portrait/<uuid>.<ext>`), `person`, `mime`, `source` (the photo it was painted from: `gallery/…` or `photo/…`), `source_year` (the photo's year, when it has a date), `model` (the OpenRouter model), `created_by`, `created_at`, and `accepted`. A row with `accepted = 0` is a candidate waiting for a choice; at most one row per person is accepted ("Use this portrait"), and that is the one the person can show. Accepting deletes the one it replaces; discarding a candidate, or removing the accepted one, deletes its picture too. `person.prefer_portrait` (0013) is the person's choice of the painted portrait: `prefer_avatar` (the drawing) and `prefer_portrait` are never both 1, and neither is 1 when the photo is shown.
- **`house_succession`**: a house's `law` (`absolute-primogeniture`, `seniority` or `elective`), and optional `head`,
  `heir` and `country`. A house with no row uses absolute primogeniture and derives its head from the family graph.
- **`house_meaning`**: one row per house with a saved research: the `name` researched, `family_words` (the family's own words, may be empty), `meanings` (JSON: every meaning the research returned, each with `chosen` for the ones the steward kept), `web_searched`, `note`, and `saved_at` and `saved_by` (the steward's user id). Saved again in place. A row with no chosen meaning is not saved research: it is what the background task collected (`saved_by` is `ai-background`), a dismissed collection, or failed tries (`collect_failures`), and only stewards can read it.
- **`house_arms_review`**: one row per house with a check of its arms: `fingerprint` (a hash of the arms, the family's words and the chosen meanings the check read), `verdict` (`fits`, `partly` or `reconsider`), `reason` and `advice` in the reader's language of the check, `checked_at`, `checked_by`, and `dismissed_fingerprint` (set when the steward keeps the arms; it counts only while it matches the current fingerprint). A check is out of date when the fingerprint no longer matches.
- **`research_project`**, **`research_document`**, **`research_note`**, **`research_picture`**, **`research_person`**, **`research_place`** (migration 0017): a family's research. A project (`title`, `summary`, `private`) holds documents (the file is in media storage under `research/<uuid>.<ext>`, the row keeps its `key`, `mime`, `size`, `title`, partial `date`, `source`, `notes` and `private`), Markdown notes (`title`, `body`, partial `date`, `private`), and links to gallery pictures, people and Atlas places, which cascade away with the row they point at. `private` is 1 for editors and stewards only; a link to a person has it too. Every row keeps `created_by` (the account id, which decides who may change it) and `created_by_name` (the name shown, which outlives the account). The timeline is derived from these and the people's dates; nothing about it is stored.
- **`ancestry_rev`**: a single row (`id` = 1) with `rev`, the ancestry revision. Triggers on `parent` add one on every insert, update and delete, so `rev` moves with any change to who is whose parent, whatever the size of the family. The GEDCOM import reads it while planning and guards `rev = ?` inside its batch, so a change to the links in between makes the import plan again. The D1 transfer leaves it out (see `LEFT_OUT_TABLES` in `scripts/lib/d1-transfer.ts`): the target's links bump the target's own counter as they are written, and the counter is only ever compared with itself.
- **`op`**: the retry keys. A change sent with a key records its result in the same batch as the change (see below).
- **`guard`**: a view with a trigger, used to abort a batch (see below).
- **`d1_migrations`**: which migration files have run, kept by Node and by D1 alike.

## The accounts database (`migrations/accounts`)

| Migration | What it adds |
| --- | --- |
| `0001_initial.sql` | The first schema, as before versioned migrations (every statement `IF NOT EXISTS`). |
| `0002_guard.sql` | The `guard` view and trigger. |
| `0003_ai_settings.sql` | The AI settings, the usage counter and the assistant's conversations. |
| `0004_locale.sql` | `user.locale`: the reader's language, used before the cookie when the server renders. |
| `0005_push.sql` | Device push subscriptions. |
| `0006_push_sent.sql` | Reminder delivery bookkeeping. |
| `0007_ai_money.sql` | The monthly budget in micro-dollars, the web-search switch and the family's own prices. |
| `0008_ai_portrait.sql` | `ai_portrait`: the painted-portrait switch, model and OpenRouter key (or the family's reused key), kept apart from the assistant's features. |
| `0009_ai_background.sql` | The background AI tasks: the steward's settings, each task's switch, schedule and last start, the background share of the budget, and the run log. |

| `0010_ai_providers.sql` | Provider connections and a provider/model route per AI feature; migrates the previous saved keys and routes. |
| `0011_names_task.sql` | Adds the `names` background task and route to the lists the task, run and route tables allow. |
| `0019_house_translation.sql` | `house_translation`: the background AI translations of a house's researched name meanings and its arms check. |
| `0017_feedback.sql` | `feedback`: what stewards report about Kindred itself, kept in this installation (the picture of the screen is in the family's media storage). |

### Tables

- **`feedback`** (migration 0017): one report: `tree`, `kind` (`bug`, `idea`, `confusing`), `status` (`new`, `in-progress`, `resolved`), `body`, `context` (JSON: the page, the element's selector, language, theme, screen size, browser, app version and recent client errors, nothing else), `picture` (`feedback/<uuid>.jpg` in media storage, null when it was left out), `user` and `user_name` (the name at the time), `created_at`, `updated_at`. Stewards only.
- **`user`**: a person with an account: `name`, an optional `email`, a random `handle` (the passkey's user handle, so a
  passkey reveals nothing about the account), `locale`, `created` and `last_seen`.
- **`credential`**: a passkey: its id, public key, counter, transports, a device name, whether it is synced, and when it
  was last used. Each user has one or more.
- **`session`**: a sign-in. Its key is the SHA-256 hash of the cookie's token, never the token; it has `expires` and
  `refreshed`, and it slides forward as the user is active.
- **`invite`**: an invitation to a family with a `role`, an optional `email`, an `expires`, who created it and who used
  it, and `revoked_at`. Only a hash of the link's token is stored.
- **`share_link`** (0015): a family's share link, at most one per family: a hash of its token, a PBKDF2 hash of its password (or none),
  a `generation` that goes up when it is replaced, and an optional `expires`. A guest is not a user.
- **`share_session`** (0015): a guest's short-lived visit: the SHA-256 hash of the cookie's token, the link and the generation it belongs
  to, and `expires`. It is deleted when the link is replaced or turned off.
- **`share_attempt`** (0015): tries against a link in the current 15-minute window, per link and per link and hashed address.
- **`membership`**: a user's role in a family (`viewer`, `contributor`, `editor`, `steward`), and who they are in that
  family (a person id, or `-` for "just browsing").
- **`challenge`**: a passkey ceremony in progress (for setup, an invitation, adding a passkey, or signing in), with its
  expiry.
- **`ai_settings`**: one row per family: feature switches, web search, the monthly budget in micro-dollars and custom prices.
  Legacy provider/model and daily token-budget columns remain for compatibility; provider connections and routes are authoritative.
- **`ai_provider`** (0010): one connection per family and provider (`anthropic`, `openai`, `openrouter`), with a sealed key,
  its last four characters, and who last updated it.
- **`ai_route`** (0010): a provider and model per family and feature: assistant, arms, faces, avatar, portrait,
  arms-review, occupations and chronicle. An absent route or null provider follows the assistant, except painting requires OpenRouter.
- **`ai_spend`** (0007): monthly spend in micro-dollars, shared across features and providers.
- **`push_subscription`** (0005–0006): device subscriptions; `last_sent_day` claims each device's daily reminder before sending.
- **`ai_usage`**: tokens used per family per UTC day.
- **`ai_conversation`**: which conversation a reader is in, per family.
- **`ai_background`** (migration 0009): one row per family for the background AI tasks: the share of the monthly budget that
  background work may use (`cap_share`), the languages the translations go into (`languages`, JSON), the steward's language
  for the review texts (`locale`), and when it was last changed and by whom.
- **`ai_background_task`** (0009): one row per family and task (`arms`, `occupations`, `chronicle`): `enabled` (off by default),
  `schedule` (`daily` or `weekly`) and `last_started`, which the daily run uses to tell when a task is due.
- **`ai_background_spend`** (0009): micro-dollars that background work has booked per family per UTC month, against its share.
  The whole month's spend stays in `ai_spend`, which background calls book against as well.
- **`ai_task_run`** (0009): the runs that did something, failed, stopped at the cap, or were asked for by hand: when, the
  task, who started it (`schedule` or `manual`), the status, the items done, failed and waiting, what it cost, and a short note.
  The newest 200 per family are kept.
- **`ai_portrait`** (migration 0008): the painted-portrait switch. Its legacy model and key columns remain after migration
  0010; the portrait route and OpenRouter connection now select the model and key. Spend uses the family's monthly budget.
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
- **Pictures and research documents are in media storage.** The database holds only keys (`photo/<uuid>.jpg`, `gallery/<uuid>.jpg`, `research/<uuid>.pdf`). Node keeps
  them in `data/media/<id>/`, Cloudflare in R2 under `<id>/<key>`. A replaced picture is deleted after the change that
  replaced it is written.

## Seeding and the exchange

`src/lib/seed-format.ts` defines the JSON a family can be seeded from (`scripts/seed.ts`), and `scripts/import-kindred.ts`
produces that JSON from a v1 Markdown archive. GEDCOM and the Markdown archive are the formats for moving a family in and
out; [exchange.md](exchange.md) describes them, and what each one keeps.
