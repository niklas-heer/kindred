# Recipes and the Cookbook

A family's recipes are worth more than a block of text: they are cooked from, with wet hands, for six instead of four.
In Kindred a recipe has a form to be written in, a page to be read on, a mode to cook from, and a sheet to print.

A recipe is still a memory of someone. It is a story of kind `recipe`, so it is in the Chronicle and in
the [feed](feed.md) on Today, takes [reactions and comments](responses.md), is in the change history, and belongs to a
person in the tree: whose recipe it is.

## Writing one

Wherever a memory can be added (a person's Memories tab, "Add a memory" in the Chronicle, the composer on Today),
choosing **Recipe** opens the recipe form. The Cookbook has **Add a recipe**, which starts with the writer's own person.

- **Its name**, and optionally **where it comes from** in the family's own words ("Grandma's", "from the blue notebook").
- **Whose recipe it is**: a person in the tree. It shows on their page, with their face. From someone's own page it is
  theirs; in the Cookbook it starts as the writer's and can be given to anyone.
- **Servings**, and the **preparation** and **cooking** time.
- **Ingredients**, one row each: amount, unit, what, and how it is prepared. A whole line typed into the first box
  ("800 g beef, diced") sorts itself into the four. A pasted list becomes rows, one per line, and a line that ends in a
  colon ("For the dumplings:") starts a named part of the list. Enter in a row starts the next one. Units are read in
  English, German and Afrikaans (g, EL, tbsp, eetlepel, Prise, cloves …); a line the reader cannot take apart is kept
  whole.
- **Method**, one step at a time. A pasted method is split at its paragraphs or its numbers. Steps can be moved up and
  down, and up to six of them can have a picture.
- **Notes**: tips, what goes with it, the story behind it. Markdown.
- **Tags**: a few words to find it by (soup, Christmas, quick). The tags the family already uses are offered.
- **A picture of the dish.**

A recipe needs a name and at least one ingredient or one step.

## The pictures are the recipe's, not the Gallery's

A recipe's cover and its steps' pictures are stored with the family's other media (in `recipe/`, the cover's small copy
in `recipe-thumb/`) but they are **not gallery pictures**: the Gallery does not list them, nobody can be tagged in
them, they are on no person's photos, and the gallery's address does not serve them. They have their own address,
`/api/recipe/<family>/<file>`, which serves a picture only to someone who may read its recipe.

The browser scales a picture down (1,800 pixels for a cover, 1,400 for a step) and drops its location data before it is
sent; the server checks its first bytes and cleans it again. The pictures travel with the recipe in one request, so no
picture is ever stored waiting for a recipe that is not saved: a refused save gives them back. A picture a change
replaces is deleted with that change.

## Reading one

Each recipe has a page, `/<family>/recipe/<id>`:

- the picture, the name, whose kitchen it is from (with their face) and who wrote it down;
- **how much to make**: fewer or more servings, any number typed in, or ½×, 1×, 2× in one press. The amounts follow.
  Fractions stay fractions ("1 1/2" doubled is "3", halved is "¾"), a decimal stays a decimal in the reader's notation,
  a point between groups of three figures is read as thousands ("1.000 g Mehl" is a kilogram), a tiny amount never
  scales to nothing, and words such as "a pinch" are left alone. A recipe that does not say what it serves is scaled by times;
- **ingredients to tick off**. The ticks are the reader's own, kept in that browser for that recipe, so they survive a
  reload;
- the method, with its pictures, and the notes;
- **Start cooking**: the recipe one step at a time, in large letters, first the ingredients to lay out, then each step.
  The screen is kept awake where the browser can (the Screen Wake Lock API; the page says whether it is). The arrow
  keys, a swipe and two large buttons turn the page, and the ingredients are one press away at every step;
- **Print**: the recipe alone on a clean sheet, the picture small, the ingredients with boxes to tick with a pen;
- reactions and comments, as on any memory, for members.

When the family has AI translations of stories ([ai.md](ai.md)), a recipe written in another language offers its
translation, as text.

## The Cookbook

`/<family>/cookbook` is every recipe of the family as cards, newest first, with their pictures. It is reached from the
Chronicle, from a person's Memories tab, and from every recipe (a recipe's tags are links into it). It can be searched
(names, tags, the people, and what is in the dish) and narrowed by tag, by whose recipe it is, and by house; the
filters are in the address, so a filtered Cookbook can be sent to someone.

## Recipes from before

A recipe written before recipes had a form is a story of kind `recipe` with only its text. It is not converted: it is in
the Cookbook with the others and opens on its own page as it was written. Whoever may change it can **add ingredients
and steps**: the form opens with its text as the notes, and saving gives it the form. It keeps its writer and its date.

## Who may do what

| Who | May |
| --- | --- |
| Share-link guest | read the Cookbook and recipes, as they read the Chronicle: none of a living person when the link protects living people, neither its words nor its pictures |
| Viewer | read, tick, scale, cook, print; react |
| Contributor | also write recipes, change their own, and comment |
| Editor, steward | also change and remove anyone's |

A removed recipe can be brought back with **Undo** by whoever removed it, with its pictures. They are kept, served to
nobody, for as long as the removal can be undone, and the daily job deletes them after 31 days. A demo and a steward's
"View as" preview refuse every change.

## Where it is kept

`recipe` and `recipe_image` in the family's database (tree migration 0031, [data-model.md](data-model.md)). The story's
own text is the whole recipe written out as Markdown, made again on every save in the writer's language, so everything
that reads stories reads a recipe: the Chronicle's search, the assistant, a translation, and the
[Markdown archive](exchange.md), which writes each recipe out readably with its tags. The pictures are in no export.
GEDCOM has no recipes, as it has no stories.

The two invented families (`mise run data`, and the public demo) come with a few recipes: a grandmother's goulash and
her cardamom buns among them.
