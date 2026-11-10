// Where nothing may be written: a demo (the whole server, src/lib/demo.ts), or one request of a steward's "View as" preview
// (src/lib/auth/view-as.server.ts). The storage layer (src/lib/store/index.ts), `once` (src/lib/db.server.ts) and the AI
// adapters ask here before every write or provider call, so a feature added later is read-only in both without knowing them.
//
// A demo is a setting of the server. A preview is a property of one request: the guard (src/lib/auth/guard.server.ts) knows
// which request belongs to a previewing session and registers how to ask. Code that runs outside a request (a daily job, a
// script, a test without one) is never in a preview.
//
// Plain code with no server-only imports: the store imports it, and the store is imported by scripts and tests.
import { demoRefused, isDemo } from './demo.ts';
import type { AuthError } from './auth/errors.ts';

type Refusal = () => AuthError | undefined;

// Kept on globalThis: a test's module graph (vite's) and Node's own may load this file twice, and both must see one answer.
const g = globalThis as unknown as { __kindredRequestRefusal?: Refusal };

/** Set by the guard: the refusal for the current request when it belongs to a preview, else undefined. */
export function onRequestReadOnly(fn: Refusal): void {
  g.__kindredRequestRefusal = fn;
}

/** The refusal a write gets here and now: the demo's, a preview's, or undefined when writing is allowed. */
export function readOnlyRefusal(): AuthError | undefined {
  if (isDemo()) return demoRefused();
  // Not caught: the guard's answer already covers "outside a request", so anything it throws is a fault, and a fault must
  // fail the write rather than let a preview through.
  return g.__kindredRequestRefusal?.();
}

/** Whether nothing may be written now. A page that stores something while it is only being read skips that when this is true. */
export const readOnly = (): boolean => readOnlyRefusal() !== undefined;

/** Throws the refusal when nothing may be written now. For code that does work before it writes (an upload, an AI call, a plan). */
export function refuseReadOnly(): void {
  const refusal = readOnlyRefusal();
  if (refusal) throw refusal;
}
