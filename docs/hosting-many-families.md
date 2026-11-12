# Hosting many families

One Kindred server can host family trees for people who are not your family: a club, a village, friends, or a small service.
This page is for the person who runs such a server, the **operator**. A server run for one family needs none of it: everything
here is off or empty until you change it, and the server behaves as it always has.

## The operator

The operator runs the server. It is a role of the server, not of a family, and it gives **no access to any family's records**.

- The server's first account is its operator. On a server that already had accounts when it was upgraded, the earliest account
  became the operator (migration 0034).
- An operator can make another account an operator (by the email of an account that exists) and can step down. The last operator
  cannot step down.
- Being an operator does not make you a member of anything. A family's tree, people, stories, pictures, research and history are
  closed to you exactly as to any stranger, unless a steward of that family invites you. In law (the EU's GDPR) the families are
  the controllers of what they write and you are their processor; Kindred is built so that the processor cannot read it in the app.
- The full role, with what each family role can do, is in [roles-and-privacy.md](roles-and-privacy.md#the-operator).

## The operator console

**Operator console** in the account menu, at `/operator`. Only operators see the item, and the server checks the role on every
call. It has six tabs.

### Families

Every family on the server, with what you need to run it and to help its stewards, and nothing it holds:

| Shown | From |
| --- | --- |
| Name and address (`/<id>`) | The family's details, the same list every page uses |
| When it was made | The console, or its first membership for a family made before |
| Members | How many accounts belong to it |
| Stewards | Their names and emails, for support |
| Storage | What its pictures and documents take, against its cap, with a bar |
| Last visit | When a member last opened it |
| Status | In use, read-only or closed |

Actions:

- **Make a family for someone.** Its name, address and theme, and the name (and, if you like, the email) of the person who will
  be its first steward. Kindred makes the family with **no members** (you are not added) and a link that works once, for two
  weeks, and makes whoever opens it the family's steward. **Kindred sends no email**: copy the link and send it yourself. While
  nobody has joined, **New invitation link** makes another (the old one stops working), and nobody else can claim the empty
  family as theirs, by making it or by importing into it. Only the invitation you made with the family can be renewed here, and
  only while the family has no members: once someone has joined, its stewards invite people themselves, and an invitation a
  steward made (for a co-steward, say) is never renewed by an operator. See [Invitations](#invitations).
- **How it may be used**: **In use**, **Read-only** or **Closed** (each change is in the log).
  - *Read-only* (suspended): its members and its share-link guests read everything; members see a bar that says the server's
    operator suspended it and how to reach you (the contact email in Settings) to ask why or to have it deleted. Every change is
    refused, deleting included: its stewards cannot remove it while you look into something, so they ask you. Use it for an unpaid
    account, a complaint you are looking into, or a family that asked for a pause.
  - *Closed*: nobody opens it. Its members see a page that says you closed it and how to reach you instead of the family; every
    read and change is refused; its share link opens nothing and guests inside are sent out at once. Use it when even reading must
    stop (content you were told is illegal, a family that has to be taken down). Nothing is deleted. Its stewards cannot download
    its backup or export it either, so a closed family's page tells them to ask you for a copy: when you agree, make it
    *Read-only* for a while; its stewards export it (Import & export) or download the backup, then you close it again or delete it.
    A read-only family's stewards also still see the data requests you forwarded to them.
  - *In use* lets it be used again.
- **Storage cap** in MB (empty for none), and **Recount** (see [Storage caps](#storage-caps)).
- **Delete**, with the family's address typed and your passkey, as its stewards delete it. You cannot export a family you are not
  a member of, so ask its stewards to download the Markdown archive or GEDCOM first (Import & export). It cannot be undone.

On Node and Docker a new family is a new database file. On Cloudflare it needs its storage first: a Durable Object namespace or a
bound D1 database ([deploy-cloudflare.md](deploy-cloudflare.md)).

### Waiting list

When **Who may make a family** is **Anyone may ask**, the sign-in page links to `/request`: a short form with the person's name,
email, the family's name and a message. They are told "We'll be in touch at <their email>". Their request waits here, oldest first.

- **Approve…** asks for the family's name and address (filled in from the request), makes the family and the steward link for the
  person who asked, and offers **Write to <email>**, which opens your mail program with the link in it.
- **Decline** closes it. Kindred tells them nothing: write to them if you want them to know.

Both public forms are braked the same way:

- a field people never see (a bot that fills it is thanked and nothing is kept);
- [Cloudflare Turnstile](#cloudflare-turnstile), when you set it up;
- at most three sends an hour and five a day from one network, counted by a 4-character hash (never the address);
- a ceiling for the whole server: once **200** requests of a kind wait unanswered (family requests not yet approved or declined,
  data requests still *Open*), that form says it is closed for now, and opens again as you answer them. The data request form then
  shows your contact email, if you set one.

The limits are checked in the same database batch that stores the request, so they hold across every process and Worker isolate,
and two requests at once cannot both take the last place. The ceiling is what bounds a flood from many networks; Turnstile is what
keeps one out. While **Anyone may ask** is on and Turnstile is not set up, the console warns you on Settings and the Waiting list
(it does not stop you: a small private server may not want Turnstile).

Decided requests are listed newest first, 50 at a time, with **Show older**.

### Data requests

Anyone, member or not, can ask at `/privacy-request` for **access** to, **correction** or **deletion** of data about them, or
something else: their name, email, the family (its name or address, as far as they know it) and what they want. It is linked from
every legal footer and from the legal page.

- Each request shows who asked, what, about which family (when what they wrote names one here: its address, its id or its exact
  name) and **the days left** of the month GDPR gives to answer, then how many days past it.
- Move it on: **Open**, **With the stewards** or **Answered**. A request reaches a family's stewards only when you choose **With
  the stewards**: from then it shows at the top of their Access page, and they can mark it answered themselves once they have
  dealt with it. Until then only operators see it (you may want to check who is asking first), and moving it back to **Open**
  takes it from them again. One you mark **Answered** yourself never reaches them.
- Kindred sends no email here either. Answer from your own mail, or let the family's stewards answer.
- Answered requests are listed newest first, 50 at a time, with **Show older**.

### Being told about new requests

**Tell this device about new requests** (Settings, under *This device*) turns on Web Push for the browser you are using; it
needs the server's push keys (`KINDRED_VAPID_*`, as for reminders, [self-host.md](self-host.md)). A new family request or data
request then sends "A new request" to each operator device that asked, with nothing of what was asked or by whom, and at most
once in ten minutes per device, however many arrive. Signing out on the device, turning it off, or no longer being an operator
stops it. The account menu shows how many requests wait (open family requests and data requests still *Open*) beside **Operator
console**, and in the dot on your name.

### Settings

- **Who may make a family** (`family_creation`):
  - *Stewards and operators* (the default): any steward of a family here can make another, as on a server for one family.
    **Families each account may make** limits how many of the families still on the server one account (not an operator) has
    made; the Families page shows "You have made 2 of the 5 …" and refuses the next. A new install starts at 5; a server that
    already had accounts when it was upgraded (migration 0037) has no limit until you set one. Leave it empty for none.
  - *Only operators*: nobody else, and no request form.
  - *Anyone may ask*: the request form is open; only operators make families, by approving requests or directly.
- **This server**: its name (shown above the public forms), a contact email (on the legal page) and the **storage cap for new
  families** in MB. The default cap applies to families made after you set it; set existing families' caps on the Families tab.
- **Legal texts**: the Impressum, the privacy policy, the terms of use and where to report content. The privacy policy and the
  terms may each be the text itself or the web address of a page that has it; "report content" may be an email or a web address.
- **This device**: whether this browser is told about new requests (see above).

### Terms of use, accepted

While the **terms of use** are set, whoever makes a family on the Families page and whoever takes an invitation to be a family's
**steward** (with a passkey, with Cloudflare Access, or signed in already) ticks **I accept this server's terms of use**, with a
link to read them; the server refuses the step without it. Kindred records who accepted, which version (the first 16 hex
characters of the SHA-256 of the terms' text, so changing the text makes a new version), when, and for which family
(`terms_acceptance`, kept when the family is deleted). Operators are not asked, and neither are members invited as viewers,
contributors or editors: the stewards are the ones who answer for a family. A family you make for someone in the console asks
them when they take its steward invitation.

### Operators and Log

The operators, with **Make an operator** by email and **Step down**. The **Log** lists everything any operator did, newest first:
when, who, what, and which family (making, suspending, closing, capping, recounting and deleting families, new invitation links,
approving and declining requests, moving data requests on, changing settings and operators). It never holds a family's records.
The log is kept when a family is deleted.

## Legal pages

`/legal` shows the Impressum, the privacy policy, the terms and where to report content, from the settings, each with its own
anchor (`/legal#impressum`, `#privacy`, `#terms`, `#report`). A quiet footer links to the sections you filled in, under the sign-in,
setup, invitation, share-link and request pages, with "Data about you" (`/privacy-request`); the account menu has **Legal**. When
you fill in none, no link shows anywhere.

## Storage caps

Pictures, videos and documents are what a family costs to host. Every upload (profile photos, the gallery and the feed's
pictures, recipe pictures, research documents, painted portraits, the picture with a steward's feedback) is counted, per family,
in the accounts database, before the file is written:

- Within the cap, or with no cap, the file is stored and counted. Over it, the upload is refused and the member is told how much
  is used of how much, and to remove something or ask the server's operator for more room. Nothing is stored.
- Deleting a file frees its room at once.
- A family's stewards see what it uses (and its cap) on the Families page.
- **Recount** in the console rebuilds a family's count from its storage: one listing of the family's files with the sizes the
  storage reports (no file is opened, none of the family's records is read), so a file that no record names any more still
  counts, as it still costs. An upload that has reserved its room and is still being written keeps its count. The daily run
  recounts a few families a day that were never counted (on a server upgraded with files already stored) or not for a month,
  so the count does not drift.
- Lowering a cap below what a family uses deletes nothing; new uploads are refused until there is room.

## Cloudflare Turnstile

Set `KINDRED_TURNSTILE_SITE_KEY` and `KINDRED_TURNSTILE_SECRET` (both, or neither) to show Turnstile's check on `/request` and
`/privacy-request`. Make a widget in the Cloudflare dashboard (Turnstile is free) for your server's host name. The browser loads
Cloudflare's script only on those forms and only then (the page's Content-Security-Policy allows `challenges.cloudflare.com` only
while the keys are set); the server asks Cloudflare whether each form's token is good and refuses it otherwise. Settings:
[self-host.md](self-host.md#settings), [deploy-cloudflare.md](deploy-cloudflare.md).

## Invitations

An invitation link is all it takes to join: whoever opens it while it is open joins in the role it names. With Kindred's own
sign-in, the email address on an invitation is not checked. A new account made from the link gets that address if nobody has
it yet, and someone already signed in can accept the link with their own account (`acceptInvite`, `finishInvite` in
`src/lib/auth/`). Behind Cloudflare Access, an invitation for an address is accepted on its own when someone signs in there with
that address, and a link opened by any other Access identity works too. So send a link only to the person it is for, revoke one
you no longer need, and treat a renewed link like a key: that is why an operator may renew only the first-steward invitation
they made, and only while nobody has joined.

## Moving or importing families

`scripts/import-to-do.ts` brings a family into its Durable Object on Cloudflare
([deploy-cloudflare.md](deploy-cloudflare.md#moving-a-family-into-a-durable-object)). Being an operator gives no more right
there than anyone else has: a **new** family may be imported by anyone who may make families (an operator included), who
becomes its steward; a family that exists here, has members, or waits for an invited steward is never imported into; and
copying a family a D1 binding serves is for its stewards. The rows travel as data, never as SQL, into a staged object that
serves nothing until the import is complete, so an import can neither read a family's records nor change a family that is in
use.

## What the operator can and cannot see

| The operator sees | The operator does not see |
| --- | --- |
| Each family's name, address, member count, when it was made, when it was last visited, its status | The people in it, their details, their relationships |
| Its stewards' names and emails | Its other members' names and emails |
| How much storage it uses | Its pictures, documents and portraits |
| Requests for a family and data requests sent to the server | Its stories, posts, comments, recipes, research, history, chats with the assistant |
| What every operator did (the log) | Who did what inside the family |

An operator who is also a member of a family sees that family as their role there allows, like anyone else. The server's files
and databases are, of course, readable by whoever runs the machine: that is a matter of how you run it, not of the app.

## A short checklist for an operator in the EU

This is a list of what operators commonly need, not legal advice. Check what applies to you.

- **Impressum.** In Germany and Austria a service offered to others usually needs one (in Germany § 5 DDG): name, postal address,
  a fast way to reach you. Put it in the console's Impressum.
- **Privacy policy.** Say who you are, what the service stores (accounts, the families' data, uploaded files, a hash of the
  network a request came from), why, where (your server or Cloudflare), for how long, and the rights of the people concerned
  (Art. 13 GDPR). Link it in the console.
- **A data processing agreement with each family.** The families decide what goes in their trees; you process it for them
  (Art. 28 GDPR). Put it in your terms or a separate agreement.
- **Your own processors.** On Cloudflare, accept its Data Processing Addendum in the dashboard; on a hosting provider, theirs.
  Any AI provider a family connects with its own key is that family's choice and contract.
- **EU storage.** Keep the data in the EU if you promise it: a server in the EU, or on Cloudflare a jurisdiction for the data
  ([deploy-cloudflare.md](deploy-cloudflare.md)).
- **Records of processing.** Keep a short record of what you process and why (Art. 30 GDPR); the console's log helps show what
  operators did.
- **Requests from the people concerned.** Answer access, correction and deletion requests within a month (Art. 12(3)); the Data
  requests tab counts the days. Usually the family's stewards make the change; you make sure it happens.
- **Reporting content.** A hosting service in the EU needs a way for anyone to report illegal content (Digital Services Act,
  Art. 16): fill in "Report content".
- **Deleting.** When a family leaves, export it for them first (they can, from Import & export), then delete it from the console.
  Backups you keep still hold it until they age out: say so in your privacy policy.
