-- The contacts and the favourite now live in person_field (0003), and nothing reads the old copies any more.
-- Drops the first contact table and the one-line favourite column that 0003 copied from.
ALTER TABLE person DROP COLUMN favourite;
DROP TABLE contact;
