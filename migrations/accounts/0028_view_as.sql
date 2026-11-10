-- "View as": a steward previews one family as a role, as one of its members, or as a guest of its share link
-- (src/lib/auth/view-as.server.ts, docs/roles-and-privacy.md).
--   view_as   one preview, behind a random token in an HttpOnly cookie; only the token's hash is kept, as for a session. It
--             belongs to the steward's account (`user`) and, under Kindred's own sign-in, to the session that started it
--             (`session`, the session's hash; NULL behind Cloudflare Access). `kind` is what is previewed: 'role' (`role`, a
--             member with that role and no person), 'member' (`member`, an account in the family) or 'guest' (`link`, the
--             family's share link, or NULL for a plain guest with living people protected). `last_used` is when the preview was
--             last used; one unused for an hour ends by itself, and none lasts longer than a day. Deleted on Stop, on sign-out,
--             when the steward is no longer a steward, when the member leaves or the link goes, and with the family.
-- Plain SQL, so D1 and node:sqlite both run it.
CREATE TABLE view_as (
  hash TEXT PRIMARY KEY,
  user TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  session TEXT,
  tree TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('role', 'member', 'guest')),
  role TEXT CHECK (role IN ('viewer', 'contributor', 'editor')),
  member TEXT,
  link TEXT,
  created INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);
CREATE INDEX view_as_by_user ON view_as (user);
CREATE INDEX view_as_by_tree ON view_as (tree);
