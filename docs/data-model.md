# Data model

Kindred keeps data in two kinds of database, with one set of migrations each:

- **The accounts database**, one per installation: who people are, their passkeys and sessions, the families they
  belong to, invitations, and each family's AI settings and assistant conversations. `migrations/accounts/`. On Node it
  is `data/accounts.db`; on Cloudflare it is one Durable Object of the `FAMILIES` namespace, or the `ACCOUNTS` D1 binding
  where one is bound.
- **A family database**, one per family: the people, their links, stories, places, pictures and houses. `migrations/tree/`.
  On Node it is `data/<id>.db`; on Cloudflare it is the family's own Durable Object, or the `TREE_<ID>` D1 binding where one
  is bound (see [Where a family lives](#where-a-family-lives)).

Migrations are plain SQL files named `NNNN_name.sql`. They run in order: on Node when a file is opened, on D1 with
`mise run cf:migrate` or `cf:migrate:remote`, and in a Durable Object by the object itself, when it is made and whenever it
starts again after a deploy, before it answers anything (`src/lib/store/durable.ts`; the files are bundled into the Worker).
All three use the same files and the same `d1_migrations` table. A file that
has shipped is never edited: a change is a new file. A migration must run on SQLite, on D1 and in a Durable Object, so it
has no `PRAGMA`, no `BEGIN` and no `COMMIT`, and a new `NOT NULL` column has a default.

The schema is the sum of the files in the `migrations/` folders. On Node, `src/lib/store/node.ts` applies the pending ones
when it opens a file and backs the file up first. A migration runs while the Worker that is still serving is on the old
code (`mise run deploy` migrates before it deploys), so it must not break the release before it. There are three folders:
`tree`, `accounts` and `gazetteer` (see the end).

## Where a family lives

| Where Kindred runs | A family | The accounts | How the families are listed (`store.treeIds()`) |
| --- | --- | --- | --- |
| Node | `data/<id>.db`, made by `ensureTree` | `data/accounts.db` | the `*.db` files in the data folder |
| Cloudflare, Durable Objects (new installs) | its own SQLite Durable Object `tree:<id>` in `FAMILIES`, made by `ensureTree` | the Durable Object `accounts` | the rows of `family_store` (accounts migration 0033) |
| Cloudflare, D1 (installs from before Durable Objects) | the D1 database bound as `TREE_<ID>`, which must exist before the family is made | the `ACCOUNTS` D1 database | the `TREE_<ID>` bindings |

Both Cloudflare ways can be mixed: a family with a `TREE_<ID>` binding is served from D1, any other from its Durable Object,
and the list is both together. A Durable Object holds up to 10 GB, in the EU when `KINDRED_JURISDICTION=eu` is set before the
first family (it cannot be changed afterwards). Deleting a family deletes its Durable Object's storage and its `family_store`
row; a D1 database is emptied instead, since a Worker cannot remove it. On Node nothing is recorded in `family_store`: the
file is the record. `scripts/import-to-do.ts` moves a family from a Node file, a D1 database or a steward's backup into a
Durable Object ([deploy-cloudflare.md](deploy-cloudflare.md#moving-a-family-into-a-durable-object)). The import writes into a
**staged** object, which answers every ordinary query as if it did not exist; only a finished import whose counts match is
published (listed in `family_store`, and then served), so nothing serves a family half-imported (`src/lib/store/durable.ts`,
`src/lib/store/move.server.ts`).

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
| `0009_person_revision.sql` | `person.revision`, bumped by triggers on person and `person_field` changes, so the Edit tab can refuse a stale save. It never leaves the server: a reader gets a digest of what they can see instead (see `viewRevision` in `src/lib/person.server.ts`), so a hidden field's change does not show. |
| `0010_revision_scope.sql` | Limits the person trigger to the columns the Edit tab writes, so a portrait or picture change doesn't block your own save. |
| `0011_ancestry_revision.sql` | `ancestry_rev`, one number bumped by triggers on every change to `parent`, which the GEDCOM import guards instead of the whole list of links. |
| `0012_house_meaning.sql` | `house_meaning`: what each house's name means, as a steward researched and chose it. `house_arms_review`: the steward's latest check of the arms against it, and whether they were kept. |
| `0013_portrait.sql` | Painted portrait candidates and the accepted portrait; `person.prefer_portrait`. |
| `0014_ai_background.sql` | `story_translation`: the background AI translations of stories, kept beside each original (see [ai.md](ai.md), "Background tasks"). |
| `0015_collected_meanings.sql` | `house_meaning.collect_failures`: failed tries of the background name research for a house. |
| `0016_arms_review_history.sql` | `house_arms_review.history`: what each arms check advised and what the steward decided, oldest first. |
| `0017_research.sql` | The Research page: `research_project`, `research_document`, `research_note`, `research_picture`, `research_person`, `research_place`. |
| `0018_portrait_versions.sql` | `portrait.kept` and `portrait.tweak`: a person keeps several painted portraits, and their small adjustments. |
| `0019_house_translation.sql` | `house_translation`: the background AI translations of a house's researched name meanings and its arms check. |
| `0020_field_visibility.sql` | `person_field.visibility` (`personal`, `editors`, `family`) and `owner`, in place of the single `private` flag, which it drops. |
| `0021_further_given_names.sql` | `person.further_given`, and the person revision trigger recreated to count it. |
| `0022_field_author.sql` | `person_field.created_by` now holds the author's account id; the old display name column is renamed `created_by_name`. |
| `0023_photo_thumb.sql` | `media.thumb`: the key of a gallery photo's small copy (`thumb/<uuid>.jpg`, about 400 pixels), made by the browser at upload; NULL for photos from before, which are served whole. |
| `0024_events_sources.sql` | Life events and sources: `life_event` (a person's baptism, schooling, moves, service, burial…), `source` (the family's register of sources) and `citation` (one source for one fact). |
| `0025_campaign.sql` | The Campaign, a game between the houses ([campaign.md](campaign.md)): `campaign`, `campaign_season`, `campaign_member`, `campaign_log` and `campaign_push`. It changes no existing table. |
| `0026_history.sql` | `history`: one row for each change to the family's records, written in the change's own batch (see "Rules every change follows"). It changes no existing table, and starts empty. |
| `0027_reactions_comments.sql` | Reactions and comments on memories and gallery photos ([responses.md](responses.md)): `reaction`, `comment`, `response_push`, two triggers that take them away with their story or picture, and `story.author_account`. |
| `0028_today.sql` | Today ([today.md](today.md)): the question of the week (`today_week`, `today_answer`) and the daily quiz (`today_settings`, `quiz_day`, `quiz_answer`). It changes no existing table. |
| `0029_posts.sql` | The family feed ([feed.md](feed.md)): `post`, `post_media`, `post_person`, `media.for_post` (a picture uploaded for a post) with its index, and an index on `media.uploaded_at`. `reaction` and `comment` are made again with the rows they had, so that their `target_kind` also allows `post`; their two triggers come back with a third, `post_responses_go`. |
| `0030_emoji_reactions.sql` | Emoji reactions and events of the feed ([responses.md](responses.md), [feed.md](feed.md)): `reaction` and `comment` are made again with their rows so that `target_kind` also allows `event`; each stored `reaction.kind` becomes its emoji (`heart` ❤️, `laugh` 😂, `candle` 🕯️, `thanks` 🙏, `remember` 💭); the three triggers come back; and an index `reaction_account` on (`account`, `created_at`) for a member's recently used emoji. |
| `0031_recipes.sql` | Recipes as a structured kind ([recipes.md](recipes.md)): `recipe` (what makes a story of kind `recipe` a recipe) and `recipe_image` (its pictures, which are not gallery pictures), with the trigger `recipe_images_go`. It changes no existing table. |
| `0032_campaign_run.sql` | The Campaign as a game one plays alone ([campaign.md](campaign.md)): `campaign_run`, one row for each reign a member begins. The tables of 0025 stay, and a season still running is closed once by the app, not by the migration. It changes no existing table. |
| `0033_who_is_this.sql` | "Who is this?" ([who-is-this.md](who-is-this.md)): `tag_proposal` and `tag_pass`, and `media_person.named_by`. |
| `0034_campaign_week.sql` | The Campaign's week ([campaign.md](campaign.md)): `campaign_week`, the field every reign of a week plays, filled for the weeks already played from each week's first reign (without that player's renown and reward). It changes no existing table. |
| `0035_campaign_ruleset.sql` | The Campaign's rules have a version ([campaign.md](campaign.md), "Rulesets"): `campaign_run.ruleset` and `campaign_week.ruleset`, both 1 for everything stored before (the map made from the family's places), and an index on the reigns by ruleset, week and score. |
| `0036_campaign_counted.sql` | The Campaign's counted reign is fixed when it begins ([campaign.md](campaign.md), "The week's challenge"): `campaign_run.counts_for` (the day a reign is the counted one of, filled for the reigns already finished: the first finished of each day), a unique index that allows one a day for a member under one ruleset, and `campaign_run.progress` (the moves kept while a reign is played). |

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
- **`person_field`**: one row per field, with `created_by` (the account that created it, which alone may make it personal; NULL before migration 0022) and `created_by_name` (the name shown): `type` (phone, email, address, website, social, names, dates, education,
  occupation, military, religion, nationality, languages, medical, allergies, favourites, gifts, notes, related, custom),
  `label`, `value` (JSON, the shape depends on the type), `ord`, `visibility` (migration 0020: `family` for every member, `editors` for editors and stewards, `personal` for the account in `owner` alone, never an export or the assistant) and `owner` (the account id, set exactly when the field is personal).
- **`album`**, **`media`**, **`media_person`**: the gallery. `media.key` is the picture's key in media storage, `thumb` (0023)
  the key of its small copy for tiles, or NULL, `taken` is
  a partial date, and each `media_person` row is a face box (`x`, `y`, `w`, `h` between 0 and 1) with `confirmed` (0 for a
  suggestion, which is never shown as a tag).
- **`portrait`** (migration 0013): a painted portrait made from one of a person's photos. `key` is the picture in media storage (`portrait/<uuid>.<ext>`), `person`, `mime`, `source` (the photo it was painted from: `gallery/…` or `photo/…`), `source_year` (the photo's year, when it has a date), `model` (the OpenRouter model), `created_by`, `created_at`, `accepted`, and (migration 0018) `kept` and `tweak` (the person's own small adjustments, JSON). A row with `accepted = 0` and `kept = 0` is a draft, swept when abandoned; a kept version is one the person chose to keep; `accepted = 0` otherwise means a candidate waiting for a choice; at most one row per person is accepted ("Use this portrait"), and that is the one the person can show. Accepting deletes the one it replaces; discarding a candidate, or removing the accepted one, deletes its picture too. `person.prefer_portrait` (0013) is the person's choice of the painted portrait: `prefer_avatar` (the drawing) and `prefer_portrait` are never both 1, and neither is 1 when the photo is shown.
- **`house_succession`**: a house's `law` (`absolute-primogeniture`, `seniority` or `elective`), and optional `head`,
  `heir` and `country`. A house with no row uses absolute primogeniture and derives its head from the family graph.
- **`house_meaning`**: one row per house with a saved research: the `name` researched, `family_words` (the family's own words, may be empty), `meanings` (JSON: every meaning the research returned, each with `chosen` for the ones the steward kept), `web_searched`, `note`, and `saved_at` and `saved_by` (the steward's user id). Saved again in place. A row with no chosen meaning is not saved research: it is what the background task collected (`saved_by` is `ai-background`), a dismissed collection, or failed tries (`collect_failures`), and only stewards can read it.
- **`house_arms_review`**: one row per house with a check of its arms: `fingerprint` (a hash of the arms, the family's words and the chosen meanings the check read), `verdict` (`fits`, `partly` or `reconsider`), `reason` and `advice` in the reader's language of the check, `checked_at`, `checked_by`, and `dismissed_fingerprint` (set when the steward keeps the arms; it counts only while it matches the current fingerprint). A check is out of date when the fingerprint no longer matches.
- **`research_project`**, **`research_document`**, **`research_note`**, **`research_picture`**, **`research_person`**, **`research_place`** (migration 0017): a family's research. A project (`title`, `summary`, `private`) holds documents (the file is in media storage under `research/<uuid>.<ext>`, the row keeps its `key`, `mime`, `size`, `title`, partial `date`, `source`, `notes` and `private`), Markdown notes (`title`, `body`, partial `date`, `private`), and links to gallery pictures, people and Atlas places, which cascade away with the row they point at. `private` is 1 for editors and stewards only; a link to a person has it too. Every row keeps `created_by` (the account id, which decides who may change it) and `created_by_name` (the name shown, which outlives the account). The timeline is derived from these and the people's dates; nothing about it is stored.
- **`life_event`** (migration 0024): one event in a person's life (`person`, cascading with them): `type` from a fixed list (`baptism`, `christening`, `confirmation`, `bar-bat-mitzvah`, `education`, `graduation`, `military`, `occupation`, `residence`, `emigration`, `immigration`, `naturalisation`, `engagement`, `retirement`, `burial`, `cremation`, `census`, `award`, or `custom`, which needs a `label`), an optional `label` (what it was: a school, a regiment), `date` and `end_date` as partial dates, `place` (a place name, pinned through `place` as birthplaces are), `note`, and `ord`, the editor's order among events of the same date. `created_by`/`created_by_name`, `created_at`, `updated_by`, `updated_at`. Birth, death and partnerships stay where they are (`person`, `partnership`); the life timeline reads both.
- **`source`** (0024): the family's sources: `title`, `author`, `publication` (the publication or archive), `reference` (a call number or a URL), a partial `date`, `note`, and optional links to a research document (`document`, set to NULL when it is deleted) and a gallery picture (`media`, likewise). `created_by`/`created_by_name`, `created_at`, `updated_at`.
- **`citation`** (0024): one source cited for one fact, with `page`, `quality` (`original`, `derivative`, `unsure`, or NULL) and a short `transcription`. `fact` says what it is about, and the columns that name it are foreign keys that cascade, so a citation goes with its fact: `person` for `birth`, `death` and `name`; `event` (a `life_event`); `partnership`; or `person` (the child) and `parent` together for `parent`, a key into `parent (child, parent)`. A `CHECK` allows exactly the columns of its kind. `source` does not cascade: a source that is still cited cannot be deleted, and Kindred deletes its citations first, in the same batch, only after the editor confirmed how many.
- **`campaign`**, **`campaign_season`**, **`campaign_member`**, **`campaign_log`**, **`campaign_push`** (migration 0025): the Campaign's old shared game (closed since migration 0032: its seasons are kept as the hall of fame, nothing of it is played or written any more), and nothing else's. No row refers to a person, a house or a place by a foreign key, and the game writes to no other table. `campaign` is one row (`id` = 1): the steward's switch (`enabled`, 0 until turned on) and the number of the `season` being played. `campaign_season` is one row per season: its `seed`, the UTC day it `started` (days since 1970), the `map` (provinces with their land and borders), the `sides` (the houses, their allies and arms as they were that day) and the `state` (who holds what, the garrisons, each side's waiting levy, the seats, who gave an order today), all JSON; `rev` goes up with every change to `state`, and every order guards on it; a finished season has `ended`, `winner` and `result` (its standings), which is the hall of fame. `campaign_member` is one row per season and account: the `side` a member chose when they stand for nobody in a house (`pledged`), their `orders` and the season day that count is from (`orders_day`), the UTC day of their last bonus order (`bonus_day`), the last chronicle entry they have `seen`, and the `name` shown. `campaign_log` is the chronicle: `season`, `day`, `kind` (`muster`, `march`, `attack`, `pledge`, `bonus`, `season_start`, `season_end`), the `side`, the `account` and `name` (NULL for a regent), the `province`, `took`, `data` (JSON: the dice of a battle with their seed) and `cry` (a battle cry, at most 80 characters). `campaign_push` holds one row per account and UTC day: the claim that keeps the push to one a day. Rows of seasons older than the previous one are deleted when a season starts, except `campaign_season`. The D1 transfer leaves all five out (`LEFT_OUT_TABLES`): they name accounts, which are not copied, and the target starts with the game off.
- **`campaign_run`** (migration 0032): one row per reign of the Campaign a member begins ([campaign.md](campaign.md)). `id` (a random UUID), `account` (who plays, no foreign key) and `name_then` (the name shown in the tables), `side` (the house's id, or a regent company's `rival:` id, they rule), `week` (the ISO week, "2026-W46"), `seed` (the reign's dice seed: an HMAC of the reign's id under the server's secret; reigns begun before migration 0034 have the week's), `field` (JSON: the week's field from `campaign_week`, with the player's `renown` and quiz `grant` as they were when the reign began), `created_at`; and once finished, `orders` (JSON: the moves the browser sent), `score` (what the server got by replaying them), `result` (JSON: provinces, towns, battles won, troops lost, total, and from ruleset 2 the reign's `title`) and `finished_at`; and `ruleset` (migration 0035: the rules the reign's field was laid out for; the tables rank a reign only among reigns of the same ruleset, and one begun under an earlier ruleset can no longer be finished); and from migration 0036 `counts_for` (the UTC day, "2026-11-12", the reign is the counted one of: the first reign its member began that day, written when it begins and never changed; NULL for an extra reign; a unique index on `account`, `ruleset` and `counts_for` allows one a day) and `progress` (JSON: the moves the browser has reported while the reign is played, up to its last battle or end of a turn; a later report and the finish must go on from them). The tables rank a reign that has `counts_for` and is finished. A reign is finished at most once (the update guards on `finished_at IS NULL`); one never finished is deleted two weeks later, when the same member begins another. A member's reigns are deleted when they leave the family. Not in GEDCOM or the Markdown archive; the D1 transfer leaves it out (it names accounts).
- **`campaign_week`** (migration 0034): one row per ISO week in which a reign of the Campaign began. `week` ("2026-W46", the key), `field` (JSON: the map, the four sides and the opening, laid out from the week's seed when the week's first reign began; from ruleset 2 the map is an invented continent and holds no place of the family's), `created_at` and `ruleset` (migration 0035). A reign that begins reads it back, and stores it only when the week has none under today's ruleset (a guard in the same batch, so two first reigns at once play one field); a week begun under an earlier ruleset gets today's field in its place, and the reigns already played keep their own copy. It names no account, so it stays when a member leaves. Not in GEDCOM or the Markdown archive; the D1 transfer leaves it out (a game).
- **`history`** (migration 0026): the change history ([roles-and-privacy.md](roles-and-privacy.md#change-history-and-whats-new)). One row per change: `at`, `account` (who; NULL for Kindred itself, a daily job or a script) and `name` (the name shown then), `kind` (`person`, `field`, `link`, `partnership`, `event`, `source`, `citation`, `story`, `photo`, `album`, `tag`, `portrait`, `house`, `place`, `research`, `family`, `import`), `record` (its id; a parent link is `child>parent`), `person` (the person it is about, no foreign key, so the row outlives them) and `person_name` (their name then), `label` (what the record was called then), `action` (`added`, `changed`, `removed`), `level` and `owner` (who may read the row, the levels of a person's field: `family`, `editors`, or `personal` for `owner` alone), `fields` (JSON, for a change: `{"f": {field: [before, after]}}` with the changed fields alone, each value at most 400 characters and the whole at most 4,000; `t` names values cut short, `o` fields kept without content, such as a picture, the arms or a portrait's look, `e` values for editors only; a person's field added or deleted keeps `k`, its type, and an added one its value as `{"value": [null, text]}`, from November 2026 on), `count` (how many records one row stands for: a GEDCOM import is one row) and `fn` (the change that wrote it). Saves of one record by one person within ten minutes are folded into one row, and a change that ends where it started leaves none. A personal field's row never has `fields`. Rows older than `KINDRED_HISTORY_YEARS` (3) are deleted by the daily job, and a member's personal rows go with them when they leave the family. Not in GEDCOM or the Markdown archive; the D1 transfer leaves it out (it names accounts).
- **`reaction`**, **`comment`**, **`response_push`** (migration 0027): what members say about a memory or a gallery photo ([responses.md](responses.md)). Both name what they are about with `target_kind` (`story`, `media`, since migration 0029 `post`, and since 0030 `event`) and `target` (the story's or the post's `id`, the picture's `key`, or an event's key: `updates:<day>|<author key>`, `people:<day>|<author key>`, `b:<person>:<year>` or `a:<partnership>:<year>`, see `EVENT_TARGET` in `src/lib/responses.ts`); as a target is in one of several tables, or none, there is no foreign key, and the triggers `story_responses_go`, `media_responses_go` and `post_responses_go` delete a story's, a picture's or a post's reactions and comments when it is deleted, also when a story goes with its person. A restored story comes back without them. An event is no row, so nothing deletes its answers: the feed reads them by key, and an event's key that ages out of the history (`KINDRED_HISTORY_YEARS`) keeps its few rows, unread. `reaction` is one row per `account`, target and `kind`, with `created_at`; `kind` is the emoji itself (since 0030), exactly one RGI emoji grapheme, fully qualified (the server checks it, `reactionOf` in `src/lib/responses.ts`), and one member gives one target at most 12 different ones. `comment` has an `id`, the `account` and the `author_name` shown when it was written (it outlives the account and the membership), the plain-text `body` (1 to 1,000 characters, line breaks kept), `created_at` and `edited_at` (set when its writer changes it). A member who leaves keeps their comments, under that name, and their reactions, which still count. `response_push` is one row per account that chose the push to an author: `enabled`, and `last_day`, the UTC day of the last one, which is the claim that keeps it to one a day. The D1 transfer copies `reaction` and `comment` and leaves `response_push` out.
- **`post`**, **`post_media`**, **`post_person`** (migration 0029): the family feed ([feed.md](feed.md)). A `post` is a member's short message to the family: an `id`, the `account` that wrote it, the `author_name` shown then and `author_person` (the person the writer stood for in the tree then, NULL when nobody or when that person is removed), so a post outlives the account and the membership with its name and its face; the plain-text `body` (at most 4,000 characters, line breaks kept, empty when the post is only pictures), `created_at` and `edited_at` (set when its writer changes the words). `post_media` lists a post's pictures in their order (`ord`): each is a gallery picture (`media.key`), uploaded through the gallery before the post is made with `media.for_post` = 1, and belongs to at most one post (`UNIQUE`); removing the picture in the gallery removes the row, and removing the post removes its pictures from the gallery and from storage. `media.for_post` is set only by the server, on the composer's upload, from the moment the picture is stored, and only such a picture, the writer's own and in no post yet, can become a post's: so removing a post deletes only pictures uploaded for it. A marked picture in no post is a leftover of a post never made: nobody sees it, its writer may delete it (the composer does on cancel and on a refusal), and the daily job (`feed`) deletes leftovers older than a day from the table and from storage. A marked picture writes no `history` row, coming or going. `post_person` names the people from the tree a post is about; a person who is removed drops out of it. A post is not a record of the family's: writing, changing or removing one writes no `history` row, nor does uploading or removing its pictures. Reactions and comments reach a post through `reaction` and `comment` with `target_kind` = `post`, and the trigger `post_responses_go` deletes them with it. A share-link guest reads none of the three, and a picture with `media.for_post` = 1, in a post or not, is left out of a guest's gallery, a person's photos, research and the media route; research cannot link one and a source cannot cite one. The D1 transfer copies all three; the Markdown archive carries the posts and their comments in `feed/`, one file per year; GEDCOM has none of it.
- **`recipe`**, **`recipe_image`** (migration 0031): recipes ([recipes.md](recipes.md)). A recipe is a `story` of kind `recipe`; `recipe` has one row for a story written with the recipe form (`story`, cascading with it), and a recipe story without a row is one from before, free text. `story.title` is the recipe's name, `story.person` whose recipe it is, and `story.body` the whole recipe written out as Markdown, made again on every save, so everything that reads stories reads it. `source` is where it comes from in the family's words (at most 80 characters), `servings` (1 to 999), `prep_minutes` and `cook_minutes` (0 to 10,080) are NULL when not given, `ingredients` is JSON (`[{"name": "For the dumplings", "items": [{"amount", "unit", "item", "note"}]}]`; a part without a name is the list's plain start; `amount` is text as it was typed), `steps` is JSON (`[{"text", "image"}]`, `image` a key in `recipe_image` or null), `notes` is Markdown (at most 8,000 characters), `tags` a JSON list of words, `cover` the key of its picture, and `updated_at` when it was last saved. `recipe_image` lists a recipe's pictures: `key` (`recipe/<uuid>.<ext>` in media storage), the `story`, `mime`, `width`, `height`, `thumb` (a cover's small copy, `recipe-thumb/<uuid>.jpg`, or NULL), `created_at` and `gone_at`. They are **not** gallery pictures: `media` has no row for them, and only `/api/recipe/` serves them, to whoever may read the recipe. `story` has no foreign key there, so a row outlives its story: the trigger `recipe_images_go` sets `gone_at` when the story is deleted (also when it goes with its person), a picture with `gone_at` is served to nobody, restoring the story (Undo, which keeps the `recipe` row with the removal) clears it, and the daily job (`recipes`) deletes rows and files that stayed gone for 31 days. A picture a change replaces is deleted with that change. Writing, changing and removing a recipe each write a `history` row of kind `story`. A share-link guest reads recipes as stories: none of a living person, nor its pictures, when the link protects living people. The D1 transfer copies both tables and uploads the pictures; the Markdown archive writes each recipe out with its tags and says how many pictures it has; GEDCOM has none of it.
- **`story.author_account`** (0027): the account that wrote a story, so its writer can be told about answers; `author` stays the name shown. NULL for stories from before, from the assistant and from imports. It is never sent with a story to a reader.
- **`today_week`**, **`today_answer`** (migration 0028): the question of the week. Which curated question a week asks is computed from the family's id (`src/lib/today/week.ts`) and not stored; `today_week` has a row only for a week a steward changed, with their own `question` or `skipped` = 1. An answer is an ordinary `story` row; `today_answer` is its tag (`story`, the ISO `week` such as `2026-W46`, and the `question`: `q01` to `q60`, or `custom`), removed with the story (`ON DELETE CASCADE`). Neither names an account, and both are copied by the D1 transfer.
- **`today_settings`**, **`quiz_day`**, **`quiz_answer`** (migration 0028): the daily quiz. `today_settings` is one row (`id` = 1): the steward's switch (`quiz`, 1 until turned off). `quiz_day` is one row per UTC day: the `question` as readers are sent it (JSON, without the answer), the `answer`, the `kind`, and the person or house it is `about`. `quiz_answer` is one row per member and day (the primary key, so an answer cannot be given twice): the `account`, the `choice`, whether it was `correct`, and the `house` of the person the member stood for. They are a game's state, name members by account id, and are left out of every export and of the D1 transfer.
- **`tag_proposal`**, **`tag_pass`**, **`media_person.named_by`** (migration 0033): "Who is this?" ([who-is-this.md](who-is-this.md)). `tag_proposal` is a member's proposal that a `person` is in gallery picture `media`: the box they tapped (`x`, `y`, `w`, `h`, all NULL when they tapped none), their `account` and the `name` shown then, `at`, and `status` (`open`, `confirmed` or `declined`) with `decided_by` and `decided_at`; one row per member, picture and person (`UNIQUE`), removed with the picture or the person. `tag_pass` is a picture a member answered "I don't know" to (`kind` = `unknown`, not shown again) or skipped (`skip`, shown after the rest), one row per member and picture. Neither is a record: a proposal or a pass writes no `history`; confirming one writes the tag (`media_person`, `confirmed` = 1) with an `added` row of kind `tag` in the same batch, and sets `media_person.named_by` to the name of the first member who proposed it (NULL for a tag made in the gallery). Both tables name members by account id, are in no export, and are left out of the D1 transfer; `media_person.named_by` is copied with its row. A share-link guest reads none of it, and the gallery leaves `named_by` out of a guest's answer.
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
| `0012_background_idle.sql` | `ai_background_task.last_checked`, and `ai_task_giveup`: how often one item failed, so an item that can never succeed stops being asked. |
| `0013_portrait_style.sql` | `ai_portrait.style`: a family's own portrait style (empty means the default). |
| `0014_person_confirmed.sql` | `membership.person_confirmed`: whether a steward has confirmed who a member says they are. |
| `0015_share_link.sql` | `share_link`, `share_session` and `share_attempt`: the guest link. |
| `0016_statistics.sql` | `stats_setting`, `stats_daily`, `stats_member` and `stats_once`: the stewards' usage counters. |
| `0017_feedback.sql` | `feedback`: what stewards report about Kindred itself, kept in this installation (the picture of the screen is in the family's media storage). |
| `0018_ai_chat_image.sql` | `ai_chat_image`: a picture a reader chose to keep with an assistant message. |
| `0019_statistics_categories.sql` | The counters carry the reader's category (`cat`) and a `change` kind; `stats_member.cat`. Older counters become `legacy`. |
| `0020_ai_threads.sql` | `ai_thread`: one row per assistant chat, with its title and an optional provider and model. |
| `0021_ai_turn.sql` | `ai_turn`: one running reply per chat, as a lease. |
| `0022_session_credential.sql` | `session.credential`: the passkey that started a session, so removing that passkey signs its device out (null for older sessions). |
| `0023_share_protect_living.sql` | `share_link.protect_living`: whether the link's guests get living people reduced to their names, faces and place in the tree. 0 for links that already existed; Kindred sets it for every new link unless the steward unticks it. |
| `0024_join_request.sql` | `share_link.ask_to_join` (on for every link), `join_request`, `guest_visitor` and `join_challenge`: a guest asking for an own account, and how a guest browser used the link. |
| `0025_session_proof.sql` | `session.proved`: when the session last confirmed with a passkey (the reader verified), which adding a passkey and "sign out everywhere else" need within five minutes. `challenge` is made again to allow the purpose `confirm`. |
| `0026_family_visit.sql` | `family_visit`, for "since your last visit", and `push_subscription.weekly` and `weekly_sent_day`, for "This week in the family". |
| `0027_join_network_visits.sql` | `join_request.network`: a short hash of the link and the network a request came from, so one home holds at most 12 open requests per link. `family_visit.visits`: how many visits the member has made (0 for visits from before), so a first visit is known. |
| `0028_view_as.sql` | `view_as`: a steward's "View as" preview of one family ([roles-and-privacy.md](roles-and-privacy.md#view-as)). |
| `0029_post_push.sql` | `push_subscription.posts` and `posts_sent_at`, for the push about a new post in the family feed ([feed.md](feed.md)). |
| `0032_presence.sql` | `presence`: who of the family is here right now ([roles-and-privacy.md](roles-and-privacy.md#here-now)). |
| `0033_family_store.sql` | `family_store`: the families made as Durable Objects on Cloudflare ([Where a family lives](#where-a-family-lives)). |
| `0034_operator.sql` | The operator ([hosting-many-families.md](hosting-many-families.md)): `user.operator` (the earliest account becomes one), `instance_setting`, `operator_audit`, `family_admin` and `media_usage`. |
| `0035_requests.sql` | `family_request` (the waiting list) and `data_request` (access, correction, deletion). |
| `0036_family_import.sql` | `family_import` (an import into a family's Durable Object, bound to the account that began it), `invite.by_operator` (an operator's first-steward invitation) and `media_usage.pending_at` (an upload on its way). |
| `0037_operator_forms.sql` | `family_admin.closed` (a closed family), `data_request.forwarded_at` (stewards see a request only once forwarded), `terms_acceptance`, `operator_push`, and the `families_per_account` setting (5 on a new install only). |
| `0038_operator_insight.sql` | The operator's statistics and update check, and "New in Kindred": `instance_daily`, `update_check`, `release_seen` and `release_running`. |
| `0040_password.sql` | A username and password as a second way in: `user.username`, `password`, `totp`, `recovery_code`, `auth_attempt` (the database-backed limit on guessing), and `session.method` / `session.proved_via`. |
| `0041_signin_step.sql` | `signin_step` (a right password waiting for its two-step code) and `password_reset` (an operator's one-hour reset link). |
| `0042_policies.sql` | The operator's policies ([hosting-many-families.md](hosting-many-families.md), "Policies"): `instance_policy`, `family_policy`, operator-funded AI (`operator_ai_provider`, `ai_operator_spend`, `ai_operator_month`, `ai_operator_booking`, `ai_settings.funding`) and `announcement`. Every policy starts as `families` (today's behaviour) and `ai.source` as `byo`. |
| `0043_signup.sql` | Hosting and sign-up ([hosting-many-families.md](hosting-many-families.md#hosting-and-sign-up)): `signup`, `signup_code`, `family_admin.self_signed`, and `challenge` made again with the purpose `signup`. |
| `0044_gdpr.sql` | Data protection ([gdpr.md](gdpr.md)): `terms_acceptance.kind` (`terms` or `dpa`), `data_request.extended_at`, `extension_reason`, `person` and `outcome`, the statement of reasons on `family_admin` (`status_reason`, `status_ground`, `status_at`), `subject_restriction` and `subject_action`. |
| `0045_breach.sql` | The operator's breach register: `breach` and `breach_family`. |
| `0046_oidc.sql` | Single sign-on with OpenID Connect: `auth_provider` (the operator's providers), `oidc_identity` (an account's identity at a provider, by `sub`), `oidc_flow` (a sign-in in flight: state, nonce and PKCE verifier) and `session.provider`. |
| `0047_updates_health.sql` | The console's Update button and Health tab ([hosting-many-families.md](hosting-many-families.md), "Updates" and "Health"): `update_github` (the install's repository and sealed GitHub token, and the last update's run), `job_run` (each daily job's last run) and `family_schema` (the schema each family last reported). |
| `0048_signin_fixes.sql` | Fixes to the ways in: `password_reset.seen_at` (the holder dismissed the notice of a used reset link), `signin_daily` (sign-ins per day and way in, for the statistics) and `oidc_flow` made again with the purpose `signup`. |
| `0049_lasting_counts.sql` | Counts that outlive what they count, and bookkeeping for complete erasure ([gdpr.md](gdpr.md), [ai.md](ai.md#operator-funded-ai)): `ai_operator_family_month` (replaces `ai_operator_spend`, kept by the family's id when a family is deleted; rows copied), `ai_operator_overage`, `signup_tally` (rows copied from `signup`), `family_left`, `subject_action.pending` and `job_run.code`. |
| `0050_round_seven_fixes.sql` | `ai_operator_overage.model`, `.acknowledged_at`, `.acknowledged_by` (an overage pauses the operator's AI for a family and model until acknowledged), `user.email_verified` (whether the address was verified, for `trust_email`) and `user.retiring`: the pseudonym an unused account's writing gets, claimed by the retention job before it changes anything ([gdpr.md](gdpr.md#retention)). |
| `0052_family_lifecycle.sql` | The lifecycle of quiet families ([hosting-many-families.md](hosting-many-families.md#lifecycle)): `family_lifecycle` (where a quiet family stands), `family_admin.active_at` and `.status_by`, `steward_notice` (what a family's stewards were told in the app) and `steward_notice_dismissal`. Off until the operator turns it on. |
| `0051_backups.sql` | The automatic backups ([hosting-many-families.md](hosting-many-families.md#backups)): `family_backup` (each encrypted backup's manifest), `backup_status` (each scope's last attempt, last good backup and last restore drill) and `recovery_point` (a Durable Object's bookmark from before it migrated). The retention and the grace period are `instance_setting` rows (`backup_keep`, `backup_grace_days`). |

### Tables

- **`family_backup`** (0051): one row per automatic backup file (`src/lib/backup/backup.server.ts`): `family` (a family id, or
  `_accounts` for this database) and `name` (the UTC time it was made, `20261112T060000123Z`, also its file name), `created_at`,
  `bytes` (the encrypted file), `format` (`sqlite`, a Node database file; `dump`, a Durable Object's schema and rows), `schema`
  (the newest migration it holds), `counts` (JSON: rows per table), `sha256` (of the database inside) and `key_id` (which key
  sealed it, never the key). `gone_at`: when its family was deleted. The column is **`family`, not `tree`, on purpose**: deleting a
  family must not delete its backups' rows with the family's other rows (`forgetInAccounts` finds tables by a `tree` column);
  `deleteFamily` sets `gone_at`, and the daily backup run deletes the files and rows once the grace period has passed.
- **`backup_status`** (0051): one row per scope (`family`, as above): `tried_at`, `ok_at` (the last good backup), `error` (the
  last failure, sanitised as a job's failure is), and the last restore drill: `drill_at`, `drill_backup`, `drill_ok`,
  `drill_problem`. Deleted with the last backup of a deleted family.
- **`recovery_point`** (0051): a family's Durable Object's point-in-time-recovery `bookmark` from before it applied new
  migrations (`reason` `migration`, with `before_migration`, the first it was about to apply, and `held_migration`, the newest it
  held) or from just before a rollback (`rollback`), and `at`. Unique per `tree` and bookmark. The object keeps its own list and
  reports it on its first answer in an isolate; the accounts object writes its own (`tree` `_accounts`). Deleted with the family.
- **`family_store`** (0033): one row per family the Worker made in the `FAMILIES` Durable Object namespace (`tree`, the
  family's id; `driver`, `durable-object`; `created_at`, ISO 8601 in UTC), written by `store.ensureTree` and deleted by
  `store.dropTree`. A Worker cannot list Durable Objects, so this is how `store.treeIds()` finds them. Families in D1 or in a
  Node file have no row. Only the store reads and writes it (`src/lib/store/cf.ts`, and the batch that publishes an import);
  deleting a family also finds it by its `tree` column. A staged import has no row until it is published.
- **`family_import`** (0036): one row per family an import into its Durable Object has begun (POST `/api/move/<tree>`,
  `src/lib/store/move.server.ts`): `id` (random; every later step names it), `user` (who began it: only they may continue it),
  `mode` (`new`: a family this server does not have, whose importer becomes its steward when it is published; `copy`: a family a
  `TREE_<ID>` D1 binding serves, copied by one of its stewards), `schema` (the last tree migration the rows were read under),
  `expected` (JSON: the rows of each table announced at the start), `started_at` and `finished_at` (ms). An import is over after
  a day. The finish publishes only when every count matches, the schema is the same and the rows name this family. Replaced by
  the next import of the family; deleted with the family (`tree` column).
- **`view_as`** (0028): one "View as" preview, behind a random token in its own HttpOnly cookie; `hash` is the token's SHA-256, as for a session. `user` is the steward who started it and `session` the hash of the passkey session it belongs to (NULL under Cloudflare Access, which has no session row). `tree` is the family previewed; `kind` is `role` (with `role`: `viewer`, `contributor` or `editor`), `member` (with `member`, the account previewed) or `guest` (with `link`, the family's share link, or NULL for a plain guest with living people protected). `created` and `last_used` are milliseconds: a preview unused for an hour, or older than a day, is over. Deleted on Stop, on sign-out and with its session, when the steward is no longer a steward, the member leaves or the link goes, with the account (`ON DELETE CASCADE`) and with the family (its `tree` column).
- **`family_visit`** (0026): one row per member and family: `last_seen` (when they last opened the family, milliseconds), `shown` (when "What's new" or the History page last showed them the news) and `since` (where "What's new" counts from). `visits` (0027) counts the visits, 1 during the first (0 for members who visited before it was counted). A visit ends after two hours without opening the family; when the next begins, `since` moves up to `shown` and never further, so news that came after they last looked is not skipped, and during a visit it stays put, so the page shows the same news however often it is opened. Goes with the account and when the member leaves the family.
- **`presence`** (0032): one row per member's open browser tab in a family (`tree`, `account`, `tab`, a random id the tab
  keeps for its life), rewritten by the tab's heartbeat every 15 seconds while it is visible. `route` is one page name from a
  fixed list (`src/lib/presence/shared.ts`), `focus` a person of that family or NULL, `editing` 1 while that person's Edit tab
  is open, `shadows` 0 when the member turned "Show me to others" off (then `focus` and `editing` stay empty). `seen` is
  milliseconds: a row older than 45 seconds is ignored by every read, deleted when its tab is left, and swept by the next
  heartbeat after five minutes. Not a record of the family and not history, so it is written with a plain upsert, not `once`,
  and adds nothing to the op table. Goes with the account (`ON DELETE CASCADE`), when the member leaves the family and with
  the family (its `tree` column).
- **`push_subscription.weekly`** and **`weekly_sent_day`** (0026): whether the device wants "This week in the family", and the UTC day it was last claimed for: at most one in seven days, claimed by one conditional UPDATE before the send.
- **`push_subscription.posts`** and **`posts_sent_at`** (0029): whether the device wants to be told of a new post in the family feed (0 until its owner turns it on), and when it was last told (milliseconds): at most one push in six hours for each device, claimed by one conditional UPDATE before the send.
- **`ai_task_giveup`** (0012): per family, task and item, how many tries failed for a reason of the item's own; after a few, the item is no longer asked until it changes.
- **`ai_chat_image`** (0018): a picture kept with one assistant message (`item` is the `ai_chat` row, `data` is base64). It goes with its message and its user, and is read only through the same check as the message.
- **`ai_thread`** (0020): one row per family, reader and chat (`conv`): the `title` the reader chose, the `title_tier` that name needs (`member` or `editor`), and an optional `provider` and `model` a steward chose for this chat. Messages stay in `ai_chat`.
- **`ai_turn`** (0021): one row per chat while a reply runs (`conv`, `claim`, `at`). It is deleted at the end; a row older than the lease stops counting, so a chat cannot stay locked.
- **`stats_setting`**, **`stats_daily`**, **`stats_member`**, **`stats_once`** (0016, 0019): the stewards' usage counters, see [roles-and-privacy.md](roles-and-privacy.md). `stats_daily` has one counter per family, day, `kind` (`view`, `visit`, `event`, `active`, `change`), reader category `cat` and `name` from a fixed list, so it never holds a person's id or anything a reader typed (it is kept three years). `stats_member` is one pseudonymous marker per member (a one-way hash, never an account id) with the day last seen and the category, dropped 100 days after the last visit; `stats_once` records what a member was counted for once (finishing the tour). `stats_setting` is a steward's off switch; turning collection off deletes the markers at once.
- **`feedback`** (migration 0017): one report: `tree`, `kind` (`bug`, `idea`, `confusing`), `status` (`new`, `in-progress`, `resolved`), `body`, `context` (JSON: the page, the element's selector, language, theme, screen size, browser, app version and recent client errors, nothing else), `picture` (`feedback/<uuid>.jpg` in media storage, null when it was left out), `user` and `user_name` (the name at the time), `created_at`, `updated_at`. Stewards only.
- **`user`**: a person with an account: `name`, an optional `email`, a random `handle` (the passkey's user handle, so a
  passkey reveals nothing about the account), `locale`, `created` and `last_seen`.
- **`credential`**: a passkey: its id, public key, counter, transports, a device name, whether it is synced, and when it
  was last used. Each user has one or more.
- **`session`**: a sign-in. Its key is the SHA-256 hash of the cookie's token, never the token; it has `expires` and
  `refreshed`, and it slides forward as the user is active. `credential` (0022) is the passkey that started it; removing
  that passkey deletes the session. `proved` (0025) is when the session last confirmed with one of its user's passkeys, the
  reader verified, or signed in that way; NULL means never.
- **`invite`**: an invitation to a family with a `role`, an optional `email`, an `expires`, who created it and who used
  it, and `revoked_at`. Only a hash of the link's token is stored. `by_operator` (0036) is 1 for the first-steward invitation an
  operator made with a family: only that one may an operator renew, and only while the family has no members.
- **`share_link`** (0015): a family's share link, at most one per family: a hash of its token, a PBKDF2 hash of its password (or none),
  a `generation` that goes up when it is replaced, an optional `expires`, and `protect_living` (0023: 1 when its guests get the living
  without dates, places or details; see docs/roles-and-privacy.md). A guest is not a user.
- **`share_session`** (0015): a guest's short-lived visit: the SHA-256 hash of the cookie's token, the link and the generation it belongs
  to, and `expires`. It is deleted when the link is replaced or turned off.
- **`share_attempt`** (0015): tries against a link in the current 15-minute window, per link and per link and hashed address. Requests to join use it too, under their own keys.
- **`join_request`** (0024): a guest's request to join: `tree`, the `link` it came through, `user` (the pending account, which has
  no membership and cannot sign in while the request is `open`), `browser` (the hash of the asking browser's cookie), `visitor`
  (the hash of its visitor cookie), `status` (`open` or `approved`), and what the stewards read: `name`, `person` (null: not in the
  tree yet), `message`, `city`, `region`, `country` (from Cloudflare's request data, never an address), `time_zone`, `language`,
  `device` (the family only), `usage` (a JSON copy of the usage when it was sent) and `network` (0027: 18 bits of a hash of the
  link and the network, an IPv4 address or an IPv6 /64, which stand for thousands of addresses; it counts the open requests from
  one home). Approving clears all of those; the row then waits for the first sign-in. A declined or expired request is deleted with its account and passkey; `expires` is 30 days.
- **`guest_visitor`** (0024): one guest browser's use of one link, keyed by the hash of its visitor cookie and the link (the cookie
  is derived from the guest's visit, so a visit makes one row at most; at most 500 per link, the one idle longest goes first): `first_seen`,
  `last_seen`, `visits`, `active_seconds`, `sections` (JSON counts per section name from the statistics' fixed list) and `people`
  (JSON counts of the 20 people opened most). Deleted when the link is replaced or turned off, and 90 days after the last visit.
- **`join_challenge`** (0024): a request's passkey ceremony in progress, with what the guest typed, for five minutes.
- **`user.operator`** (0034): 1 for an operator of the server, an instance role apart from every family's
  ([roles-and-privacy.md](roles-and-privacy.md#the-operator)). The migration makes the earliest account one; afterwards a new
  account is one only when it is the server's first (`newUser`). The last operator cannot step down.
- **`user.email_verified`** (0050): 1 when the account's address was verified: by Cloudflare Access, or by a sign-on provider
  whose ID token said `email_verified` for that same address (taking an invitation, signing up, signing in, adding the provider).
  0 for an address a steward typed into an invitation. A provider with `trust_email` finds only a verified address. The migration
  verifies the addresses a linked identity already vouched for; an Access account is verified at its next visit.
- **`user.retiring`** (0050): set while the retention job retires an unused account: the `former-…` pseudonym its writing gets,
  claimed in one batch guarded by the retention rule (which also ends the account's sessions) before anything of the account
  changes. While set, no session of the account is a way in, none is made, and a visit does not update `last_seen`. A run that
  stopped part-way is finished by the next under the same pseudonym. NULL otherwise.
- **`user.username`** (0040): the name a password sign-in types, normalised to lower case and unique (`COLLATE NOCASE`); NULL for
  an account without a password. Chosen with the first password; cleared when the password is removed.
- **`password`** (0040): one row per account with a password: `hash` (`pbkdf2-sha256-6x100k-v1$salt$key`: PBKDF2-HMAC-SHA-256,
  six chained rounds of 100,000 iterations, over the password after an HMAC pepper keyed from `KINDRED_SECRET`), `params` (the
  scheme, to find old hashes; a sign-in with an old one stores it again) and `set_at`. Goes with the account (`ON DELETE CASCADE`).
- **`totp`** (0040): an account's two-step codes: `secret_sealed` (AES-GCM under a key from `KINDRED_SECRET` and the account),
  `last_step` (the last 30-second step used: a code is accepted only for a later step, in one statement, so it works once),
  `created`, and `confirmed_at` (NULL while being set up). Goes with the account.
- **`recovery_code`** (0040): ten per account, `hash` only (`h1:` and an HMAC of the account and the code keyed from
  `KINDRED_SECRET`, as the passwords' pepper; codes are 50 random bits), `created` and `used_at` (one use: the update that sets
  it is the check). Codes made before that are a plain SHA-256 with no prefix: they still work once each, and the account menu
  asks for new ones. Replaced by a new set; goes with the account.
- **`auth_attempt`** (0040): password, two-step and recovery-code tries per `key`: `u:` and a hash of the username (known or
  not), `p:` and a hash of the username with the network, `n:` and a hash of the network (an IPv4 address, or an IPv6 address's
  /64), or `all` for the server.
  `window_start`, `count`, and `level` (each lockout of a `p:` key doubles its next window, up to 16 hours). Every try is counted
  before it is checked, by one statement that answers the new count, so the limit holds across every Worker isolate and against
  tries sent at once (`src/lib/auth/attempts.server.ts`). A success deletes the username's rows and gives the network's and the
  server's try back; old rows go with the next try.
- **`session.method`**, **`session.proved_via`** (0040): which way in started a session (`passkey`, `password`, `oidc` from 0046; NULL for a session
  from before, read as a passkey's) and how its last fresh proof was given. Turning a way in off deletes the sessions it started;
  a session of a way that `KINDRED_AUTH_METHODS` leaves out is not honoured.
- **`signin_step`** (0041): a right password whose account has two-step codes: the hash of a ticket the browser holds, the account,
  `tries` (five wrong codes end it) and `expires` (five minutes). Deleting it is the check that starts the session.
- **`password_reset`** (0041): an operator's reset link: the hash of its token, the account, `created_by` (the operator, no foreign
  key), `expires` (an hour), `used_at` (once: guarded in the batch that sets the password) and `clear_totp` (1: the link also
  turns two-step codes off). A new link for the account replaces an unused one. `seen_at` (0048): when the holder dismissed the
  notice that the link was used (only a session of another way in can; a password session shows it for 30 days); a used link's
  row stays until then. Goes with the account.
- **`signin_daily`** (0048): `day` (UTC, `YYYY-MM-DD`), `method` (`passkey`, `password`, `oidc`) and `count`: one added by every
  new session (`createSession`), in the same batch. Aggregates only, for the operator's statistics; names nobody.
- **`auth_provider`** (0046): a single sign-on provider the operator added: `id` (the slug in the redirect URI
  `/api/auth/oidc/<id>/callback`, never changed), `kind` (`google`, `entra`, `authentik`, `keycloak`, `generic`: only presets and
  help), `label` (the button), `issuer` (compared exactly; fixed once saved), `client_id`, `secret_sealed` (AES-GCM under a key
  from `KINDRED_SECRET` and the provider; NULL for a public client), `scopes` (space-separated, `openid` first), `trust_email`
  (0/1, off by default: a verified email the provider vouches for may find an account whose `user.email_verified` is 1), `enabled`, and a cache of the discovery
  document (`discovery`, `discovered_at`, a day) and the signing keys (`jwks`, `jwks_at`, a day; fetched again for an unknown key
  id, at most once a minute). Not a family's: no `tree`.
- **`oidc_identity`** (0046): an account's identity at a provider: `(provider, subject)` is the key (the provider's `sub`), so
  one identity belongs to one account; `UNIQUE (user, provider)` keeps one per provider per account. `email` and `email_verified`
  as the last sign-in said: `email_verified = 1` is the account's **verified email** (`verifiedEmailOf` in
  `src/lib/auth/oidc.server.ts`), which nothing else gives. Goes with the account or the provider.
- **`oidc_flow`** (0046, made again in 0048): a sign-in in flight, ten minutes: the hash of its `state`, `provider`, `purpose`
  (`signin`, `invite`, `link`, `proof`, and `signup` from 0048), the hash of the browser's flow cookie, `nonce`, the PKCE `verifier`, `subject` (the account and session for
  `link` and `proof`), `next` (a same-site path) and `data` (an invitation's id, name and terms, or a sign-up's form). The callback deletes its row
  first: a state works once. Not in any backup worth keeping; old rows go with the next flow.
- **`session.provider`** (0046): the provider that started a session whose `method` is `oidc`; turning that provider off or
  removing it deletes those sessions.
- **`instance_setting`** (0034): the server's own settings, one row per `key` (`family_creation`, `instance_name`,
  `contact_email`, `impressum`, `privacy`, `terms`, `report_contact`, `default_cap_bytes`, `families_per_account` from 0037,
  `update_check` from 0038: `on` once an operator agreed to the daily update check, `off` when they declined or turned it off;
  `languages`: the offered languages as `en,de,af`, English always among them, no migration needed; from 0043, also without a
  migration: `instance_mode` (`single` or `hosting`), `signup_per_account`, `signup_per_day`, `signup_total` (a number, or `none`),
  `signup_unverified` (`open` or `waitlist`), `landing_text`, `demo_url` and `backups_confirmed`; `family_creation` may then be
  `signup`;
  `auth_methods` from 0040: a JSON list of the ways in the operator offers, `["passkey","password"]`; missing means
  passkeys only, or what `KINDRED_AUTH` lists, src/lib/auth/methods.server.ts;
  `processing_agreement`, and the retention job's `retention_mode` and `retention_report` from 0044) with
  its text `value`, and when and by whom it last changed. A missing row is the default (`family_creation` is then `stewards`; no
  storage cap; no limit of families per account; every complete language offered). Migration 0037 writes `families_per_account` = 5 only on an install with no
  accounts yet.
- **`operator_audit`** (0034): one row per thing an operator did: `at`, `account` and `name` (no foreign key, so the row outlives
  the account), `action` (`family.create`, `family.suspend`, `family.close`, `family.resume`, `family.cap`, `family.delete`, `request.approve`, `settings`,
  `operator.add`, …), `family` (an id; deliberately not a `tree` column, so deleting the family keeps the row) and `detail` (JSON,
  never record content).
- **`family_admin`** (0034): one row per family with administration: `status` (`active` or `suspended`, read with every
  membership so the guard knows without another round trip) and `closed` (0037: 1 for a suspended family the operator closed
  outright; its members are refused and its guests' visits end; the share link checks it too), `cap_bytes` (NULL for none), `created_at` and `created_by`,
  `invited_name` (whom the operator invited as its first steward), `counted_at` (its storage's last recount) and `self_signed`
  (0043: 1 for a family made by sign-up; the server's ceiling of signed-up families counts these). Deleted with the family
  (`tree` column). From 0044 the statement of reasons for a suspension or closure (EU DSA Art. 17): `status_reason` (the
  operator's text, which the family's members read), `status_ground` (`terms`, `law` or `other`) and `status_at`; resuming clears
  them.
- **`signup`** (0043): one row per sign-up that made a family: `user` (foreign key, deleted with the account, since the row holds
  their `name` and contact `email`), `family` (an id, deliberately not a `tree` column, so the day's count outlives the family),
  `verified` (whether a sign-in provider verified the email; 0 for every passkey sign-up), `age_confirmed` ("I am 16 or older"),
  `code` (the `signup_code` used), `network` (a 4-character hash, never the address) and `created`. Until 0049 the limits per day
  and per network counted these rows, so deleting an account lowered them; they count `signup_tally` now.
- **`signup_tally`** (0049): one row per sign-up with only its `id`, `network` hash and `created`: no account and no family, so
  deleting either keeps the count. The limits per day and per network count these rows inside the batch that adds one; that
  batch removes rows older than two days.
- **`family_left`** (0049): an account that left a family or was removed from it: `user`, `tree`, `left_at`. Deleting the account
  visits these families too, to give what it wrote there a pseudonym ([gdpr.md](gdpr.md)). Deleted with the account and with
  the family.
- **`family_lifecycle`** (0052): one row per family in the lifecycle of quiet families: `tree`, `stage` (`warned`, `readonly` or
  `due`), `quiet_since` (the last activity the stage was decided on: a later visit or reactivation wins), `warned_at`,
  `readonly_at`, `due_at`, `final_notice_at` (automatic deletion's last notice) and `claim` (set by the batch that claims a
  deletion before anything of the family is deleted). No row: not in the lifecycle. Deleted with the family.
- **`family_admin.active_at`** (0052): the last activity that is not a member's visit (`family_visit`): a steward turning the family
  back on, or the operator letting it be used again. **`family_admin.status_by`** (0052): `lifecycle` while the suspension is the
  lifecycle's, which the family's stewards may lift themselves; NULL for the operator's own.
- **`steward_notice`** (0052): what a family's stewards were told in the app (`src/lib/notify/stewards.server.ts`): `tree`, `kind`
  (`lifecycle_warning`, `lifecycle_readonly`, `lifecycle_due`, `lifecycle_final`), `vars` (JSON of dates and numbers, never record
  content) and `at`. **`steward_notice_dismissal`** (0052): a steward (`user`) put a kind of notice away for a family until
  `until`. Both deleted with the family.
- **`signup_code`** (0043): a code an operator made that opens sign-up: `hash` (the code's SHA-256; the code is shown once),
  `label`, `uses_max`, `uses`, `expires` (NULL: never), `created`, `created_by` and `revoked_at`.
- **`subject_restriction`** (0044): a person in a family whose processing is restricted on a request (GDPR Art. 18): `tree`,
  `person`, `since`, `restricted_by`, `request`. While it exists the person's edits are refused. Deleted with the family, or when
  the person is erased.
- **`subject_action`** (0044): one row per erasure, restriction or lifting a steward did: `tree`, `kind`, `at`, `done_by`,
  `request`, and `counts` (JSON: rows removed or rewritten per place). Never a name. Deleted with the family. `pending` (0049):
  the person's id while an erasure is unfinished, NULL once both databases are done; a retry finds it and finishes.
- **`breach`** and **`breach_family`** (0045): the operator's breach register ([gdpr.md](gdpr.md#when-something-goes-wrong)):
  what happened, when the operator became aware (`aware_at`, the start of the 72-hour clock), the risk, when the authority and
  the people were told, the reasons for a late notification, a `notice` for the affected families' stewards until
  `notice_until` or `closed_at`, and the families affected (`breach_family.family`, an id, not a `tree` column: the register
  outlives a family; none means every family). Kept while the server runs.
- **`media_usage`** (0034): one row per file in a family's media storage, `tree`, `key`, `bytes`, `at`. Every upload reserves its
  row in a batch whose guard refuses it over the family's cap, before the file is written; a deletion removes it. A family's usage
  is the sum. `pending_at` (0036) is when the reservation was made, until the file is written (then NULL). The daily run recounts
  a few families a day that were never counted or not for a month (`recount` in `src/lib/operator/storage.server.ts`): it lists
  the family's storage (every file under it, with the size the storage reports, whether a record names it or not) and rebuilds
  the rows from that, keeping rows written since it began and pending reservations younger than an hour. It reads none of the
  family's records. Deleted with the family.
- **`instance_daily`** (0038): one row per UTC `day` of aggregates of the whole server, for the operator's Statistics tab
  ([hosting-many-families.md](hosting-many-families.md#statistics)); never a record and never a person. Families (`families`,
  `families_new`, `families_suspended`, `families_closed`), accounts (`accounts`, `accounts_new`), members per family
  (`members_median`, `members_max`), accounts active in the last day, 7 and 30 days (`active_day`, `active_week`, `active_month`,
  from `user.last_seen`), `active_families` (a member's visit in 30 days, from `family_visit`), `storage_bytes` (from
  `media_usage`), `page_views` (from `stats_daily`, so a family with statistics off adds none), `sign_ins` (JSON, sessions begun
  that day by method), `requests_open`, `data_requests_open`, `backfilled` (1 for a day the first run reconstructed: only the
  families, accounts and page views are known; the rest is NULL) and `at`. Written each night for the day before, from the
  accounts database alone; deleted after three years. Not a family's, so it has no `tree` column and outlives deleted families.
- **`update_check`** (0038): one row (`id` 1), the last answer to "is there a newer Kindred?": `repo`, `checked_at`, GitHub's
  `etag`, `latest` (a version), `releases` (JSON: version, name, date, address and notes of up to twenty releases, as GitHub
  returned them; the console renders the notes through the safe Markdown renderer) and `error` (a short code of a failed check,
  which keeps the last good answer). Only written once an operator agreed (`instance_setting` `update_check` = `on`).
- **`release_seen`** (0038): per account (foreign key, deleted with it), the newest minor version (`2.4`) whose "New in Kindred"
  card it dismissed or followed, and when.
- **`release_running`** (0038): per minor version, when this server first ran it; the card goes only to accounts made before.
- **`family_request`** (0035): someone asking for a family while `family_creation` is `requests`: `name`, `email`, `family_name`,
  `message`, `locale`, `created`; `status` (`open`, `approved`, `declined`) with `decided_at`, `decided_by` and, once approved,
  `family` (the id made; not a `tree` column, so the operator's record outlives the family). `network` is a 4-character hash of the
  network it came from, for the limit of five a day; it names no address.
- **`data_request`** (0035): an access, correction or deletion request (`kind`; or `other`): `name`, `email`, `family_text` (the
  family as written) and `family` (its id, when that names one here; not a `tree` column, for the same reason), `message`,
  `created`; `status` (`open`, `forwarded`, `done`) with `updated_at` and `updated_by`; `network` as above; `forwarded_at` (0037),
  when the operator handed it to the family's stewards, cleared when it is moved back to `open`: the stewards' Access page lists
  only `forwarded` ones. Both forms store a request in one batch whose guards hold the per-network limits (three an hour, five a
  day) and the server-wide ceiling of 200 open requests of that kind. From 0044: `extended_at` and `extension_reason` (the
  operator told the requester the answer takes up to two more months; the deadline is then three calendar months after
  `created` instead of one, `dueAt` in `src/lib/operator/shared.ts`), `person` (the person the stewards found it is about, while
  restricted) and `outcome` (`answered`, `erased`, `restricted` or `refused`, once done). The retention job deletes a request
  three years after it was answered.
- **`terms_acceptance`** (0037): one row per time someone accepted the server's terms of use: `user` (no foreign key, so the
  record stays), `version` (16 hex characters of the SHA-256 of the terms' text), `at`, `action` (`family.create` or
  `invite.steward`) and `family` (an id, not a `tree` column: it outlives the family). Written in the same batch as the step.
  `kind` (0044) says what was accepted: `terms`, or `dpa` for the processing agreement (the `processing_agreement` setting), one
  row each when the server has both. Kept when the account is deleted; the retention job removes a row three years after its
  account is gone.
- **`operator_push`** (0037): an operator's device that asked to be told about new requests: `user` (foreign key, so it goes
  with the account), `endpoint` (unique), `p256dh`, `auth`, `locale`, `created` and `sent_at`, the claim that keeps it to one push
  in ten minutes. Sent only while the account is an operator; deleted when the device turns it off or signs out, or the push
  service reports it gone.
- **`instance_policy`** (0042): one row per policy key the operator has set (`feature.campaign`, `feature.assistant`,
  `feature.portraits`, `feature.address_lookup`, `feature.push`, `ai.source`): `scope` (`off`, `families`, `selected`), `value`
  (JSON; for `ai.source` the source, the operator's provider and model, and the family and server-wide monthly budgets in
  micro-dollars), `updated_at`, `updated_by`. A key with no row is `families` with its default value.
- **`family_policy`** (0042): the operator's word for one family on one key: `tree`, `key`, `granted` (1 under `selected`, 0 for
  a family withheld under `families`), `value` (JSON, unused so far). Deleted with the family.
- **`operator_ai_provider`** (0042): the operator's own key per provider, sealed like a family's (`ai_provider`) under the
  reserved id `*operator`, with its last four characters.
- **`ai_operator_spend`** (0042): micro-dollars of operator-funded AI per family (`tree`) per UTC month; unused since 0049, which
  copied it to **`ai_operator_family_month`** (`family`, `month`, `micros`): the same, by the family's id in a column not named
  `tree`, so deleting a family keeps it and a family made again under the id does not start at 0. **`ai_operator_month`**: the
  same for all families together (no `tree`: it outlives a deleted family, so the ceiling holds). **`ai_operator_booking`**:
  one row per operator-funded call, its reservation until it is settled once (`settled_at`); settled rows go after two days.
  **`ai_operator_overage`** (0049): what a provider billed above a call's reservation (`family`, `month`, `micros`, `at`); the
  settlement books the whole cost and keeps the difference here for the Health tab. `model` (`provider:model`),
  `acknowledged_at` and `acknowledged_by` (0050): an unacknowledged row pauses the operator's AI for that family and model
  (the reservation's guard) until the operator acknowledges it; rows from before 0050 have no model and pause nothing.
- **`announcement`** (0042): a banner from the operator: `title`, `body` (plain text), `audience` (`stewards`, `everyone`),
  `starts_at`, `ends_at` (null: until ended), `created_at`, `created_by`.
- **`update_github`** (0047): one row (`id` 1) for a copy made by the Deploy to Cloudflare button: its `repo` (`owner/name`) and
  default `branch`, the operator's GitHub `token` sealed under `KINDRED_SECRET` (never returned to a page), `token_tail`, `set_at`,
  `set_by`, and the last update the console started: `run_tag`, `run_started_at`, GitHub's `run_id`, `run_url`, `run_status`,
  `run_conclusion` and `run_polled_at`.
- **`job_run`** (0047): one row per daily job (`job`): `started_at`, `finished_at`, `ok` (0 when it failed), `error` (a short
  reason; from 0049 sanitised: no email address, URL path, quoted text, long number or family id) and `last_ok_at`. Written by the
  job runner. `code` (0049): the failure's operational code (`network`, `timeout`, `database`, `config`, an error's own code, or
  `error`).
- **`family_schema`** (0047): per family (`tree`), the newest family migration it reported having (`migration`), the `error` of a
  failed one, and `reported_at`; written by the storage drivers when they open a family. Deleted with the family.
- **`membership`**: a user's role in a family (`viewer`, `contributor`, `editor`, `steward`), and who they are in that
  family (a person id, or `-` for "just browsing"). `person_confirmed` (0014) is 1 once a steward has confirmed the link.
- **`challenge`**: a passkey ceremony in progress (for setup, an invitation, adding a passkey, signing in, or confirming
  it is you on a session, 0025), with its expiry.
- **`ai_settings`**: one row per family: feature switches, web search, the monthly budget in micro-dollars and custom prices,
  and `funding` (0042): `own` (the default) or `operator`, the steward's opt-in to the server's AI.
  Legacy provider/model and daily token-budget columns remain for compatibility; provider connections and routes are authoritative.
- **`ai_provider`** (0010): one connection per family and provider (`anthropic`, `openai`, `openrouter`), with a sealed key,
  its last four characters, and who last updated it.
- **`ai_route`** (0010): a provider and model per family and feature: assistant, arms, faces, avatar, portrait,
  arms-review, occupations, chronicle and names. An absent route or null provider follows the assistant, except painting requires OpenRouter.
- **`ai_spend`** (0007): monthly spend in micro-dollars, shared across features and providers.
- **`push_subscription`** (0005–0006): device subscriptions; `last_sent_day` claims each device's daily reminder before sending.
- **`ai_usage`**: tokens used per family per UTC day.
- **`ai_conversation`**: which conversation a reader is in, per family.
- **`ai_background`** (migration 0009): one row per family for the background AI tasks: the share of the monthly budget that
  background work may use (`cap_share`), the languages the translations go into (`languages`, JSON), the steward's language
  for the review texts (`locale`), and when it was last changed and by whom.
- **`ai_background_task`** (0009): one row per family and task (`arms`, `occupations`, `chronicle`, `names`): `enabled` (off by default),
  `schedule` (`daily` or `weekly`), `last_started` (when it last did something) and `last_checked` (migration 0012: when it last looked and found nothing), which the daily run uses to tell when a task is due.
- **`ai_background_spend`** (0009): micro-dollars that background work has booked per family per UTC month, against its share.
  The whole month's spend stays in `ai_spend`, which background calls book against as well.
- **`ai_task_run`** (0009): the runs that did something, failed, stopped at the cap, or were asked for by hand: when, the
  task, who started it (`schedule` or `manual`), the status, the items done, failed and waiting, what it cost, and a short note.
  The newest 200 per family are kept.
- **`ai_portrait`** (migration 0008): the painted-portrait switch and (0013) the family's own `style`. Its legacy model and key columns remain after migration
  0010; the portrait route and OpenRouter connection now select the model and key. Spend uses the family's monthly budget.
- **`ai_chat`**: one row per message, with the message's JSON body (the text and, for an assistant reply, its proposals
  and their status).

## The gazetteer database (`migrations/gazetteer`)

Optional, read-only for the app, and the same on both targets: offline place search from GeoNames cities500 (CC BY 4.0).
On Node it is `data/gazetteer.db`, built by `mise run gazetteer` (or into the Docker image with `WITH_GAZETTEER=1`); on
Cloudflare it is the `GAZETTEER` D1 binding, with its rows loaded by `mise run cf:gazetteer`. Without it, place search offers
the family's own places.

| Migration | What it adds |
| --- | --- |
| `0001_gazetteer.sql` | `meta` (key and value), `place` (`id`, `name`, `cc`, `admin1`, `lat`, `lng`, `pop`, with an index on `lat`) and `name` (one row per searchable folded spelling: `key`, `id`, and `alt`, the spelling to show when it differs). |

## When a membership ends

A steward removes a member on the Access page (`removeMember`; removing yourself is the only way to "leave"). No account is
deleted while it is a member, and deleting a family deletes its database and every accounts row naming it. One function ends
a membership, `endMembership` in `src/lib/auth/members.server.ts`, in two steps, because the two databases share no
transaction. First the accounts database, in one batch: the membership, the reminder devices (and so the choices of what to be
told), the visit marker, any live presence rows and the assistant chats for that family. Then the family's database (`forgetInFamily`, one `once`
plan, safe to run again, skipped for someone who is a member again). The membership goes first so nobody who is out can add
anything while the second step runs; if it fails, removing them again finishes it.

- Stays: memories (`story`, with `author_account`) and answers to the question of the week; comments (with the name they were
  written under; "a former member" when none); their posts in the feed, with the pictures and the comments under them (a `post`
  keeps `author_name` and `author_person`; only its writer could change it, so it can now only be removed, by an editor); the
  change history with their name; the Campaign's chronicle (`campaign_log`); join requests as history; their confirmed
  "Who is this?" proposals (`tag_proposal`, `confirmed`: they are tags, "Named by" them).
- Goes: reactions; quiz answers (so standings and streaks); the Campaign's reigns (`campaign_run`, so their lines in the
  tables) and the old game's member rows and push claims;
  the opt-in for the answer push (`response_push`); their "Who is this?" proposals nobody confirmed (open or declined) and the
  pictures they passed on (`tag_pass`); their Personal items and the history rows of those.
- Left pointing at the account: `story.author_account`, `comment.account`, `post.account`, `campaign_log.account`, `history.account`, `tag_proposal.account` (confirmed) and `decided_by`,
  `updated_by` columns of the Campaign and Today settings, invitations (`created_by`, `used_by`) and join requests. None is
  read as a live membership; each is either shown by the name kept beside it or ignored.

## When an account is deleted

"Delete my account" and the retention job (`src/lib/gdpr/account.server.ts`, [gdpr.md](gdpr.md)) read both databases' schemas
instead of a list, so a table added later is covered. Refused while the account is a family's last steward or the server's last
operator (guards in the batch restate both).

- Accounts database: every row with a `user` or `account` column naming the account goes (passkeys, sessions, memberships,
  chats, push devices, visits, presence, feedback, join requests, and the sign-in tables of any later method); a `*_by` column
  naming it is emptied and its row stays; `ai_turn` rows found through its chats and `challenge` rows naming it go first. Kept as
  the operator's records: `operator_audit` and `terms_acceptance`. Then the `user` row.
- Each family whose accounts rows named it: through one `once` plan with no history row. Rows keyed by the account (reactions,
  quiz answers, push opt-ins …), rows only it could read (`owner`: personal fields and their history) and its retry keys (`op`)
  go. Every other column naming the account (`account`, `author_account`, `*_by`) becomes `former-<uuid>` (one per deletion),
  and the name beside it (`name`, `author_name`, `author`, `created_by_name`) "A former member"; a plain-text name column in a
  table that records authorship is replaced too when no other member of the family has that name.

## Erasing a person

A steward erases a living person who is not a member (`erasePerson` in `src/lib/gdpr/subject.server.ts`), also generic over both
schemas: the person as removing them does (their links, fields, events, stories, photo, portraits, tags, citations, research
links cascade), the gallery pictures only they are tagged in (and their files), every `history` row about them, then in every
text column of the family's tables (and of the accounts tables with a `tree` column, for that family) their id becomes `[—]` and
each full name `[—]` (a key column holding the id deletes its row). In the accounts database, every assistant conversation in
the family that names them goes whole, `guest_visitor.people` loses their key, a join request's `person` is cleared. The
`subject_action` row keeps counts only.

## Rules every change follows

These rules keep the data consistent without interactive transactions, which D1 does not have.

- **Reads decide, a batch writes.** A change reads what it needs, checks it, and then sends its writes as one batch
  (`batch()`). The batch starts with **guards** that restate what the decision relied on, for example "the child still
  has one parent" or "the person count is the same as when I read it". A guard is an `INSERT INTO guard (ok) SELECT …`,
  and the trigger on the `guard` view aborts the whole batch when the condition is false. If another request changed
  the facts in between, nothing is written and the change is decided again on fresh reads.
- **Reads that do not depend on each other go together.** On D1 every statement is a round trip, so a page's independent
  reads are sent as one `readBatch()` (reads only; one round trip on D1, one read transaction on Node, the same moment of
  the database on both). The family graph, the families list, the session and the AI status each read this way.
- **Every change writes its history row in the same batch.** A plan names what it did to the family's records in `history`
  (`src/lib/history.server.ts`), and `once` turns that into `history` rows inside the change's own batch, so a change is never
  stored without its row and a refused batch writes neither. `history` is required by the plan's type; a plan for a write that
  touches none of the family's records (the Campaign, a translation cache) says `NOT_A_RECORD`, and `once` refuses one that
  says so while writing a records table, or names no history at all. Who made the change comes from the request's membership
  check; a daily job or a script is Kindred itself.
- **Retry keys make a resend safe.** A change sent with an `opKey` stores its result in `op` in the same batch. The same
  key sent again, by the same person with the same change, returns the stored result instead of writing twice. A key
  reused for something else is refused. Rows older than 30 days are pruned.
- **Constraints back the same rules.** Primary keys, foreign keys and `CHECK`s hold in the database itself, so a bug in
  the application cannot store, for example, a parent link to a person who does not exist.
- **Pictures and research documents are in media storage.** The database holds only keys (`photo/<uuid>.jpg`, `gallery/<uuid>.jpg`, `research/<uuid>.pdf`). Node keeps
  them in `data/media/<id>/`, Cloudflare in R2 under `<id>/<key>`. A replaced picture is deleted after the change that
  replaced it is written. Every file is stored and deleted through `media` in `src/lib/db.server.ts`, never `store.media` directly: it counts
  the file against the family's storage cap (`media_usage`). The one exception is the operator's restore into a new family
  (`copyMedia` in `src/lib/backup/backup.server.ts`), which copies the original's files and then recounts the new family.
- **A family's rows in the accounts database carry its id in a column named `tree`.** Deleting a family
  (`src/lib/families.server.ts`) removes every accounts row whose table has a `tree` column, found from the schema, so a
  table added later is included without a list to keep. A row that belongs to a family only through another row (a share
  session through its link, a running reply through its chat) is listed there by hand; add yours the same way. A family in a
  Durable Object loses all its storage. The automatic backups' rows (`family_backup`, `backup_status`) name the family in a
  column called `family` instead, so they outlast it for the operator's grace period. A D1 family database is emptied rather than removed (`emptyDatabase` in `src/lib/store/db.ts`): every table but
  `d1_migrations` and the tables a migration seeds with a starting row (`SEEDED_TABLES`, today `ancestry_rev`). A new
  migration that seeds a table with a row the app needs adds it there.
- **A release's migrations are additive; clean-ups come one release later.** A migration in a release adds tables, columns
  (with defaults), indexes and rows; it never drops, renames or narrows what the release before still reads. On Workers the old
  and new code run side by side for a while (Workers Builds rolls out gradually, and each Durable Object migrates itself on first
  use after a deploy), and an operator may go back one release (reverting the update's commit, or the previous image) on a
  schema that has already moved on. Dropping a column or a table the previous release used is a migration of the next release
  but one, once no supported release reads it, and its release notes say so.
- **A demo writes nothing.** With `KINDRED_DEMO=1` (`src/lib/demo.ts`) the storage layer hands out read-only databases and
  a media store that refuses to store or delete, and `once` refuses before its plan runs. A write made while a page is only
  read (bookkeeping such as "last seen") must tolerate that refusal, or skip itself when `isDemo()`.

## Seeding and the exchange

`src/lib/seed-format.ts` defines the JSON a family can be seeded from (`scripts/seed.ts`), and `scripts/import-kindred.ts`
produces that JSON from a v1 Markdown archive. GEDCOM and the Markdown archive are the formats for moving a family in and
out; [exchange.md](exchange.md) describes them, and what each one keeps.
