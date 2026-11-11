// What live presence shows: the faces of who else is in the family now (in the top bar, with a list of who is on which
// page), the faces of those on the same page, "Anna is here" / "Anna is editing Carl" on a person, and a soft halo on a
// card someone else has selected. Calm on purpose: no motion beyond a fade, none at all with reduced motion.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { displayName } from '~/lib/graph';
import { useFamily } from '~/lib/family';
import { relativeTime, useT, type Key } from '~/lib/i18n';
import type { Present } from '~/lib/presence/shared';
import { useOverlayLayer, isTopOverlay } from '../ui';
import { Portrait } from '../Portrait';
import { usePresence } from './PresenceHost';
import './presence.css';

const hueStyle = (hue: number) => ({ '--presence-hue': String(hue) }) as CSSProperties;

/** One member's small face: their person's portrait when they have said who they are, else their initial. */
export function Face({ who, size = 24 }: { who: Pick<Present, 'name' | 'person' | 'hue'>; size?: number }) {
  const f = useFamily();
  const p = who.person ? f.byId.get(who.person) : undefined;
  return (
    <span className="presence-face" style={{ ...hueStyle(who.hue), width: size, height: size }} title={who.name} aria-hidden>
      {p ? <Portrait person={p} tree={f.graph.tree.id} size={size} frame={false} decorative /> : <span className="presence-initial">{who.name.trim().slice(0, 1).toUpperCase()}</span>}
    </span>
  );
}

function Stack({ people, max = 3, size = 24 }: { people: Present[]; max?: number; size?: number }) {
  const shown = people.slice(0, max);
  return (
    <span className="presence-stack">
      {shown.map((p) => <Face key={p.account} who={p} size={size} />)}
      {people.length > max && <span className="presence-more" aria-hidden>+{people.length - max}</span>}
    </span>
  );
}

/** "Anna", "Anna and Bram", "Anna, Bram and Cora". */
function useNames() {
  const t = useT();
  return (people: Pick<Present, 'name'>[]) => {
    const names = people.map((p) => p.name);
    if (names.length <= 1) return names[0] ?? '';
    return t('presence.and', { first: names.slice(0, -1).join(', '), second: names[names.length - 1]! });
  };
}

/** The top bar's "2 here now": a stack of faces that opens the list of who is on which page. */
export function HereNow() {
  const t = useT();
  const { roster } = usePresence();
  const [open, setOpen] = useState(false);
  const layer = useOverlayLayer(open);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && isTopOverlay(layer)) { e.preventDefault(); setOpen(false); button.current?.focus(); } };
    const press = (e: PointerEvent) => { if (!list.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', press);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('pointerdown', press); };
  }, [open, layer]);
  useLayoutEffect(() => {
    if (!open) return;
    const r = button.current?.getBoundingClientRect();
    if (r) setPos({ top: Math.round(r.bottom + 6), right: Math.max(8, Math.round(window.innerWidth - r.right)) });
  }, [open]);

  if (!roster) return null;
  const here = roster.here;
  if (!here.length && !roster.last) return null;
  const label = here.length ? t('presence.here_now', { count: here.length }) : t('presence.last_here', { name: roster.last!.name, ago: relativeTime(roster.last!.at, t.locale) });
  return (
    <>
      <button ref={button} type="button" className={`presence-here${here.length ? '' : ' presence-quiet'}`} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)} title={label}>
        {here.length ? <Stack people={here} /> : <Face who={{ name: roster.last!.name, person: roster.last!.person, hue: 0 }} size={22} />}
        <span className="presence-label">{label}</span>
      </button>
      {open && (
        <div ref={list} className="presence-list" role="dialog" aria-label={t('presence.list_title')} style={pos ? { top: pos.top, right: pos.right } : { visibility: 'hidden' }}>
          <b>{t('presence.list_title')}</b>
          {here.length ? (
            <>
              <small>{t('presence.list_hint')}</small>
              <ul>
                {here.map((p) => (
                  <li key={p.account}>
                    <Face who={p} size={28} />
                    <span>{t('presence.on_page', { name: p.name, page: t(`presence.route.${p.route}` as Key) })}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <small>{t('presence.alone')}</small>
              <p>{label}</p>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** The faces of others on this same page, in a corner. Not on the tree and a profile, which show it on the person. */
export function PageFaces() {
  const t = useT();
  const { roster, route } = usePresence();
  const same = useMemo(() => (roster && route ? roster.here.filter((p) => p.route === route && !['elsewhere', 'tree', 'person'].includes(route)) : []), [roster, route]);
  if (!same.length) return null;
  return (
    <div className="presence-page" role="status" aria-label={t('presence.also_here')}>
      <Stack people={same} size={26} />
      <span className="sr-only">{same.map((p) => p.name).join(', ')}</span>
    </div>
  );
}

/** Who else has this person open: "Anna is editing Carl", or "Anna is here". Shown in the person's panel and profile. */
export function PresenceNote({ person }: { person: string }) {
  const t = useT();
  const f = useFamily();
  const names = useNames();
  const { roster } = usePresence();
  const on = roster?.here.filter((p) => p.focus === person) ?? [];
  if (!on.length) return null;
  const editing = on.filter((p) => p.editing);
  const p = f.byId.get(person);
  const text = editing.length
    ? t('presence.is_editing', { name: names(editing), person: p ? displayName(p, f) : '' })
    : on.length === 1 ? t('presence.is_here', { name: on[0]!.name }) : t('presence.are_here', { names: names(on) });
  return (
    <p className={`presence-note${editing.length ? ' editing' : ''}`} role="status" style={hueStyle((editing[0] ?? on[0]!).hue)}>
      <Stack people={editing.length ? editing : on} size={22} /> <span>{text}</span>
    </p>
  );
}

/** Who has each person selected, for the tree's cards. */
export function useWatchers(): Map<string, Present[]> {
  const { roster } = usePresence();
  return useMemo(() => {
    const m = new Map<string, Present[]>();
    for (const p of roster?.here ?? []) if (p.focus) m.set(p.focus, [...(m.get(p.focus) ?? []), p]);
    return m;
  }, [roster]);
}

/** The halo's face on a card, and the colour of the first who has it selected. */
export function CardWatchers({ watchers, name }: { watchers: Present[]; name: string }) {
  const t = useT();
  const names = useNames();
  const title = t('presence.has_selected', { name: names(watchers), person: name });
  return (
    <span className="card-watchers" title={title}>
      <Stack people={watchers} max={2} size={20} />
      <span className="sr-only">{title}</span>
    </span>
  );
}

export const watchedStyle = (watchers: Present[] | undefined) => (watchers?.length ? hueStyle(watchers[0]!.hue) : undefined);
