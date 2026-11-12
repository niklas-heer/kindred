-- Where each family made as a Durable Object lives (src/lib/store/cf.ts, docs/data-model.md "Where a family lives").
--
--   family_store   one row per family the Worker made in the FAMILIES Durable Object namespace (`store.ensureTree`), so
--                  `store.treeIds()` can list them: a Durable Object cannot be listed from inside a Worker. `driver` says
--                  which storage holds it ('durable-object'); `created_at` is when it was made (ISO 8601, UTC). A family in
--                  a bound D1 database (TREE_<ID>) or a Node file (data/<id>.db) has no row: its binding or its file lists
--                  it. Deleting the family deletes the row with the Durable Object's storage, and the `tree` column lets
--                  the deletion of a family find it like every other table of the accounts database.
-- Plain SQL, so D1, node:sqlite and a Durable Object all run it.
CREATE TABLE family_store (
  tree TEXT PRIMARY KEY,
  driver TEXT NOT NULL,
  created_at TEXT NOT NULL
);
