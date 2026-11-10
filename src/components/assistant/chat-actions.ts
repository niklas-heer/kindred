// What the assistant's window asks of the server for one chat, besides sending a message (useChatStream.ts): an answer
// from another model, a chat's model, a family session's transcript, and the reader's decisions on proposal cards.
// Each keeps the chat's run (chat-runs.ts) up to date, so the window shows what is happening wherever it is.
import type { QueryClient } from '@tanstack/react-query';
import { aiChatRetry, aiChatSend, aiThreadSetModel } from '~/lib/ai.functions';
import { toAiLocale } from '~/lib/ai/types';
import { errorText } from '~/lib/errortext';
import type { Locale } from '~/lib/i18n';
import type { Attached } from './attachments';
import { finishRun, getRun, patchRun } from './chat-runs';
import type { PickedModel } from './ModelPicker';
import type { OnDecided } from './ProposalCard';

/** The chat and how to reach it: the family, the reader's language, and the query cache to refresh. */
export interface ChatScope { conv: string; tree: string; locale: Locale; qc: QueryClient }

const refresh = ({ conv, tree, qc }: ChatScope) =>
  Promise.all([qc.invalidateQueries({ queryKey: ['ai-chat', tree, conv] }), qc.invalidateQueries({ queryKey: ['ai-threads', tree] })]);

/** "Try with a stronger model": the same question on another model. Both answers stay; nothing new from the reader is stored. */
export async function askAgain(scope: ChatScope, itemId: string, model: PickedModel) {
  const { conv: c, tree, locale } = scope;
  if (getRun(c).busy) return;
  patchRun(c, { busy: true, error: null, stream: null });
  try {
    await aiChatRetry({ data: { tree, conv: c, itemId, model, locale: toAiLocale(locale) } });
    await refresh(scope);
  } catch (err) {
    patchRun(c, { error: errorText(err, locale) });
  } finally {
    patchRun(c, { busy: false });
    finishRun(c);
  }
}

/** The model this chat uses from now on (null: the family's own choice). */
export async function chooseModel({ conv: c, tree, locale, qc }: ChatScope, model: PickedModel | null) {
  try {
    await aiThreadSetModel({ data: { tree, conv: c, model } });
    await qc.invalidateQueries({ queryKey: ['ai-chat', tree, c] });
  } catch (err) {
    patchRun(c, { error: errorText(err, locale) });
  }
}

/**
 * A family session's transcript (or its pictures alone), sent once; `pending` is what the thread shows meanwhile.
 * `onSent` runs once the draft is made, before the chat stops being busy. Resolves true when the draft was made.
 */
export async function sendSession(scope: ChatScope, { transcript, speaker, images, keep, pending }: {
  transcript: string; speaker: string; images: Attached[]; keep: boolean; pending: string;
}, onSent: () => void): Promise<boolean> {
  const { conv: c, tree, locale } = scope;
  patchRun(c, { busy: true, error: null, pending, pendingImages: images });
  try {
    await aiChatSend({ data: { tree, conv: c, text: transcript, locale: toAiLocale(locale), session: true, speaker, ...(images.length && { images: images.map((i) => ({ base64: i.base64 })), keepImages: keep }) } });
    await refresh(scope);
    onSent();
    return true;
  } catch (err) {
    patchRun(c, { error: errorText(err, locale) });
    return false;
  } finally {
    patchRun(c, { pending: null, pendingImages: [], busy: false });
    finishRun(c);
  }
}

/** A card was decided: records it, and carries on (`carryOn`) when it was the last one waiting. */
export function recordDecision(conv: string, locale: Locale, mark: Parameters<OnDecided>[0], carryOn: () => void) {
  void mark().then(
    (r) => { if (r.due) carryOn(); },
    (err) => patchRun(conv, (x) => ({ unrecorded: [...x.unrecorded, mark], continueError: errorText(err, locale) })),
  );
}

/** Retry: records whatever decisions could not be recorded, then asks the assistant to carry on. */
export async function recordAndCarryOn(conv: string, locale: Locale, carryOn: () => Promise<void>) {
  patchRun(conv, { continueError: null });
  for (const mark of getRun(conv).unrecorded) {
    try {
      await mark();
      patchRun(conv, (x) => ({ unrecorded: x.unrecorded.filter((m) => m !== mark) }));
    } catch (err) {
      patchRun(conv, { continueError: errorText(err, locale) });
      return;
    }
  }
  await carryOn();
}
