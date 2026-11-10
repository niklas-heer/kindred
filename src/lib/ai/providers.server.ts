// A family's connected AI providers and the routes that say which provider and model each job uses. One key per provider,
// in ai_provider, sealed for that provider (secret.server.ts); one row per job in ai_route (migration 0010).
//
// The rule that keeps keys safe: `keyFor(tree, provider)` is the only place a provider's key is opened, and it opens the key
// of the provider it is asked for, nothing else. A route never falls back to another provider: when its provider is not
// connected, the route is `needs-provider` and nothing is sent.
import { accounts } from '../auth/store.server';
import { q } from '../store/index.ts';
import { AiError, chatModelId, searchesOnItsOwn } from './adapters';
import { keyTail, openKey, sealKey } from './secret.server';
import { DEFAULT_MODEL, PAINT_PROVIDERS, PROVIDERS, ROUTES, followsAssistant, type Provider, type ProviderState, type Route } from './types';

const MODEL = /^[A-Za-z0-9._:/-]{1,120}$/;
export const validModel = (m: string) => m === '' || MODEL.test(m);

export interface ConnRow { provider: string; key_sealed: string; key_tail: string; updated: number }
export interface RouteDbRow { route: string; provider: string | null; model: string }

/** A route as stored (`provider` null: the assistant's), and where it goes once "same as the assistant" is applied. */
export interface ResolvedRoute {
  route: Route;
  provider: Provider | null;
  model: string;
  effective: { provider: Provider; model: string } | null;
  /** The effective provider has a readable key saved. */
  connected: boolean;
  /** Painting has no default model: a portrait route needs one picked. */
  needsModel: boolean;
}

const isProvider = (p: string | null): p is Provider => !!p && (PROVIDERS as readonly string[]).includes(p);

/** The reads `resolveRoutes` makes, for a caller that batches them with its own (see `statusFor`). */
export const connectionsQuery = (tree: string) => q('SELECT provider, key_sealed, key_tail, updated FROM ai_provider WHERE tree = ?', tree);
export const routesQuery = (tree: string) => q('SELECT route, provider, model FROM ai_route WHERE tree = ?', tree);

async function connectionRows(tree: string): Promise<ConnRow[]> {
  const c = connectionsQuery(tree);
  return accounts().all<ConnRow>(c.sql, ...c.params);
}

/** Every provider, with whether a key is saved and can be opened. Never the key itself. */
export async function providerStates(tree: string, connections?: ConnRow[]): Promise<ProviderState[]> {
  const rows = new Map((connections ?? (await connectionRows(tree))).filter((r) => isProvider(r.provider)).map((r) => [r.provider as Provider, r]));
  const out: ProviderState[] = [];
  for (const provider of PROVIDERS) {
    const r = rows.get(provider);
    if (!r) {
      out.push({ provider, keyState: 'none', keyTail: null, updated: 0 });
      continue;
    }
    let readable = true;
    try {
      await openKey(tree, provider, r.key_sealed);
    } catch {
      readable = false;
    }
    out.push({ provider, keyState: readable ? 'saved' : 'unreadable', keyTail: readable ? r.key_tail : null, updated: r.updated });
  }
  return out;
}

/** The providers whose key is saved and readable. */
export async function connectedProviders(tree: string, connections?: ConnRow[]): Promise<Set<Provider>> {
  return new Set((await providerStates(tree, connections)).filter((p) => p.keyState === 'saved').map((p) => p.provider));
}

/**
 * The key of one provider, for one call. Throws not-configured when that provider is not connected, and key-unreadable when
 * the key cannot be opened. The key is never returned for any other provider.
 */
export async function keyFor(tree: string, provider: Provider): Promise<string> {
  const r = await accounts().get<ConnRow>('SELECT provider, key_sealed, key_tail, updated FROM ai_provider WHERE tree = ? AND provider = ?', tree, provider);
  if (!r) throw new AiError('not-configured', 'ai.err_provider_not_connected');
  return openKey(tree, provider, r.key_sealed);
}

/** Saves a provider's key (replacing the saved one). The typed key is sealed for that provider and never returned. */
export async function saveProviderKey(tree: string, by: string | null, provider: Provider, apiKey: string): Promise<void> {
  const key = apiKey.trim();
  if (!key) throw new AiError('bad-input', 'ai.err_key_shape');
  const sealed = await sealKey(tree, provider, key);
  await accounts().run(
    `INSERT INTO ai_provider (tree, provider, key_sealed, key_tail, updated, updated_by) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (tree, provider) DO UPDATE SET key_sealed = excluded.key_sealed, key_tail = excluded.key_tail,
       updated = excluded.updated, updated_by = excluded.updated_by`,
    tree, provider, sealed, keyTail(key), Date.now(), by ?? '',
  );
}

/**
 * Disconnects a provider: its key is deleted. Its routes stay as the steward set them, and they report needs-provider until
 * it is connected again. Nothing is rerouted to another provider.
 */
export async function removeProvider(tree: string, provider: Provider): Promise<void> {
  await accounts().run('DELETE FROM ai_provider WHERE tree = ? AND provider = ?', tree, provider);
}

/** The stored routes, by route. A route with no row follows the assistant. */
async function storedRoutes(tree: string, given?: RouteDbRow[]): Promise<Map<Route, { provider: Provider | null; model: string }>> {
  const r = routesQuery(tree);
  const rows = given ?? (await accounts().all<RouteDbRow>(r.sql, ...r.params));
  return new Map(rows.map((r) => [r.route as Route, { provider: isProvider(r.provider) ? r.provider : null, model: r.model }]));
}

/** Where every route goes now. Reads only. `rows` are the two reads already made (`routesQuery`, `connectionsQuery`), if they were. */
export async function resolveRoutes(tree: string, rows?: { routes: RouteDbRow[]; connections: ConnRow[] }): Promise<Record<Route, ResolvedRoute>> {
  const [stored, connected] = await Promise.all([storedRoutes(tree, rows?.routes), connectedProviders(tree, rows?.connections)]);
  const own = (r: Route) => stored.get(r) ?? { provider: null, model: '' };
  const a = own('assistant');
  const assistant = a.provider ? { provider: a.provider, model: a.model || DEFAULT_MODEL[a.provider] } : null;
  const out = {} as Record<Route, ResolvedRoute>;
  for (const route of ROUTES) {
    const s = own(route);
    let effective: ResolvedRoute['effective'] = null;
    if (route === 'assistant') effective = assistant;
    else if (s.provider) effective = { provider: s.provider, model: s.model || (route === 'portrait' ? '' : DEFAULT_MODEL[s.provider]) };
    else if (followsAssistant(route)) effective = assistant;
    out[route] = {
      route,
      provider: s.provider,
      model: s.model,
      effective,
      connected: !!effective && connected.has(effective.provider),
      needsModel: route === 'portrait' && !!effective && effective.model === '',
    };
  }
  return out;
}

/** One route, resolved. */
export async function resolveRoute(tree: string, route: Route): Promise<ResolvedRoute> {
  return (await resolveRoutes(tree))[route];
}

export interface RouteInput {
  route: Route;
  /** Null: the same as the assistant (only for routes that follow it). */
  provider: Provider | null;
  model: string;
}

/**
 * Saves the routes the steward chose. A route is refused when its model is not a plausible id, when it names a model that
 * searches the web by itself, or when it names a provider that is not connected (only checked for a route that changed:
 * a route left as it was is not re-judged). A portrait route may only name a provider that paints.
 */
/**
 * Whether a route would have a connected provider once `inputs` are saved. A switch turned on in the same save is checked
 * against this before anything is written. Reads only.
 */
export async function projectedConnected(tree: string, route: Route, inputs: RouteInput[]): Promise<boolean> {
  const stored = await storedRoutes(tree);
  const connected = await connectedProviders(tree);
  const pick = (r: Route): { provider: Provider | null } => {
    const i = inputs.find((x) => x.route === r);
    return i ? { provider: i.provider } : (stored.get(r) ?? { provider: null });
  };
  const own = pick(route);
  const provider = route === 'assistant' || !followsAssistant(route) ? own.provider : (own.provider ?? pick('assistant').provider);
  return !!provider && connected.has(provider);
}

export async function saveRoutes(tree: string, inputs: RouteInput[]): Promise<void> {
  const before = await storedRoutes(tree);
  const connected = await connectedProviders(tree);
  const assistantIn = inputs.find((i) => i.route === 'assistant');
  const assistantProvider = assistantIn ? assistantIn.provider : (before.get('assistant')?.provider ?? null);
  for (const i of inputs) {
    if (!(ROUTES as readonly string[]).includes(i.route)) throw new AiError('bad-input', 'ai.err_route');
    if (i.provider === null && !followsAssistant(i.route)) throw new AiError('bad-input', 'ai.err_route');
    if (i.provider !== null && !isProvider(i.provider)) throw new AiError('bad-input', 'ai.err_route');
    if (i.route === 'portrait' && i.provider !== null && !(PAINT_PROVIDERS as readonly string[]).includes(i.provider)) throw new AiError('bad-input', 'paint.err_provider_cannot_paint');
    if (i.provider === null && i.model !== '') throw new AiError('bad-input', 'ai.err_route');
    const model = i.provider ? chatModelId(i.provider, i.model.trim()) : '';
    if (!validModel(model)) throw new AiError('bad-input', 'ai.err_model_chars');
    const effective = i.provider ?? assistantProvider;
    if (effective && model && searchesOnItsOwn(effective, model)) throw new AiError('bad-input', 'ai.err_model_search');
    const prev = before.get(i.route);
    const changed = !prev || prev.provider !== i.provider || prev.model !== model;
    if (changed && i.provider && !connected.has(i.provider)) throw new AiError('not-configured', 'ai.err_provider_not_connected');
  }
  const now = Date.now();
  for (const i of inputs) {
    const model = i.provider ? chatModelId(i.provider, i.model.trim()) : '';
    await accounts().run(
      `INSERT INTO ai_route (tree, route, provider, model, updated) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (tree, route) DO UPDATE SET provider = excluded.provider, model = excluded.model, updated = excluded.updated`,
      tree, i.route, i.provider, model, now,
    );
  }
}
