// The person's fields as a reader sees them: grouped by what they are, each in its own shape. Contacts
// are shown separately (they have buttons: call, write, find); the rest is the details page.
import {
  AtSign, BriefcaseBusiness, CalendarHeart, Church, Flag, GraduationCap, Gift, Globe, HeartPulse, Languages, Mail, MapPin,
  Phone, Shield, Star, StickyNote, TriangleAlert, Users, IdCard, Tag,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { formatDate, useT, type Key, type Translator } from '~/lib/i18n';
import { displayName, type Family } from '~/lib/graph';
import { isColourLabel, parseColours } from '~/lib/favourites';
import { socialLink } from '~/lib/social';
import type { PersonField } from '~/lib/types';
import { fieldText, isContactType, type FieldType } from './model';
import { presetLabel } from './presets';
import { VisibilityMark } from './VisibilityMark';
import './fields.css';

export const TYPE_ICON: Record<FieldType, ReactNode> = {
  phone: <Phone size={15} />, email: <Mail size={15} />, address: <MapPin size={15} />, website: <Globe size={15} />, social: <AtSign size={15} />,
  names: <IdCard size={15} />, dates: <CalendarHeart size={15} />, education: <GraduationCap size={15} />, occupation: <BriefcaseBusiness size={15} />,
  military: <Shield size={15} />, religion: <Church size={15} />, nationality: <Flag size={15} />, languages: <Languages size={15} />,
  medical: <HeartPulse size={15} />, allergies: <TriangleAlert size={15} />, favourites: <Star size={15} />, gifts: <Gift size={15} />,
  notes: <StickyNote size={15} />, related: <Users size={15} />, custom: <Tag size={15} />,
};

/** The groups the details page shows, in order. Contacts are left out: they are shown as reach buttons and a list. */
export const GROUPS: { id: string; title: Key; types: FieldType[] }[] = [
  { id: 'names', title: 'group.names', types: ['names'] },
  { id: 'life', title: 'group.life', types: ['dates', 'education', 'occupation', 'military'] },
  { id: 'background', title: 'group.background', types: ['religion', 'nationality', 'languages'] },
  { id: 'health', title: 'group.health', types: ['medical', 'allergies'] },
  { id: 'likes', title: 'group.likes', types: ['favourites', 'gifts'] },
  { id: 'other', title: 'group.other', types: ['related', 'notes', 'custom'] },
];

/** The contact fields, in the family's order. */
export const contactsOf = (fields: PersonField[]) => fields.filter((x) => isContactType(x.type));

/** The href a contact opens: a call, a message, a map, a site. */
export function contactHref(f: PersonField): string | undefined {
  const v = f.value;
  if (f.type === 'phone') return `tel:${(v.number ?? '').replace(/[^\d+]/g, '')}`;
  if (f.type === 'email') return `mailto:${v.address ?? ''}`;
  if (f.type === 'address') return `https://maps.apple.com/?q=${encodeURIComponent(fieldText('address', v))}`;
  if (f.type === 'website') return /^https?:\/\//i.test(v.url ?? '') ? v.url : `https://${v.url ?? ''}`;
  if (f.type === 'social') return socialLink(v.handle, f.label)?.href;
  return undefined;
}

/** "1985–1990", "from 1985", "until 1990": the years a line spans. */
function years(c: Translator, from?: string, to?: string) {
  if (from && to) return `${from}–${to}`;
  if (from) return c('years.from', { year: from });
  if (to) return c('years.until', { year: to });
  return '';
}

/** One field's value, in the shape its type has. */
function FieldValue({ f, fam, onSelect }: { f: PersonField; fam?: Family; onSelect?: (id: string) => void }) {
  const c = useT();
  const v = f.value;
  const link = contactHref(f);
  switch (f.type) {
    case 'address':
      return <span className="fv-lines">{[v.street, [v.postcode, v.city].filter(Boolean).join(' '), v.country].filter(Boolean).map((l, i) => <span key={i}>{l}</span>)}</span>;
    case 'phone': case 'email': case 'website':
      return <a href={link} rel="noreferrer">{fieldText(f.type, v)}</a>;
    case 'dates':
      return <span>{formatDate(v.date, c.locale)}{v.note && <span className="subtle"> · {v.note}</span>}</span>;
    case 'education': case 'occupation': case 'military': {
      const head = f.type === 'education' ? [v.school, v.place] : f.type === 'occupation' ? [v.title, v.employer] : [v.unit, v.rank];
      const span = years(c, v.from, v.to);
      const note = f.type === 'education' || f.type === 'occupation' ? v.note : '';
      return <span>{head.filter(Boolean).join(', ')}{span && <span className="subtle"> · {span}</span>}{note && <span className="subtle"> · {note}</span>}</span>;
    }
    case 'languages':
      return <span>{v.language}{v.level && <span className="subtle"> · {v.level}</span>}</span>;
    case 'related': {
      const linked = v.person && fam?.byId.get(v.person);
      const label = linked ? displayName(linked, fam) : v.name;
      return (
        <span>
          {linked && onSelect ? <button type="button" className="pp-inline-link" onClick={() => onSelect(linked.id)}>{label}</button> : label}
          {v.note && <span className="subtle"> · {v.note}</span>}
        </span>
      );
    }
    case 'religion':
      return <span>{v.name}{v.left && <span className="subtle"> · {v.leftOn ? c('faith.leftOn', { date: formatDate(v.leftOn, c.locale) }) : c('faith.left')}</span>}</span>;
    case 'favourites':
      if (isColourLabel(f.label)) {
        return <span className="fv-colours">{parseColours(v.text ?? '').map((t, i) => <span className="fv-colour" key={i}>{t.colour && <i aria-hidden style={{ background: t.colour.hex }} />}{t.text}</span>)}</span>;
      }
      return <span className="fv-text">{fieldText(f.type, v)}</span>;
    case 'notes': case 'medical': case 'allergies': case 'gifts': case 'custom':
      return <span className="fv-text">{fieldText(f.type, v)}</span>;
    default:
      return <span>{fieldText(f.type, v)}</span>;
  }
}

/** One row: its label, then its value. The label is the family's word for it, or the type's name. */
export function FieldRow({ f, fam, onSelect, removeOwn }: { f: PersonField; fam?: Family; onSelect?: (id: string) => void; removeOwn?: (id: string) => ReactNode }) {
  const c = useT();
  const name = f.label ? presetLabel(f.label, c) : c(`type.${f.type}` as Key);
  return (
    <div className="fv-row">
      <span className="fv-icon" aria-hidden>{TYPE_ICON[f.type]}</span>
      <span className="fv-label"><span>{name}</span><VisibilityMark level={f.visibility} />{removeOwn && f.visibility === 'personal' && removeOwn(f.id)}</span>
      <span className="fv-value"><FieldValue f={f} fam={fam} onSelect={onSelect} /></span>
    </div>
  );
}

/** The non-contact fields, under their group headings. Nothing renders when there are none. */
export function FieldGroups({ fields, fam, onSelect, removeOwn }: { fields: PersonField[]; fam?: Family; onSelect?: (id: string) => void; removeOwn?: (id: string) => ReactNode }) {
  const c = useT();
  const groups = GROUPS.map((g) => ({ ...g, items: fields.filter((x) => g.types.includes(x.type)) })).filter((g) => g.items.length);
  if (!groups.length) return null;
  return (
    <>
      {groups.map((g) => (
        <section className="fv-group" key={g.id} aria-label={c(g.title)}>
          <div className="rule">{c(g.title)}</div>
          {g.items.map((f) => <FieldRow key={f.id} f={f} fam={fam} onSelect={onSelect} removeOwn={removeOwn} />)}
        </section>
      ))}
    </>
  );
}

/** A contact line for the Reach section: the icon, the label and the value, with its link. */
export function ContactRow({ f, actions }: { f: PersonField; actions?: ReactNode }) {
  const c = useT();
  const link = contactHref(f);
  const name = f.label ? presetLabel(f.label, c) : c(`type.${f.type}` as Key);
  const text = fieldText(f.type, f.value);
  const social = f.type === 'social' ? socialLink(f.value.handle, f.label) : null;
  return (
    <div className="pp-contact">
      {TYPE_ICON[f.type]}
      <div className="pp-contact-body">
        {link ? (
          <a className="pp-contact-value" href={link} target={f.type === 'address' || f.type === 'website' || f.type === 'social' ? '_blank' : undefined} rel="noopener noreferrer">
            {social ? `${social.network} · ${social.handle}` : text}
          </a>
        ) : <span className="pp-contact-value">{text}</span>}
        <span className="pp-contact-tags">
          {name && !social && <span className="chip">{name}</span>}
          <VisibilityMark level={f.visibility} />
        </span>
      </div>
      {actions}
    </div>
  );
}
