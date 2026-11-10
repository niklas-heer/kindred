# Reactions and comments

Members can answer what the family shares: a memory (any story: a memory, a saying, an anecdote, a recipe or a note) and a
photo in the gallery. Under each one there is a small row of reactions and a thread of comments. It is for members only;
a share-link guest sees none of it, not even the counts.

## Reactions

Five, chosen to mean something in a family rather than to keep score:

| Reaction | English | Deutsch | Afrikaans |
| --- | --- | --- | --- |
| `heart` | With love | Von Herzen | Met liefde |
| `remember` | I remember this | Daran erinnere ich mich | Ek onthou dit |
| `laugh` | Made me laugh | Hat mich zum Lachen gebracht | Het my laat lag |
| `candle` | A candle in memory | Eine Kerze zum Gedenken | ’n Kers ter herinnering |
| `thanks` | Thank you for sharing | Danke fürs Teilen | Dankie dat jy dit deel |

Every member, viewers included, can give each reaction once to a memory or a photo, and take it back. A button says its
name and how many gave it to a screen reader, and shows that it is yours by its outline and fill as well as its colour. An
opened thread says who gave which.

## Comments

Contributors, editors and stewards write comments: plain text, up to 1,000 characters, with its line breaks. Nothing in a
comment is read as Markdown or HTML, and links are not made clickable. The name on a comment is the writer's own name in
Kindred, never one the browser sends; when the writer stands for someone in the tree, that person's portrait is beside it.

- The writer can change their comment (it is then marked "changed") and remove it. Removing asks first.
- Editors and stewards can remove anyone's comment, and cannot change it.
- A member whose role is lowered to viewer can still remove their own comments, and no longer write or change them.
- A thread opens on its last five comments, with the earlier ones one click away.

## Where they show

- The Chronicle: every entry, sayings included, has the reactions and the comment count, and opens its thread in place.
- A person's Stories tab: under each story.
- The gallery: a tile shows its number of reactions and comments; the photo's own window has the reactions and the thread.

The counts for a whole page come from one request that makes two reads of the family database, however many entries there are.

## Telling the author

The person who wrote a memory or shared a photo can be told when someone reacts to it or comments on it. It is off until
they turn it on, in the Reminders dialog ("Answers"), and it arrives on the devices where reminders are on for that family.
At most one such push a day, never for their own answer, and it says who answered and about whom, not the words. Stories
written before this feature, by the assistant or brought in by an import have no account as their writer, so nobody is
told about those.

The family's "what's new" reads the `reaction` and `comment` tables for answers to what the reader wrote.

## What is kept, and where it goes

- A memory or a photo takes its reactions and comments with it when it is removed, also when a story goes with its person.
  Undoing the removal of a memory brings it back without them.
- A member who is removed from the family keeps their comments, under the name they wrote them with ("a former member" when
  none was kept). Their reactions go, and so do their opt-in for the answer push and their reminder devices for the family.
  Their portrait is no longer shown beside their comments. See docs/data-model.md, "When a membership ends".
- The Markdown archive has each story with its comments (`memories/`). GEDCOM has neither. Reactions and the comments on
  photos are in no export. The D1 transfer copies reactions and comments, and not the push choice.

See [data-model.md](data-model.md) for the tables (migration `tree/0027`) and [roles-and-privacy.md](roles-and-privacy.md) for
who may do what.
