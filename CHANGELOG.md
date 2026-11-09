# Changelog

All notable changes to Kindred are written here, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers follow
[Semantic Versioning](https://semver.org/). Read the section for each release between yours and the one you are
moving to before you upgrade ([docs/self-host.md](docs/self-host.md), "Upgrading").

## [Unreleased]

Changes on `main` since 2.0.0. They are not in a release yet.

Database changes: accounts migration `0022_session_credential.sql` is new. On Node it is applied by itself when the
server starts, after a copy of the database. On Cloudflare, `mise run deploy` applies it before the new Worker goes live
(`mise run cf:migrate:remote` does the same step alone). It adds one empty column; sessions you already have keep working.

### Added

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
- Cloudflare guide: a page needs the Workers Paid plan, and the Worker should be placed near D1.

### Fixed

- The Path lens asks for a second person instead of comparing someone with themselves.
- Step, foster and in-law relations are named as they are.
- A house is not saved over someone else's newer change, and a house's member count is the same on the tree and on its page.
- A value someone else entered on the Needed page while yours was open is kept.
- An upload is kept when the batch that used it may have been saved.
- GEDCOM and the other imports: continued text keeps every character, a couple's existing partnership is matched instead of
  doubled, parent rules are the link form's, an ancestor with no death record is not marked living, and Julian and dual-year
  dates are kept as about their year.
- A restored draft that cannot be saved shows the field that stops it. An old invitation opened by a signed-in member shows the way in.
- A contributor is told what she can add instead of being sent to someone else.
- Layout fixes for phones and 1280 px laptops.

### Security

- The Content-Security-Policy is now enforced, not report-only. Every response also carries a Cross-Origin-Opener-Policy and a
  Permissions-Policy, and private pages are marked `Cache-Control: private, no-store`.
- Behind a reverse proxy, the limits on signing in, share links and invitations now count each visitor's own address instead of
  one limit for the whole site (set `KINDRED_TRUSTED_PROXIES`). Malformed share and invitation tokens are refused before they are counted.
- Uploaded photographs lose their EXIF, GPS, XMP and IPTC data on the server, whatever client sent them (a camera's orientation is kept).
- A PDF cannot hide active content in comments, strings or object streams, and `/AA` and most `/OpenAction` entries are refused.
- Sessions are tied to the passkey that started them (see Added).

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
