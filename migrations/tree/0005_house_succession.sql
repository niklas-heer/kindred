-- Who heads each house and how its line of succession runs. A house without a row uses absolute
-- primogeniture with no explicit head, heir or country. `head` and `heir` are optional overrides: with
-- neither set, the head is worked out from the family graph (see src/lib/houses.tsx).
CREATE TABLE house_succession (
  house TEXT PRIMARY KEY REFERENCES house(id) ON DELETE CASCADE,
  law TEXT NOT NULL DEFAULT 'absolute-primogeniture' CHECK (law IN ('absolute-primogeniture', 'seniority', 'elective')),
  head TEXT REFERENCES person(id) ON DELETE SET NULL,
  heir TEXT REFERENCES person(id) ON DELETE SET NULL,
  country TEXT CHECK (country IS NULL OR (length(country) = 2 AND country = upper(country)))
);
