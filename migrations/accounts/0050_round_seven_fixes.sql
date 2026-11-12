-- Fixes from the seventh round's review (docs/data-model.md):
--   user.retiring   set while the retention job retires an unused account (src/lib/gdpr/retention.server.ts): the pseudonym
--                   its writing gets, claimed in one guarded batch while the account still qualifies. While it is set the
--                   account has no session and a visit is not counted, and the next run finishes a retirement that stopped
--                   part-way under the same pseudonym. NULL otherwise.
--   user.email_verified  1 when the account's address was verified: by Cloudflare Access, or by a single sign-on provider whose
--                   ID token said email_verified for that same address (an invitation, a sign-up, a link or a sign-in). An
--                   address a steward typed into an invitation is not verified. A provider trusted for emails (trust_email)
--                   finds only a verified address, so nobody can take over an account through an address its holder never
--                   proved. Existing accounts are verified where a linked identity already vouched for the same address.
-- Additive only. Plain SQL, so D1 and node:sqlite both run it.
ALTER TABLE user ADD COLUMN retiring TEXT;
ALTER TABLE user ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
UPDATE user SET email_verified = 1 WHERE email IS NOT NULL AND EXISTS (
  SELECT 1 FROM oidc_identity i WHERE i.user = user.id AND i.email_verified = 1 AND lower(i.email) = lower(user.email));
