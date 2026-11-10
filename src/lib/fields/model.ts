// What a person field is: its types, the labels offered for each, and the shape of its value. The Edit tab,
// the read-only view and the server (src/lib/person.server.ts) all use this file, so they agree on what a
// field may hold. A value is a flat object of strings; `VALUE` says which keys each type has and how to
// check them.
import { z } from 'zod';
import { validDate } from '../dates.ts';
import { translate } from '../i18n/dictionary.ts';
import { VISIBILITIES, type Visibility } from '../visibility.ts';

export const FIELD_TYPES = [
  'phone', 'email', 'address', 'website', 'social', 'names', 'dates', 'education', 'occupation', 'military',
  'religion', 'nationality', 'languages', 'medical', 'allergies', 'favourites', 'gifts', 'notes', 'related', 'custom',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type FieldValue = Record<string, string>;

/** The most fields one person can have. */
export const MAX_FIELDS = 200;

/** The refusal of a save made on a version of the person that has since changed (English; the reader sees their language). */
export const CHANGED_SINCE_OPENED = translate('en', 'fields.changed_since_opened');

/** One entry in a person's list of fields, as the browser receives it. */
export interface PersonField {
  id: string;
  type: FieldType;
  label: string;
  value: FieldValue;
  ord: number;
  /** Who may see it (src/lib/visibility.ts). A reader only ever receives what their level allows. */
  visibility: Visibility;
  /** Only on the Edit tab's read: whether the reader created this field, which decides if they may make it personal. */
  authored?: boolean;
  updatedAt: string;
  updatedBy: string;
}

/** Ways to reach someone. Changing these needs `edit-contact`; the rest need `edit-person`. */
export const CONTACT_TYPES: readonly FieldType[] = ['phone', 'email', 'address', 'website', 'social'];
/** These start at the editors' level, in the Edit tab and in the assistant's proposals alike: they are sensitive by nature. */
export const RESTRICTED_BY_DEFAULT: readonly FieldType[] = ['address', 'medical', 'allergies', 'religion'];

export const isContactType = (t: string) => (CONTACT_TYPES as readonly string[]).includes(t);
/** The level a new field of this type starts at. */
export const defaultVisibility = (t: string): Visibility => ((RESTRICTED_BY_DEFAULT as readonly string[]).includes(t) ? 'editors' : 'family');

/**
 * Labels offered for each type, as stored. The stored label is the English word; the view shows the
 * reader's translation of it when there is one (see strings.ts). A label the family types is kept as typed.
 */
export const PRESETS: Record<FieldType, readonly string[]> = {
  phone: ['mobile', 'home', 'work', 'other'],
  email: ['personal', 'work', 'other'],
  address: ['home', 'work', 'holiday', 'other'],
  website: ['home page', 'work', 'blog', 'other'],
  social: ['Instagram', 'Facebook', 'LinkedIn', 'X', 'TikTok', 'YouTube', 'Bluesky', 'Threads', 'Mastodon', 'WhatsApp', 'Signal', 'Other'],
  names: ['maiden', 'birth', 'nickname', 'religious', 'alias'],
  dates: ['anniversary', 'baptism', 'confirmation'],
  education: ['school', 'university', 'training', 'other'],
  occupation: ['job', 'apprenticeship', 'volunteering', 'business'],
  military: ['army', 'navy', 'air force', 'reserve', 'other'],
  religion: ['faith', 'denomination'],
  nationality: ['citizenship', 'other'],
  languages: ['mother tongue', 'spoken', 'learning'],
  medical: ['condition', 'medication', 'surgery', 'other'],
  allergies: ['food', 'medicine', 'other'],
  favourites: ['colour', 'food', 'drink', 'music', 'book', 'film', 'sport', 'flower', 'place', 'hobby', 'other'],
  gifts: ['food', 'book', 'hobby', 'other'],
  notes: ['general', 'other'],
  related: ['friend', 'godparent', 'neighbour', 'colleague', 'carer', 'other'],
  custom: [],
};

const need = (max: number) => z.string().trim().min(1).max(max);
/** An optional text: a key the value does not have yet counts as empty. */
const text = (max: number) => z.string().trim().max(max).default('');
/** A partial date ("1953", "1953-08", "~1953") or nothing. */
const when = z.string().trim().default('').refine((s) => s === '' || validDate(s), 'date');
const exactlyDate = z.string().trim().refine((s) => validDate(s), 'date');

/** The keys of each type's value, with checks. The server stores exactly what these accept. */
export const VALUE = {
  phone: z.object({ number: need(60) }),
  email: z.object({ address: z.string().trim().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'email').max(200) }),
  address: z.object({ street: text(200), city: text(120), postcode: text(40), country: text(120) })
    .refine((v) => Object.values(v).some(Boolean), 'address'),
  website: z.object({ url: need(500).refine((s) => /^https?:\/\//i.test(s) || /^[^\s/]+\.[^\s]+$/.test(s), 'url') }),
  social: z.object({ handle: need(300) }),
  names: z.object({ name: need(160) }),
  dates: z.object({ date: exactlyDate, note: text(200) }),
  education: z.object({ school: need(200), place: text(120), from: when, to: when, note: text(300) }),
  occupation: z.object({ title: need(200), employer: text(200), from: when, to: when, note: text(300) }),
  military: z.object({ unit: need(200), rank: text(120), from: when, to: when }),
  // `left` is '1' when they have left this church or faith; `leftOn` when, as far as anyone knows.
  religion: z.object({ name: need(120), left: text(1), leftOn: when }),
  nationality: z.object({ country: need(120) }),
  languages: z.object({ language: need(120), level: text(120) }),
  medical: z.object({ note: need(2000) }),
  allergies: z.object({ note: need(2000) }),
  favourites: z.object({ text: need(500) }),
  gifts: z.object({ text: need(500) }),
  notes: z.object({ text: need(5000) }),
  related: z.object({ person: text(120), name: text(200), note: text(200) })
    .refine((v) => !!(v.person || v.name), 'related'),
  custom: z.object({ text: need(2000) }),
} satisfies Record<FieldType, z.ZodType<FieldValue>>;

/** One field as the Edit tab sends it. `id` is set for a field that already exists. */
export const fieldInput = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(),
    type: z.enum(FIELD_TYPES),
    label: z.string().trim().max(60),
    value: z.record(z.string(), z.string().max(5000)),
    visibility: z.enum(VISIBILITIES),
  })
  .superRefine((f, ctx) => {
    const r = VALUE[f.type].safeParse(f.value);
    if (!r.success) ctx.addIssue({ code: 'custom', message: r.error.issues[0]?.message ?? 'invalid', path: ['value'] });
  });
export type FieldInput = z.infer<typeof fieldInput>;

/** The value as stored: checked, trimmed, and with only the keys the type has. */
export function storedValue(type: FieldType, value: Record<string, string>): FieldValue {
  const r = VALUE[type].parse(value) as FieldValue;
  return Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined));
}

/** What can be wrong with a field, as a code the editor shows in the reader's language (`issue.<code>`). */
export type IssueCode = 'required' | 'tooLong' | 'date' | 'email' | 'url' | 'address' | 'related' | 'invalid';
const CODES: readonly string[] = ['date', 'email', 'url', 'address', 'related'];

/** The first thing wrong with a field's value; undefined when it is fine. */
export function fieldIssue(type: FieldType, value: Record<string, string>): IssueCode | undefined {
  const r = VALUE[type].safeParse(value);
  if (r.success) return undefined;
  const i = r.error.issues[0];
  if (i?.code === 'too_small') return 'required';
  if (i?.code === 'too_big') return 'tooLong';
  return CODES.includes(i?.message ?? '') ? (i!.message as IssueCode) : 'invalid';
}

/** A new, empty value for the editor to start from. */
export const blankValue = (type: FieldType): FieldValue => {
  const keys = Object.keys(VALUE[type].shape ?? {});
  return Object.fromEntries(keys.map((k) => [k, '']));
};

/** A one-line text for a value, for lists, vCards and search. Empty parts are left out. */
export function fieldText(type: FieldType, v: FieldValue): string {
  switch (type) {
    case 'phone': return v.number ?? '';
    case 'email': return v.address ?? '';
    case 'address': return [v.street, v.city, v.postcode, v.country].filter(Boolean).join(', ');
    case 'website': return v.url ?? '';
    case 'social': return v.handle ?? '';
    case 'names': return v.name ?? '';
    case 'dates': return v.date ?? '';
    case 'education': return [v.school, v.place].filter(Boolean).join(', ');
    case 'occupation': return [v.title, v.employer].filter(Boolean).join(', ');
    case 'military': return [v.unit, v.rank].filter(Boolean).join(', ');
    case 'religion': return v.name ?? '';
    case 'nationality': return v.country ?? '';
    case 'languages': return [v.language, v.level].filter(Boolean).join(', ');
    case 'medical': case 'allergies': return v.note ?? '';
    case 'favourites': case 'gifts': case 'custom': return v.text ?? '';
    case 'notes': return v.text ?? '';
    case 'related': return v.name ?? ''; // a linked person is shown by their name, from the graph
  }
}

/** What the Edit tab offers first when a new field is added, and what a type calls itself. */
export const DEFAULT_LABEL: Partial<Record<FieldType, string>> = {
  phone: 'mobile', email: 'personal', address: 'home', website: 'home page', social: 'Instagram',
  names: 'maiden', dates: 'anniversary', education: 'school', occupation: 'job', military: 'army',
  religion: 'faith', nationality: 'citizenship', languages: 'spoken', medical: 'condition', allergies: 'food',
  favourites: 'food', gifts: 'food', notes: 'general', related: 'friend',
};
