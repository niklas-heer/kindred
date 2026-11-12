-- Password resets by email (src/lib/email/reset.server.ts): a link Kindred sends to an account's verified address is a row of
-- password_reset like an operator's, and the notice after it is used names which it was.
--   password_reset.via  'operator' (an operator made the link in the console; every row from before) or 'email' (the account's
--                       holder asked for it on the sign-in page, and it went to their verified address; `created_by` is NULL).
-- Additive only. Plain SQL, so D1 and node:sqlite both run it.
ALTER TABLE password_reset ADD COLUMN via TEXT NOT NULL DEFAULT 'operator' CHECK (via IN ('operator', 'email'));
