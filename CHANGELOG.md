# Changelog

All notable changes to Kindred are written here, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers follow
[Semantic Versioning](https://semver.org/). Read the section for each release between yours and the one you are
moving to before you upgrade ([docs/self-host.md](docs/self-host.md), "Upgrading").

## [Unreleased]

Changes on `main` since 2.0.0. They are not in a release yet.

Database changes: four migrations are new, `accounts/0022_session_credential.sql`, `accounts/0023_share_protect_living.sql`,
`accounts/0024_join_request.sql` and `tree/0023_photo_thumb.sql`. They add columns and new tables, so they are quick and nothing
you have is rewritten. On Node they
`tree/0023_photo_thumb.sql` and `tree/0024_events_sources.sql`. The first three each add one column and the last adds three
empty tables, so they are quick and nothing you have is rewritten. On Node they
are applied by themselves when the server starts, after a copy of each database. On Cloudflare, `mise run deploy` applies
them before the new Worker goes live (`mise run cf:migrate:remote` does the same step alone). Code and migrations roll back
together: to go back to 2.0.0, restore the copies the server made before the migration and start the old version. An old
version will not run on a database that has had these migrations.

`tree/0025_campaign.sql` adds the Campaign's own five tables and changes none that exist.

### Added

- Managing families: a steward (or the server's first account) can make another family on the new Families page (name,
  address, tagline, theme), change a family's details, and delete a family after downloading its export, typing its address and
  confirming with a passkey. Deleting removes its database, its pictures and every accounts row that names it. On Cloudflare the
  page lists bound but empty `TREE_<ID>` databases to set up and explains the binding step. See docs/self-host.md, "More than one
  family".
- A public demo: `KINDRED_DEMO=1` opens the invented families to anyone without sign-in, read-only, with a slim demo bar; every
  write is refused on the server. `mise run demo` (Node), `docker compose --profile demo up -d --build demo`, and `deploy/demo/`
  for Cloudflare. It refuses to start beside accounts, Access, a guest host, a setup code or reminder keys. See docs/self-host.md,
  "A public demo".
- Ask to join: a guest of a family's share link can ask for an account of their own, with a passkey. A steward sees the request
  on the Access page (with an approximate place, the device family and how the link was used), gets a badge and a push, and
  approves it with a role or declines it. Requests end after 30 days; a link holds at most 10. Each link has a "Guests may ask to
  join" switch, on by default. To show how the link was used, a guest's visit is now measured per browser as a few totals
  (never with Do Not Track or Global Privacy Control); see docs/roles-and-privacy.md. Kindred sign-in only.
- Life events: baptisms, schooling, service, moves, burials and more (or a custom event), each with a date and an end, a
  place and a note. Editors add them on a person's Edit tab or with "Add an event" on the life timeline, where every reader
  sees them in order with birth, partnerships, children and death. Events with a place are a new "Events" view on the Atlas.
  A share-link guest sees events of the dead, and with "Protect living people" none of a living person's.
- Sources and citations: a Sources page under Research holds the family's registers, letters, books and web pages, and
  editors cite them for a birth, death, name, event, partnership or parent link, with a page, a quality and a short
  transcription. Cited facts carry a small "sourced" mark; the Edit tab shows which facts have no source, and the Needed page
  lists births without one for editors. Members read sources; guests get none.
- GEDCOM export and import carry life events (standard tags, `EVEN` with `TYPE` for the rest) and sources (`SOUR` records,
  and citations with `PAGE`, `QUAY` and `DATA`/`TEXT`); Kindred's own export comes back unchanged. The Markdown archive lists
  them too, with sources in `sources/`.
- The Campaign: a slow game between the family's houses, on a map made from the family's places. A house whose people are
  well recorded raises more troops; every member gets three orders a day; a season lasts 28 days. It is off until a steward
  turns it on under Games, never changes the family's records, is not shown to share-link guests and is left out of every
  export. A practice skirmish runs in the browser. See [docs/campaign.md](docs/campaign.md).

- Setting `KINDRED_TRUSTED_PROXIES`: how many reverse proxies stand in front of the Node server. `compose.yaml` passes it
  on and the HTTPS steps set it to 1.
- Removing a passkey now signs out the devices that signed in with it. The passkeys dialog has "Sign out everywhere else".
- The Node server compresses what it sends (brotli or gzip), so a large family's tree page is about a tenth of its former size
  on the wire without a proxy.
- GEDCOM import reads UTF-16 files, ANSI/Windows-1252, ISO-8859-1, Mac Roman and ANSEL, found from the byte order mark and the
  `CHAR` line. The preview says how many characters could not be read.
- A gallery batch of photographs can share one optional date.
- Add a memory from the Chronicle itself. A removed memory can be undone.
- A shorter guided tour (eight steps) of what a new relative needs.
- The family tree opens on the view the reader last chose, small families open on full cards, and a person's Life tab shows the
  whole timeline when they have died.
- Arrow keys walk the tree and say where you are to a screen reader; the person panel is named, and on a phone it is a dialog.
- Search lists your nearest relatives first among equal matches.
- Design rounds one and two: people are larger, every word is readable, the tree opens on the person and the toolbar hangs from the top bar.

- A share link can protect living people, and every new link does: a guest sees their name, face and place in the tree, and
  none of their dates, places, details, stories or photo tags. Links you already made are not changed. The Access page shows
  each link's protection and switches it on or off (accounts migration 0023).
- Gallery tiles load a small copy of each photograph (about 400 pixels), made when it is uploaded, so a big gallery opens much
  faster. Photographs uploaded before keep loading whole (tree migration 0023).
- "About and credits" in the account menu, which now holds only what concerns you. A skip link and a main landmark on every
  family page, and the section icons carry names for screen readers.
- On a phone the page uses the whole screen, and Kindred can be added to the home screen with its own icon.
- A new first-run question after setup shows years and parents before you say who you are, so two people with one name are
  easy to tell apart.
- A ready-made multi-arch image (amd64 and arm64) is published to `ghcr.io/niklas-heer/kindred` when a version is tagged, and
  `docs/self-host.md` shows the short way to run it. The pipeline also starts the Docker image and checks `/api/health`.
- `mise run screenshots` retakes the README pictures from the two invented families.

### Changed

- The Node server runs in production mode unless you set `NODE_ENV` yourself.
- Pages and the family graph are smaller and quicker to load: absent fields are left out, the families list reads only what the
  reader's families need, and the account count is not checked on every request once an account exists.
- The world maps are no longer in the server build; the Worker's server code is about 1.2 MB smaller.
- German, Afrikaans and English wording was reviewed: kinship words agree, ordinals and sorting follow each language, German names
  roles instead of gendering people, and several sentences are whole sentences in every language.
- A person's removal no longer blocks other changes to the fields that named them.
- The Access page lists people first; the account menu has two groups.
- Removing something asks in Kindred's own dialog.
- The browser downloads only the language it shows, not all three, and page code loads when a page is opened, so the first
  screen appears sooner. The Chronicle, the Gallery and a profile are drawn on the server.
- Reminder and date wording in German and Afrikaans was reviewed again: whole sentences, wedding anniversaries with their full
  names, one name for each feature.
- Cloudflare guide: a page needs the Workers Paid plan, and the Worker should be placed near D1.
- A family page reaches D1 in 4 round trips instead of about 21: the session with its account and memberships, the families
  list with today's events, the family and the AI status are each read as one batch.
- Saving a person on the Edit tab no longer reads the whole family again: the save answers with the person as your page shows
  them, and the page patches its copy. A newly pinned place, or a new birth date for someone with a painted portrait, still
  reads the family again.
- The Chronicle's page is about 375 kB lighter (1.44 MB to 1.07 MB on a family of 1600 people, before compression): only the
  first entries draw their faces into the page; the rest are drawn as soon as it has loaded, in the same frame.

### Fixed

- A GEDCOM file with a few thousand partnerships no longer fails to import because two of them were given the same new id.
- The Path lens asks for a second person instead of comparing someone with themselves.
- Step, foster and in-law relations are named as they are.
- A house is not saved over someone else's newer change, and a house's member count is the same on the tree and on its page.
- A value someone else entered on the Needed page while yours was open is kept.
- An upload is kept when the batch that used it may have been saved.
- GEDCOM and the other imports: continued text keeps every character, a couple's existing partnership is matched instead of
  doubled, parent rules are the link form's, an ancestor with no death record is not marked living, and Julian and dual-year
  dates are kept as about their year.
- A restored draft that cannot be saved shows the field that stops it. An old invitation opened by a signed-in member shows the way in.
- An edit whose save reached the server just as the page closed says "All saved" when the person is opened again, instead of
  looking as if nothing had been typed.
- A contributor is told what she can add instead of being sent to someone else.
- Layout fixes for phones and 1280 px laptops: the upload button and the add-a-memory form stay on the screen, date fields
  keep their size, the almanac's month tiles and the person tabs keep their words in German, and keyboard hints are hidden on
  touch screens.
- Accessibility: input fields are 16 px on touch so iOS does not zoom, errors are tied to the field that caused them, links
  to phone numbers, e-mail and names are told apart, and every control on the account menu shows where the focus is.

### Security

- The Content-Security-Policy is now enforced, not report-only. Every response also carries a Cross-Origin-Opener-Policy and a
  Permissions-Policy, and private pages are marked `Cache-Control: private, no-store`.
- Behind a reverse proxy, the limits on signing in, share links and invitations now count each visitor's own address instead of
  one limit for the whole site (set `KINDRED_TRUSTED_PROXIES`). Malformed share and invitation tokens are refused before they are counted.
- Uploaded photographs lose their EXIF, GPS, XMP and IPTC data on the server, whatever client sent them (a camera's orientation is kept).
- A PDF cannot hide active content in comments, strings or object streams, and `/AA` and most `/OpenAction` entries are refused.
- Sessions are tied to the passkey that started them (see Added).
- A share link that protects living people no longer shows the caption, date or place of a picture a living person is
  tagged (or suggested) in, in the gallery, on a person's page or in research.
- Adding a passkey and "Sign out everywhere else" ask you to confirm with a passkey on that browser first, unless you signed in
  there in the last five minutes, so a borrowed, unlocked browser cannot add a passkey of its own (accounts migration 0025).
- Nobody learns of changes to, or the number of, a person's fields they cannot see. The Edit tab's version of a person now
  moves only with what that reader sees, the limit of 200 fields counts only theirs, a field's position is its place among
  theirs, and the person read no longer carries the stored revision at all (a guest never needed it). A draft open across
  this upgrade asks once to load the latest.

## [2.0.0] - 2026-11-09

The first release of the web app. It replaces the v1 Markdown archive application: a shared family tree for a whole family,
on Node 26 with SQLite or on Cloudflare Workers with D1 and R2.

- Trees, houses and arms, Atlas, Almanac, Chronicle, photographs, research projects and a profile for each person.
- Passkeys, invitations, four roles enforced on the server, and read-only share links.
- Optional AI through Anthropic, OpenAI or OpenRouter, with a monthly budget; nothing changes without approval.
- English, German and Afrikaans; GEDCOM import and export, Markdown export, optional reminders and nightly private GitHub archives.

Read the [release notes](docs/releases/v2.0.0.md) for the full list and for moving from v1 (also
[docs/migration-plan.md](docs/migration-plan.md)). Cloudflare Access installs must set `KINDRED_AUTH=cloudflare-access` before deploying.

[Unreleased]: https://github.com/niklas-heer/kindred/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/niklas-heer/kindred/releases/tag/v2.0.0
