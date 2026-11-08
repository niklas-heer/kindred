// The Cloudflare driver: D1 for the families and the accounts, R2 for media. Bindings (wrangler.jsonc):
//   ACCOUNTS       D1, the accounts database (migrations/accounts)
//   TREE_<ID>      D1, one database per family (migrations/tree); TREE_FAMILY serves /family,
//                  TREE_MY_FAMILY serves /my-family
//   MEDIA          R2, uploaded files under <tree>/<key>
//   GAZETTEER      D1, optional: the GeoNames towns for assisted place entry, read-only (migrations/gazetteer,
//                  loaded by `mise run cf:gazetteer`). Without it the place picker offers the family's own places.
import { env } from 'cloudflare:workers';
import { checkMediaKey, NOT_TREES, TREE_ID, type Db, type Driver, type Param, type Query, type Result } from './db.ts';

const isD1 = (v: unknown): v is D1Database => !!v && typeof (v as D1Database).prepare === 'function' && typeof (v as D1Database).batch === 'function';

/** The binding that holds a tree: `my-family` → TREE_MY_FAMILY. */
export const treeBinding = (tree: string) => `TREE_${tree.toUpperCase().replace(/-/g, '_')}`;

function wrap(d1: D1Database): Db {
  const stmt = (sql: string, params: Param[]) => d1.prepare(sql).bind(...params);
  const result = (r: D1Result): Result => ({ rows: r.results ?? [], changes: r.meta?.changes ?? 0, lastRowId: r.meta?.last_row_id ?? 0 });
  return {
    async all<R>(sql: string, ...params: Param[]) {
      return (await stmt(sql, params).all<R>()).results;
    },
    async get<R>(sql: string, ...params: Param[]) {
      return (await stmt(sql, params).first<R>()) ?? undefined;
    },
    async run(sql: string, ...params: Param[]) {
      return result(await stmt(sql, params).run());
    },
    async batch(queries: Query[]) {
      if (!queries.length) return [];
      return (await d1.batch(queries.map((x) => stmt(x.sql, x.params)))).map(result);
    },
  };
}

const wrapped = new WeakMap<D1Database, Db>();
const db = (d1: D1Database) => {
  let w = wrapped.get(d1);
  if (!w) wrapped.set(d1, (w = wrap(d1)));
  return w;
};

const bucket = () => {
  const b = env.MEDIA as R2Bucket | undefined;
  if (!b) throw new Error('No MEDIA bucket is bound; see wrangler.jsonc');
  return b;
};

const driver: Driver = {
  name: 'cloudflare',

  tree(id) {
    if (!TREE_ID.test(id) || NOT_TREES.has(id)) throw new Error(`bad tree id ${id}`);
    const d1 = env[treeBinding(id)];
    if (!isD1(d1)) throw new Error(`no tree ${id}; bind a D1 database as ${treeBinding(id)}`);
    return db(d1);
  },

  // The binding must already exist (docs/deploy-cloudflare.md, step 2): nothing can be created here.
  ensureTree(id) {
    return driver.tree(id);
  },

  treeIds() {
    return Object.keys(env)
      .filter((k) => /^TREE_[A-Z0-9_]+$/.test(k) && isD1(env[k]))
      .map((k) => k.slice(5).toLowerCase().replace(/_/g, '-'))
      .filter((id) => TREE_ID.test(id) && !NOT_TREES.has(id));
  },

  accounts() {
    const d1 = env.ACCOUNTS;
    if (!isD1(d1)) throw new Error('No ACCOUNTS database is bound; see wrangler.jsonc');
    return db(d1);
  },

  // Read-only: the gazetteer is only ever searched. A write through it is refused, never sent to D1.
  gazetteer() {
    const g = env.GAZETTEER;
    if (!isD1(g)) return null;
    const d = db(g);
    const refuse = async (): Promise<never> => {
      throw new Error('The gazetteer is read-only');
    };
    return { all: d.all.bind(d), get: d.get.bind(d), run: refuse, batch: refuse };
  },

  secret() {
    const s = (env as Record<string, unknown>).KINDRED_SECRET;
    if (typeof s !== 'string' || !s.trim()) throw new Error('KINDRED_SECRET is not set. Add it as a Worker secret.');
    return s.trim();
  },

  media: {
    async put(tree, key, bytes, mime) {
      checkMediaKey(tree, key);
      await bucket().put(`${tree}/${key}`, bytes, { httpMetadata: { contentType: mime } });
    },
    async get(tree, key) {
      checkMediaKey(tree, key);
      const o = await bucket().get(`${tree}/${key}`);
      return o ? { body: o.body, size: o.size, mime: o.httpMetadata?.contentType } : undefined;
    },
    async delete(tree, key) {
      checkMediaKey(tree, key);
      await bucket().delete(`${tree}/${key}`);
    },
  },
};

export default driver;
