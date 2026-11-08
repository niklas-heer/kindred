// Steward feedback: the shapes, limits and checks shared by the browser and the server, and the Markdown report.
// Everything that is attached automatically is listed in `feedbackContextSchema` and nothing else is accepted, so a field's
// value, a person's data or anything else can never be stored by accident. No React and no server imports.
import { z } from 'zod';
import { LOCALES } from './i18n/types.ts';

export const FEEDBACK_KINDS = ['bug', 'idea', 'confusing'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const FEEDBACK_STATUSES = ['new', 'in-progress', 'resolved'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_LIMITS = {
  text: 4000,
  /** The picture's size in bytes. The browser scales it down and lowers the quality to fit. */
  picture: 3 * 1024 * 1024,
  /** Reports kept per family; old ones must be deleted before more can be sent. */
  reports: 500,
  page: 1000,
  selector: 500,
  browser: 400,
  errors: 20,
  error: 500,
} as const;

export const feedbackContextSchema = z.strictObject({
  page: z.string().startsWith('/').max(FEEDBACK_LIMITS.page),
  selector: z.string().min(1).max(FEEDBACK_LIMITS.selector).nullable(),
  locale: z.enum(LOCALES),
  theme: z.string().max(32),
  screen: z.string().max(80),
  browser: z.string().max(FEEDBACK_LIMITS.browser),
  version: z.string().max(64),
  errors: z.array(z.string().max(FEEDBACK_LIMITS.error)).max(FEEDBACK_LIMITS.errors),
});
export type FeedbackContext = z.infer<typeof feedbackContextSchema>;

/** One report as the inbox shows it. */
export interface FeedbackReport {
  id: string;
  kind: FeedbackKind;
  status: FeedbackStatus;
  text: string;
  context: FeedbackContext;
  hasPicture: boolean;
  by: string;
  created: number;
  updated: number;
}

export interface FeedbackForm {
  tree: string;
  kind: FeedbackKind;
  text: string;
  context: FeedbackContext;
  picture: File | null;
}

const TREE = /^[a-z0-9-]{1,64}$/;

/** What the panel sends, checked. Throws a translation key the panel can show. */
export function parseFeedbackForm(form: FormData): FeedbackForm {
  const tree = form.get('tree');
  if (typeof tree !== 'string' || !TREE.test(tree)) throw new Error('feedback.err_invalid');
  const kind = z.enum(FEEDBACK_KINDS).safeParse(form.get('kind'));
  if (!kind.success) throw new Error('feedback.err_invalid');
  const raw = form.get('text');
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) throw new Error('feedback.err_empty');
  if (text.length > FEEDBACK_LIMITS.text) throw new Error('feedback.err_too_long');
  let json: unknown;
  try { json = JSON.parse(String(form.get('context'))); } catch { throw new Error('feedback.err_invalid'); }
  const context = feedbackContextSchema.safeParse(json);
  if (!context.success) throw new Error('feedback.err_invalid');
  const file = form.get('picture');
  let picture: File | null = null;
  if (file !== null) {
    if (!(file instanceof File) || file.type !== 'image/jpeg') throw new Error('feedback.err_picture');
    if (file.size > FEEDBACK_LIMITS.picture) throw new Error('feedback.err_picture_big');
    picture = file;
  }
  return { tree, kind: kind.data, text, context: context.data, picture };
}

const inline = (s: string) => {
  const longest = Math.max(0, ...[...s.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  return longest ? `${fence} ${s} ${fence}` : `${fence}${s}${fence}`;
};

/**
 * The report a developer can paste into an issue. Always in English, whatever the steward's language, and without the
 * steward's name: it leaves the family's Kindred only when a steward pastes it somewhere.
 */
export function reportMarkdown(r: Pick<FeedbackReport, 'kind' | 'status' | 'text' | 'context' | 'hasPicture' | 'created'>): string {
  const c = r.context;
  const lines = [
    `## Feedback: ${r.kind}`,
    '',
    ...r.text.split('\n').map((l) => `> ${l}`),
    '',
    `- **Status:** ${r.status}`,
    `- **Reported:** ${new Date(r.created).toISOString()}`,
    `- **Page:** ${inline(c.page)}`,
    `- **Element:** ${c.selector ? inline(c.selector) : 'none marked'}`,
    `- **Language:** ${c.locale}`,
    `- **Theme:** ${c.theme}`,
    `- **Screen:** ${c.screen}`,
    `- **Browser:** ${inline(c.browser)}`,
    `- **Version:** ${inline(c.version)}`,
    `- **Screenshot:** ${r.hasPicture ? 'kept in the family’s Kindred; attach it here if it helps' : 'none included'}`,
  ];
  if (c.errors.length) {
    const body = c.errors.join('\n');
    const longest = Math.max(2, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
    const fence = '`'.repeat(longest + 1);
    lines.push('', '### Recent client errors', '', `${fence}text`, body, fence);
  }
  return lines.join('\n') + '\n';
}
