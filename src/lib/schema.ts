// Where the database schema lives now: ordered, versioned SQL migrations in migrations/, the same
// files on Node and on Cloudflare D1.
//
//   migrations/tree/NNNN_name.sql      every family's database (data/<id>.db; D1 binding TREE_<ID>)
//   migrations/accounts/NNNN_name.sql  the accounts database (data/accounts.db; D1 binding ACCOUNTS)
//
// On Node, src/lib/store/node.ts applies the pending ones when it opens a file (backing the file up
// first) and records them in the d1_migrations table, exactly as `wrangler d1 migrations apply` does
// on D1. A file made before migrations passes through 0001, which is the schema as it was then.
//
// To change the schema, add the next numbered file; never edit one that has shipped. It must run on
// both SQLite and D1: plain SQL, no PRAGMA, no BEGIN/COMMIT (each migration is its own transaction),
// and a column with NOT NULL needs a DEFAULT. Then apply it on Cloudflare with `mise run cf:migrate`
// (local) or `mise run cf:migrate:remote`.

/** The migration folders, by kind of database. */
export const MIGRATION_DIRS = { tree: 'migrations/tree', accounts: 'migrations/accounts' } as const;
