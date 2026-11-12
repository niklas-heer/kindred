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
--   ai_operator_overage.model, .acknowledged_at, .acknowledged_by
--                   which model (`provider:model`) an operator-funded call that cost more than its reservation used, and when
--                   and by whom the operator acknowledged it on the Health tab. Until then the operator's AI is paused for that
--                   family and model. Rows from before have no model and pause nothing.
-- Additive only. Plain SQL, so D1 and node:sqlite both run it.
ALTER TABLE user ADD COLUMN retiring TEXT;
ALTER TABLE ai_operator_overage ADD COLUMN model TEXT;
ALTER TABLE ai_operator_overage ADD COLUMN acknowledged_at INTEGER;
ALTER TABLE ai_operator_overage ADD COLUMN acknowledged_by TEXT;
CREATE INDEX IF NOT EXISTS ai_operator_overage_open ON ai_operator_overage (family, model) WHERE acknowledged_at IS NULL;
ALTER TABLE user ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
UPDATE user SET email_verified = 1 WHERE email IS NOT NULL AND EXISTS (
  SELECT 1 FROM oidc_identity i WHERE i.user = user.id AND i.email_verified = 1 AND lower(i.email) = lower(user.email));
