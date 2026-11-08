import { socialLink } from '~/lib/social';
import { useToday } from '~/lib/clock';
import { PageHeader, Skeleton, ErrorState } from '~/components/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { BookUser, Check, Copy, Download, Globe, Home, Mail, MapPin, MessageCircle, Phone, Search, UserPlus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GameIcon } from '~/components/GameIcon';
import { Arms } from '~/components/Heraldry';
import { Portrait } from '~/components/Portrait';
import { PortraitZoom } from '~/components/photos/PortraitZoom';
import { contactsQuery } from '~/lib/api';
import { VisibilityMark } from '~/components/fields/VisibilityMark';
import { useFamily, useMeChosen, useTreeId } from '~/lib/family';
import { play } from '~/lib/sfx';
import { locales, useT, type Key, type Translator } from '~/lib/i18n';
import { age as ageOf, ageAt, children, displayName, partnersOf, parents, siblings, type Family } from '~/lib/graph';
import type { GPerson } from '~/lib/types';
import { buildHouseholds, type Household, type Row } from '~/lib/contact-households';
import '~/styles/contacts.css';
import { sectionHead } from '~/lib/title';

export const Route = createFileRoute('/$tree/contacts')({
  head: sectionHead('Contacts'),
  component: ContactsPage,
});

/** You, your partner, parents, children, siblings, grandparents and grandchildren. */
function closeFamily(f: Family, me: string): Set<string> {
  const out = new Set<string>([me, ...partnersOf(f, me), ...parents(f, me), ...children(f, me), ...siblings(f, me)]);
  for (const p of parents(f, me)) for (const g of parents(f, p)) out.add(g);
  for (const c of children(f, me)) for (const g of children(f, c)) out.add(g);
  return out;
}

// ---------- helpers ----------

const DAY = 86_400_000;
function nextBirthday(p: GPerson, today: Date): { days: number; turns: number; date: Date } | undefined {
  const m = p.born && /^(\d{4})-(\d\d)-(\d\d)$/.exec(p.born);
  if (!m || !p.living) return undefined;
  for (let y = today.getFullYear(); ; y++) {
    const leapless = +m[2] === 2 && +m[3] === 29 && !((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0);
    const d = new Date(y, +m[2] - 1, leapless ? 28 : +m[3]);
    if (d >= today) return { days: Math.round((d.getTime() - today.getTime()) / DAY), turns: y - +m[1], date: d };
  }
}

const vEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
function vcard(p: GPerson, all: Row[], f: Family): string {
  // A card is a file that leaves the app, so it holds only what every member may read, whoever makes it.
  const rows = all.filter((r) => r.visibility === 'family');
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
  const t = useT();
  const f = useFamily();
  const me = useMeChosen();
  const tree = useTreeId();
  usePageTrail('contacts', tree);
  const { data, isPending, isError, refetch } = useQuery(contactsQuery(tree));
  const [q, setQ] = useRememberedState(`contacts:${tree}:q`, '');
  const [dq] = useDebouncedValue(q, { wait: 180 });
  const [onlyPhone, setOnlyPhone] = useRememberedState(`contacts:${tree}:onlyPhone`, false);
  const [onlyAddress, setOnlyAddress] = useRememberedState(`contacts:${tree}:onlyAddress`, false);
  const [onlyClose, setOnlyClose] = useRememberedState(`contacts:${tree}:onlyClose`, false);
  const [allNoDetails, setAllNoDetails] = useRememberedState(`contacts:${tree}:allNoDetails`, false);

  const [kidsWithParent, setKidsWithParent] = useRememberedState(`contacts:${tree}:kidsWithParent`, false);
  const built = useMemo(() => {
    const rows = (data ?? []) as Row[];
    const base = buildHouseholds(f, rows);
    const withKids = buildHouseholds(f, rows, { childrenWithParent: true });
    return { base, withKids, kids: base.noDetails.length - withKids.noDetails.length };
  }, [f, data]);
  const { households, noDetails } = kidsWithParent ? built.withKids : built.base;
  const close = useMemo(() => (onlyClose && me ? closeFamily(f, me) : null), [f, me, onlyClose]);

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
  const noData = !isPending && !isError && households.length === 0;

  return (
    <div className="page">
      <div className="page-inner con">
        <PageHeader title={t('con.titleLabel')} subtitle={<>
              {isPending
                ? t('con.opening')
                : noData
                  ? t('con.noneYet')
                  : `${t('con.households', { count: households.length })} · ${t('con.peopleWithDetails', { count: households.reduce((n, h) => n + h.members.length, 0) })}`}
            </>} actions={<><button className="btn" onClick={downloadAll} disabled={!shown.length} title={t('con.downloadTitle')}>
            <Download size={16} /> {t('con.downloadVcard')}{shown.length ? ` (${people})` : ''}
          </button></>} />

        {isPending && <div className="page-loading" aria-busy="true" aria-label={t('con.loadingAria')}>{Array.from({ length: 4 }, (_, i) => <div className="ui-card" key={i} style={{ padding: 20, marginBottom: 12 }}><Skeleton width={48} height={48} radius="50%" /><Skeleton lines={3} /></div>)}</div>}
        {isError && <ErrorState title={t('con.errorTitle')} message={t('con.errorText')} onRetry={() => { void refetch(); }} />}
        {!isPending && !isError && <>
        <div className="con-tools" role="search">
          <label className="con-search">
            <Search size={16} />
            <input
              className="input"
              type="search"
              placeholder={t('con.searchPlaceholder')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label={t('con.searchAria')}
            />
          </label>
          <div className="con-filters">
            <button className="btn" aria-pressed={onlyPhone} onClick={() => setOnlyPhone(!onlyPhone)}>
              <Phone size={14} /> {t('con.hasPhone')}
            </button>
            <button className="btn" aria-pressed={onlyAddress} onClick={() => setOnlyAddress(!onlyAddress)}>
              <Home size={14} /> {t('con.hasAddress')}
            </button>
            <button className="btn" disabled={!me} aria-pressed={onlyClose} onClick={() => setOnlyClose(!onlyClose)} title={t('con.closeFamilyTitle')}>
              <BookUser size={14} /> {t('con.closeFamily')}
            </button>
            {filtering && (
              <button className="btn ghost" onClick={clear}>
                <X size={14} /> {t('con.clear')}
              </button>
            )}
          </div>
        </div>

        {noData && (
          <div className="con-empty ui-card">
            <BookUser size={28} />
            <h2 className="display">{t('con.emptyTitle')}</h2>
            <p className="muted">{t('con.emptyText')}</p>
          </div>
        )}

        {!noData && shown.length === 0 && shownNoDetails.length === 0 && (
          <div className="con-empty ui-card">
            <Search size={26} />
            <h2 className="display">{t('con.noMatchTitle')}</h2>
            <p className="muted">{t('con.noMatchText')}</p>
            <button className="btn" onClick={clear}>{t('con.clearFilters')}</button>
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

        {!noData && (built.kids > 0 || kidsWithParent) && (
          <details className="con-kids">
            <summary>{t('con.kidsTitle')}</summary>
            <label className="con-kids-opt">
              <input type="checkbox" checked={kidsWithParent} onChange={(e) => setKidsWithParent(e.target.checked)} />
              <span>{t('con.kidsOption')}</span>
            </label>
            <p className="muted">{t('con.kidsText')}</p>
          </details>
        )}

        {!noData && shownNoDetails.length > 0 && (
          <section className="con-nodetails" aria-labelledby="nod">
            <h2 id="nod" className="rule">
              {t('con.noDetailsTitle')} <span className="chip">{shownNoDetails.length}</span>
            </h2>
            <p className="muted con-nod-note">{t('con.noDetailsText')}</p>
            <ul className="con-nod-list">
              {(allNoDetails ? shownNoDetails : shownNoDetails.slice(0, 36)).map((p) => (
                <li key={p.id}>
                  <Portrait person={p} tree={tree} size={36} />
                  <span className="con-nod-name">{displayName(p, f)}</span>
                  <Link className="btn ghost" to="/$tree" params={{ tree }} search={{ focus: p.id }}>
                    <UserPlus size={14} /> {t('con.add')}
                  </Link>
                </li>
              ))}
            </ul>
            {shownNoDetails.length > 36 && (
              <button className="btn" onClick={() => setAllNoDetails(!allNoDetails)}>
                {allNoDetails ? t('con.showFewer') : t('con.showAll', { count: shownNoDetails.length })}
              </button>
            )}
          </section>
        )}
        </>}
      </div>
    </div>
  );
}

// ---------- cards ----------

function CopyButton({ value, label }: { value: string; label: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      className="btn ghost icon con-copy"
      aria-label={t('con.copyLabel', { label })}
      title={done ? t('con.copied') : t('con.copyLabel', { label })}
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
      <span className="con-sr" role="status">{done ? t('con.copied') : ''}</span>
    </button>
  );
}

const ICONS = { phone: Phone, email: Mail, address: MapPin, web: Globe, messenger: MessageCircle };
const KIND_KEY: Record<Row['kind'], Key> = { phone: 'con.kind.phone', email: 'con.kind.email', address: 'con.kind.address', web: 'con.kind.web', messenger: 'con.kind.messenger' };

function ContactLine({ r }: { r: Row }) {
  const t = useT();
  const Icon = ICONS[r.kind];
  const href =
    r.kind === 'phone' ? `tel:${r.value.replace(/[^\d+]/g, '')}` : r.kind === 'email' ? `mailto:${r.value}` : r.kind === 'web' ? webHref(r.value) : undefined;
  const social = r.kind === 'messenger' ? socialLink(r.value, r.label ?? '') : null;
  const map = r.kind === 'address' ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(r.value)}` : undefined;
  return (
    <li className="con-line" data-kind={r.kind}>
      <Icon size={15} />
      {r.label && !social && <span className="con-label">{r.label}</span>}
      <VisibilityMark level={r.visibility} />
      {social ? (
        <a href={social.href} className="con-value" target="_blank" rel="noopener noreferrer">{social.network} · {social.handle}</a>
      ) : href ? (
        <a href={href} className="con-value" {...(r.kind === 'web' ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>
          {r.value}
        </a>
      ) : (
        <span className="con-value">{r.value}</span>
      )}
      {map && (
        <a className="btn ghost icon con-copy" href={map} target="_blank" rel="noreferrer noopener" aria-label={t('con.openMap')} title={t('con.openMap')}>
          <MapPin size={14} />
        </a>
      )}
      <CopyButton value={r.value} label={t(KIND_KEY[r.kind])} />
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
  const t = useT();
  const house = sharedHouse(h, f);
  const today = useToday();
  return (
    <article className="con-card ui-card" data-house={house ? true : undefined}>
      {house && (
        <header className="con-house">
          <Arms arms={house.arms} size={22} />
          <span className="display">{house.name}</span>
          <span className="con-house-n">{h.members.length}</span>
        </header>
      )}
      {h.members.map((m) => {
        const bd = today ? nextBirthday(m, today) : undefined;
        const mine = (h.rows.get(m.id) ?? []).filter((r) => r.kind !== 'address');
        const years = today ? ageOf(m, today) : undefined;
        return (
          <div key={m.id} className="con-member">
            <div className="con-who">
              <PortraitZoom person={m} tree={tree} size={50} />
              <div className="con-id">
                <Link to="/$tree/person/$id" params={{ tree, id: m.id }} className="con-name">
                  {displayName(m, f)}
                </Link>
                <div className="con-sub">
                  {m.nickname && <span className="con-nick">“{m.nickname}”</span>}
                  {years !== undefined && <span>{t('con.years', { count: years })}</span>}
                  {bd && (
                    <span className="con-bday" data-soon={bd.days <= 14 || undefined}>
                      <GameIcon name="cake-slice" size={14} />
                      {bd.days === 0 ? t('con.birthdayToday') : bd.days === 1 ? t('con.birthdayTomorrow') : t('con.birthdayOn', { date: bd.date.toLocaleDateString(locales[t.locale], { day: 'numeric', month: 'short' }), n: bd.turns })}
                    </span>
                  )}
                </div>
              </div>

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
      {/* The card's actions, after what they act on. */}
      <footer className="con-actions">
        <button
          className="btn ghost con-download"
          aria-label={h.members.length > 1 ? t('con.saveMany', { count: h.members.length }) : t('con.saveOne', { name: h.members[0] ? displayName(h.members[0], f) : t('con.saveFallback') })}
          onClick={() => download(`${tree}-${h.id}.vcf`, 'text/vcard', h.members.map((m) => vcard(m, h.rows.get(m.id) ?? [], f)).join('\r\n'))}
        >
          <Download size={15} /> {t('con.saveButton', { count: h.members.length })}
        </button>
      </footer>
    </article>
  );
}

// Restore after hydration, so stored preferences never change server-rendered markup.
function useRememberedState<T>(key: string, fallback: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(fallback);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(key);
      if (stored !== null) setValue(JSON.parse(stored) as T);

    } catch { /* Private browsing can disable storage. */ }
    setReady(true);
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(value));

    } catch { /* Keeping filters in memory still works. */ }
  }, [key, value, ready]);
  return [value, setValue];
}
function usePageTrail(page: string, tree: string) {
  useEffect(() => {
    const key = `kindred:scroll:${tree}:${page}`;
    const restore = () => {
      try {
        const saved = JSON.parse(sessionStorage.getItem(key) ?? '{}') as Record<string, number>;
        for (const selector of [':root', '.page', '.reg-scroll']) {
          const el = document.querySelector(selector);
          if (el) el.scrollTop = saved[selector] ?? 0;
        }
      } catch {}
    };
    const timer = window.setTimeout(() => { restore(); document.addEventListener('scroll', scroll, true); }, 450);
    const scroll = () => {
      try { sessionStorage.setItem(key, JSON.stringify(Object.fromEntries([':root', '.page', '.reg-scroll'].map((selector) => [selector, document.querySelector(selector)?.scrollTop ?? 0])))); } catch {}
    };
    const click = (event: MouseEvent) => {
      const link = (event.target as Element).closest('a');
      if (!link) return;
      const url = new URL(link.href);
      const person = url.searchParams.get('focus');
      if (person && url.pathname === `/${tree}`) {
        try { localStorage.setItem('kindred:last-visit', JSON.stringify({ tree, person, name: link.textContent?.trim() || 'your family' })); } catch {}
      }
    };
    document.addEventListener('click', click, true);
    return () => { clearTimeout(timer); document.removeEventListener('scroll', scroll, true); document.removeEventListener('click', click, true); };
  }, [page, tree]);
}
