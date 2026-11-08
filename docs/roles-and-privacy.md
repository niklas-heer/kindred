# Roles and privacy

Kindred is a family's private record. This page says who can see and change what, how that is enforced, and what
the app does not hide, so that a steward can choose the right settings for their family.

## Roles

Each person has one role in each family they belong to. Roles are cumulative: each one includes the ones above it.

| Role | Can do |
| --- | --- |
| **Viewer** | Browse the tree, the Atlas, the Almanac, the Chronicle, the gallery and the houses, and read everyone's public details. |
| **Contributor** | Viewer, plus add memories, sayings, recipes and photos. |
| **Editor** | Contributor, plus add and edit people, parent and partner links, places and contacts, and remove people. Editors can also export the family. |
| **Steward** | Editor, plus edit houses and their arms, manage who has access (invite, change roles, remove), and import a GEDCOM file. |

The source of truth is `src/lib/roles.ts`. Each action has the lowest role that may do it, and the same table decides
both what the browser shows and what the server allows.

| Action | Lowest role |
| --- | --- |
| View | Viewer |
| Add a memory, saying, recipe or photo | Contributor |
| Edit or add a person, a link, a place or a contact; remove a person | Editor |
| Export the family (GEDCOM or Markdown) | Editor |
| Edit a house and its arms | Steward |
| Manage access | Steward |
| Import a GEDCOM file | Steward |

Hiding a button is never the only protection. Every server function and server route calls `requireMember` or
`requireCan` before it reads or writes, and answers 401 when signed out and 403 when the role is too low.

### How people get a role

- **The first account** is steward of every family that exists at setup.
- **An invitation** names the family, the role and, optionally, an email address, and it expires. The invited person
  makes a passkey and joins with that role. An invitation can be revoked before it is used.
- **Access** (the family's Access page) shows the members and their roles. Stewards can change a role or remove a
  member. A family always keeps at least one steward: the last one cannot be removed or demoted.
- **"Who you are"** is a separate choice: the person in the tree a member stands for, which makes kinship labels such
  as "your aunt" work. It does not change what the member may do.

## What is private

Kindred separates three things, and they behave differently.

**Private fields.** A person's field (a phone number, an address, a diagnosis, a dietary note, anything the family adds
as a field) can be marked private. Private fields are returned by the server only to editors and stewards. Viewers and
contributors never receive them, and that includes the AI assistant's reads, which use the same rule.

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
themselves. Viewers and contributors can read the same people in the app, but they cannot take a copy away. Each download lists what it leaves out, before you download it. See [exchange.md](exchange.md).

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

To leave, export the family, or copy the database. Deleting a family means deleting its database and its media.

## The AI assistant and privacy

The assistant reads only what the reader's role may see, and it proposes changes that the reader approves. A proposal
runs under the reader's own role, so an approval cannot give a contributor an editor's power. The details of what is
sent, and how the key is stored, are in [ai.md](ai.md).
