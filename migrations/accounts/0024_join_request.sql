-- "Ask to join": a share-link guest asks for an account of their own (src/lib/auth/join.server.ts, docs/roles-and-privacy.md).
--   share_link.ask_to_join  the steward's switch per link: 1 lets its guests ask. On for every link, also the ones that existed.
--   join_request    one guest's request. `user` is the pending account the guest's passkey belongs to: it has no membership,
--                   and it cannot sign in until a steward says yes. `browser` is the hash of the cookie that lets the asking
--                   browser follow its request. What the stewards read (name, who they say they are, message, approximate
--                   place, time zone, language, device family, a copy of the link's usage) is cleared when the request is
--                   approved; a declined or expired request goes with its account and its passkey. `status` is 'open' or
--                   'approved'; an approved row only waits for the new member's first sign-in, and goes 30 days later at most.
--   guest_visitor   how one guest browser used one link, aggregated: first and last seen, visits, active seconds, counts per
--                   section and a small tally of the people opened. Keyed by the hash of a random cookie; no address, no page
--                   log. Deleted when the link is replaced or turned off, and 90 days after the last visit.
--   join_challenge  a passkey ceremony for a request in progress, with what the guest typed, for five minutes.
-- Plain SQL, so D1 and node:sqlite both run it.
ALTER TABLE share_link ADD COLUMN ask_to_join INTEGER NOT NULL DEFAULT 1 CHECK (ask_to_join IN (0, 1));

CREATE TABLE join_request (
  id TEXT PRIMARY KEY,
  tree TEXT NOT NULL,
  link TEXT NOT NULL,
  user TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE CASCADE,
  browser TEXT NOT NULL UNIQUE,
  visitor TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved')),
  name TEXT NOT NULL,
  person TEXT,
  message TEXT,
  city TEXT,
  region TEXT,
  country TEXT,
  time_zone TEXT,
  language TEXT,
  device TEXT,
  usage TEXT,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX join_request_by_tree ON join_request (tree, status);
CREATE INDEX join_request_by_link ON join_request (link, status);

CREATE TABLE guest_visitor (
  hash TEXT NOT NULL,
  link TEXT NOT NULL,
  tree TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  visits INTEGER NOT NULL DEFAULT 0,
  active_seconds INTEGER NOT NULL DEFAULT 0,
  sections TEXT NOT NULL DEFAULT '{}',
  people TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (hash, link)
);
CREATE INDEX guest_visitor_by_link ON guest_visitor (link);
CREATE INDEX guest_visitor_by_last_seen ON guest_visitor (last_seen);

CREATE TABLE join_challenge (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires INTEGER NOT NULL
);
