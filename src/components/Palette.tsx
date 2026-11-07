// ⌘K: jump to anyone by name, nickname, epithet, title or place; or run a command.
import { useHotkey } from '@tanstack/react-hotkeys';
import { useNavigate } from '@tanstack/react-router';
import { CalendarHeart, Contact, Map as MapIcon, Crown, GitFork, Moon, Network, Palette as PaletteIcon, ScrollText, Sun, UserRound } from 'lucide-react';
import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useFamily, useMe, useMeChosen, useTreeId } from '~/lib/family';
import { displayName, kinship, lifespan, ancestorDepths, type Family } from '~/lib/graph';
import { setPref } from '~/lib/prefs';
import { play } from '~/lib/sfx';
import { Portrait } from './Portrait';
import { Dialog } from './ui/Dialog';
import './palette.css';

let isOpen = false;
const subs = new Set<() => void>();
const set = (v: boolean) => ((isOpen = v), subs.forEach((s) => s()));
export function usePalette() {
  const open = useSyncExternalStore((l) => (subs.add(l), () => subs.delete(l)), () => isOpen, () => false);
  return { isOpen: open, open: () => set(true), close: () => set(false) };
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

interface Item {
  key: string;
  icon?: ReactNode;
  person?: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function searchPeople(f: Family, q: string, limit = 40): { id: string; score: number }[] {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const out: { id: string; score: number }[] = [];
  for (const p of f.graph.people) {
    const name = fold([p.given, p.surname, p.nickname].filter(Boolean).join(' '));
    const extra = fold([p.epithet, p.title, p.occupation, f.house.get(p.house ?? '')?.name].filter(Boolean).join(' '));
    let score = 0;
    for (const t of terms) {
      if (name.split(' ').some((w) => w.startsWith(t))) score += 10;
      else if (name.includes(t)) score += 5;
      else if (extra.includes(t)) score += 2;
      else { score = 0; break; }
    }
    if (score) out.push({ id: p.id, score: score + (p.living ? 1 : 0) + Math.min(p.stories, 5) * 0.2 + (p.title ? 0.5 : 0) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function Palette() {
  const { isOpen, open, close } = usePalette();
  const f = useFamily();
  const tree = useTreeId();
  const me = useMe();
  // Kinship hints only once the reader has said who they are.
  const who = useMeChosen();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const dq = useDeferredValue(q);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // While open, the dialog keeps keys to itself, so ⌘K inside it is handled on the input below.
  useHotkey('Mod+K', () => (isOpen ? close() : open()), { ignoreInputs: false });
  useHotkey('/', () => open(), { enabled: !isOpen });
  useEffect(() => {
    if (isOpen) {
      setQ('');
      setSel(0);
    }
  }, [isOpen]);

  const myAnc = useMemo(() => (who ? ancestorDepths(f, who) : new Map<string, number>()), [f, who]);
  const items: Item[] = useMemo(() => {
    const go = (focus: string) => () => { navigate({ to: '/$tree', params: { tree }, search: (s: any) => ({ ...s, focus, sel: undefined, root: undefined }) }); close(); };
    const people = searchPeople(f, dq).map(({ id }) => {
      const p = f.byId.get(id)!;
      const k = who ? kinship(f, who, id, myAnc)?.label : undefined;
      return { key: id, person: id, label: displayName(p, f), hint: [lifespan(p), k && k !== 'you' ? `your ${k}` : k].filter(Boolean).join(' · '), run: go(id) };
    });
    const cmds: Item[] = [
      { key: 'v-family', icon: <Network size={16} />, label: 'View: Family (hourglass)', run: () => { navigate({ to: '/$tree', params: { tree }, search: (s: any) => ({ ...s, view: 'family' }) }); close(); } },
      { key: 'v-dynasty', icon: <Crown size={16} />, label: 'View: Dynasty tree', run: () => { navigate({ to: '/$tree', params: { tree }, search: (s: any) => ({ ...s, view: 'dynasty' }) }); close(); } },
      { key: 'v-anc', icon: <GitFork size={16} style={{ transform: 'rotate(180deg)' }} />, label: 'View: Ancestors', run: () => { navigate({ to: '/$tree', params: { tree }, search: (s: any) => ({ ...s, view: 'ancestors' }) }); close(); } },
      { key: 'me', icon: <UserRound size={16} />, label: who ? 'Go to me' : 'Go home', hint: displayName(f.byId.get(me)!, f), run: go(me) },
      { key: 'almanac', icon: <CalendarHeart size={16} />, label: 'Open Almanac', hint: 'birthdays & anniversaries', run: () => { navigate({ to: '/$tree/almanac', params: { tree } }); close(); } },
      { key: 'atlas', icon: <MapIcon size={16} />, label: 'Open Atlas', hint: 'where the family was born', run: () => { navigate({ to: '/$tree/atlas', params: { tree } }); close(); } },
      { key: 'contacts', icon: <Contact size={16} />, label: 'Open Contacts', run: () => { navigate({ to: '/$tree/contacts', params: { tree } }); close(); } },
      { key: 'chronicle', icon: <ScrollText size={16} />, label: 'Open Chronicle', hint: 'stories & sayings', run: () => { navigate({ to: '/$tree/chronicle', params: { tree } }); close(); } },
      { key: 't-codex', icon: <PaletteIcon size={16} />, label: 'Theme: Codex', run: () => { setPref('theme', 'codex'); close(); } },
      { key: 't-paper', icon: <Sun size={16} />, label: 'Theme: Paper', run: () => { setPref('theme', 'modern'); close(); } },
      { key: 't-night', icon: <Moon size={16} />, label: 'Theme: Night', run: () => { setPref('theme', 'night'); close(); } },
    ];
    const fq = fold(dq);
    const matched = fq ? cmds.filter((c) => fold(c.label).includes(fq)) : cmds;
    return fq ? [...people, ...matched] : matched;
  }, [f, dq, me, who, myAnc, navigate, tree, close]);

  useEffect(() => setSel(0), [dq]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  return (
    <Dialog open={isOpen} onClose={close} label="Find anyone" placement="top" width={640} bare className="palette" initialFocus={input}>
        <input
          ref={input}
          className="palette-input"
          placeholder="Find anyone — name, nickname, title, house…"
          aria-label="Find anyone"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={items[sel] ? `palette-i${sel}` : undefined}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === 'Enter') { play('tick'); items[sel]?.run(); }
            else if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); close(); }
          }}
        />
        <div className="palette-list" ref={list} id="palette-list" role="listbox" aria-label="Results">
          {items.length === 0 && <div className="empty">Nobody by that name. Yet.</div>}
          {items.map((it, i) => (
            <Fragment key={it.key}>
            {(i === 0 || !!items[i - 1].person !== !!it.person) && <div className="palette-group">{it.person ? 'People' : 'Commands'}</div>}
            <button data-i={i} id={`palette-i${i}`} role="option" tabIndex={-1} className="palette-item" aria-selected={i === sel} onMouseMove={() => setSel(i)} onClick={it.run}>
              <span className="palette-icon">
                {it.person ? <Portrait person={f.byId.get(it.person)!} tree={tree} size={30} frame={false} /> : it.icon}
              </span>
              <span className="palette-label">{it.label}</span>
              {it.hint && <span className="palette-hint">{it.hint}</span>}
            </button>
            </Fragment>
          ))}
        </div>
        <div className="palette-foot muted">
          <span><kbd>↑</kbd> <kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> go</span>
          <span><kbd>esc</kbd> close</span>
          <span style={{ marginLeft: 'auto' }}>{f.graph.people.length.toLocaleString('en-GB')} people</span>
        </div>
    </Dialog>
  );
}
