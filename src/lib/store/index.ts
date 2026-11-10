// The storage layer for server code: `store.tree(id)`, `store.accounts()`, `store.media` and the
// `Db` interface (./db.ts). `#store/driver` resolves to ./node.ts on Node and to ./cf.ts on Workers
// (package.json "imports", by the `workerd` condition), so node:sqlite never reaches the Worker.
//
// In a demo (KINDRED_DEMO=1, src/lib/demo.ts) this is where every write is refused: each database handed out is read-only
// (`run` and `batch` throw the demo's refusal, the reads work) and the media store neither stores nor deletes. Every server
// function, server route and job reaches the data through here, so nothing needs to know it runs in a demo to be safe in one.
// The driver object is changed in place rather than wrapped, so code (and tests) holding `store` keep holding the driver.
import driver from '#store/driver';
import { demoRefused, isDemo } from '../demo.ts';
import type { Db, Driver } from './db.ts';

const readOnly = new WeakMap<Db, Db>();
/** The same database with its writes refused. Reads (`all`, `get`, `readBatch`, which refuses anything but a read) pass. */
function readOnlyOf(d: Db): Db {
  let r = readOnly.get(d);
  if (!r) {
    const refuse = async (): Promise<never> => { throw demoRefused(); };
    r = { all: d.all.bind(d), get: d.get.bind(d), readBatch: d.readBatch.bind(d), run: refuse, batch: refuse };
    readOnly.set(d, r);
  }
  return r;
}

const g = globalThis as unknown as { __kindredDemoStore?: WeakSet<Driver> };
const patched = (g.__kindredDemoStore ??= new WeakSet());
if (!patched.has(driver)) {
  patched.add(driver);
  const { tree, ensureTree, accounts, dropTree } = driver;
  const { put, delete: remove, deleteTree } = driver.media;
  driver.tree = (id) => (isDemo() ? readOnlyOf(tree.call(driver, id)) : tree.call(driver, id));
  // Making a family's database is a write.
  driver.ensureTree = (id) => {
    if (isDemo()) throw demoRefused();
    return ensureTree.call(driver, id);
  };
  driver.accounts = () => (isDemo() ? readOnlyOf(accounts.call(driver)) : accounts.call(driver));
  driver.media.put = (...args) => (isDemo() ? Promise.reject(demoRefused()) : put.apply(driver.media, args));
  driver.media.delete = (...args) => (isDemo() ? Promise.reject(demoRefused()) : remove.apply(driver.media, args));
  driver.media.deleteTree = (...args) => (isDemo() ? Promise.reject(demoRefused()) : deleteTree.apply(driver.media, args));
  driver.dropTree = (...args) => (isDemo() ? Promise.reject(demoRefused()) : dropTree.apply(driver, args));
}

export const store = driver;
export const onWorkers = driver.name === 'cloudflare';
export * from './db.ts';
