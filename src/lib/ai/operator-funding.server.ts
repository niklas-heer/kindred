// Operator-funded AI (docs/ai.md, "Operator-funded AI"; policy `ai.source`): the operator's own provider keys, and the
// booking of every call against two monthly limits of the operator's money: the family's budget from the operator and the
// server-wide ceiling. It is never on by itself: a family's calls go to the operator's key only when the operator offers it
// (`operator` or `either`) and the family's steward opted in, since the provider then works for the operator.
//
// The booking follows the family budget's rules (settings.server.ts) with two differences. The reservation goes against both
// limits in one atomic batch: two guards and the updates, so two calls racing for the last of either limit cannot both get
// it. And the settlement is idempotent: each reservation has a row (`ai_operator_booking`), and settling it twice changes
// nothing the second time. A booking that is never settled (the server stopped mid-call) keeps its reservation.
//
// The reservation is the most a call books, so the two limits hold whatever the provider bills. A family's own budget may
// estimate; the operator's money may not. So an operator-funded call reserves a strict upper bound: its reply's cap (sent to
// the provider as the call's max_tokens) and its input bounded by its bytes (a tokenizer makes at most one token of a byte,
// plus a little for each message's framing). What cannot be bounded before it is sent is refused: a web search (the pages it
// reads in are input nobody can count beforehand, and a search is billed per use) and an image (each provider counts an
// image's tokens its own way). The settlement books at most the reservation; anything the provider billed above it is kept
// in `ai_operator_overage` for the operator's Health tab, and logged.
//
// The per-family spend is kept by the family's id in `ai_operator_family_month` (migration 0049), which a deleted family does
// not take with it: a family deleted and made again under the same id within the month does not start again at 0.
import { AiError, makeAdapter, outputCap, type AiAdapter, type AiRequest } from './adapters';
import { fakeAdapter } from './fake';
import { tr, type Tr } from './labels';
import { openRouterListed } from './models.server';
import { costMicros, tablePrice, type Price } from './prices';
import { keyTail, openKey, sealKey } from './secret.server';
import { failureMicros, fakeOn, monthNow, replyMicros, SINGLE_CALL_SHARE, TINY_BUDGET_MICROS } from './settings.server';
import type { AiLocale, Provider } from './types';
import { audit } from '../operator/settings.server.ts';
import { OPERATOR_SEAL } from '../operator/policy.server.ts';
import { AI_PROVIDERS, type FamilyAi, type OperatorKeyState } from '../operator/policy.ts';
import { guard, isGuardError, q, store } from '../store/index.ts';
import type { UserRow } from '../auth/store.server.ts';

const accounts = () => store.accounts();

// ---------- the operator's keys ----------

interface KeyRow { provider: string; key_sealed: string; key_tail: string }

/** Each provider's key state for the console: never the key. */
export async function operatorKeyStates(): Promise<OperatorKeyState[]> {
  const rows = await accounts().all<KeyRow>('SELECT provider, key_sealed, key_tail FROM operator_ai_provider');
  return Promise.all(AI_PROVIDERS.map(async (provider) => {
    const r = rows.find((x) => x.provider === provider);
    if (!r) return { provider, saved: false, keyTail: null, readable: false };
    const readable = await openKey(OPERATOR_SEAL, provider, r.key_sealed).then(() => true, () => false);
    return { provider, saved: true, keyTail: readable ? r.key_tail : null, readable };
  }));
}

export async function saveOperatorKey(op: UserRow, provider: Provider, apiKey: string, now = Date.now()): Promise<void> {
  const key = apiKey.trim();
  if (!key) throw new AiError('bad-input', 'ai.err_key_shape');
  const sealed = await sealKey(OPERATOR_SEAL, provider, key);
  await accounts().batch([
    q(`INSERT INTO operator_ai_provider (provider, key_sealed, key_tail, updated, updated_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (provider) DO UPDATE SET key_sealed = excluded.key_sealed, key_tail = excluded.key_tail, updated = excluded.updated, updated_by = excluded.updated_by`,
      provider, sealed, keyTail(key), now, op.id),
    audit({ id: op.id, name: op.name }, 'ai.operator_key', null, { provider }, now),
  ]);
}

/** Removes a key: families funded by it wait (their calls are refused) until the operator connects one again. */
export async function removeOperatorKey(op: UserRow, provider: Provider): Promise<void> {
  await accounts().batch([
    q('DELETE FROM operator_ai_provider WHERE provider = ?', provider),
    audit({ id: op.id, name: op.name }, 'ai.operator_key_removed', null, { provider }),
  ]);
}

/** The operator's key for one provider, for one call; never returned to anyone. */
export async function operatorKey(provider: Provider): Promise<string> {
  const r = await accounts().get<KeyRow>('SELECT provider, key_sealed, key_tail FROM operator_ai_provider WHERE provider = ?', provider);
  if (!r) throw new AiError('not-configured', 'ai.err_provider_not_connected');
  return openKey(OPERATOR_SEAL, provider, r.key_sealed);
}

// ---------- prices ----------

/**
 * The price operator-funded calls of a model are booked at: the table's, or OpenRouter's list. A family's own prices never
 * count (a family could otherwise price the operator's model at nothing), and a model with no known price is refused (null).
 */
export async function operatorPrice(provider: Provider, model: string): Promise<{ price: Price; reasoning?: boolean } | null> {
  const table = tablePrice(provider, model);
  if (table) return { price: table };
  if (provider !== 'openrouter' || fakeOn()) return null;
  const listed = await openRouterListed(model);
  return listed?.price ? { price: listed.price, reasoning: listed.reasoning } : null;
}

export const priceKnown = async (provider: Provider, model: string) => (await operatorPrice(provider, model)) !== null;

// ---------- the booking ----------

export interface OperatorBooking { id: string; tree: string; month: string; amount: number }
export interface OperatorLimits { familyMicros: number; ceilingMicros: number }

/** Books `amount` against the family's operator budget and the server's ceiling at once, or throws `budget`. */
export async function reserveOperator(tree: string, amount: number, limits: OperatorLimits, c: Tr, now = new Date()): Promise<OperatorBooking> {
  const month = monthNow(now);
  const id = crypto.randomUUID();
  try {
    await accounts().batch([
      q('INSERT INTO ai_operator_family_month (family, month, micros) VALUES (?, ?, 0) ON CONFLICT (family, month) DO NOTHING', tree, month),
      q('INSERT INTO ai_operator_month (month, micros) VALUES (?, 0) ON CONFLICT (month) DO NOTHING', month),
      guard('(SELECT micros FROM ai_operator_family_month WHERE family = ? AND month = ?) + ? <= ?', tree, month, amount, limits.familyMicros),
      guard('(SELECT micros FROM ai_operator_month WHERE month = ?) + ? <= ?', month, amount, limits.ceilingMicros),
      q('UPDATE ai_operator_family_month SET micros = micros + ? WHERE family = ? AND month = ?', amount, tree, month),
      q('UPDATE ai_operator_month SET micros = micros + ? WHERE month = ?', amount, month),
      q('INSERT INTO ai_operator_booking (id, tree, month, amount, created) VALUES (?, ?, ?, ?, ?)', id, tree, month, amount, now.getTime()),
    ]);
  } catch (e) {
    if (isGuardError(e)) throw new AiError('budget', c('policy.err.operator_budget'));
    throw e;
  }
  return { id, tree, month, amount };
}

/** Settled bookings are kept this long, so a late second settlement still finds its row and does nothing. */
const SETTLED_KEPT_MS = 2 * 86_400_000;

/**
 * Replaces a reservation with what the call cost, once: settling the same booking again changes nothing. It books at most the
 * reservation, so neither limit is passed; what the provider billed above it is kept as an overage for the operator.
 */
export async function settleOperator(b: OperatorBooking, actual: number, now = Date.now()): Promise<boolean> {
  const billed = Math.max(0, Math.round(actual));
  const cost = Math.min(billed, b.amount);
  const over = billed - cost;
  try {
    await accounts().batch([
      guard('EXISTS (SELECT 1 FROM ai_operator_booking WHERE id = ? AND settled_at IS NULL)', b.id),
      q('UPDATE ai_operator_family_month SET micros = MAX(0, micros - ? + ?) WHERE family = ? AND month = ?', b.amount, cost, b.tree, b.month),
      q('UPDATE ai_operator_month SET micros = MAX(0, micros - ? + ?) WHERE month = ?', b.amount, cost, b.month),
      q('UPDATE ai_operator_booking SET settled_at = ? WHERE id = ?', now, b.id),
      q('DELETE FROM ai_operator_booking WHERE settled_at IS NOT NULL AND settled_at < ?', now - SETTLED_KEPT_MS),
      ...(over > 0 ? [q('INSERT INTO ai_operator_overage (id, family, month, micros, at) VALUES (?, ?, ?, ?, ?)', b.id, b.tree, b.month, over, now)] : []),
    ]);
    if (over > 0) console.warn(`[kindred] operator-funded AI: a call billed ${over} micro-dollars above its reservation (family ${b.tree}); booked at the reservation`);
    return true;
  } catch (e) {
    if (isGuardError(e)) return false;
    throw e;
  }
}

/** Micro-dollars of the operator's money a family has booked this UTC month, and all families together. */
export async function operatorSpent(tree?: string): Promise<{ family: number; total: number }> {
  const month = monthNow();
  const [fam, all] = (await accounts().readBatch([
    q('SELECT micros FROM ai_operator_family_month WHERE family = ? AND month = ?', tree ?? '', month),
    q('SELECT micros FROM ai_operator_month WHERE month = ?', month),
  ])) as unknown as [{ micros: number }[], { micros: number }[]];
  return { family: fam[0]?.micros ?? 0, total: all[0]?.micros ?? 0 };
}

/** Tokens each message's framing (its role and separators) may add, and the request's own, beyond the bytes of its content. */
const FRAME_TOKENS_PER_MESSAGE = 16;
const FRAME_TOKENS = 512;

/**
 * The most input tokens a request can be, before it is sent: one per byte of everything it sends as text (the system prompt,
 * the messages, the tools' definitions, the answer's schema), plus the framing. No tokenizer makes more than one token of a
 * byte. A request with an image or a web search has no such bound and is refused before this (operatorBudgeted).
 */
export function inputBound(req: Pick<AiRequest, 'system' | 'messages' | 'tools' | 'json'>): number {
  const text = JSON.stringify({ system: req.system, messages: req.messages, tools: req.tools, json: req.json });
  return new TextEncoder().encode(text).length + FRAME_TOKENS + FRAME_TOKENS_PER_MESSAGE * (req.messages.length + (req.tools?.length ?? 0));
}

/** Whether a request's cost can be bounded before it is sent: no web search, no image. */
const unbounded = (req: AiRequest) => !!req.webSearch || req.messages.some((m) => m.role === 'user' && (m.images?.length ?? 0) > 0);

/**
 * The adapter with every call booked against the operator's limits first, and settled after (as `budgeted` does for a family).
 * The reservation is a strict upper bound (see the top of this file), and the settlement books at most it.
 */
export function operatorBudgeted(tree: string, adapter: AiAdapter, price: Price, limits: OperatorLimits, c: Tr): AiAdapter {
  return {
    provider: adapter.provider,
    model: adapter.model,
    reasoning: adapter.reasoning,
    async complete(request) {
      if (request.signal?.aborted && (request.signal.reason as Error | undefined)?.name !== 'TimeoutError') throw new AiError('aborted', 'ai.stopped');
      if (unbounded(request)) throw new AiError('bad-input', c('policy.err.operator_unbounded'));
      const cap = outputCap(adapter.provider, adapter.model, request.maxTokens, adapter.reasoning);
      // The cap the reservation counts is the one sent: the provider stops the reply there.
      const req = { ...request, maxTokens: cap };
      const reserve = costMicros({ inputTokens: inputBound(req), outputTokens: cap, searches: 0 }, price);
      if (limits.familyMicros >= TINY_BUDGET_MICROS && reserve > limits.familyMicros * SINGLE_CALL_SHARE) throw new AiError('budget', c('ai.errBudgetShare'));
      const booked = await reserveOperator(tree, reserve, limits, c);
      let actual = booked.amount;
      try {
        const reply = await adapter.complete(req);
        actual = reply.usageUnknown ? booked.amount : replyMicros(reply, price);
        return reply;
      } catch (e) {
        // A failure keeps what it may have billed: at most the reservation, which settleOperator holds to.
        actual = e instanceof AiError && e.billed ? replyMicros(e.billed, price) + (e.inFlight ? booked.amount : 0) : failureMicros(e, booked.amount);
        throw e;
      } finally {
        await settleOperator(booked, actual);
      }
    },
  };
}

/** The raw adapter for an operator-funded family: the operator's provider, model and key, booked against the operator's limits. */
export async function operatorAdapter(tree: string, ai: FamilyAi, locale: AiLocale): Promise<{ inner: AiAdapter; price: Price; provider: Provider; model: string }> {
  const c = tr(locale);
  const provider = ai.provider;
  const model = ai.model;
  if (!provider || !model) throw new AiError('not-configured', c('policy.err.ai_off'));
  const priced = await operatorPrice(provider, model);
  if (!priced) throw new AiError('not-configured', c('policy.err.no_price'));
  const key = await operatorKey(provider);
  const raw = fakeOn() ? fakeAdapter(model) : makeAdapter(provider, key, model, { reasoning: priced.reasoning });
  return { inner: operatorBudgeted(tree, raw, priced.price, { familyMicros: ai.familyMicros, ceilingMicros: ai.ceilingMicros }, c), price: priced.price, provider, model };
}

// ---------- the steward's choice ----------

/**
 * The steward opts in to the operator's AI (`operator`), or back to the family's own keys (`own`). Opting in is refused
 * unless the operator offers it to this family; opting out is always allowed. The family's own keys and routes stay.
 */
export async function setFunding(tree: string, by: string, funding: 'own' | 'operator'): Promise<void> {
  if (funding === 'operator') {
    const { effective } = await import('../operator/policy.server.ts');
    const ai = await effective(tree, 'ai.source');
    if (ai.value.offered !== 'operator' && ai.value.offered !== 'either') throw new AiError('bad-input', 'policy.err.not_offered');
  }
  await accounts().run(
    `INSERT INTO ai_settings (tree, funding, updated, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(tree) DO UPDATE SET funding = excluded.funding, updated = excluded.updated, updated_by = excluded.updated_by`,
    tree, funding, Date.now(), by,
  );
}
