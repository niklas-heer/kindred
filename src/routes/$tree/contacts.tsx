import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { BookUser, Check, Copy, Download, Globe, Home, Mail, MapPin, MessageCircle, Phone, Search, UserPlus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GameIcon } from '~/components/GameIcon';
import { Arms } from '~/components/Heraldry';
import { Portrait } from '~/components/Portrait';
import { contactsQuery } from '~/lib/api';
import { useFamily, useMe, useTreeId } from '~/lib/family';
import { play } from '~/lib/sfx';
import { age as ageOf, ageAt, children, displayName, partnersOf, parents, siblings, type Family } from '~/lib/graph';
import type { GPerson } from '~/lib/types';
import '~/styles/contacts.css';

export const Route = createFileRoute('/$tree/contacts')({
  component: ContactsPage,
});

interface Row {
  id: number;
  person: string;
  kind: 'phone' | 'email' | 'address' | 'web' | 'messenger';
  label: string | null;
  value: string;
}

interface Household {
  id: string;
  members: GPerson[];
  rows: Map<string, Row[]>;
  /** Addresses of everyone in the card, shown once. */
  addresses: Row[];
  sortKey: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s,.\-/]+/g, '');

// ---------- households ----------

function buildHouseholds(f: Family, rows: Row[]) {
  const by = new Map<string, Row[]>();
  for (const r of rows) {
    if (!f.byId.get(r.person)?.living) continue;
    const a = by.get(r.person);
    if (a) a.push(r);
    else by.set(r.person, [r]);
  }
  // Union-find over people who share a card.
  const root = new Map<string, string>();
  const find = (x: string): string => {
    let r = root.get(x) ?? x;
    while ((root.get(r) ?? r) !== r) r = root.get(r)!;
    root.set(x, r);
    return r;
  };
  const join = (a: string, b: string) => root.set(find(a), find(b));
  const addrs = (id: string) => new Set((by.get(id) ?? []).filter((r) => r.kind === 'address').map((r) => norm(r.value)));

  for (const u of f.graph.unions) {
    if (u.end || !by.has(u.a) || !by.has(u.b)) continue;
    const a = addrs(u.a);
    if ([...addrs(u.b)].some((v) => a.has(v))) join(u.a, u.b);
  }
  const attached = new Set<string>();
  for (const p of f.graph.people) {
    if (!p.living) continue;
    const years = ageAt(p.born);
    if (years === undefined || years >= 18) continue;
    const home = parents(f, p.id).find((x) => by.has(x));
    if (home) {
      join(p.id, home);
      attached.add(p.id);
    }
  }

  const groups = new Map<string, GPerson[]>();
  const noDetails: GPerson[] = [];
  for (const p of f.graph.people) {
    if (!p.living) continue;
    if (!by.has(p.id) && !attached.has(p.id)) {
      noDetails.push(p);
      continue;
    }
    const r = find(p.id);
    const g = groups.get(r);
    if (g) g.push(p);
    else groups.set(r, [p]);
  }

  const households: Household[] = [...groups.entries()].map(([id, members]) => {
    members.sort((a, b) => (ageOf(b) ?? 0) - (ageOf(a) ?? 0));
    const seen = new Set<string>();
    const addresses: Row[] = [];
    for (const m of members)
      for (const r of by.get(m.id) ?? [])
        if (r.kind === 'address' && !seen.has(norm(r.value))) {
          seen.add(norm(r.value));
          addresses.push(r);
        }
    const lead = members[0];
    return { id, members, rows: by, addresses, sortKey: `${lead.surname ?? lead.given} ${lead.given}`.toLowerCase() };
  });
  households.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  noDetails.sort((a, b) => displayName(a, f).localeCompare(displayName(b, f)));
  return { households, noDetails };
}

/** You, your partner, parents, children, siblings, grandparents and grandchildren. */
function closeFamily(f: Family, me: string): Set<string> {
  const out = new Set<string>([me, ...partnersOf(f, me), ...parents(f, me), ...children(f, me), ...siblings(f, me)]);
  for (const p of parents(f, me)) for (const g of parents(f, p)) out.add(g);
  for (const c of children(f, me)) for (const g of children(f, c)) out.add(g);
  return out;
}

// ---------- helpers ----------

const DAY = 86_400_000;
function nextBirthday(p: GPerson): { days: number; turns: number; date: Date } | undefined {
  const m = p.born && /^(\d{4})-(\d\d)-(\d\d)$/.exec(p.born);
  if (!m || !p.living) return undefined;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let y = today.getFullYear(); ; y++) {
    const leapless = +m[2] === 2 && +m[3] === 29 && !((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0);
    const d = new Date(y, +m[2] - 1, leapless ? 28 : +m[3]);
    if (d >= today) return { days: Math.round((d.getTime() - today.getTime()) / DAY), turns: y - +m[1], date: d };
  }
}

const vEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
function vcard(p: GPerson, rows: Row[], f: Family): string {
  const name = displayName(p, f);
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${vEsc(p.surname ?? '')};${vEsc(p.given)};;;`, `FN:${vEsc([p.given, p.surname].filter(Boolean).join(' ') || name)}`];
  if (p.nickname) lines.push(`NICKNAME:${vEsc(p.nickname)}`);
  if (p.born && /^\d{4}-\d\d-\d\d$/.test(p.born)) lines.push(`BDAY:${p.born}`);
  const notes: string[] = [];
  for (const r of rows) {
    const label = (r.label ?? '').toLowerCase();
    if (r.kind === 'phone') lines.push(`TEL;TYPE=${/mobile|cell/.test(label) ? 'CELL' : /work/.test(label) ? 'WORK' : /home/.test(label) ? 'HOME' : 'VOICE'}:${vEsc(r.value)}`);
    else if (r.kind === 'email') lines.push(`EMAIL;TYPE=INTERNET:${vEsc(r.value)}`);
    else if (r.kind === 'address') lines.push(`ADR;TYPE=${/work/.test(label) ? 'WORK' : 'HOME'}:;;${vEsc(r.value)};;;;`);
    else if (r.kind === 'web') lines.push(`URL:${r.value}`);
    else notes.push(`${r.label ?? 'Messenger'}: ${r.value}`);
  }
  if (notes.length) lines.push(`NOTE:${vEsc(notes.join('\n'))}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

function download(name: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const webHref = (v: string) => (/^https?:\/\//i.test(v) ? v : /^[a-z][a-z0-9+.-]*:/i.test(v) ? undefined : `https://${v}`);

// ---------- page ----------

function ContactsPage() {
  const f = useFamily();
  const me = useMe();
  const tree = useTreeId();
  const { data, isPending } = useQuery(contactsQuery(tree));
  const [q, setQ] = useState('');
  const [dq] = useDebouncedValue(q, { wait: 180 });
  const [onlyPhone, setOnlyPhone] = useState(false);
  const [onlyAddress, setOnlyAddress] = useState(false);
  const [onlyClose, setOnlyClose] = useState(false);
  const [allNoDetails, setAllNoDetails] = useState(false);

  const { households, noDetails } = useMemo(() => buildHouseholds(f, (data ?? []) as Row[]), [f, data]);
  const close = useMemo(() => (onlyClose ? closeFamily(f, me) : null), [f, me, onlyClose]);

  const tokens = dq.toLowerCase().split(/\s+/).filter(Boolean);
  const filtering = tokens.length > 0 || onlyPhone || onlyAddress || onlyClose;

  const text = (members: GPerson[], rows: Map<string, Row[]>) =>
    members
      .map((m) => [displayName(m, f), m.nickname, m.given, m.surname, ...(rows.get(m.id) ?? []).flatMap((r) => [r.value, r.label])].filter(Boolean).join(' '))
      .join(' ')
      .toLowerCase();

  const shown = useMemo(
    () =>
      households.filter((h) => {
        const all = h.members.flatMap((m) => h.rows.get(m.id) ?? []);
        if (onlyPhone && !all.some((r) => r.kind === 'phone')) return false;
        if (onlyAddress && !all.some((r) => r.kind === 'address')) return false;
        if (close && !h.members.some((m) => close.has(m.id))) return false;
        if (!tokens.length) return true;
        const hay = text(h.members, h.rows);
        return tokens.every((t) => hay.includes(t));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [households, onlyPhone, onlyAddress, close, dq],
  );
  const shownNoDetails = useMemo(() => {
    if (onlyPhone || onlyAddress) return [];
    return noDetails.filter((p) => {
      if (close && !close.has(p.id)) return false;
      const hay = `${displayName(p, f)} ${p.nickname ?? ''}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noDetails, onlyPhone, onlyAddress, close, dq, f]);

  const letters = useMemo(() => {
    const m = new Map<string, Household[]>();
    for (const h of shown) {
      const l = h.sortKey.normalize('NFD').charAt(0).toUpperCase();
      const k = /[A-Z]/.test(l) ? l : '#';
      const a = m.get(k);
      if (a) a.push(h);
      else m.set(k, [h]);
    }
    return [...m.entries()];
  }, [shown]);

  const people = shown.reduce((n, h) => n + h.members.length, 0);
  const downloadAll = () => {
    const cards = shown.flatMap((h) => h.members.map((m) => vcard(m, h.rows.get(m.id) ?? [], f)));
    download(`${tree}-contacts.vcf`, 'text/vcard', cards.join('\r\n') + '\r\n');
    play('chime');
  };
  const clear = () => {
    setQ('');
    setOnlyPhone(false);
    setOnlyAddress(false);
    setOnlyClose(false);
  };
  const noData = !isPending && households.length === 0;

  return (
    <div className="page">
      <div className="page-inner con">
        <header className="con-head">
          <div>
            <h1>Contacts</h1>
            <p className="muted">
              {isPending
                ? 'Opening the address book…'
                : noData
                  ? 'Nobody has contact details yet'
                  : `${households.length} ${households.length === 1 ? 'household' : 'households'} · ${households.reduce((n, h) => n + h.members.length, 0)} people with details`}
            </p>
          </div>
          <button className="btn" onClick={downloadAll} disabled={!shown.length} title="Save everyone shown as a .vcf file for your phone or address book">
            <Download size={16} /> Download vCard{shown.length ? ` (${people})` : ''}
          </button>
        </header>

        <div className="con-tools" role="search">
          <label className="con-search">
            <Search size={16} />
            <input
              className="input"
              type="search"
              placeholder="Search names, numbers, streets…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search contacts"
            />
          </label>
          <div className="con-filters">
            <button className="btn" aria-pressed={onlyPhone} onClick={() => setOnlyPhone(!onlyPhone)}>
              <Phone size={14} /> Has phone
            </button>
            <button className="btn" aria-pressed={onlyAddress} onClick={() => setOnlyAddress(!onlyAddress)}>
              <Home size={14} /> Has address
            </button>
            <button className="btn" aria-pressed={onlyClose} onClick={() => setOnlyClose(!onlyClose)} title="You, your partner, parents, children, siblings and grandparents or grandchildren">
              <BookUser size={14} /> Close family
            </button>
            {filtering && (
              <button className="btn ghost" onClick={clear}>
                <X size={14} /> Clear
              </button>
            )}
          </div>
        </div>

        {noData && (
          <div className="con-empty panel">
            <BookUser size={28} />
            <h2 className="display">An empty address book</h2>
            <p className="muted">
              Open anyone on the tree and add a phone number, email or address. Households fill in here on their own: partners who share an address,
              with their children.
            </p>
          </div>
        )}

        {!noData && shown.length === 0 && (
          <div className="con-empty panel">
            <Search size={26} />
            <h2 className="display">No one matches</h2>
            <p className="muted">Try fewer words or switch a filter off.</p>
            <button className="btn" onClick={clear}>
              Clear filters
            </button>
          </div>
        )}

        {letters.map(([letter, hs]) => (
          <section key={letter} className="con-letter-row">
            <div className="con-letter display" aria-hidden>{letter}</div>
            <div className="con-grid">
              {hs.map((h) => (
                <HouseholdCard key={h.id} h={h} f={f} tree={tree} />
              ))}
            </div>
          </section>
        ))}

        {shownNoDetails.length > 0 && (
          <section className="con-nodetails" aria-labelledby="nod">
            <h2 id="nod" className="rule">
              No details yet <span className="chip">{shownNoDetails.length}</span>
            </h2>
            <p className="muted con-nod-note">Living relatives with no phone, email or address on file.</p>
            <ul className="con-nod-list">
              {(allNoDetails ? shownNoDetails : shownNoDetails.slice(0, 36)).map((p) => (
                <li key={p.id}>
                  <Portrait person={p} tree={tree} size={36} />
                  <span className="con-nod-name">{displayName(p, f)}</span>
                  <Link className="btn ghost" to="/$tree" params={{ tree }} search={{ focus: p.id }}>
                    <UserPlus size={14} /> Add
                  </Link>
                </li>
              ))}
            </ul>
            {shownNoDetails.length > 36 && (
              <button className="btn" onClick={() => setAllNoDetails(!allNoDetails)}>
                {allNoDetails ? 'Show fewer' : `Show all ${shownNoDetails.length}`}
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

// ---------- cards ----------

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      className="btn ghost icon con-copy"
      aria-label={`Copy ${label}`}
      title={done ? 'Copied' : `Copy ${label}`}
      data-done={done || undefined}
      onClick={() => {
        navigator.clipboard
          ?.writeText(value)
          .then(() => {
            play('tick');
            setDone(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setDone(false), 1200);
          })
          .catch(() => {});
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
      <span className="con-sr" role="status">{done ? 'Copied' : ''}</span>
    </button>
  );
}

const ICONS = { phone: Phone, email: Mail, address: MapPin, web: Globe, messenger: MessageCircle };

function ContactLine({ r }: { r: Row }) {
  const Icon = ICONS[r.kind];
  const href =
    r.kind === 'phone' ? `tel:${r.value.replace(/[^\d+]/g, '')}` : r.kind === 'email' ? `mailto:${r.value}` : r.kind === 'web' ? webHref(r.value) : undefined;
  const map = r.kind === 'address' ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(r.value)}` : undefined;
  return (
    <li className="con-line" data-kind={r.kind}>
      <Icon size={15} />
      {r.label && <span className="con-label">{r.label}</span>}
      {href ? (
        <a href={href} className="con-value" {...(r.kind === 'web' ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>
          {r.value}
        </a>
      ) : (
        <span className="con-value">{r.value}</span>
      )}
      {map && (
        <a className="btn ghost icon con-copy" href={map} target="_blank" rel="noreferrer noopener" aria-label="Open on a map" title="Open on a map">
          <MapPin size={14} />
        </a>
      )}
      <CopyButton value={r.value} label={r.kind} />
    </li>
  );
}

/** The house most of the card belongs to, when at least two people share one. */
function sharedHouse(h: Household, f: Family) {
  const n = new Map<string, number>();
  for (const m of h.members) if (m.house) n.set(m.house, (n.get(m.house) ?? 0) + 1);
  const [id, c] = [...n.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  return id && c >= 2 ? f.house.get(id) : undefined;
}

function HouseholdCard({ h, f, tree }: { h: Household; f: Family; tree: string }) {
  const house = sharedHouse(h, f);
  return (
    <article className="con-card panel" data-house={house ? true : undefined}>
      {house && (
        <header className="con-house">
          <Arms arms={house.arms} size={22} />
          <span className="display">{house.name}</span>
          <span className="con-house-n">{h.members.length}</span>
        </header>
      )}
      {h.members.map((m) => {
        const bd = nextBirthday(m);
        const mine = (h.rows.get(m.id) ?? []).filter((r) => r.kind !== 'address');
        const years = ageOf(m);
        return (
          <div key={m.id} className="con-member">
            <div className="con-who">
              <Portrait person={m} tree={tree} size={50} />
              <div className="con-id">
                <Link to="/$tree" params={{ tree }} search={{ focus: m.id }} className="con-name">
                  {displayName(m, f)}
                </Link>
                <div className="con-sub">
                  {m.nickname && <span className="con-nick">“{m.nickname}”</span>}
                  {years !== undefined && <span>{years} {years === 1 ? 'year' : 'years'}</span>}
                  {bd && (
                    <span className="con-bday" data-soon={bd.days <= 14 || undefined}>
                      <GameIcon name="cake-slice" size={14} />
                      {bd.days === 0 ? 'Birthday today' : bd.days === 1 ? 'Birthday tomorrow' : `${bd.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, turns ${bd.turns}`}
                    </span>
                  )}
                </div>
              </div>
              <button
                className="btn ghost icon"
                aria-label={`Download ${m.given}'s vCard`}
                title="Download vCard"
                onClick={() => download(`${m.given.toLowerCase()}-${m.id}.vcf`.replace(/[^a-z0-9._-]+/g, '_'), 'text/vcard', vcard(m, h.rows.get(m.id) ?? [], f) + '\r\n')}
              >
                <Download size={15} />
              </button>
            </div>
            {mine.length > 0 && (
              <ul className="con-lines">
                {mine.map((r) => (
                  <ContactLine key={r.id} r={r} />
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {h.addresses.length > 0 && (
        <ul className="con-lines con-home">
          {h.addresses.map((r) => (
            <ContactLine key={r.id} r={r} />
          ))}
        </ul>
      )}
    </article>
  );
}
