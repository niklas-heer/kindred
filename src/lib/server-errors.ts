// What a failed server function may tell the reader. A message written for readers is passed on as it is: an auth or AI
// error, a dictionary key, or English the dictionary knows. Anything else (a SQL error, a TypeError) is an internal
// failure: it is logged here with a short reference, and the reader gets a generic sentence quoting that reference.
// Start serializes a thrown error's message to the browser without logging it, so this is the only record of the failure.
import { isKnownMessage, translate } from './i18n/dictionary.ts';

/** Where a failure happened, for the log line. */
export interface FailureContext { fn: string; data?: unknown }

function isIntended(e: unknown): boolean {
  // Start's own control flow: a redirect is a Response, a not-found is a flagged object.
  if (e instanceof Response || (e as { isNotFound?: unknown } | null)?.isNotFound === true) return true;
  if (!(e instanceof Error)) return false;
  // AbortError: the reader left, and nothing failed.
  if (e.name === 'AuthError' || e.name === 'AiError' || e.name === 'AbortError') return true;
  return isKnownMessage(e.message);
}

/** The family a call was about, when it names one. It comes from the client, so only a plain id reaches the log. */
function treeOf(data: unknown): string | undefined {
  const tree = (data as { tree?: unknown } | null | undefined)?.tree;
  return typeof tree === 'string' && /^[\w-]{1,64}$/.test(tree) ? tree : undefined;
}

/** The error to send to the reader: `e` itself when it was meant for them, otherwise a generic one, after logging `e`. */
export function publicError(e: unknown, where: FailureContext): unknown {
  if (isIntended(e)) return e;
  const reference = crypto.randomUUID().slice(0, 8);
  const tree = treeOf(where.data);
  const detail = e instanceof Error ? e.stack ?? `${e.name}: ${e.message}` : String(e);
  const cause = e instanceof Error && e.cause !== undefined ? `\ncaused by: ${e.cause instanceof Error ? e.cause.stack ?? e.cause.message : String(e.cause)}` : '';
  console.error(`[kindred] server function ${where.fn} failed (reference ${reference}${tree ? `, family ${tree}` : ''}): ${detail}${cause}`);
  return new Error(translate('en', 'common.err_unexpected', { reference }));
}
