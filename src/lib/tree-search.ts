// The tree canvas's state lives in the URL, so every view is a link: back/forward walk your
// trail, and a view can be shared. Kept apart from search.ts: the route validates its search with this before any page
// loads, so it is in every page's entry chunk, and the name search (with the occupation vocabulary) is not needed there.
import { z } from 'zod';

export const treeSearch = z.object({
  /** The centre of the family/ancestor views and the dynasty's line. */
  focus: z.string().optional(),
  /** Who the side panel shows, when not the focus. Selecting never moves the tree. */
  sel: z.string().optional(),
  view: z.enum(['dynasty', 'family', 'ancestors']).optional(),
  /** Dynasty root; defaults to the oldest ancestor of the focus in its line. */
  root: z.string().optional(),
  /** Dynasty: only house members (CK3) or every descendant. */
  line: z.enum(['house', 'all']).optional(),
  up: z.number().int().min(1).max(12).optional(),
  down: z.number().int().min(1).max(12).optional(),
  /** Highlight lens: dims everyone outside it. */
  lens: z.enum(['none', 'line', 'living', 'house', 'path', 'gaps']).optional(),
  /** For the path lens: the other person. */
  to: z.string().optional(),
});
export type TreeSearch = z.infer<typeof treeSearch>;

/**
 * The view a family's tree opens in when the link names none: the one this reader last chose there, else Family.
 * Family shows one person or a thousand equally well; a dynasty with its house banner is a choice, not a default.
 */
export function openingView(remembered: string | null | undefined): NonNullable<TreeSearch['view']> {
  return remembered === 'dynasty' || remembered === 'ancestors' || remembered === 'family' ? remembered : 'family';
}
