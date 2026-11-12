// Who this server passes personal data to (its subprocessors, GDPR Art. 28(2) and (4)), derived from how it is configured, so the
// legal page and the Art. 30 record (record.server.ts) never list a service the server does not use or miss one it does
// (docs/gdpr.md). Each entry names the service, what it does here, where it processes and its own privacy page; the operator's
// privacy policy says the rest. Nothing here contacts a service.
import { addressLookupOn } from '../address-lookup.server.ts';
import { vapidFrom } from '../reminders.server.ts';
import { store, onWorkers } from '../store/index.ts';
import { turnstileKeys } from '../operator/settings.server.ts';
import type { Subprocessor } from '../operator/shared.ts';

type Read = (name: string) => string | undefined;
const fromEnv: Read = (name) => {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};

const AI: Record<string, Subprocessor> = {
  anthropic: { id: 'anthropic', name: 'Anthropic PBC', purpose: 'ai', where: 'US', url: 'https://www.anthropic.com/legal/privacy' },
  openai: { id: 'openai', name: 'OpenAI', purpose: 'ai', where: 'US', url: 'https://openai.com/policies/privacy-policy' },
  openrouter: { id: 'openrouter', name: 'OpenRouter', purpose: 'ai', where: 'US', url: 'https://openrouter.ai/privacy' },
};

/** What the configuration says, gathered once so the list can be tested without a server. */
export interface Configuration {
  workers: boolean;
  /** AI providers some family or the operator (operator-funded AI, or a key in the environment) has a key for. */
  aiProviders: string[];
  addressLookup: boolean;
  /** At least one family's nightly archive to GitHub is set up (KINDRED_ARCHIVE_<ID>_REPO and _TOKEN). */
  githubArchive: boolean;
  push: boolean;
  turnstile: boolean;
}

/**
 * Reads the configuration: the environment, and which AI providers have a key here: a family's own (accounts `ai_provider`) or
 * the operator's for operator-funded AI (`operator_ai_provider`).
 */
export async function configuration(read: Read = fromEnv, env: Record<string, string | undefined> = process.env): Promise<Configuration> {
  const providers = await store.accounts().all<{ provider: string }>(
    'SELECT provider FROM ai_provider UNION SELECT provider FROM operator_ai_provider ORDER BY provider').catch(() =>
    store.accounts().all<{ provider: string }>('SELECT DISTINCT provider FROM ai_provider ORDER BY provider').catch(() => []));
  const operatorKeys = ['anthropic', 'openai', 'openrouter'].filter((p) => read(`KINDRED_${p.toUpperCase()}_API_KEY`) || read(`KINDRED_AI_${p.toUpperCase()}_KEY`));
  return {
    workers: onWorkers,
    aiProviders: [...new Set([...providers.map((p) => p.provider), ...operatorKeys])].filter((p) => p in AI).sort(),
    addressLookup: addressLookupOn(env),
    githubArchive: Object.keys(env).some((k) => /^KINDRED_ARCHIVE_[A-Z0-9_]+_REPO$/.test(k) && !!read(k) && !!read(k.replace(/_REPO$/, '_TOKEN'))),
    push: !!vapidFrom(read),
    turnstile: !!turnstileKeys(env),
  };
}

/** The subprocessors a configuration implies, in a stable order. */
export function subprocessorsOf(c: Configuration): Subprocessor[] {
  const out: Subprocessor[] = [];
  const cloudflare = 'https://www.cloudflare.com/cloudflare-customer-dpa/';
  if (c.workers) {
    out.push({ id: 'cloudflare', name: 'Cloudflare, Inc.', purpose: 'hosting', where: 'global', url: cloudflare });
    out.push({ id: 'cloudflare-storage', name: 'Cloudflare, Inc. (D1, R2, Durable Objects)', purpose: 'storage', where: 'global', url: cloudflare });
  }
  if (c.turnstile) out.push({ id: 'turnstile', name: 'Cloudflare Turnstile', purpose: 'turnstile', where: 'global', url: 'https://www.cloudflare.com/turnstile-privacy-policy/' });
  for (const p of c.aiProviders) out.push(AI[p]!);
  if (c.addressLookup) out.push({ id: 'photon', name: 'komoot GmbH (Photon)', purpose: 'address', where: 'DE', url: 'https://www.komoot.com/privacy' });
  if (c.githubArchive) out.push({ id: 'github', name: 'GitHub, Inc.', purpose: 'archive', where: 'US', url: 'https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement' });
  if (c.push) out.push({ id: 'push', name: 'Web Push services of the browsers (Google, Mozilla, Apple, Microsoft)', purpose: 'push', where: 'global', url: 'https://developer.mozilla.org/docs/Web/API/Push_API' });
  return out;
}

/** This server's subprocessors, as the legal page lists them. */
export async function subprocessors(): Promise<Subprocessor[]> {
  return subprocessorsOf(await configuration());
}
