# Release notes and highlights

Each release has two kinds of notes:

- **`docs/releases/vX.Y.Z.md`**: the release notes for people who run Kindred (what changed, new settings, what to do when
  updating). They become the GitHub release's text, which the operator console's Updates tab shows.
- **Highlights** in `src/lib/releases/index.ts`: what the people who use Kindred see under **New in Kindred** (`/whats-new`) and
  on the card after an upgrade ([hosting-many-families.md](../hosting-many-families.md#new-in-kindred)).

## Writing a release's highlights

1. Find the release's entry in `RELEASES` (the newest is first; a release gets an empty slot while it is being made) and set its
   `date` (YYYY-MM-DD) when it ships.
2. Add **3 to 8 highlights**, the changes a person would notice, most noticeable first. Each is a title and one line:
   `h('ops.r240.thing_title', 'ops.r240.thing_text', 'everyone')`. The title is a short sentence ending in a full stop; the line
   says what it means for the reader, in plain words and in the second person ("du" in German, "jy" in Afrikaans). No setting
   names, no file names: those belong in the release notes.
3. Give each its **audience**: `everyone` (members, and guests from a share link), `stewards` (what only stewards do: access,
   settings, View as) or `operators` (running the server). A steward sees `everyone` and `stewards`; an operator sees all.
4. Put the text in `src/lib/i18n/areas/ops.ts` in every language, under the release's prefix (`ops.r240.`). `npm test` fails while
   a language is missing one.
5. Mark the release `security: true` when it fixes a security problem, and `manual: true` when updating needs a step by hand (a
   setting, a command); the console shows both to operators.
   A server running an older Kindred does not have this file's word on a newer release, so say it in the GitHub release's notes
   too, with a line of its own: `<!-- kindred:security -->` or `<!-- kindred:manual -->` (hidden on GitHub's page). The console's
   update check reads them, and its Update button refuses to pass a `manual` release. Mark a release `manual` whenever a
   Deploy-button copy must change something itself, such as Kindred's own `wrangler.jsonc` (the update workflow keeps the copy's).

A release with no highlights is skipped: no card, no section. The test `src/lib/operator/insight.test.ts` checks that each
release has between 3 and 8.
