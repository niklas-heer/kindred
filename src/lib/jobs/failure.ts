// What the operator's Health tab keeps of a daily job that failed (accounts `job_run`, src/lib/operator/health.server.ts): an
// operational code and a sanitised message, never the error's own text. A job's error may quote what it was working on: a
// family's id or name, a person's name or dates from a record, an email address, a URL with a path or a token in it. The
// server's log keeps the whole message for whoever runs the server; the console, which other operators read, does not.

/** A failure's code: what kind of thing went wrong, for an operator to act on. */
export type FailureCode = 'network' | 'timeout' | 'database' | 'config' | 'error' | (string & {});

const NETWORK = /fetch failed|ECONN(REFUSED|RESET|ABORTED)|ENOTFOUND|EAI_AGAIN|network|socket hang up|getaddrinfo/i;
const TIMEOUT = /time(d)? ?out|ETIMEDOUT|deadline exceeded/i;
const DATABASE = /SQLITE_|D1_|database is (busy|locked)|no such (table|column)|constraint failed|kindred:guard/i;
const CONFIG = /must be|set both|is not set|not configured/i;
/** An error's own code, when it is a short word (SQLITE_BUSY, ENOTFOUND, an AiError's 'budget'). */
const OWN_CODE = /^[A-Za-z][A-Za-z0-9_.:-]{0,39}$/;

/** The text of an error and of its causes, to classify it by (never stored). */
function textOf(e: unknown, depth = 0): string {
  if (depth > 3 || e === null || e === undefined) return '';
  if (typeof e === 'string') return e;
  if (e instanceof Error) {
    const own = (e as { code?: unknown }).code;
    return [e.name, typeof own === 'string' ? own : '', e.message, textOf((e as { cause?: unknown }).cause, depth + 1)].join(' ');
  }
  return String(e);
}

/** The operational code of a failure. */
export function failureCode(e: unknown): FailureCode {
  const text = textOf(e);
  if (TIMEOUT.test(text) || (e instanceof Error && e.name === 'TimeoutError')) return 'timeout';
  if (NETWORK.test(text)) return 'network';
  if (DATABASE.test(text)) return 'database';
  const own = e instanceof Error ? (e as { code?: unknown }).code : undefined;
  if (typeof own === 'string' && OWN_CODE.test(own)) return own.toLowerCase();
  if (CONFIG.test(text)) return 'config';
  return 'error';
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A failure's message with what could name a family, a person or an account taken out: email addresses, the path and query of
 * a URL (its origin stays: which service failed is useful), quoted text, numbers of three or more digits (years, ids) and
 * each of `families` (their ids). At most 300 characters.
 */
export function sanitiseFailure(message: string, families: readonly string[] = []): string {
  let m = message
    .replace(/[^\s"'<>()]+@[^\s"'<>()]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b(https?:\/\/[^/\s"'<>]+)[^\s"'<>)]*/g, '$1')
    .replace(/"[^"]*"|“[^”]*”|„[^“”]*[“”]|«[^»]*»|‘[^’]*’|'[^']*'/g, '[…]')
    .replace(/\d{3,}/g, '#');
  for (const id of [...families].filter((f) => f.length >= 2).sort((a, b) => b.length - a.length)) {
    m = m.replace(new RegExp(`(^|[^A-Za-z0-9_-])${escape(id)}(?=$|[^A-Za-z0-9_-])`, 'gi'), '$1[family]');
  }
  return m.slice(0, 300);
}
