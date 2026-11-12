# Data protection (GDPR)

What Kindred does for the people whose data it holds, and what whoever runs a Kindred server still has to do themselves. It
describes the software, written in good faith; **it is not legal advice**. Check what applies to you, in your country, with
someone qualified.

## Who is responsible for what

A family tree is personal data about a family: names, dates, places, relationships, pictures, stories, and sometimes special
categories of data (Art. 9 GDPR) such as health ("medical", "allergies" fields) or religion ("religion" field, faiths). Who is
responsible depends on who runs the server.

- **A family keeping its own tree** on its own server, for the family, is very likely within the **household exemption**
  (Art. 2(2)(c)): GDPR does not apply to "purely personal or household activity". Publishing the tree to the world, or running it
  for strangers, leaves that exemption. Kindred never publishes a tree: a share link is private, and protects the living by
  default ([roles-and-privacy.md](roles-and-privacy.md)).
- **The operator** of a server that hosts families who are not theirs ([hosting-many-families.md](hosting-many-families.md)) is
  never within it:
  - **Processor** (Art. 28) for each family's records: they keep them on the family's instructions. A **processing agreement**
    with each family is needed: Settings → *Processing agreement*; a template is in
    [processing-agreement.md](processing-agreement.md) and at `/processing-agreement`.
  - **Controller** for their own processing: accounts and sign-in, sessions, logs, usage statistics, the public request forms,
    sign-up data, the audit log, the breach register.
- **A family's stewards** decide what the family records. Where the household exemption does not hold (a large family association,
  a tree run as a society's project), the family is the controller of its records and answers its relatives' requests; Kindred
  gives the stewards the tools for that (below).

## What Kindred does for each right

| Right | For a member (has an account) | For someone in a tree who is not a member |
| --- | --- | --- |
| **Information** (Art. 13, 14) | The operator's privacy policy and terms on `/legal`, with the subprocessors this server uses, generated from its configuration. | The family tells its relatives; Kindred keeps no contact details for notices (Art. 14 notices are a later round). |
| **Access** (Art. 15) | Account menu → *Your data* → *Download (JSON)*: their account, sign-ins (without secrets), memberships, settings, their messages to the assistant, and what they wrote or did in each family. Nothing about other people beyond what they wrote themselves. | `/privacy-request` reaches the operator, who forwards it to the stewards. Access → *A request about someone*: find the person, see where they appear, *Download a copy for them* (their record, the rows that point at them, the names of the people their links point to; no member's personal notes). |
| **Rectification** (Art. 16) | They change their own name; the family corrects its records. | The stewards correct the record. While a correction is checked, *Restrict* holds it. |
| **Erasure** (Art. 17) | *Delete my account* (see below). | *Erase…* (see below). |
| **Restriction** (Art. 18) | – | *Restrict*: the person is kept, and changes to them are refused until a steward lifts it. Recorded with the request. |
| **Portability** (Art. 20) | The account export is JSON. A family's records go with the family's own export (GEDCOM, Markdown, backup). | The copy is JSON. |
| **Objection** (Art. 21) | Turn features off: statistics, presence, pushes, the assistant. | As erasure or restriction. |
| **Automated decisions** (Art. 22) | Kindred makes none with legal or similar effect. AI features only suggest; a person decides. | – |

### Deadlines

GDPR gives **one month** to answer (Art. 12(3)), counted in calendar months (a request of 31 January is due on 28 or 29 February)
and extendable **once by two more months** when a request is complex or many arrive, provided the requester is told why within
the first month. The console's Data requests tab and the stewards' Access page show the days left and the due date; *Extend by two
months* records the notice and its reason (Kindred sends no email: the operator writes, then records it).

### Deleting an account

*Delete my account* (or the retention job, below) removes the account everywhere, from the databases' own schemas, so tables added
by later features are covered without a list:

- **Goes**: the account, its passkeys, passwords and second factors, every session (so every device is signed out), memberships,
  push devices, presence, visits, view-as previews, join requests, feedback it sent, its conversations with the assistant, and in
  each family its reactions, quiz answers, game state, push opt-ins, its personal notes and their history, and its retry keys.
- **Stays, without the account**: stories, posts, comments, pictures and changes it made in a family stay with the family, shown as
  by **"A former member"**. The account id in them is replaced by a random pseudonym, one per deletion. The family keeps its
  records (it is their controller, or within the household exemption); a member who wants their writing gone deletes it before
  deleting the account, or asks the stewards. Names that older features copied as plain text (who uploaded a picture) are replaced
  where no other member of that family has the same name.
- **Kept by the operator**: the audit log of what operators did, and the record of who accepted the terms and the processing
  agreement (proof the operator may need; removed three years after the account is gone).
- **Refused** while the account is the last steward of a family (make someone else a steward, or delete the family) or the
  server's last operator. Under Kindred's own sign-in it needs the passkey once more.

### Erasing a person who is not a member

Access → *A request about someone* → *Erase…*, with the person's name typed and the steward's passkey once more:

- The person and everything that hangs on them: links, fields, life events, stories about them, contacts, photo and painted
  portraits (and their files), tags, citations, research links, tags on posts.
- Every gallery picture in which they are the only person tagged, with its file, thumbnail, reactions and comments. A picture
  with other people keeps them; only the tag goes.
- Every history row about them. In everything else the family keeps as text (other people's fields, stories, posts, comments,
  research notes, captions, the quiz, the Campaign's log, the remaining history, retry keys), their **full names** (given and
  surname as born and as now) and their id are replaced by `[—]`. A first name on its own is left: it cannot be told apart from
  anyone else's. The report before erasing lists every place they appear and the names it will replace, so a steward can read what
  is left.
- In the accounts database: every conversation with the assistant in that family that names them (the whole conversation, as an
  answer can describe someone without naming them), the guest statistics' count of visits to their page, a join request that
  claimed to be them, the background tasks' give-up list, live presence, and the same replacement in the family's feedback and
  join messages.
- Nothing of it is written down again: the erasure leaves no history row, and the steward's record keeps only counts.
- **Push payload caches**: Kindred has none. A push's text is written when it is sent and not stored; the service worker caches
  nothing. Pushes already shown stay on the members' devices.
- A member's own person is not erased this way: the member deletes their account, or a steward removes them first.

## Retention

A daily job (`retention`) counts what the server no longer needs. It **only reports** until the operator switches deletion on
(Privacy tab), so the first runs show what would go:

| What | When it goes |
| --- | --- |
| An account with no family (no membership), not an operator, unseen | 24 months after its last visit |
| An invitation never used | 90 days after it expired or was withdrawn |
| A declined request for a family | 90 days after the decision |
| An answered data request | 3 years after the answer |
| A record of terms accepted, by an account that is gone | 3 years after it was accepted |

Kept by other jobs: the change history (3 years, `KINDRED_HISTORY_YEARS`), join requests (30 days unanswered) and guest
statistics (90 days after the last visit), usage statistics (3 years). A family's own records stay until the family deletes them,
or the operator deletes the family.

## Backups and the nightly archive

Erasure and deletion reach the live databases and the stored files. They do not reach copies made before:

- **Your own backups** (`docs/self-host.md`, "Backups"; D1 exports; the files copied before a migration in `backups/`) keep
  everything until you delete them. Rotate them (for example: daily for 30 days), and say how long in your privacy policy. Restoring
  one brings erased data back: erase it again after a restore.
- **Cloudflare**: D1 keeps point-in-time history (Time Travel: 30 days on the paid plan, 7 on the free one), and every SQLite
  Durable Object 30 days of its own. Kindred has no command to read them; they age out on their own.
- **A steward's backup or export** (JSON, GEDCOM, Markdown) is the family's copy, outside the server.
- **The nightly archive to GitHub** (`KINDRED_ARCHIVE_<ID>_*`, [exchange.md](exchange.md)): the next night's commit no longer holds
  an erased person, but **every earlier commit still does**, for as long as the repository's history is kept. To erase from it,
  rewrite the history (or delete and recreate the repository) and ask GitHub to clear cached views; GitHub is a subprocessor while
  it is on.

## When something goes wrong

The operator's **breach register** (console → Privacy): every personal data breach, notified or not (Art. 33(5)), with when the
operator became aware, what happened, which data and whose, the likely consequences, the measures, and the risk. When it may put
people at risk, the supervisory authority must be told **within 72 hours** of becoming aware (Art. 33(1)); the register shows the
deadline, and after it asks for the reasons for the delay. A high risk also means telling the people (Art. 34). A breach can carry a
**notice** for the stewards of the families it affects (all, or those ticked), shown on their family's pages until a date or until
it is closed.

## The operator's checklist

Kindred gives the tools; the operator still has to:

1. Decide and write down your **role** and your legal basis for each processing (the Art. 30 record lists Kindred's suggestions).
2. Write a **privacy policy** (Art. 13): who you are, what you store, why, where, for how long, the subprocessors (copy them from
   `/legal`), and how people exercise their rights (`/privacy-request`). Set it, an **Impressum** where required, and **terms**.
3. Adapt the **processing agreement** template and set it; families then accept it when they are made.
4. Sign the **data processing agreements** of your own processors: your host (Cloudflare's DPA in the dashboard), any AI provider
   whose key *you* provide, GitHub if you run the archive.
5. Keep the data where you promise it (an EU server, or a Cloudflare jurisdiction).
6. Download the **record of processing activities** (Privacy → Markdown or JSON), complete it (your address, a DPO if you need
   one, your host), and keep it current when you change the configuration.
7. Set up **backups**, decide how long they are kept, and say so.
8. Read the **retention** report, then switch deletion on.
9. Answer **data requests** within the month: forward them to the family's stewards, follow up, mark them answered.
10. Keep the **breach register**, and know your supervisory authority's notification form before you need it.
11. Give a **statement of reasons** whenever you suspend or close a family (EU Digital Services Act, Art. 17; the console asks for
    one), and keep "Report content" filled in (Art. 16).
12. Consider a **DPIA** (Art. 35) if you host many families or special-category data at scale (a template is a later round).
