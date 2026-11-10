# Drawn portraits and the character editor

Every person in a family has a drawn portrait: a flat illustration built from parts, aged and dressed for the moment it
shows. Nobody has to make one. Until someone does, the portrait is automatic: it follows the person's sex and dates, so a
great-grandmother born in 1890 wears a high collar and greys with the years, and a child born in 2016 does not.

![An invented family dressed by hand: a monocle and a waistcoat, a beehive and cat-eye glasses, a head wrap, a turban, a hijab, locs, blue hair, a hearing aid, a doctor's coat, a flower crown, a uniform, a bridal veil, a kippah, a crown.](images/portraits.webp)

A photograph, or a portrait painted from one by the AI ([ai.md](ai.md)), can stand in for the drawing. The drawing stays
underneath, and a person can go back to it at any time.

## The character editor

Clicking a drawn portrait on a person's panel or page opens the editor. On a photograph or a painting, the small brush in
the corner does (the picture itself opens large). Editors also find it as **Appearance** on a person's Edit tab.

![The character editor on an invented relative: her portrait on the left with Surprise me, undo, redo and compare under it, and ready-made looks on the right.](images/editor.webp)

- **The portrait** on the left changes as you choose, and shows a choice while the pointer or the keyboard's focus rests on
  it. Under it are the same portrait at the size of a tree node and of a list row, and a preview of the person as a child,
  a grown-up and in old age.
- **Categories**: Looks, Face, Eyes, Hair, Beard, Details, Clothes, Headwear, Extras and Age. Each choice is a small picture
  of this person wearing it. "Automatic" leaves a part to the portrait, which is what every part is until someone sets it.
- **Surprise me** makes a believable relative: the same sex, age and time, the same skin (or a shade either side), a new
  face, hair and clothes. Headwear that is part of who someone is (a crown, a hijab, a turban, a kippah) stays.
- **Looks** are ready-made outfits for the person's own time: "Grandfather, 1950s", "Wedding day", "In uniform",
  "Midsummer", "Crowned". A look changes what is worn and never the face.
- **Undo** and **Redo** (also Ctrl+Z and Ctrl+Shift+Z, or Cmd on a Mac), **Back to how it was**, and **Compare with
  before**.
- **Save appearance** keeps it, as one entry in the family's History. Closing with unsaved changes asks first.

Everything works with the keyboard and a screen reader, at phone width (the portrait stays in view above the options), in
the three themes and the three languages. With "reduce motion" on, nothing moves.

<img src="images/editor-phone.webp" alt="The character editor on a phone: the portrait and its tools at the top, the categories under them, and hair colours to choose from." width="260">

## What a portrait can say

Skin in fourteen tones. Hair in natural and dyed colours, straight, wavy, curly or coily, in braids, locs, cornrows, buns,
a beehive or a crown braid, thinning, receding or bald; greying that follows age until you set it. Eye colour and shape,
brows, nose, mouth, ears, the shape of the face, build, and lines of age. Freckles, a mole, a birthmark, vitiligo, a scar.
An expression: calm, a smile, a grin, stern. Beards and moustaches. Glasses of a dozen kinds (a monocle and a pince-nez among them) and
the colour of the frames. A hearing aid, earrings, a necklace, a brooch, a medal, a scarf, a pipe, a bindi. Headwear by
time, faith and occasion: caps and hats, a headscarf, a hijab, a head wrap, a turban, a kippah, a prayer cap, a veil, a
uniform cap, a bridal veil, a flower crown, a crown. Clothes for every day, for Sunday, for work and service, and
traditional dress, in the house's colours or your own. A backdrop: plain, the house's colours, a studio drape, books, sky,
hills, a garden, the sea, the night.

Small symbols that would not read on a portrait the size of a thumbnail (a particular pendant, a badge of rank) are left
out. A plain pendant or a medal stands for them.

## Who may change a portrait

Whoever may paint a person's portrait may draw it: an **editor** or a **steward**, and the **member who is that person**
once a steward has confirmed the link on the Access page ([roles-and-privacy.md](roles-and-privacy.md)). The server checks
this on every save.

Everyone else in the family can still open the editor and try a look on; it says that nothing will be kept. The same
holds in a public demo and in a steward's "View as" preview. A guest of a share link gets the plain enlargement, as before.

## What is stored, and what never changes by itself

A look is a small JSON object on the person (`person.look`; `SeedLook` in `src/lib/seed-format.ts`). Only what someone
chose is stored. Every part is optional, and a part that is absent is drawn automatically from the person's id, sex and
dates, so it is the same on every screen and every day.

A portrait that is stored draws exactly as it did before a release, unless someone edits it:

- New parts are new optional fields, and absent always means "as before". Lists of colours and styles only ever grow at
  the end.
- The automatic choice of hair and eye colour draws from the colours that existed when it was written, however many are
  added.
- `src/lib/portrait-frozen.test.ts` draws 3,067 stored looks at the three sizes and compares each with a kept print. If it
  fails, a stored portrait has changed: the drawing is wrong, not the fixture.

Portraits are drawn at three levels of detail (`src/components/portrait/drawing.ts`): up to 40 px, up to 72 px, and
larger. A list-size portrait leaves out what would not show: a backdrop is flat colour there, and no part added later is
heavier at that size than the heaviest one before it (`src/lib/portrait-look.test.ts` checks both).

`/ui/character` is the developer's reference page: `?view=parts` shows every part on three sitters at two sizes,
`?view=family` the invented family above, `?view=matrix` every era and age.
