-- Suggestions from the family: any member, or a share-link guest where the family allows it, suggests a change to a
-- person's facts, a missing relative, a life event or a source, and an editor approves or declines it.
--
-- `suggestion` is one suggestion: its `kind` (`details`, `relative`, `event` or `source`), the `person` it is about (NULL
-- for a source that backs no one yet; deleting the person deletes their suggestions), the `payload` as JSON, an optional
-- `basis` (the record's values when the suggestion was made, which an approval compares with to see that the record has not
-- moved on) and a `note`. `status` is `waiting` until it is decided or
-- withdrawn; `expired` is set by the daily job. `adjusted` is 1 when the editor approved it with changes, `reason` is a
-- decline text. The writer is a member (`account`) or a guest (`guest_key`, the votes cookie's key), with the
-- `author_name` and `author_person` shown then, so it outlives the membership; `link` and `net` are a guest's, as for a
-- vote's voter. `decided_by`, `decided_by_name` and `decided_at` say who decided and when, `applied` names what the
-- approval wrote (a record id), and `created_at` is when it was made.
--
-- `suggestion_file` is a picture or a document attached to a suggestion; the file is in media storage under `key`.
--
-- `source_file` lists the files of a source in their order (`ord`), so a source may hold more than the one `document` or
-- `media` it has had since migration 0024; the file is in media storage under `media_key`, which `source_file_key` finds
-- it by when it is served.
--
-- `history.suggestion` is the id of the suggestion an approved change came from, so the history can say "suggested by";
-- `history_suggestion` finds an approval's rows by it (whether one has begun, closing one as partly applied).
CREATE TABLE suggestion (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('details', 'relative', 'event', 'source')),
  person TEXT REFERENCES person (id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  basis TEXT,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('waiting', 'approved', 'declined', 'expired', 'withdrawn')),
  adjusted INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  account TEXT,
  guest_key TEXT,
  author_name TEXT NOT NULL,
  author_person TEXT,
  link TEXT,
  net INTEGER,
  decided_by TEXT,
  decided_by_name TEXT,
  decided_at TEXT,
  applied TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX suggestion_status ON suggestion (status, created_at);
CREATE INDEX suggestion_person ON suggestion (person, status);
CREATE INDEX suggestion_guest ON suggestion (guest_key);

CREATE TABLE suggestion_file (
  id TEXT PRIMARY KEY,
  suggestion TEXT NOT NULL REFERENCES suggestion (id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE source_file (
  source TEXT NOT NULL REFERENCES source (id) ON DELETE CASCADE,
  media_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  name TEXT NOT NULL,
  ord INTEGER NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (source, media_key)
);
CREATE INDEX source_file_key ON source_file (media_key);

ALTER TABLE history ADD COLUMN suggestion TEXT;
CREATE INDEX history_suggestion ON history (suggestion);
