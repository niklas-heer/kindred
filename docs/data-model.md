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

The schema is the sum of the files in the `migrations/` folders. On Node, `src/lib/store/node.ts` applies the pending ones
when it opens a file and backs the file up first. A migration runs while the Worker that is still serving is on the old
code (`mise run deploy` migrates before it deploys), so it must not break the release before it. There are three folders:
`tree`, `accounts` and `gazetteer` (see the end).

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
- **`campaign`**, **`campaign_season`**, **`campaign_member`**, **`campaign_log`**, **`campaign_push`** (migration 0025): the Campaign's own state, and nothing else's. No row refers to a person, a house or a place by a foreign key, and the game writes to no other table. `campaign` is one row (`id` = 1): the steward's switch (`enabled`, 0 until turned on) and the number of the `season` being played. `campaign_season` is one row per season: its `seed`, the UTC day it `started` (days since 1970), the `map` (provinces with their land and borders), the `sides` (the houses, their allies and arms as they were that day) and the `state` (who holds what, the garrisons, each side's waiting levy, the seats, who gave an order today), all JSON; `rev` goes up with every change to `state`, and every order guards on it; a finished season has `ended`, `winner` and `result` (its standings), which is the hall of fame. `campaign_member` is one row per season and account: the `side` a member chose when they stand for nobody in a house (`pledged`), their `orders` and the season day that count is from (`orders_day`), the UTC day of their last bonus order (`bonus_day`), the last chronicle entry they have `seen`, and the `name` shown. `campaign_log` is the chronicle: `season`, `day`, `kind` (`muster`, `march`, `attack`, `pledge`, `bonus`, `season_start`, `season_end`), the `side`, the `account` and `name` (NULL for a regent), the `province`, `took`, `data` (JSON: the dice of a battle with their seed) and `cry` (a battle cry, at most 80 characters). `campaign_push` holds one row per account and UTC day: the claim that keeps the push to one a day. Rows of seasons older than the previous one are deleted when a season starts, except `campaign_season`. The D1 transfer leaves all five out (`LEFT_OUT_TABLES`): they name accounts, which are not copied, and the target starts with the game off.
- **`history`** (migration 0026): the change history ([roles-and-privacy.md](roles-and-privacy.md#change-history-and-whats-new)). One row per change: `at`, `account` (who; NULL for Kindred itself, a daily job or a script) and `name` (the name shown then), `kind` (`person`, `field`, `link`, `partnership`, `event`, `source`, `citation`, `story`, `photo`, `album`, `tag`, `portrait`, `house`, `place`, `research`, `family`, `import`), `record` (its id; a parent link is `child>parent`), `person` (the person it is about, no foreign key, so the row outlives them) and `person_name` (their name then), `label` (what the record was called then), `action` (`added`, `changed`, `removed`), `level` and `owner` (who may read the row, the levels of a person's field: `family`, `editors`, or `personal` for `owner` alone), `fields` (JSON, for a change only: `{"f": {field: [before, after]}}` with the changed fields alone, each value at most 400 characters and the whole at most 4,000; `t` names values cut short, `o` fields kept without content, such as a picture, the arms or a portrait's look, `e` values for editors only), `count` (how many records one row stands for: a GEDCOM import is one row) and `fn` (the change that wrote it). Saves of one record by one person within ten minutes are folded into one row, and a change that ends where it started leaves none. A personal field's row never has `fields`. Rows older than `KINDRED_HISTORY_YEARS` (3) are deleted by the daily job, and a member's personal rows go with them when they leave the family. Not in GEDCOM or the Markdown archive; the D1 transfer leaves it out (it names accounts).
- **`reaction`**, **`comment`**, **`response_push`** (migration 0027): what members say about a memory or a gallery photo ([responses.md](responses.md)). Both name what they are about with `target_kind` (`story`, `media` or, since migration 0029, `post`) and `target` (the story's or the post's `id`, or the picture's `key`); as a target is in one of three tables there is no foreign key, and the triggers `story_responses_go`, `media_responses_go` and `post_responses_go` delete a story's, a picture's or a post's reactions and comments when it is deleted, also when a story goes with its person. A restored story comes back without them. `reaction` is one row per `account`, target and `kind` (`heart`, `remember`, `laugh`, `candle`, `thanks`; the set is the app's, `src/lib/responses.ts`), with `created_at`. `comment` has an `id`, the `account` and the `author_name` shown when it was written (it outlives the account and the membership), the plain-text `body` (1 to 1,000 characters, line breaks kept), `created_at` and `edited_at` (set when its writer changes it). A member who leaves keeps their comments, under that name, and their reactions, which still count. `response_push` is one row per account that chose the push to an author: `enabled`, and `last_day`, the UTC day of the last one, which is the claim that keeps it to one a day. The D1 transfer copies `reaction` and `comment` and leaves `response_push` out.
- **`post`**, **`post_media`**, **`post_person`** (migration 0029): the family feed ([feed.md](feed.md)). A `post` is a member's short message to the family: an `id`, the `account` that wrote it, the `author_name` shown then and `author_person` (the person the writer stood for in the tree then, NULL when nobody or when that person is removed), so a post outlives the account and the membership with its name and its face; the plain-text `body` (at most 4,000 characters, line breaks kept, empty when the post is only pictures), `created_at` and `edited_at` (set when its writer changes the words). `post_media` lists a post's pictures in their order (`ord`): each is a gallery picture (`media.key`), uploaded through the gallery before the post is made with `media.for_post` = 1, and belongs to at most one post (`UNIQUE`); removing the picture in the gallery removes the row, and removing the post removes its pictures from the gallery and from storage. `media.for_post` is set only by the server, on the composer's upload, from the moment the picture is stored, and only such a picture, the writer's own and in no post yet, can become a post's: so removing a post deletes only pictures uploaded for it. A marked picture in no post is a leftover of a post never made: nobody sees it, its writer may delete it (the composer does on cancel and on a refusal), and the daily job (`feed`) deletes leftovers older than a day from the table and from storage. A marked picture writes no `history` row, coming or going. `post_person` names the people from the tree a post is about; a person who is removed drops out of it. A post is not a record of the family's: writing, changing or removing one writes no `history` row, nor does uploading or removing its pictures. Reactions and comments reach a post through `reaction` and `comment` with `target_kind` = `post`, and the trigger `post_responses_go` deletes them with it. A share-link guest reads none of the three, and a picture with `media.for_post` = 1, in a post or not, is left out of a guest's gallery, a person's photos, research and the media route; research cannot link one and a source cannot cite one. The D1 transfer copies all three; the Markdown archive carries the posts and their comments in `feed/`, one file per year; GEDCOM has none of it.
- **`story.author_account`** (0027): the account that wrote a story, so its writer can be told about answers; `author` stays the name shown. NULL for stories from before, from the assistant and from imports. It is never sent with a story to a reader.
- **`today_week`**, **`today_answer`** (migration 0028): the question of the week. Which curated question a week asks is computed from the family's id (`src/lib/today/week.ts`) and not stored; `today_week` has a row only for a week a steward changed, with their own `question` or `skipped` = 1. An answer is an ordinary `story` row; `today_answer` is its tag (`story`, the ISO `week` such as `2026-W46`, and the `question`: `q01` to `q60`, or `custom`), removed with the story (`ON DELETE CASCADE`). Neither names an account, and both are copied by the D1 transfer.
- **`today_settings`**, **`quiz_day`**, **`quiz_answer`** (migration 0028): the daily quiz. `today_settings` is one row (`id` = 1): the steward's switch (`quiz`, 1 until turned off). `quiz_day` is one row per UTC day: the `question` as readers are sent it (JSON, without the answer), the `answer`, the `kind`, and the person or house it is `about`. `quiz_answer` is one row per member and day (the primary key, so an answer cannot be given twice): the `account`, the `choice`, whether it was `correct`, and the `house` of the person the member stood for. They are a game's state, name members by account id, and are left out of every export and of the D1 transfer.
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

### Tables

- **`view_as`** (0028): one "View as" preview, behind a random token in its own HttpOnly cookie; `hash` is the token's SHA-256, as for a session. `user` is the steward who started it and `session` the hash of the passkey session it belongs to (NULL under Cloudflare Access, which has no session row). `tree` is the family previewed; `kind` is `role` (with `role`: `viewer`, `contributor` or `editor`), `member` (with `member`, the account previewed) or `guest` (with `link`, the family's share link, or NULL for a plain guest with living people protected). `created` and `last_used` are milliseconds: a preview unused for an hour, or older than a day, is over. Deleted on Stop, on sign-out and with its session, when the steward is no longer a steward, the member leaves or the link goes, with the account (`ON DELETE CASCADE`) and with the family (its `tree` column).
- **`family_visit`** (0026): one row per member and family: `last_seen` (when they last opened the family, milliseconds), `shown` (when "What's new" or the History page last showed them the news) and `since` (where "What's new" counts from). `visits` (0027) counts the visits, 1 during the first (0 for members who visited before it was counted). A visit ends after two hours without opening the family; when the next begins, `since` moves up to `shown` and never further, so news that came after they last looked is not skipped, and during a visit it stays put, so the page shows the same news however often it is opened. Goes with the account and when the member leaves the family.
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
  it, and `revoked_at`. Only a hash of the link's token is stored.
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
- **`membership`**: a user's role in a family (`viewer`, `contributor`, `editor`, `steward`), and who they are in that
  family (a person id, or `-` for "just browsing"). `person_confirmed` (0014) is 1 once a steward has confirmed the link.
- **`challenge`**: a passkey ceremony in progress (for setup, an invitation, adding a passkey, signing in, or confirming
  it is you on a session, 0025), with its expiry.
- **`ai_settings`**: one row per family: feature switches, web search, the monthly budget in micro-dollars and custom prices.
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
told), the visit marker and the assistant chats for that family. Then the family's database (`forgetInFamily`, one `once`
plan, safe to run again, skipped for someone who is a member again). The membership goes first so nobody who is out can add
anything while the second step runs; if it fails, removing them again finishes it.

- Stays: memories (`story`, with `author_account`) and answers to the question of the week; comments (with the name they were
  written under; "a former member" when none); their posts in the feed, with the pictures and the comments under them (a `post`
  keeps `author_name` and `author_person`; only its writer could change it, so it can now only be removed, by an editor); the
  change history with their name; the Campaign's chronicle (`campaign_log`); join requests as history.
- Goes: reactions; quiz answers (so standings and streaks); the Campaign's member rows (orders, pledge: a house's side is
  worked out from the members who are there, so their seat and command are free and the regent rules apply) and push claims;
  the opt-in for the answer push (`response_push`); their Personal items and the history rows of those.
- Left pointing at the account: `story.author_account`, `comment.account`, `post.account`, `campaign_log.account`, `history.account`,
  `updated_by` columns of the Campaign and Today settings, invitations (`created_by`, `used_by`) and join requests. None is
  read as a live membership; each is either shown by the name kept beside it or ignored.

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
  replaced it is written.
- **A family's rows in the accounts database carry its id in a column named `tree`.** Deleting a family
  (`src/lib/families.server.ts`) removes every accounts row whose table has a `tree` column, found from the schema, so a
  table added later is included without a list to keep. A row that belongs to a family only through another row (a share
  session through its link, a running reply through its chat) is listed there by hand; add yours the same way. On Workers
  the family database itself is emptied rather than removed (`emptyDatabase` in `src/lib/store/db.ts`): every table but
  `d1_migrations` and the tables a migration seeds with a starting row (`SEEDED_TABLES`, today `ancestry_rev`). A new
  migration that seeds a table with a row the app needs adds it there.
- **A demo writes nothing.** With `KINDRED_DEMO=1` (`src/lib/demo.ts`) the storage layer hands out read-only databases and
  a media store that refuses to store or delete, and `once` refuses before its plan runs. A write made while a page is only
  read (bookkeeping such as "last seen") must tolerate that refusal, or skip itself when `isDemo()`.

## Seeding and the exchange

`src/lib/seed-format.ts` defines the JSON a family can be seeded from (`scripts/seed.ts`), and `scripts/import-kindred.ts`
produces that JSON from a v1 Markdown archive. GEDCOM and the Markdown archive are the formats for moving a family in and
out; [exchange.md](exchange.md) describes them, and what each one keeps.
