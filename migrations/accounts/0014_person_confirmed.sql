-- Whether a steward has confirmed who a member says they are. A linked member may paint their own portrait, which spends the
-- family's budget, so the link has to be confirmed first. Editors and stewards can paint anyway: their own links count as
-- confirmed. Links viewers and contributors already made wait for a steward, like new ones.
-- Plain SQL, so D1 and node:sqlite both run it.
ALTER TABLE membership ADD COLUMN person_confirmed INTEGER NOT NULL DEFAULT 0;
UPDATE membership SET person_confirmed = 1 WHERE role IN ('editor', 'steward') AND person IS NOT NULL AND person <> '-';
