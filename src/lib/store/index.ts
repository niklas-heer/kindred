// The storage layer for server code: `store.tree(id)`, `store.accounts()`, `store.media` and the
// `Db` interface (./db.ts). `#store/driver` resolves to ./node.ts on Node and to ./cf.ts on Workers
// (package.json "imports", by the `workerd` condition), so node:sqlite never reaches the Worker.
//
// This is where every write is refused while nothing may be written (src/lib/read-only.ts): in a demo (KINDRED_DEMO=1,
// src/lib/demo.ts), and in a request of a steward's "View as" preview (src/lib/auth/view-as.server.ts). Each database handed
// out asks before every write (`run` and `batch` throw the refusal, and so do `get` and `all` for anything but a read, since a
// write with RETURNING goes through them; the reads work), and the media store neither stores nor deletes. The question is
// asked at the moment of the write, not when the database is handed out, because a preview belongs to one request and other
// requests write as usual. Every server function, server route and job reaches the data through here, so nothing needs to
// know about a demo or a preview to be safe in one.
// The driver object is changed in place rather than wrapped, so code (and tests) holding `store` keep holding the driver.
import driver from '#store/driver';
import { readOnlyRefusal } from '../read-only.ts';
import { isReadSql, type Db, type Driver } from './db.ts';

const guarded = new WeakMap<Db, Db>();
/** Throws the refusal when nothing may be written now (src/lib/read-only.ts). */
const check = () => {
  const refusal = readOnlyRefusal();
  if (refusal) throw refusal;
};
/**
 * The same database, asking before each write. Reads always pass: `all` and `get` with a SELECT (or a WITH that selects), and
 * `readBatch`, which refuses anything but a read itself. A write with RETURNING through `get` or `all` is refused like `run`.
 */
function guardedOf(d: Db): Db {
  let r = guarded.get(d);
  if (!r) {
    r = {
      all: async (sql, ...params) => { if (!isReadSql(sql)) check(); return d.all(sql, ...params); },
      get: async (sql, ...params) => { if (!isReadSql(sql)) check(); return d.get(sql, ...params); },
      readBatch: d.readBatch.bind(d),
      run: async (sql, ...params) => { check(); return d.run(sql, ...params); },
      batch: async (queries) => { check(); return d.batch(queries); },
    };
    guarded.set(d, r);
  }
  return r;
}

const g = globalThis as unknown as { __kindredDemoStore?: WeakSet<Driver> };
const patched = (g.__kindredDemoStore ??= new WeakSet());
if (!patched.has(driver)) {
  patched.add(driver);
  const { tree, ensureTree, accounts, dropTree } = driver;
  const { put, delete: remove, deleteTree } = driver.media;
  const refused = () => {
    const refusal = readOnlyRefusal();
    return refusal ? Promise.reject(refusal) : undefined;
  };
  driver.tree = (id) => guardedOf(tree.call(driver, id));
  // Making a family's database is a write.
  driver.ensureTree = (id) => {
    check();
    return guardedOf(ensureTree.call(driver, id));
  };
  driver.accounts = () => guardedOf(accounts.call(driver));
  driver.media.put = (...args) => refused() ?? put.apply(driver.media, args);
  driver.media.delete = (...args) => refused() ?? remove.apply(driver.media, args);
  driver.media.deleteTree = (...args) => refused() ?? deleteTree.apply(driver.media, args);
  driver.dropTree = (...args) => refused() ?? dropTree.apply(driver, args);
}

export const store = driver;
export const onWorkers = driver.name === 'cloudflare';
export * from './db.ts';
