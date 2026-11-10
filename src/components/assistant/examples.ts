// The example prompts an empty chat offers: the ones that suit the reader's role, the family's features and the page
// they are on. Pure, so the choice can be tested alone.
import type { Key } from '~/lib/i18n';

export interface ChatExample {
  key: Key;
  /** Opens a family session instead of filling the box. */
  open?: boolean;
  /** The name the example's words take (the person whose page is open). */
  name?: string;
}

export function chatExamples({ viewed, me, canDraft, canPhotos, canPropose, avatars, canHouse }: {
  /** The person whose page the reader is on, if any. */
  viewed: { id: string; name: string } | undefined;
  /** Who the reader said they are. */
  me: string | null;
  canDraft: boolean; canPhotos: boolean; canPropose: boolean; canHouse: boolean;
  /** Whether the family's assistant can make avatars. */
  avatars: boolean;
}): ChatExample[] {
  return [
    ...(viewed
      ? (['chat.start.who', 'chat.start.family'] as Key[]).map((key) => ({ key, name: viewed.name }))
      : [{ key: 'chat.start.birthdays' as Key }]),
    // Among the first four whatever page the reader is on: the rest wait behind "More".
    ...(canDraft ? [{ key: 'ai.exFamily' as Key, open: true }] : []),
    ...(viewed
      ? (['chat.start.timeline', 'chat.start.gaps', ...(me && me !== viewed.id ? ['chat.start.relation'] : [])] as Key[]).map((key) => ({ key, name: viewed.name }))
      : []),
    { key: 'ai.exPhotos' },
    { key: 'ai.exMissing' },
    { key: 'ai.exRelated' },
    ...(canPhotos ? [{ key: 'ai.exAlbum' as Key }] : []),
    ...(canPropose && avatars ? [{ key: 'ai.exAvatar' as Key }] : []),
    ...(canHouse ? [{ key: 'ai.exHouse' as Key }] : []),
  ];
}
