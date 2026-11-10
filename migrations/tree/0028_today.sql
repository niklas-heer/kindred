-- Today (docs/today.md): the question of the week and the daily quiz. Plain SQL, as every migration here: D1 and
-- node:sqlite run it.

-- One row: the steward's switch for the daily quiz (on until a steward turns it off).
CREATE TABLE today_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  quiz INTEGER NOT NULL DEFAULT 1 CHECK (quiz IN (0, 1)),
  updated_at TEXT,
  updated_by TEXT
);

-- A week a steward changed: their own question in place of the curated one, or no question at all. `week` is an ISO
-- week ("2026-W46"). A week without a row asks the curated question chosen for the family (src/lib/today/week.ts).
CREATE TABLE today_week (
  week TEXT PRIMARY KEY,
  skipped INTEGER NOT NULL DEFAULT 0 CHECK (skipped IN (0, 1)),
  question TEXT,
  updated_at TEXT
);

-- The tag on a memory written as an answer: the week it answers and the question asked ("q17" from the curated list,
-- or "custom" for a steward's own). The memory itself is an ordinary row of `story`; this goes with it when it is removed.
CREATE TABLE today_answer (
  story TEXT PRIMARY KEY REFERENCES story (id) ON DELETE CASCADE,
  week TEXT NOT NULL,
  question TEXT NOT NULL
);
CREATE INDEX today_answer_week ON today_answer (week);

-- The quiz question of a UTC day ("2026-11-10"), kept as it was drawn so that everyone gets the same one however the
-- family's records change during the day. `question` is what a reader is shown (JSON, without the answer), `answer`
-- the right choice, and `about` the person or house it is about: for the answer's link, and so the same one is not
-- asked again for a while.
CREATE TABLE quiz_day (
  day TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  about TEXT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL
);

-- A member's one answer to a day's quiz: the primary key is what keeps it to one. Members are named by their account
-- id; `house` is the house of the person they stood for when they answered, for the month's table of houses.
CREATE TABLE quiz_answer (
  day TEXT NOT NULL REFERENCES quiz_day (day) ON DELETE CASCADE,
  account TEXT NOT NULL,
  choice TEXT NOT NULL,
  correct INTEGER NOT NULL CHECK (correct IN (0, 1)),
  house TEXT,
  at TEXT NOT NULL,
  PRIMARY KEY (day, account)
);
CREATE INDEX quiz_answer_account ON quiz_answer (account, day);
