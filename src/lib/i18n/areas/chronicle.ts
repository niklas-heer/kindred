// The chronicle: stories and sayings. Empty until the translation sweep moves its text here.
// Keys are unique across every area. Add a key to en, de and af here, and use it as t('<key>').
import type { Message } from "../types.ts";

export const en = {
};

export const de: Record<keyof typeof en, Message> = {
};

/** Afrikaans. A missing entry falls back to English at runtime; the test reports them. */
export const af: Partial<Record<keyof typeof en, Message>> = {};
