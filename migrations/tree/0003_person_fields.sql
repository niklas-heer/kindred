-- Person fields: what a person is recorded as having, as a list the Edit tab shows the way a phone's contact
-- card does. One row per field: a phone number, an address, a school, a dietary note… Each has a type (what
-- it is, and the shape of its value), a label the family picks or types ("mobile", "work", "custom…"), a value
-- as JSON, a place in the list, and whether only editors and stewards may see it.
--
-- Also the birth name and the current name. A NULL current name means "same as birth": it follows the birth
-- name when that changes.
--
-- The contacts and the favourite move into the list here. The old `contact` table and `person.favourite` stay
-- for now; nothing reads them after the reads have moved to person_field, and a later migration drops them.

ALTER TABLE person ADD COLUMN current_given TEXT;
ALTER TABLE person ADD COLUMN current_surname TEXT;

CREATE TABLE IF NOT EXISTS person_field (
  id TEXT PRIMARY KEY,
  person TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'phone', 'email', 'address', 'website', 'social', 'names', 'dates', 'education', 'occupation', 'military',
    'religion', 'nationality', 'languages', 'medical', 'allergies', 'favourites', 'gifts', 'notes', 'related', 'custom'
  )),
  label TEXT NOT NULL DEFAULT '',
  value TEXT NOT NULL CHECK (json_valid(value)),   -- JSON object, shape by type (src/components/fields/model.ts)
  ord INTEGER NOT NULL DEFAULT 0,                  -- the order in the list
  private INTEGER NOT NULL DEFAULT 0 CHECK (private IN (0, 1)),
  created_by TEXT NOT NULL DEFAULT '',             -- the account's name when it was added
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS person_field_by_person ON person_field(person, ord);

-- Contacts, one field each. A web address is a website; a messenger handle is a social profile.
INSERT INTO person_field (id, person, type, label, value, ord, private, created_by, created_at, updated_by, updated_at)
SELECT 'contact-' || c.id, c.person,
  CASE c.kind WHEN 'web' THEN 'website' WHEN 'messenger' THEN 'social' WHEN 'phone' THEN 'phone' WHEN 'email' THEN 'email' WHEN 'address' THEN 'address' ELSE 'custom' END,
  CASE WHEN c.kind = 'messenger' THEN coalesce(c.label, 'Messenger') ELSE coalesce(c.label, '') END,
  CASE c.kind
    WHEN 'phone' THEN json_object('number', c.value)
    WHEN 'email' THEN json_object('address', c.value)
    WHEN 'address' THEN json_object('street', c.value)
    WHEN 'web' THEN json_object('url', c.value)
    WHEN 'messenger' THEN json_object('handle', c.value)
    ELSE json_object('text', c.value)
  END,
  row_number() OVER (PARTITION BY c.person ORDER BY c.id) - 1, 0,
  'migration', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'migration', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM contact c;

-- The old one-line "Likes & gift ideas" becomes a favourites field, after the contacts.
INSERT INTO person_field (id, person, type, label, value, ord, private, created_by, created_at, updated_by, updated_at)
SELECT 'favourite-' || p.id, p.id, 'favourites', '', json_object('text', p.favourite), 1000, 0,
  'migration', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'migration', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM person p
WHERE p.favourite IS NOT NULL AND trim(p.favourite) <> '';
