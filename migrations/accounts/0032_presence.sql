-- Who is in a family right now (src/lib/presence/presence.server.ts, docs/roles-and-privacy.md "Here now").
--
--   presence   one row per member's open browser tab in a family, rewritten by its heartbeat (every 15 s while the tab is
--              visible) and deleted when the tab is left. A row older than 45 s is ignored by every read and swept by the
--              next heartbeat, so this is never a history of who was where. `route` is one of a fixed list of page names
--              (never an address or a search), `focus` a person's id in that family or NULL, `editing` 1 while that person's
--              Edit tab is open, `shadows` 0 when the member switched "Show me to others" off: then `focus` and `editing`
--              stay empty and they see nobody else's either. Members only: a guest, a demo and a "View as" preview write
--              nothing here. Deleted with the account, when the member leaves the family, and with the family.
-- Plain SQL, so D1 and node:sqlite both run it.
CREATE TABLE presence (
  tree TEXT NOT NULL,
  account TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  tab TEXT NOT NULL,
  route TEXT NOT NULL,
  focus TEXT,
  editing INTEGER NOT NULL DEFAULT 0 CHECK (editing IN (0, 1)),
  shadows INTEGER NOT NULL DEFAULT 1 CHECK (shadows IN (0, 1)),
  seen INTEGER NOT NULL,
  PRIMARY KEY (tree, account, tab)
);
CREATE INDEX presence_seen ON presence (seen);
