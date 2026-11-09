import { kinshipLabel, LANGUAGE_NAME, LOCALES, useT, type Translator } from '~/lib/i18n';
import { matchesName } from '~/lib/search';
import { occupationSearchText } from '~/lib/occupations';
// ⌘K: jump to anyone by name, nickname, epithet, title or place; or run a command.
import { useHotkey } from '@tanstack/react-hotkeys';
import { useNavigate } from '@tanstack/react-router';
import { CalendarHeart, CircleHelp, Contact, Landmark, Languages, Map as MapIcon, Crown, GitFork, Moon, Network, ScrollText, Shield, Sparkles, Sun, UserRound, FolderSearch, Inbox, MessageSquarePlus } from 'lucide-react';
import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useFamily, useMe, useMeChosen, useTreeId } from '~/lib/family';
import { displayName, kinship, lifespan, ancestorDepths, type Family } from '~/lib/graph';
import { setPref } from '~/lib/prefs';
import { useCan, useSession } from '~/lib/session';
import { play } from '~/lib/sfx';
import { openAiSetup, openAssistant, useAiStatus } from './assistant/store';
import { useAiSetupNeeded } from './assistant/AiSetup';
import { Arms } from './Heraldry';
import { Flag } from './heraldry/Flag';
import { LANGUAGE_FLAG } from './LanguagePicker';
import { Portrait } from './Portrait';
import { Dialog } from './ui/Dialog';
import { reopenTour } from './FirstRun';
import { openFeedback } from './feedback/FeedbackHost';
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
  /** The heading it is listed under; people and commands by default. */
  group?: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function searchPeople(f: Family, q: string, limit = 40): { id: string; score: number }[] {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const out: { id: string; score: number }[] = [];
  for (const p of f.graph.people) {
    // Names first (any known name, in any order); the epithet, title, occupation and house also find someone.
    const named = matchesName(p, q);
    const name = fold([p.given, p.surname, p.nickname].filter(Boolean).join(' '));
    const extra = fold([p.epithet, p.title, p.occupation, occupationSearchText(p.occupationCode), f.house.get(p.house ?? '')?.name].filter(Boolean).join(' '));
    if (!named && !terms.every((t) => extra.includes(t))) continue;
    const score = named ? 10 + terms.filter((t) => name.split(' ').some((w) => w.startsWith(t))).length * 5 : 2;
    out.push({ id: p.id, score: score + (p.living ? 1 : 0) + Math.min(p.stories, 5) * 0.2 + (p.title ? 0.5 : 0) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** "1890–1960 · your great-uncle": life years, and kinship once the reader has said who they are. */
export function personHint(f: Family, id: string, who: string | null, anc: Map<string, number> | undefined, t: Translator): string {
  const p = f.byId.get(id);
  if (!p) return '';
  const k = who ? kinship(f, who, id, anc) : undefined;
  const kin = !k ? '' : k.label === 'you' ? t('common.you') : t('shell.palette.yourKin', { kin: kinshipLabel(k, t.locale) });
  return [lifespan(p, t.locale), kin].filter(Boolean).join(' · ');
}

/**
 * The palette's person row: portrait, name, then life years and "your …" kinship. Put it inside an
 * element with the `palette-item` class; `note` adds a second line under the name.
 */
export function PersonRow({ f, tree, id, who, anc, note }: { f: Family; tree: string; id: string; who: string | null; anc?: Map<string, number>; note?: ReactNode }) {
  const t = useT();
  const p = f.byId.get(id);
  if (!p) return null;
  const hint = personHint(f, id, who, anc, t);
  return (
    <>
      <span className="palette-icon"><Portrait person={p} tree={tree} size={30} frame={false} /></span>
      <span className="palette-label palette-name">{displayName(p, f)}{note && <small className="palette-note">{note}</small>}</span>
      {hint && <span className="palette-hint">{hint}</span>}
    </>
  );
}

const groupOf = (it: Item, t: Translator) => it.group ?? (it.person ? t('shell.palette.people') : t('shell.palette.commands'));

/** The commands this reader can use. A guest has no Contacts: the shell hides it and the guest host refuses it. */
export const commandsForReader = <T extends { key: string }>(cmds: T[], guest: boolean): T[] => (guest ? cmds.filter((c) => c.key !== 'contacts') : cmds);

export function Palette() {
  const t = useT();
  const { isOpen, open, close } = usePalette();
  const f = useFamily();
  const tree = useTreeId();
  const me = useMe();
  // Kinship hints only once the reader has said who they are.
  const who = useMeChosen();
  // The assistant is offered only when this family has it switched on (the drawer checks the same).
  const assistantOn = !!useAiStatus(tree)?.features.assistant;
  // A steward of a family with no AI key gets the set-up command in its place (the same panel as the top bar's button).
  const setupNeeded = useAiSetupNeeded(tree);
  const steward = useCan('manage-access');
  const guest = useSession()?.guest?.tree === tree;
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const dq = useDeferredValue(q);
  const [sel, setSel] = useState(0);
  // 'find' lists people and commands; 'language' lists the three languages, opened by "Change language".
  const [mode, setMode] = useState<'find' | 'language'>('find');
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // While open, the dialog keeps keys to itself, so ⌘K inside it is handled on the input below.
  useHotkey('Mod+K', () => (isOpen ? close() : open()), { ignoreInputs: false });
  useHotkey('/', () => open(), { enabled: !isOpen });
  useEffect(() => {
    if (isOpen) {
      setQ('');
      setSel(0);
      setMode('find');
    }
  }, [isOpen]);

  const myAnc = useMemo(() => (who ? ancestorDepths(f, who) : new Map<string, number>()), [f, who]);
  const items: Item[] = useMemo(() => {
    if (mode === 'language') {
      return LOCALES.map((l) => ({
        key: `lang-${l}`, icon: <Flag code={LANGUAGE_FLAG[l]} size={18} />, label: LANGUAGE_NAME[l], hint: l === t.locale ? t('shell.palette.current') : undefined,
        run: () => { t.setLocale(l); close(); },
      }));
    }
    const go = (focus: string) => () => { navigate({ to: '/$tree', params: { tree }, search: (s: any) => ({ ...s, focus, sel: undefined, root: undefined }) }); close(); };
    const people = searchPeople(f, dq).map(({ id }) => {
      const p = f.byId.get(id)!;
      return { key: id, person: id, label: displayName(p, f), hint: personHint(f, id, who, myAnc, t), run: () => { navigate({ to: '/$tree/person/$id', params: { tree, id } }); close(); } };
    });
    // Houses by name: straight to the house's page.
    const fqh = fold(dq.trim());
    const houses: Item[] = fqh
      ? f.graph.houses.filter((h) => fold(h.name).includes(fqh)).slice(0, 5).map((h) => ({
          key: `house:${h.id}`, group: t('shell.palette.houses'), icon: <Arms arms={h.arms} size={22} />, label: h.name, hint: t('shell.palette.house'),
          run: () => { navigate({ to: '/$tree/house/$house', params: { tree, house: h.id } }); close(); },
        }))
      : [];
    const cmds = commandsForReader<Item>([
      // Views first, then pages, then what you do rarely: settings, the tour, feedback.
      { key: 'v-family', icon: <Network size={16} />, label: t('shell.cmd.viewFamily'), run: () => { navigate({ to: '/$tree', params: { tree }, search: (s: any) => ({ ...s, view: 'family' }) }); close(); } },
      { key: 'v-dynasty', icon: <Crown size={16} />, label: t('shell.cmd.viewDynasty'), run: () => { navigate({ to: '/$tree', params: { tree }, search: (s: any) => ({ ...s, view: 'dynasty' }) }); close(); } },
      { key: 'v-anc', icon: <GitFork size={16} style={{ transform: 'rotate(180deg)' }} />, label: t('shell.cmd.viewAncestors'), run: () => { navigate({ to: '/$tree', params: { tree }, search: (s: any) => ({ ...s, view: 'ancestors' }) }); close(); } },
      // An empty family has nobody to go to yet.
      ...(f.byId.has(me) ? [{ key: 'me', icon: <UserRound size={16} />, label: who ? t('shell.cmd.goMe') : t('shell.cmd.goHome'), hint: displayName(f.byId.get(me)!, f), run: go(me) }] : []),
      { key: 'almanac', icon: <CalendarHeart size={16} />, label: t('shell.cmd.almanac'), hint: t('shell.cmd.almanacHint'), run: () => { navigate({ to: '/$tree/almanac', params: { tree } }); close(); } },
      { key: 'atlas', icon: <MapIcon size={16} />, label: t('shell.cmd.atlas'), hint: t('shell.cmd.atlasHint'), run: () => { navigate({ to: '/$tree/atlas', params: { tree } }); close(); } },
      { key: 'contacts', icon: <Contact size={16} />, label: t('shell.cmd.contacts'), run: () => { navigate({ to: '/$tree/contacts', params: { tree } }); close(); } },
      { key: 'chronicle', icon: <ScrollText size={16} />, label: t('shell.cmd.chronicle'), hint: t('shell.cmd.chronicleHint'), run: () => { navigate({ to: '/$tree/chronicle', params: { tree } }); close(); } },
      { key: 'research', icon: <FolderSearch size={16} />, label: t('research.title'), hint: t('research.cmd_hint'), run: () => { navigate({ to: '/$tree/research', params: { tree } }); close(); } },
      { key: 'houses', icon: <Landmark size={16} />, label: t('shell.cmd.houses'), hint: t('shell.cmd.housesHint'), run: () => { navigate({ to: '/$tree/houses', params: { tree } }); close(); } },
      ...(assistantOn ? [{ key: 'assistant', icon: <Sparkles size={16} />, label: t('ai.askCommand'), run: () => { close(); openAssistant(); } }] : []),
      ...(setupNeeded ? [{ key: 'ai-setup', icon: <Sparkles size={16} />, label: t('ai.setupCommand'), run: () => { close(); openAiSetup(); } }] : []),
      { key: 'language', icon: <Languages size={16} />, label: t('common.changeLanguage'), hint: LANGUAGE_NAME[t.locale], run: () => { setMode('language'); setQ(''); setSel(0); } },
      { key: 't-codex', icon: <Shield size={16} />, label: t('shell.cmd.themeCodex'), run: () => { setPref('theme', 'codex'); close(); } },
      { key: 't-paper', icon: <Sun size={16} />, label: t('shell.cmd.themePaper'), run: () => { setPref('theme', 'modern'); close(); } },
      { key: 't-night', icon: <Moon size={16} />, label: t('shell.cmd.themeNight'), run: () => { setPref('theme', 'night'); close(); } },
      { key: 'tour', icon: <CircleHelp size={16} />, label: t('shell.cmd.tour'), hint: t('shell.cmd.tourHint'), run: () => { close(); reopenTour(); } },
      ...(steward ? [
        { key: 'feedback', icon: <MessageSquarePlus size={16} />, label: t('feedback.menu'), hint: t('feedback.command_hint'), run: () => { close(); openFeedback(); } },
        { key: 'feedback-inbox', icon: <Inbox size={16} />, label: t('feedback.inbox'), hint: t('feedback.inbox_hint'), run: () => { navigate({ to: '/$tree/settings/feedback', params: { tree } }); close(); } },
      ] : []),
    ], guest);
    const fq = fold(dq);
    const matched = fq ? cmds.filter((c) => fold(c.label).includes(fq)) : cmds;
    return fq ? [...people, ...houses, ...matched] : matched;
  }, [f, dq, me, who, myAnc, navigate, tree, close, t, t.locale, assistantOn, setupNeeded, steward, guest, mode]);

  useEffect(() => setSel(0), [dq]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  return (
    <Dialog open={isOpen} onClose={close} label={t('shell.palette.label')} placement="top" width={640} bare className="palette" initialFocus={input}>
        <input
          ref={input}
          className="palette-input"
          placeholder={mode === 'language' ? t('shell.palette.language') : t('shell.palette.placeholder')}
          aria-label={t('shell.palette.label')}
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          aria-describedby="palette-count"
          aria-controls="palette-list"
          aria-activedescendant={items[sel] ? `palette-i${sel}` : undefined}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.max(0, Math.min(s + 1, items.length - 1))); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === 'Enter') { play('tick'); items[sel]?.run(); }
            else if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); close(); }
          }}
        />
        <div className="palette-list" ref={list} id="palette-list" role="listbox" aria-label={t('shell.palette.results')}>
          {items.length === 0 && <div className="empty">{t('shell.palette.nobody')}</div>}
          {items.map((it, i) => (
            <Fragment key={it.key}>
            {(i === 0 || groupOf(items[i - 1], t) !== groupOf(it, t)) && <div className="palette-group">{groupOf(it, t)}</div>}
            <button data-i={i} id={`palette-i${i}`} role="option" tabIndex={-1} className="palette-item" aria-selected={i === sel} onMouseMove={() => setSel(i)} onClick={it.run}>
              {it.person ? <PersonRow f={f} tree={tree} id={it.person} who={who} anc={myAnc} /> : (
                <>
                  <span className="palette-icon">{it.icon}</span>
                  <span className="palette-label">{it.label}</span>
                  {it.hint && <span className="palette-hint">{it.hint}</span>}
                </>
              )}
            </button>
            </Fragment>
          ))}
        </div>
        <div className="palette-foot muted">
          <span id="palette-count" role="status" aria-live="polite">{items.length ? t('shell.palette.count', { count: items.length }) : t('shell.palette.none')}</span>
          <span><kbd>↑</kbd> <kbd>↓</kbd> {t('shell.palette.move')}</span>
          <span><kbd>↵</kbd> {t('shell.palette.go')}</span>
          <span><kbd>esc</kbd> {t('shell.palette.close')}</span>
          <span style={{ marginLeft: 'auto' }}>{t('common.people', { count: f.graph.people.length })}</span>
        </div>
    </Dialog>
  );
}
