-- How many open requests to join came from one network through one link (src/lib/auth/join.server.ts, `networkKey`): a short
-- hash of the link and the network (an IPv4 address, or an IPv6 /64), 18 bits, which stands for thousands of addresses and so
-- names none. Cleared when the request is approved; a declined or expired request is deleted. Null for requests sent before.
-- Plain SQL, so D1 and node:sqlite both run it.
ALTER TABLE join_request ADD COLUMN network TEXT;
CREATE INDEX join_request_by_network ON join_request (link, network, status);
