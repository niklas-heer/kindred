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
  makes a passkey (or, on a Cloudflare Access installation, signs in there) and joins with that role. An invitation can be revoked before it is used.
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

A guest sees less than a viewer: the tree, the people's names, dates, biographies and stories (of living people only what
"Protect living people" below leaves, when the link has it on), and the research that isn't private, but
**no person's fields at any level (no contacts, no favourites, no notes), no Contacts page, no editing, no AI, no money
spent, no export, no Access or settings pages.** A link can be passed on, so "Family" means the members with an account, not
everyone holding the link. One number does reach a guest: the Needed page can say that someone has no contact recorded (never
a living person, when the link protects them). The
server enforces this: a guest can only reach the reads named in
`requireReader` (`src/lib/auth/guard.server.ts`), and the person read and Contacts give a guest no fields (`src/lib/visibility.ts`). Every other server function refuses a guest, because the checks it uses need an
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
- **Protect living people.** On by default for every new link, and switchable on the Access page at any time without replacing
  the link; links made before the setting existed have it off until a steward turns it on, so nothing changed under their guests.
  When it is on, a guest gets each person the family marks as living by **name** (with title, epithet and nickname), **sex,
  house and place in the tree** (parents, children, partners and the kind of each tie), and **face** (photo, painted portrait and
  drawn look, without an age pinned in it). They get **no date of any kind**, not even a birth year, since a year and a name
  already identify a child and an age follows from it; so no age either, and where the dates would be the page shows nothing.
  They also get no birthplace or other place, no occupation, traits or biography, no fields (no guest ever does), no stories
  about them in the Chronicle or on their page, in any language, no research project that names them (its notes, documents
  and files included), no birthday or wedding anniversary on the families list or in the Almanac, no Atlas pin or place that
  only their records name, no partnership date or place for a couple with a living partner, and no story or contact counts.
  Gallery pictures still show if a guest can open the gallery, but no living person is tagged on them, and a living person's
  own photo list is empty. The `living` flag decides as stored: someone marked not living is shown in full, with or without a
  date of death, and the dead are untouched. The server applies this where it shapes a guest's reads
  (`src/lib/protect-living.ts`; the guard hands every read the link's setting), so no response to such a guest carries any of
  it, the page the server renders included. What the family wrote in free text about someone else (a story about a
  grandmother that names her grandchild's birthday, a caption on a picture) is not rewritten.

Before you share a link, decide what it should show: anyone who has the link and the password can read the names, the dates
of the dead (and of the living, if the link does not protect them), biographies and stories, for as long as the link works,
and can pass it on.

## What is private

Kindred separates three things, and they behave differently.

**A person's fields and notes have three levels**, shown by a small symbol on each one and chosen when it is added or edited:

| Level | Who sees it |
| --- | --- |
| **Personal** (a lock) | Only the account that added it. Not an editor, not a steward, not the assistant. |
| **Editors** (a pen) | Editors and stewards. This is what "private" used to mean, and addresses, medical notes and allergies start here. |
| **Family** (two people) | Every member of the family, including viewers and contributors. Not a guest with a share link. |

Only the account that created a field can make it Personal, or make it Personal again after sharing it. Nobody can take over a field someone else created, because it would vanish for everyone else and be deleted when that member is removed. Fields from before authors were recorded (migration 0022) can't be made Personal.

The rule is one file, `src/lib/visibility.ts`, and the server applies it on every read. Fields that were private before became
Editors; the others became Family.

Nothing a reader can see moves when a field they cannot see changes. The Edit tab's check that a person has not changed
since the draft was opened compares only what that reader sees, a field's position is its place among their fields, and
the limit on fields (200 per person) counts only theirs, so none of these tells them a hidden field was added, changed or
removed, or how many there are. A guest gets no such version at all.

Each reader sees everything their level allows wherever a field appears, with its symbol: the person's page and its Everyday tab, the Overview's call and write buttons, and Contacts. The assistant answers an editor or a steward from Editors fields too.

A personal item shows only to its author, in those same places. It stays out of everything that is shared or passed on: suggestions, the assistant and everything sent to an AI provider (even for its own author), the
web lookup guard, GEDCOM and Markdown exports with their counts, the nightly archive, and vCards (a vCard holds Family fields only, whoever downloads it). Its author always finds it on the person's page, whatever their role is now. Someone who loses the right to edit keeps
seeing their personal items and may remove them, but cannot change them until they can edit again.

**When a member is removed, their personal items are deleted**, and the Access page says so before you confirm. Nobody else could ever read or remove them, so keeping them would leave
data in the family that no one can reach. Their assistant chats in that family, with any pictures kept in them, are deleted at the same time, so inviting them back does not bring those back. Removing a person from the tree removes all their fields, personal ones included.

Personal does not mean encrypted. Whoever runs the server can read it in a copy of the database: **a database backup contains personal items**. The move to
Cloudflare with `scripts/import-to-d1.ts` leaves them behind, because accounts are not copied and the target would have no one to show them to.

**Private research.** A research project, a document, a note, or a link from a project to a person can be marked private. It follows the Editors level above: only editors and stewards ever receive it, and for anyone else it is not there at all: no entry in a list, no count, no timeline event, and the file answers "not found". Only editors can mark something private. Kindred has no private person (see below), so a person whose connection to a piece of research is sensitive is kept private by the link, not by hiding them from the family.

**Everything else is visible to every member.** That includes names, dates, places, biographies, memories and
sayings, and the public contact fields. Contributors can add to these, and viewers can read them.

**The living flag does not hide anyone.** Kindred does not hide living people from viewers. A person marked as living
still appears with their name and details to every member. The flag affects what the app does: it drives the birthday
list on the home page and in the Almanac, the research prompts in *Needed*, and the age-based gaps (a living adult with
no contact, for example). If a living person's details must be hidden, keep them at the Editors or Personal level, or leave the person
out of the family.

So before you invite relatives, decide what a viewer should read. The safest place for a detail is the Personal level,
then the Editors level; a family that wants nothing hidden from members needs no changes.

**Pictures lose what the camera wrote about them.** A photo, a profile picture or a picture added to research is
stored without its EXIF, GPS position, XMP and IPTC details. The browser drops them when it scales the picture, and the
server drops them again for an upload that did not come through the browser (JPEG, PNG and WebP; a JPEG keeps only which
way up it was taken). A picture too damaged to clean is refused. The date a camera wrote is read in the browser before
that, and offered as the photo's date. PDFs are stored as they are, so their author and title fields stay: print a PDF to
a new one first if they say more than the family should read.

## What an export contains

An export is a copy of everything the family holds that its format can carry, and an editor or steward can make one.
It holds everyone's names, dates, places, links and biographies, so treat an export as private as the family. It
leaves out stories, contact details and other person fields (at every level), houses and arms, and the pictures
themselves. The Markdown archive carries research that isn't private, with its documents, and leaves private research out. Viewers and contributors can read the same people in the app, but they cannot take a copy away. Each download lists what it leaves out, before you download it. See [exchange.md](exchange.md).

## Sign-in and sessions

- Each installation has one sign-in method, chosen when it is deployed: Kindred's passkeys, or Cloudflare Access. Kindred stores no
  passwords either way. See [Choosing how people sign in](self-host.md#choosing-how-people-sign-in).
- A session is a random token in an HttpOnly cookie (SameSite=Lax, and `Secure` on HTTPS). The server keeps only a
  SHA-256 hash of the token, so a copy of the database does not contain a working session.
- A session remembers which passkey started it. Removing a passkey ("Your name & passkeys" in the account menu) signs out
  every browser that signed in with it, so a lost phone loses its access with its passkey. The same dialog has "Sign out
  everywhere else", which ends every session of yours except the one you are using. Sessions started before Kindred
  recorded this (accounts migration 0022) name no passkey; only "Sign out everywhere else" or their expiry ends those.
- Pages and data are sent with `Cache-Control: private, no-store`, so after signing out on a shared computer the family's
  pages are not left in the browser's cache, and no shared cache keeps one member's page for another. Pages also carry an
  enforced Content-Security-Policy (see [self-host.md](self-host.md#security-headers-and-caching)).
- Sign-in endpoints are rate-limited. The limit is kept in memory: it resets when the server restarts, and on
  Cloudflare each isolate keeps its own count. It is a brake against guessing, not a wall.
- With Cloudflare Access as the method, Kindred accepts only a verified Access identity, so the first person through Access can
  become steward when setup codes are off. With passkeys as the method, Access tokens are ignored. See
  [deploy-cloudflare.md](deploy-cloudflare.md).

## Your data

You are the operator of your own family's data. On Node it sits in `data/` on your machine, and on Cloudflare it sits
in your D1 and R2 resources in your account. Kindred does not send a family's records to any service of its own. The
only outside calls are the ones you turn on: the AI assistant and image features, which send what [ai.md](ai.md)
describes to the provider you choose; the nightly archive, which commits the family's archive to the private GitHub
repository you name; and reminders, which send a notification to each device's browser push service. The place search
runs offline once the gazetteer is built.

**Usage statistics** stay in the same place and go nowhere else: no third-party service is involved. See [Usage statistics](#usage-statistics).

To leave, export the family, or copy the database (a copy of the database holds everyone's personal items too). Deleting a family means deleting its database and its media.

## Usage statistics

A steward can see how the family uses Kindred on the family's Statistics page, and can turn collection off there. It is on until a steward turns it off.

**What is counted, per family and per day:** page views by section (Almanac, Atlas, "a house's page"), visits, how many members were active, and the use of a few features (asked the assistant, designed arms, added research, finished or skipped the tour). A guest from a share link counts as one anonymous visit, and nothing else about them is kept. The changes on the page (people, photos, stories, research) and the number of feedback reports are read from what the family already holds, so they add no new data. A person counts on the day they were last edited.

**Who did it, by category.** Every counter is also filed under the role the member held when it happened: steward, editor, contributor or viewer, and share-link guests as their own group. The server reads the role from the membership; a browser cannot name its own category. The Statistics page headline and its "how it's being received" reading cover **the family without stewards**, so a steward using Kindred does not make it look busier; a switch shows each group or everyone. A "Who did what" table gives each group's visits, active people, page views, changes and feature use. These are totals per group, never a list of people. A group with one member says so, because its numbers may then be that one person. Changes are told apart by who made them from the day categories began (the family's records keep no author); before that, and for counters written before categories existed, the numbers appear only under "Everyone", labelled as from before categories.

**What is never stored:** names, anything anyone wrote, which person, house or project was opened, search terms, or IP addresses. The browser turns an address into its section before reporting it, and the server keeps only section and feature names from a fixed list.

**The one thing tied to a member** is a marker saying which day they were last seen, plus a note that they have been counted for the tour, so "active in the last 30 days" and "finished the tour" count each member once. Each is stored under a one-way pseudonym that differs per family, never the account id. The marker also holds the category the member was last seen in, so "active in the last 30 days" can be split by group. The page shows only totals, never who. Markers are deleted 100 days after a member was last seen.

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
