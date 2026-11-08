// The storage layer for server code: `store.tree(id)`, `store.accounts()`, `store.media` and the
// `Db` interface (./db.ts). `#store/driver` resolves to ./node.ts on Node and to ./cf.ts on Workers
// (package.json "imports", by the `workerd` condition), so node:sqlite never reaches the Worker.
import driver from '#store/driver';

export const store = driver;
export const onWorkers = driver.name === 'cloudflare';
export * from './db.ts';
