-- Fixes from the seventh round's review (docs/data-model.md):
--   user.retiring   set while the retention job retires an unused account (src/lib/gdpr/retention.server.ts): the pseudonym
--                   its writing gets, claimed in one guarded batch while the account still qualifies. While it is set the
--                   account has no session and a visit is not counted, and the next run finishes a retirement that stopped
--                   part-way under the same pseudonym. NULL otherwise.
-- Additive only. Plain SQL, so D1 and node:sqlite both run it.
ALTER TABLE user ADD COLUMN retiring TEXT;
