# Roles and privacy

Kindred is a family's private record. This page says who can see and change what, how that is enforced, and what
the app does not hide, so that a steward can choose the right settings for their family.

## Roles

Each person has one role in each family they belong to. Roles are cumulative: each one includes the ones above it.

| Role | Can do |
| --- | --- |
| **Viewer** | Browse the tree, the Atlas, the Almanac, the Chronicle, the gallery, the houses and the research, read the family's feed and everyone's public details, and react to messages, memories, photos and the events of the feed. |
| **Contributor** | Viewer, plus write messages to the family, add memories, sayings, recipes and photos, comment on messages, memories and photos, and add research projects, documents, notes and links, and change their own. |
| **Editor** | Contributor, plus add and edit people, parent and partner links, places and contacts, and remove people. Editors can also export the family, change or remove anyone's research, mark research private, and remove anyone's comment. |
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
| Add, change and remove life events, sources and citations | Editor |
| Export the family (GEDCOM or Markdown) | Editor |
| Edit a house and its arms | Steward |
| Manage access | Steward |
| Import a GEDCOM file | Steward |
| See the family's usage statistics, and turn them off | Steward |
| Read the change history and "What's new" (what their role may see) | Viewer |
| Put a person's earlier fact back from the history | Editor |
| Play the Campaign, while it is on | Viewer |
| React to a message, a memory or a gallery photo (`react`) | Viewer |
| Comment on a message, a memory or a gallery photo, and change your own comment (`comment`) | Contributor |
| Read the family's feed ([feed.md](feed.md)) | Viewer |
| Write a message to the family, and change your own (`post`); remove your own, whatever your role now | Contributor |
| Remove anyone's message (`remove-post`) | Editor |
| Remove your own comment | Any member |
| Remove anyone's comment (`remove-comment`) | Editor |
| Turn the Campaign on or off, and end its season | Steward |
| Change the family's name, tagline and theme | Steward |
| Delete the family (with its address typed and a passkey confirmation) | Steward |
| Make another family on the server | Steward of any family there, or the server's first account |
| Open Today, read the week's answers, take the daily quiz | Viewer |
| Answer the question of the week (an answer is a memory) | Contributor |
| Change or skip this week's question; switch the daily quiz off | Steward |

Hiding a button is never the only protection. Every server function and server route calls `requireMember` or
`requireCan` before it reads or writes, and answers 401 when signed out and 403 when the role is too low.

### How people get a role

- **The first account** is steward of every family that exists at setup.
- **An invitation** names the family, the role and, optionally, an email address, and it expires. The invited person
  makes a passkey (or, on a Cloudflare Access installation, signs in there) and joins with that role. An invitation can be revoked before it is used.
- **Access** (the family's Access page) shows the members and their roles. Stewards can change a role or remove a
  member. A family always keeps at least one steward: the last one cannot be removed or demoted.
- **"Who you are"** is a separate choice: the person in the tree a member stands for, which makes kinship labels such
  as "your aunt" work. It takes effect at once. A member may also paint their own portrait through it, and change their
  own drawn portrait in the character editor, but only after a steward confirms the link on the Access page (declining
  unlinks them, and changing the link asks again). Editors and stewards can do both for anyone, so their own links need no
  confirmation. Nobody else can save a drawn portrait: the editor still opens for a member, to try a look on, and says
  that it will not be kept.

## Guests (a family share link)

A steward can share the family with relatives who don't want an account: on the Access page, **Share with a link** makes one
URL for the family and, by default, a password. The steward can copy the link, the password, or a short ready message holding both,
and paste it into a chat or an email. A guest is not a member and is not an account: they don't appear in the members list,
and they have no name, no "who you are" and no settings.

A guest sees less than a viewer: the tree, the people's names, dates, biographies and stories (of living people only what
"Protect living people" below leaves, when the link has it on), and the research that isn't private, and life events (of living people none, when the link protects them), and the Cookbook's recipes with their pictures (a recipe is a story: none of a living person's, when the link protects them; see [recipes.md](recipes.md)), but
**no feed and no message of the family's (nor a message's pictures in the gallery, which are not served to a guest), no reactions or comments (not even their counts), no sources or citations, no person's fields at any level (no contacts, no favourites, no notes), no Contacts page, no editing, no AI, no money
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
- **What is kept about a guest.** The visit's cookie says which link it came from and when it ends; no account, name or address
  is stored for it. The family's statistics count it as one anonymous visit (never when the family has them off, or when the
  browser sends Do Not Track or Global Privacy Control). Only where a guest may ask to join, one more cookie, `kindred_visitor`,
  lets the server keep a few totals of how that browser used the link (see below), and a guest who sends a request adds what
  the form showed them. Nothing is kept of what a guest typed in a search or of which pages they opened one by one.
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
  and files included), no birthday or wedding anniversary on the families list or in the Almanac, no life event (on their page or the Atlas), no Atlas pin or place that
  only their records name, no partnership date or place for a couple with a living partner, and no story or contact counts.
  Gallery pictures still show if a guest can open the gallery, but no living person is tagged on them, and a picture with a
  living person in it (tagged, or only suggested) comes without its caption, date and place, in the gallery, on anyone's page
  and in research alike: a caption usually names who is in the picture and the occasion, and a date gives their age. A living
  person's own photo list is empty. The `living` flag decides as stored: someone marked not living is shown in full, with or without a
  date of death, and the dead are untouched. The server applies this where it shapes a guest's reads
  (`src/lib/protect-living.ts`; the guard hands every read the link's setting), so no response to such a guest carries any of
  it, the page the server renders included. What the family wrote in free text about someone else (a story about a
  grandmother that names her grandchild's birthday, the caption of a picture nobody living is tagged in) is not rewritten.

### Asking to join (an own account from a share link)

On an installation with Kindred's own sign-in (`KINDRED_AUTH=kindred`), a guest can ask for an account of their own. A quiet,
dismissible card on their pages (and "Ask to join" by the Guest label) says what an account gives. The guest gives a name,
picks who they are in the tree (or "I'm not in the tree yet"), may add a short message, and makes a passkey. Before sending, the
form shows exactly what the stewards will receive.

- **A pending account.** Sending makes an account with that passkey and **no membership**, and a request. The account cannot
  sign in: the sign-in refuses it until a steward has said yes, so it can reach nothing a guest could not already read. The
  guest keeps looking around as a guest and sees "Waiting for a steward". The asking browser follows its request through a
  cookie of its own (only a hash is stored). One browser sends one request.
- **The steward's card.** Stewards see a badge on the account menu and on Access, a card at the top of the Access page, and,
  on devices with reminders on, a push. The card shows the name given; who they say they are, with that person's card and how
  the steward is related to them, and a warning when a member already stands for that person; the message; an approximate
  place (city, region and country from Cloudflare's request data on Workers, never an IP address; "unknown" on Node, unless a
  trusted proxy, `KINDRED_TRUSTED_PROXIES`, sets the `CF-IPCountry` header, which then gives the country only); the browser's
  time zone and language; the device family ("iPhone, Safari"); and how the link was used (below).
- **Approve or decline.** Approving makes them a member with the role the steward chooses (Contributor by default), standing
  for the person the steward confirms, changes or clears; a named person counts as confirmed. It works even after the link
  ended or was replaced. Their passkey then signs them in, and the details of the request are cleared at once. Declining
  deletes the request, the pending account and its passkey.
- **Limits.** A request ends by itself after 30 days, and its account and passkey go with it. One guest visit (and one browser)
  sends one request. One network, an address or an IPv6 /64 such as a home, holds at most 12 open requests per link, so a family
  can ask together while one person who keeps clearing the browser stops there; the request keeps 18 bits of a hash of the
  network for this, which name no address. A link holds at most 40 open requests, so one person with two or three connections
  cannot fill it. Starting one is limited per address too (20 per link in 15 minutes, counted in the database like the password
  tries, the address hashed).
- **The switch.** "Guests may ask to join" is on by default for every link, existing ones included, and a steward can turn it
  off on the Access page; requests already sent stay.
- **The guest host** (`KINDRED_GUEST_ORIGIN`) and Cloudflare Access installations offer no request: the guest host has no sign-in.

**How the link was used.** Only where a request is possible, a guest's visit is measured per browser: a cookie made from the
guest's visit, stored only as a hash (one per visit, whatever the browser sends; at most 500 browsers per link, the one idle longest goes first), with first and last seen, the number of visits, minutes active, a counter per section, and a small tally of the
people opened (the 20 opened most; the card shows five). The browser's cookie lasts 90 days. There is no page log and no address. A browser with Do Not Track or Global Privacy Control
is not measured, and nothing is measured while the family's statistics are off. The password page and the request form say so.
These figures are shown to stewards only inside a request, as a copy taken when it was sent (which the form showed first); the
rows go when the link is replaced or turned off, and 90 days after the last visit.

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

**Life events, sources and citations** have no private level: every member reads them, and editors change them. A share-link
guest reads events (with "Protect living people", none of a living person's) but no sources and no citations, and the Sources
page tells a guest so. A source that links to a private research document shows that link only to editors and stewards.

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

## Change history and what's new

Every change to the family's records is kept in the family's database with who made it: people and their details, parent
links and partnerships, life events, sources and citations, memories, photos, albums and tags, pictures, houses, places, research
and the family's name (`src/lib/history.server.ts`). The row is written in the same batch as the change itself, so no change is
stored without it. It keeps the member's name as it was then, what kind of record, which one, and for a change the fields that
changed, before and after, cut short (400 characters a value, 4,000 a row) and never a picture or a document: a new photo, a
portrait or the arms are kept as "changed" without the picture. A bulk import is one row ("imported 300 people"). Saves of the
same record by the same person within ten minutes are one row, so an autosave does not fill the history.

Not kept: the Campaign, reactions and comments, quiz answers, assistant chats, statistics and join requests, which are not the
family's records.

**Who reads it.** The same rule as a person's fields:

| What changed | Who sees the row |
| --- | --- |
| A Personal field | Only its author, and the row holds no content: that it was added, changed or removed. Making a field Personal reads, for everyone else, as removed, again without content. |
| An Editors field, private research, or a source's link to a private document | Editors and stewards, with the values. Contributors and viewers do not see the row at all, so they do not learn the field exists. |
| Everything else | Every member: who added, changed or removed what, with the values they can read in the app anyway. |
| Anything | A share-link guest: nothing. The History page, "What's new" and the dot refuse a guest. |

**Restoring.** On a row about a person's own facts (names, dates, places, sex, title, occupation, biography), an editor can
put the earlier value back. It is an ordinary save, checked as the Edit tab checks it, and it is itself a row in the history.
A value that was cut short cannot be put back. Removing a person is unchanged; their history stays, and the removal names them.

**Since your last visit.** The accounts database remembers, per member and family, when they last opened the family and
when "What's new" or the History page last showed them the news (`family_visit`). A visit ends after two hours away. "What's
new" lists what others changed since the news was last shown to them, and stays the same throughout a visit; the first time,
it covers the last two weeks, and it never reaches back more than 90 days. It includes new comments and reactions on what
they wrote, once the family has those. The rows go when the member leaves the family or the account is deleted.

**This week in the family.** A member who has reminders on can also turn on a weekly push. The daily job sends it at most
once in seven days, only when the week brought something that member may see and did not do themselves, in the device's
language.

**How long.** Three years by default (`KINDRED_HISTORY_YEARS`; 0 keeps it for ever), deleted by the daily job. A member's
personal rows are deleted when they leave the family. The history is not in GEDCOM, the Markdown archive or the D1 transfer.
Whoever runs the server can read it in a copy of the database, as everything else.

## Printing

The Print page makes an ancestor chart, a descendant chart or a family book, and the browser prints it or saves it as a
PDF. It is for members: a share-link guest is told so, and the read the book makes (`getPrintPeople`,
`src/lib/print.server.ts`) refuses a guest. Any member may print what their role lets them read in the app; contact details
and other person fields are never printed.

Paper leaves the family's hands, so the default is cautious. Unless the reader switches **Living people in full** on, someone
the family marks as living is printed by name, sex, house and place in the family only: no dates, places, occupation,
biography, memories, events, sources or photos, a drawn face instead of their photo, no date or place for a partnership
with a living partner, and no gallery picture that a living person is in, on anyone's page. The server does not send what
is withheld. The cover of the book and the foot of each chart say which it was ("Living people are shown by name only" or
"in full"), with the date of printing. This is the reader's choice, not a permission: a member can read the living in the
app, as "The living flag does not hide anyone" above says.

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
- Adding a passkey, removing one and "Sign out everywhere else" ask for a passkey again: one of your own, with your face,
  fingerprint or PIN, on this same browser session, in the last five minutes (a sign-in that asked for it counts). So someone
  at a borrowed, unlocked browser can't add a passkey of their own to your account, remove yours or sign your other devices out. The confirmation belongs
  to the session: another browser's doesn't count, and signing out ends it (`src/lib/auth/proof.server.ts`).
- Pages and data are sent with `Cache-Control: private, no-store`, so after signing out on a shared computer the family's
  pages are not left in the browser's cache, and no shared cache keeps one member's page for another. Pages also carry an
  enforced Content-Security-Policy (see [self-host.md](self-host.md#security-headers-and-caching)).
- An account made by asking to join through a share link cannot sign in until a steward approves it (see
  [Asking to join](#asking-to-join-an-own-account-from-a-share-link)).
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

To leave, export the family, or copy the database (a copy of the database holds everyone's personal items too). A steward can
delete a family on the Families page ([self-host.md](self-host.md#more-than-one-family)): its database, every picture and document,
and every row of the accounts database that names it (memberships, invitations, the share link and its guests' visits, AI settings,
chats and spending, statistics, reminder subscriptions, join requests with the pending accounts of those who asked, and feedback).
The members' accounts stay for their other families. Backups you made are yours to delete.

## View as

A steward can check what someone else gets without borrowing their phone: "View as…" in the account menu, "View as" on a member's
row and on the share link on the Access page, or the role buttons there. They can view the family as a **role** (a viewer,
contributor or editor who is not linked to anyone in the tree), as a **member** (that member's role and the person they are in the
tree, so "you", kinship words and birthdays follow them) or as a **guest** of the family's share link, with that link's "Protect
living people" and "Guests may ask to join" as they are now (a plain guest with living people protected when the family has no open
link). A bar on every page says whom they view the family as, the role, that nothing is saved, and offers Switch and Stop.

What the server holds to:

- **Only a steward of that family starts one**, checked against their own membership, never the previewed one. A guest, someone who
  is not a steward, and a demo are refused. Starting and stopping need no fresh passkey proof. The preview belongs to the steward's
  account and, under Kindred's own sign-in, to the session that started it; it survives a reload, and ends on Stop, on sign-out,
  after an hour unused, a day after it started, and as soon as the member leaves, the link is turned off or the steward is no
  longer a steward.
- **Less, never more.** Every check for that family answers as it would for the previewed reader, reads included: what a viewer
  may not ask for is refused to the previewing steward too. A guest's preview gets a guest's reads only, with the link's
  protection of living people, and nothing only members may ask for.
- **Read-only.** While a preview is on, that session changes nothing anywhere, whatever the previewed role would allow: no edits,
  comments, reactions, uploads, Campaign orders, quiz answers, assistant conversations, Access changes or account changes (only the
  steward's own language can still be changed). The
  store, `once`, the media store and the AI adapters refuse it in one place, for that session only; the refusal says "You are
  viewing as …. Stop the preview to change something." The buttons still show as that reader would see them. Stop always works.
- **No trace.** A preview leaves nothing a reader's visit would: no visit or "what's new" mark, no quiz draw or answer, no usage
  statistics, no share-link visit, no last-seen for the member, no history.
- **The role and the person, not the account.** The steward never becomes the member. Passkeys, sessions, reminder devices, the
  account page, the Families page and sign-in stay the steward's own. What belongs to a member alone (their quiz answers and
  streak, their reactions, their unread news, their assistant chats, their personal notes) is never shown: a preview sees what a
  new reader with that role and person would see. "Who are you?", the tour and reminders are left out of a preview.

## A public demo

With `KINDRED_DEMO=1` ([self-host.md](self-host.md#a-public-demo)) a server shows its families to anyone, without signing in, as a
viewer. It is meant for the invented families only. Nothing is stored about a visitor: there is no account, no session cookie, no usage
statistics and no share-link measuring, and every change is refused on the server. Choosing who you are in
the tree is kept in the visitor's own browser only. The rules for viewers apply to what is shown, so private fields and private
research stay hidden as for any viewer.

## Usage statistics

A steward can see how the family uses Kindred on the family's Statistics page, and can turn collection off there. It is on until a steward turns it off.

**What is counted, per family and per day:** page views by section (Almanac, Atlas, "a house's page"), visits, how many members were active, and the use of a few features (asked the assistant, designed arms, added research, finished or skipped the tour). A guest from a share link counts as one anonymous visit here. Separately, where guests may ask to join, each guest browser's use of the link is kept as a few totals for the stewards to see in a request ([Asking to join](#asking-to-join-an-own-account-from-a-share-link)); this page never shows them. The changes on the page (people, photos, stories, research) and the number of feedback reports are read from what the family already holds, so they add no new data. A person counts on the day they were last edited.

**Who did it, by category.** Every counter is also filed under the role the member held when it happened: steward, editor, contributor or viewer, and share-link guests as their own group. The server reads the role from the membership; a browser cannot name its own category. The Statistics page headline and its "how it's being received" reading cover **the family without stewards**, so a steward using Kindred does not make it look busier; a switch shows each group or everyone. A "Who did what" table gives each group's visits, active people, page views, changes and feature use. These are totals per group, never a list of people. A group with one member says so, because its numbers may then be that one person. Changes are told apart by who made them from the day categories began (the statistics do not read the change history); before that, and for counters written before categories existed, the numbers appear only under "Everyone", labelled as from before categories.

**What is never stored:** names, anything anyone wrote, which person, house or project was opened, search terms, or IP addresses. The browser turns an address into its section before reporting it, and the server keeps only section and feature names from a fixed list.

**The one thing tied to a member** is a marker saying which day they were last seen, plus a note that they have been counted for the tour, so "active in the last 30 days" and "finished the tour" count each member once. Each is stored under a one-way pseudonym that differs per family, never the account id. The marker also holds the category the member was last seen in, so "active in the last 30 days" can be split by group. The page shows only totals, never who. Markers are deleted 100 days after a member was last seen.

**How long:** the browser sends a small report about every 30 seconds and when the page is left. There is no log of individual events, only daily counters, which are deleted after three years.

**Off and opt-out:** turning collection off stops all counting, including the measuring of a guest's use of a share link, and deletes the markers at once; the anonymous daily totals stay. A browser set to Do Not Track or Global Privacy Control is not counted at all.

## Today

Today holds the question of the week and the daily quiz ([today.md](today.md)).

- **Guests:** a share-link guest gets nothing of it. Every call needs a membership, the quiz's picture too; the page sends
  a guest back to the tree, and the section is not in a guest's navigation or command palette.
- **The quiz reads what a Viewer may read**, and nothing more: it is drawn from the graph every member gets, so a field
  kept to editors can never be a question or a wrong answer. It never asks how somebody died. The living can be asked
  about (their parents, their birthplace, their photo when the family shows one), as every member can read those.
- **The answer is the server's** until a member has answered; then it cannot be changed.
- **What is stored about a member:** one row per day they answered (their account id, their choice, whether it was right,
  and their house), for the streak and the month's table of houses. Removing the family removes it. An answer to the
  question of the week is a memory signed with the writer's name, like any other.
- **The feed's updates** ([feed.md](feed.md)) come from the change history and follow its levels: a change to something
  only editors read (an address, at first) is in an editor's feed alone, a Personal field is in nobody's, and an update
  names what changed (a new phone number), never the value. A guest has no feed.

## The Campaign

The Campaign is a game between the family's houses ([campaign.md](campaign.md)). It is off until a steward turns it on
under Games.

- **Who can play:** every member, viewers too. A member acts only for the house they fight for: the house of the person
  they stand for, or one they chose for the season when they stand for nobody in a house. The server decides that from
  the membership, never from what a browser sends, and it rolls the dice.
- **Guests:** a share-link guest gets nothing of it. Every call needs a membership, the page sends a guest back to the
  tree, and the section is not in a guest's navigation.
- **What it reads:** the houses and their arms, the places and their coordinates, and counts per house of people with a
  portrait, with dates, with a birthplace and with memories (and life events and sources where the app records them).
  Counts only: no name, date or text of a person enters the game. Place names appear on the map, which only members see.
- **What it writes:** only its own five tables. It never changes a person, a house, a place or anything else the
  family recorded.
- **What it keeps about a member:** the account id with their orders, the house they chose, and the orders they gave,
  with the name they had and an optional battle cry of up to 80 characters, which every member can read in the
  chronicle. The chronicle of the last two seasons is kept; older seasons keep only which house won.
- **Exports and copies:** GEDCOM and the Markdown archive carry none of it, and the D1 transfer leaves its tables out.
- **Push:** a member who has reminders on gets at most one message a day, when a province of their house falls. It says
  the province and the house that took it, nothing else.

## The AI assistant and privacy

The assistant reads only what the reader's role may see, and it proposes changes that the reader approves. A proposal
runs under the reader's own role, so an approval cannot give a contributor an editor's power. The details of what is
sent, and how the key is stored, are in [ai.md](ai.md).

What the assistant may propose depends on the reader's role, and the server checks again on approval:

| Role | Offered to propose |
| --- | --- |
| **Viewer** | Nothing. Questions only: who someone is, what is recorded, what is missing, which photos have no date. |
| **Contributor** | Viewer, plus memories and stories, and for photos: a date, place and caption, an album (new or existing), and people tagged in a photo. |
| **Editor** | Contributor, plus people (one at a time or a whole family draft from a conversation), links, dates and places, occupations, details and contacts, life events, sources and citations, and a drawn avatar when that feature is on. |
| **Steward** | Editor, plus a house's succession law, head, heir and country. |

A removal is a card like any other, proposed only when the reader asks for it, under the same role as by hand. Nobody is
offered a change to who has access or invitations, or a change to the AI settings or keys. Pictures
are looked at by the assistant only when the family's faces feature is on, and a family session is drafted only after its
speaker finishes it. A family draft shows its likely duplicates and its loops before anything is added.
