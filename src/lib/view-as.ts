// "View as" (src/lib/auth/view-as.server.ts), for both sides: how the browser tells a change refused by a preview from other
// errors, so it can show a gentle notice instead (src/start.ts). Plain code, safe in the browser.

/** What every refusal during a preview ends with, in English, whatever the reader's name (areas/viewas.ts, `viewas.err_*`). */
export const VIEW_AS_REFUSAL_END = 'Stop the preview to change something.';

/** Whether an error is a change refused because the session is viewing a family as someone else. */
export const isViewAsRefusal = (e: unknown): boolean => e instanceof Error && e.message.endsWith(VIEW_AS_REFUSAL_END);
