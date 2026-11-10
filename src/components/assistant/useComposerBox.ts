// The composer's box and the draft it holds per chat. The box is not a controlled field: Wispr Flow and other dictation
// apps write into it from outside (paste, the accessibility API, a value set and an input event), and nothing the app
// draws may put old text back over what they wrote. `text` follows the box, for the Send button and its size.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Attached, useImageAttach } from './attachments';
import { getTabs, updateTabs, withDraft } from './chat-tabs';

/** The composer's tallest: five lines of its text and its padding (the same number as max-height in assistant.css). */
const COMPOSER_MAX = 136;

/** Joins what was typed and what was heard, with one space between. */
export const joined = (a: string, b: string) => (a.trim() ? `${a.replace(/\s+$/, '')} ${b}` : b);

/** What is in the box (`text`), and the two ways it changes: the reader writing (`noteText`) and the app setting it (`setComposer`). */
export function useComposerBox({ tree, convRef, areaRef }: { tree: string; convRef: RefObject<string | null>; areaRef: RefObject<HTMLTextAreaElement | null> }) {
  const [text, setText] = useState('');

  /** What the reader wrote: remembered for this chat. Every way of writing in the box comes through here. */
  const noteText = useCallback((value: string) => {
    setText(value);
    const c = convRef.current;
    if (c) updateTabs(tree, (s) => withDraft(s, c, value, Date.now()), true);
  }, [tree, convRef]);

  /** Sets the box from the app's side: a reply's Edit, an example, dictation, or clearing it after sending. */
  function setComposer(value: string) {
    const el = areaRef.current;
    if (el && el.value !== value) el.value = value;
    noteText(value);
  }

  return { text, setText, noteText, setComposer };
}

/** Text from outside the app arrives as a native input event. Listened to directly, because React skips one when the value was set by script. */
export function useNativeInput(areaRef: RefObject<HTMLTextAreaElement | null>, noteText: (value: string) => void) {
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const onInput = () => noteText(el.value);
    el.addEventListener('input', onInput);
    return () => el.removeEventListener('input', onInput);
  }, [areaRef, noteText]);
}

// Pictures waiting to be sent, per chat, for the page's life: they are too large to keep across a reload, unlike a draft's words.
const draftImages = new Map<string, Attached[]>();

/** A deleted chat's waiting pictures go with it. */
export const forgetDraftImages = (conv: string) => draftImages.delete(conv);

/**
 * Switching chats brings that chat's own draft and pictures into the same box, so the focus never moves. `onSwitch`
 * clears what belonged to the chat before (a picture error, the choice to keep pictures).
 */
export function useChatDraft({ tree, conv, areaRef, attach, noteText, setText, onSwitch }: {
  tree: string; conv: string | null; areaRef: RefObject<HTMLTextAreaElement | null>; attach: ReturnType<typeof useImageAttach>;
  noteText: (value: string) => void; setText: (value: string) => void; onSwitch: () => void;
}) {
  const shownConv = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = areaRef.current;
    const before = shownConv.current;
    shownConv.current = conv;
    if (!el || !conv) return;
    // Words written while the very first chat was being made belong to it.
    if (before === null && el.value) noteText(el.value);
    else {
      el.value = getTabs(tree).drafts[conv]?.text ?? '';
      setText(el.value);
    }
    if (before) draftImages.set(before, attach.images);
    attach.replace(draftImages.get(conv) ?? []);
    onSwitch();
  }, [conv, tree]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (conv) draftImages.set(conv, attach.images); }, [conv, attach.images]);
}

/** The box grows with its text, up to five lines, then scrolls. Measured again when a family session hides or shows it. */
export function useBoxHeight(areaRef: RefObject<HTMLTextAreaElement | null>, text: string, hidden: boolean) {
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX)}px`;
  }, [areaRef, text, hidden]);
}
