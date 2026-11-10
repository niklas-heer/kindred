-- Two small columns.
--   join_request.network  how many open requests to join came from one network through one link (src/lib/auth/join.server.ts,
--                         `networkKey`): a short hash of the link and the network (an IPv4 address, or an IPv6 /64), 18 bits,
--                         which stands for thousands of addresses and so names none. Cleared when the request is approved; a
--                         declined or expired request is deleted. Null for requests sent before.
--   family_visit.visits   how many visits a member has made to the family (src/lib/history.server.ts, `noteVisit`): 1 during the
--                         first, so "What's new" can say so however often it is opened then. 0 for members who visited before
--                         it was counted, who are not on a first visit.
-- Plain SQL, so D1 and node:sqlite both run it.
ALTER TABLE join_request ADD COLUMN network TEXT;
CREATE INDEX join_request_by_network ON join_request (link, network, status);
ALTER TABLE family_visit ADD COLUMN visits INTEGER NOT NULL DEFAULT 0;
