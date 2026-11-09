// What to offer after a reply: a few short messages the reader can send with one tap. Worked out here from what the reply
// showed and who it was about, so they are free, in the reader's language, and cost no model call.
import type { ChatItem } from '~/lib/ai/types';
import type { Key } from '~/lib/i18n';

export interface Chip { key: Key; name?: string }

/** The chips after the last reply. None while the reply waits for a decision or an answer. */
export function chipsFor(item: ChatItem, pagePerson: { id: string; given: string } | undefined, nameOf: (id: string) => string | undefined): Chip[] {
  const open = item.proposals?.some((p) => p.status === 'open') || item.blocks?.some((b) => b.type === 'question' && !b.answer);
  if (open) return [];
  const widgets = (item.blocks ?? []).flatMap((b) => (b.type === 'widget' ? [b.spec] : []));
  const shown = new Set(widgets.map((w) => w.kind));
  const about = widgets.flatMap((w) => ('person' in w && w.person ? [w.person] : w.kind === 'path' ? [w.to] : []))[0];
  const name = (about && nameOf(about)) || pagePerson?.given;
  if (name) {
    const offers: [string, Key][] = [['tree', 'chat.chip.family'], ['timeline', 'chat.chip.timeline'], ['gaps', 'chat.chip.gaps']];
    return offers.filter(([kind]) => !shown.has(kind as never)).slice(0, 3).map(([, key]) => ({ key, name }));
  }
  return [...(shown.has('dates') ? [] : [{ key: 'chat.chip.birthdays' as Key }]), ...(shown.has('gaps') ? [] : [{ key: 'chat.chip.anyGaps' as Key }])];
}
