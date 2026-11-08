// The decision behind "Translate": the vocabulary first, then the translation kept in the tree, and only then a
// model. Pure on purpose: the store and the model are passed in, so the rule is tested without either. The
// server wiring is in occupations.server.ts.
import { cutText } from './ai/trim.ts';
import { z } from 'zod';
import type { Locale } from './i18n/types.ts';
import { occupationForText, occupationLabel } from './occupations.ts';

export interface Translation { label: string; code: string | null; from: 'vocabulary' | 'cache' | 'model' }

export interface TranslationStore {
  get(text: string, locale: Locale): Promise<string | undefined>;
  put(text: string, locale: Locale, label: string): Promise<void>;
}

const REPLY = z.object({ label: z.string().trim().overwrite(cutText(80)).min(1) });

/**
 * The answer for one free-text occupation. `ask` is called only when neither the vocabulary nor the cache knows
 * the text, and returns the model's JSON reply (or throws, when the AI is off). Undefined when the reply is not
 * the shape asked for, so the caller can say so.
 */
export async function translation(
  text: string,
  locale: Locale,
  store: TranslationStore,
  ask: () => Promise<unknown>,
): Promise<Translation | undefined> {
  const source = text.trim();
  const known = occupationForText(source);
  if (known) return { label: occupationLabel(known, locale, 'x'), code: known.id, from: 'vocabulary' };
  const cached = await store.get(source, locale);
  if (cached !== undefined) return { label: cached, code: null, from: 'cache' };
  const parsed = REPLY.safeParse(await ask());
  if (!parsed.success) return undefined;
  await store.put(source, locale, parsed.data.label);
  return { label: parsed.data.label, code: null, from: 'model' };
}
