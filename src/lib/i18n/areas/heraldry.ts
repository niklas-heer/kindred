// Coats of arms and the heraldry designer.
// Keys are unique across every area. Add a key to en, de and af here, and use it as t('<key>').
import type { Message } from "../types.ts";

export const en = {
  "arms.ask_more": "Ask the AI for more",
  "arms.asking": "Asking…",
  "arms.ask_more_failed": "The AI didn’t suggest any arms this time. Try again.",
};

export const de: Record<keyof typeof en, Message> = {
  "arms.ask_more": "Die KI um mehr bitten",
  "arms.asking": "Frage nach…",
  "arms.ask_more_failed": "Die KI hat diesmal keine Wappen vorgeschlagen. Versuch es noch einmal.",
};

/** Afrikaans. A missing entry falls back to English at runtime; the test reports them. */
export const af: Partial<Record<keyof typeof en, Message>> = {
  "arms.ask_more": "Vra die KI vir meer",
  "arms.asking": "Vra tans…",
  "arms.ask_more_failed": "Die KI het hierdie keer geen wapens voorgestel nie. Probeer weer.",
};
