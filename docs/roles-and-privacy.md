# Roles and privacy

Kindred is a family's private record. This page says who can see and change what, how that is enforced, and what
the app does not hide, so that a steward can choose the right settings for their family.

## Roles

Each person has one role in each family they belong to. Roles are cumulative: each one includes the ones above it.

| Role | Can do |
| --- | --- |
| **Viewer** | Browse the tree, the Atlas, the Almanac, the Chronicle, the gallery, the houses and the research, and read everyone's public details. |
| **Contributor** | Viewer, plus add memories, sayings, recipes and photos, and add research projects, documents, notes and links, and change their own. |
| **Editor** | Contributor, plus add and edit people, parent and partner links, places and contacts, and remove people. Editors can also export the family, change or remove anyone's research, and mark research private. |
| **Steward** | Editor, plus edit houses and their arms, delete albums, manage AI settings and who has access (invite, change roles, remove), and import a GEDCOM file. |

The source of truth is `src/lib/roles.ts`. Each action has the lowest role that may do it, and the same table decides
both what the browser shows and what the server allows.

| Action | Lowest role |
| --- | --- |
| View | Viewer |
| Add a memory, saying, recipe or photo | Contributor |
| Add research (a project, a document, a note, a link), and change your own | Contributor |
| Change or remove anyone's research; mark research private | Editor |
| Edit or add a person, a link, a place or a contact; remove a person | Editor |
| Export the family (GEDCOM or Markdown) | Editor |
| Edit a house and its arms | Steward |
| Manage access | Steward |
| Import a GEDCOM file | Steward |
| See the family's usage statistics, and turn them off | Steward |

Hiding a button is never the only protection. Every server function and server route calls `requireMember` or
`requireCan` before it reads or writes, and answers 401 when signed out and 403 when the role is too low.

### How people get a role

- **The first account** is steward of every family that exists at setup.
- **An invitation** names the family, the role and, optionally, an email address, and it expires. The invited person
  makes a passkey and joins with that role. An invitation can be revoked before it is used.
- **Access** (the family's Access page) shows the members and their roles. Stewards can change a role or remove a
  member. A family always keeps at least one steward: the last one cannot be removed or demoted.
- **"Who you are"** is a separate choice: the person in the tree a member stands for, which makes kinship labels such
  as "your aunt" work. It takes effect at once. A member may also paint their own portrait through it, but only after a
  steward confirms the link on the Access page (declining unlinks them, and changing the link asks again). Editors and
  stewards can paint anyway, so their own links need no confirmation.

## Guests (a family share link)

A steward can share the family with relatives who don't want an account: on the Access page, **Share with a link** makes one
URL for the family and, by default, a password. The steward can copy the link, the password, or a short ready message holding both,
and paste it into a chat or an email. A guest is not a member and is not an account: they don't appear in the members list,
and they have no name, no "who you are" and no settings.

A guest sees what a viewer sees, which includes the public contact details: **nothing private, no editing, no AI, no money
spent, no export, no Access or settings pages.** The server enforces this: a guest can only reach the reads named in
`requireReader` (`src/lib/auth/guard.server.ts`), and those return exactly what a viewer gets, so private fields and private
research are held back by the same rule. Every other server function refuses a guest, because the checks it uses need an
account. A guest's pictures go through the same checks, and they need the guest's visit too.

- **The link.** The token is 256 random bits and only its hash is stored. Without a password, the URL alone opens the
  family, so a password is the default and a steward has to choose otherwise. There is one link per family. Before the
  password, a page says only that a family tree was shared; it does not name the family.
- **The password.** Kindred makes it: twelve letters and digits that can't be misread. Only a PBKDF2 hash is stored. The server
  can never show it again, so the browser that made the link keeps a copy to paste later; to share from another browser, make a new link.
- **The limit on guessing.** Each try is counted before the password is hashed: 8 per link and address, and 40 per link across all
  addresses, every 15 minutes. The count is in the database, so it holds across Workers and across restarts.
- **The visit.** A guest's cookie lasts 12 hours and never outlives the link; then the password is asked for again.
  Replacing or turning off the link ends every visit at once, and so does the link's own expiry.
- **Revoke or replace at any time.** Turning a link off ends it. Replacing it makes a new URL and password; the old ones stop
  working. The expiry can be 1 day, a week, 30 or 90 days, or none.

Before you share a link, decide what a viewer should read, as above: anyone who has the link and the password can read
everything that isn't private, for as long as the link works, and can pass it on.

## What is private

Kindred separates three things, and they behave differently.

**Private fields.** A person's field (a phone number, an address, a diagnosis, a dietary note, anything the family adds
as a field) can be marked private. Private fields are returned by the server only to editors and stewards. Viewers and
contributors never receive them, and that includes the AI assistant's reads, which use the same rule.

**Private research.** A research project, a document, a note, or a link from a project to a person can be marked private. It follows the private-field rule: only editors and stewards ever receive it, and for anyone else it is not there at all: no entry in a list, no count, no timeline event, and the file answers "not found". Only editors can mark something private. Kindred has no private person (see below), so a person whose connection to a piece of research is sensitive is kept private by the link, not by hiding them from the family.

**Everything else is visible to every member.** That includes names, dates, places, biographies, memories and
sayings, and the public contact fields. Contributors can add to these, and viewers can read them.

**The living flag does not hide anyone.** Kindred does not hide living people from viewers. A person marked as living
still appears with their name and details to every member. The flag affects what the app does: it drives the birthday
list on the home page and in the Almanac, the research prompts in *Needed*, and the age-based gaps (a living adult with
no contact, for example). If a living person's details must be hidden, make them private fields, or leave the person
out of the family.

So before you invite relatives, decide what a viewer should read. The safest place for a detail is a private field,
then an editor's own notes; a family that wants nothing hidden from members needs no changes.

## What an export contains

An export is a copy of everything the family holds that its format can carry, and an editor or steward can make one.
It holds everyone's names, dates, places, links and biographies, so treat an export as private as the family. It
leaves out stories, contact details and other person fields (private or not), houses and arms, and the pictures
themselves. The Markdown archive carries research that isn't private, with its documents, and leaves private research out. Viewers and contributors can read the same people in the app, but they cannot take a copy away. Each download lists what it leaves out, before you download it. See [exchange.md](exchange.md).

## Sign-in and sessions

- Accounts use passkeys. Kindred stores no passwords.
- A session is a random token in an HttpOnly cookie (SameSite=Lax, and `Secure` on HTTPS). The server keeps only a
  SHA-256 hash of the token, so a copy of the database does not contain a working session.
- Sign-in endpoints are rate-limited. The limit is kept in memory: it resets when the server restarts, and on
  Cloudflare each isolate keeps its own count. It is a brake against guessing, not a wall.
- Behind Cloudflare Access, Kindred also accepts a verified Access identity, so the first person through Access can
  become steward when setup codes are off. See [deploy-cloudflare.md](deploy-cloudflare.md).

## Your data

You are the operator of your own family's data. On Node it sits in `data/` on your machine, and on Cloudflare it sits
in your D1 and R2 resources in your account. Kindred does not send a family's records to any service of its own. The
only outside calls are the ones you turn on: the AI assistant and image features, which send what [ai.md](ai.md)
describes to the provider you choose; the nightly archive, which commits the family's archive to the private GitHub
repository you name; and reminders, which send a notification to each device's browser push service. The place search
runs offline once the gazetteer is built.

**Usage statistics** stay in the same place and go nowhere else: no third-party service is involved. See [Usage statistics](#usage-statistics).

To leave, export the family, or copy the database. Deleting a family means deleting its database and its media.

## Usage statistics

A steward can see how the family uses Kindred on the family's Statistics page, and can turn collection off there. It is on until a steward turns it off.

**What is counted, per family and per day:** page views by section (Almanac, Atlas, "a house's page"), visits, how many members were active, and the use of a few features (asked the assistant, designed arms, added research, finished or skipped the tour). A guest from a share link counts as one anonymous visit, and nothing else about them is kept. The changes on the page (people, photos, stories, research) and the number of feedback reports are read from what the family already holds, so they add no new data. A person counts on the day they were last edited.

**What is never stored:** names, anything anyone wrote, which person, house or project was opened, search terms, or IP addresses. The browser turns an address into its section before reporting it, and the server keeps only section and feature names from a fixed list.

**The one thing tied to a member** is a marker saying which day they were last seen, plus a note that they have been counted for the tour, so "active in the last 30 days" and "finished the tour" count each member once. Each is stored under a one-way pseudonym that differs per family, never the account id. The page shows only totals, never who. Markers are deleted 100 days after a member was last seen.

**How long:** the browser sends a small report about every 30 seconds and when the page is left. There is no log of individual events, only daily counters, which are deleted after three years.

**Off and opt-out:** turning collection off stops all counting and deletes the markers at once; the anonymous daily totals stay. A browser set to Do Not Track or Global Privacy Control is not counted at all.

## The AI assistant and privacy

The assistant reads only what the reader's role may see, and it proposes changes that the reader approves. A proposal
runs under the reader's own role, so an approval cannot give a contributor an editor's power. The details of what is
sent, and how the key is stored, are in [ai.md](ai.md).

What the assistant may propose depends on the reader's role, and the server checks again on approval:

| Role | Offered to propose |
| --- | --- |
| **Viewer** | Nothing. Questions only: who someone is, what is recorded, what is missing, which photos have no date. |
| **Contributor** | Viewer, plus memories and stories, and for photos: a date, place and caption, an album (new or existing), and people tagged in a photo. |
| **Editor** | Contributor, plus people (one at a time or a whole family draft from a conversation), links, dates and places, occupations, details and contacts, and a drawn avatar when that feature is on. |
| **Steward** | Editor, plus a house's succession law, head, heir and country. |

Nobody is offered a delete, a change to who has access or invitations, or a change to the AI settings or keys. Pictures
are looked at by the assistant only when the family's faces feature is on, and a family session is drafted only after its
speaker finishes it. A family draft shows its likely duplicates and its loops before anything is added.
