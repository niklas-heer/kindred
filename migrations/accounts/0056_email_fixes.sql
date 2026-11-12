-- Email, round eight (src/lib/email/, src/lib/notify/stewards.server.ts; docs/hosting-many-families.md, "Email").
--   email_send.sender   who caused the email, for the limits on confirmation links and invitations (a few a day from one
--   email_send.network  account and from one network): keyed hashes under the server secret, like `recipient`, so the table
--                       names nobody. NULL for an email nobody caused (a job's) and for every row from before.
--   email_send.category gains 'notice' (no CHECK to change): what a family's stewards must get, a data breach or the final
--                       notice before the lifecycle deletes the family; it cannot be unsubscribed.
--   steward_notice.emailed, .pushed  how many stewards the notice reached by email and by push (0 for the rows from before).
--                       The lifecycle deletes a family by itself only after its final notice reached a steward one of these
--                       ways; otherwise the deletion waits for the operator.
-- Additive only. Plain SQL, so D1 and node:sqlite both run it.
ALTER TABLE email_send ADD COLUMN sender TEXT;
ALTER TABLE email_send ADD COLUMN network TEXT;
CREATE INDEX email_send_sender ON email_send (sender, category, at);
CREATE INDEX email_send_network ON email_send (network, category, at);

ALTER TABLE steward_notice ADD COLUMN emailed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE steward_notice ADD COLUMN pushed INTEGER NOT NULL DEFAULT 0;
