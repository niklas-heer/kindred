# Third-party material

Kindred itself is under the [MIT licence](LICENSE). It includes or uses the material below. Where a licence asks for
credit, the credit is here and in the app.

## Heraldic charges and some icons: game-icons.net

- What: the glyphs on shields and in the arms editor, and a few icons for occasions and traits. They are extracted from the
  `@iconify-json/game-icons` package by `scripts/extract-icons.ts` (the charges are listed in `scripts/charge-library.tsv` and
  `src/components/heraldry/catalogue.ts`) into the `*.gen.ts` files, and they ship in the app.
- Authors: Lorc, Delapouite and contributors. The set's own page, [game-icons.net](https://game-icons.net), names the author of
  each icon. Kindred's files do not record the author of each glyph.
- Licence: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Changes: the glyphs are cropped to their paths and drawn
  in the current text colour or a shield's colours.
- Credit to show: "Game-icons.net: Lorc, Delapouite and contributors, CC BY 3.0" with a link to https://game-icons.net.

## Place names: GeoNames

- What: the offline place search (`data/gazetteer.db`, or the `GAZETTEER` D1 database), built from GeoNames `cities500` by
  `scripts/gazetteer.ts`. Kindred downloads it from geonames.org when you build the gazetteer; it is not in the repository.
- Licence: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The data is reshaped into a search index.
- Credit to show: "Place names: GeoNames (geonames.org), CC BY 4.0" with a link to https://www.geonames.org.

## Typefaces: Fontsource

Cinzel, EB Garamond and Inter (variable) and IM Fell English, installed from the `@fontsource` packages and served with the app.
All four are under the [SIL Open Font License 1.1](https://openfontlicense.org/). Their copyright notices are in each package
under `node_modules/@fontsource*/`.

## The Atlas map: world-atlas and Natural Earth

The Atlas draws its map from the `world-atlas` package (ISC licence, Copyright 2013-2019 Michael Bostock), which is built from
[Natural Earth](https://www.naturalearthdata.com) data. Natural Earth is in the public domain and asks for no credit.

## npm packages

The packages Kindred depends on are listed in `package.json`, with exact versions in `package-lock.json`. Each keeps its own
licence in its package under `node_modules/`. Run `npm ls` to see them.
