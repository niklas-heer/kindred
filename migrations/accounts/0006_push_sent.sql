-- The UTC day (YYYY-MM-DD) a device's reminder was last claimed for. The daily run claims a device's day with one
-- conditional UPDATE before it sends, so a repeated, restarted or overlapping run sends that day's reminder once
-- (src/lib/reminders.server.ts, claimDay). NULL until the device's first claim. Nothing else reads it.
ALTER TABLE push_subscription ADD COLUMN last_sent_day TEXT;
