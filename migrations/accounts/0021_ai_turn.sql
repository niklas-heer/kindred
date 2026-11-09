-- One running reply per chat. A row is held only while its turn runs: it is deleted at the end, and a turn that died without
-- deleting it stops counting once `at` is older than the lease (src/lib/ai/turn-lease.server.ts), so a chat cannot stay locked.
CREATE TABLE IF NOT EXISTS ai_turn (
  conv TEXT PRIMARY KEY,
  claim TEXT NOT NULL,
  at INTEGER NOT NULL
) WITHOUT ROWID;
