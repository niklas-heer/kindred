// The browser's half of steward feedback: remembers recent client errors from the moment the app loads, and describes the
// page. Loaded with the app, so it stays small; the screen capture itself is imported only when the panel opens.
import { FEEDBACK_LIMITS, type FeedbackContext } from './feedback.ts';
import type { Locale } from './i18n/types.ts';

declare const __KINDRED_COMMIT__: string | undefined;

const recent: string[] = [];

/** Keeps a short, cut-off line; the newest {FEEDBACK_LIMITS.errors} are kept. */
export function recordClientError(text: string) {
  const line = text.replace(/\s+/g, ' ').trim().slice(0, FEEDBACK_LIMITS.error);
  if (!line || recent.at(-1) === line) return;
  recent.push(line);
  if (recent.length > FEEDBACK_LIMITS.errors) recent.shift();
}
export const recentClientErrors = () => [...recent];

const describe = (v: unknown) => (v instanceof Error ? `${v.name}: ${v.message}` : typeof v === 'string' ? v : (() => { try { return JSON.stringify(v); } catch { return String(v); } })());

let watching = false;
/** Starts listening for uncaught errors, rejected promises and console.error. Once only; does nothing on the server. */
export function watchClientErrors() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('error', (e) => recordClientError(e.message || 'Script error'));
  window.addEventListener('unhandledrejection', (e) => recordClientError(`Unhandled: ${describe(e.reason)}`));
  const original = console.error;
  console.error = (...args: unknown[]) => {
    recordClientError(args.map(describe).join(' '));
    original.apply(console, args);
  };
}

interface ElementLike {
  tagName: string;
  id?: string;
  parentElement: ElementLike | null;
  getAttribute(name: string): string | null;
  previousElementSibling: ElementLike | null;
  nextElementSibling: ElementLike | null;
}

const ident = (s: string) => /^[A-Za-z_][\w-]*$/.test(s);

/**
 * A short CSS selector for an element: tag, classes, and `:nth-of-type` where siblings would be ambiguous, up to a real id or
 * six levels. Only structure: never an element's text, value or other attributes, so nothing a family typed ends up in it.
 */
export function cssPath(el: ElementLike): string {
  const parts: string[] = [];
  let at: ElementLike | null = el;
  for (let depth = 0; at && depth < 6; depth++, at = at.parentElement) {
    const tag = at.tagName.toLowerCase();
    if (tag === 'html' || tag === 'body') break;
    if (at.id && ident(at.id)) { parts.unshift(`#${at.id}`); break; }
    const classes = (at.getAttribute('class') ?? '').split(/\s+/).filter(ident).slice(0, 2);
    let part = tag + classes.map((c) => `.${c}`).join('');
    let n = 1;
    let same = false;
    for (let s = at.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === at.tagName) { n++; same = true; }
    for (let s = at.nextElementSibling; s && !same; s = s.nextElementSibling) if (s.tagName === at.tagName) same = true;
    if (same) part += `:nth-of-type(${n})`;
    parts.unshift(part);
  }
  return parts.join(' > ').slice(0, FEEDBACK_LIMITS.selector);
}

/** The commit this build was made from: set at build time from git or KINDRED_COMMIT. */
export const appVersion = () => (typeof __KINDRED_COMMIT__ === 'string' && __KINDRED_COMMIT__ ? __KINDRED_COMMIT__ : 'unknown');

/** Everything attached to a report automatically. The panel shows exactly this before sending. */
export function feedbackContext(selector: string | null, locale: Locale): FeedbackContext {
  return {
    page: (location.pathname + location.search).slice(0, FEEDBACK_LIMITS.page),
    selector,
    locale,
    theme: document.documentElement.dataset.theme ?? '',
    screen: `${innerWidth}×${innerHeight} window, ${screen.width}×${screen.height} screen, ${devicePixelRatio || 1}x`.slice(0, 80),
    browser: navigator.userAgent.slice(0, FEEDBACK_LIMITS.browser),
    version: appVersion().slice(0, 64),
    errors: recentClientErrors(),
  };
}
