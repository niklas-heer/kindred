// The emoji palette under an entry's reactions (docs/responses.md): the quick row, what the reader gave lately, a search
// by name in their language (and in English), and every emoji by category. Loaded only when a "+" is pressed, with its
// data (src/lib/emoji/, the app's own files: nothing is asked of anyone else).
//
// A panel in the page's flow rather than a floating one, so it never covers what it answers and works the same on a
// phone. Escape or a press outside closes it; arrow keys move through the grid.
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useT } from '~/lib/i18n';
import { GROUPS, loadEmoji, searchEmoji, type Emoji, type EmojiGroup } from '~/lib/emoji';
import { QUICK_REACTIONS, type ReactionKind } from '~/lib/responses';
import { recentReactionsQuery } from '~/lib/responses.functions';

/** The tab of what the reader gave lately, beside the categories. */
type Tab = 'recent' | EmojiGroup;
/** How many emoji a row of the grid has: the arrow keys move by it. Matches the CSS's columns. */
const COLUMNS = 8;

export function EmojiPalette({ tree, mine, anchor, onPick, onClose }: {
  tree: string; mine: readonly ReactionKind[]; anchor: RefObject<HTMLElement | null>; onPick: (emoji: ReactionKind) => void;
  /** `back`: focus returns to the button that opened it (Escape); a press elsewhere leaves focus where it went. */
  onClose: (back: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const data = useQuery({ queryKey: ['emoji', t.locale], queryFn: () => loadEmoji(t.locale), staleTime: Infinity, gcTime: Infinity });
  const recentData = useQuery(recentReactionsQuery(tree)).data;
  const recent = useMemo(() => recentData ?? [], [recentData]);
  const [tab, setTab] = useState<Tab>('smileys');
  // The reader's own lately used emoji open the palette when there are any.
  const opened = useRef(false);
  useEffect(() => {
    if (!opened.current && recent.length) { opened.current = true; setTab('recent'); }
  }, [recent.length]);

  useEffect(() => field.current?.focus(), []);
  // A press anywhere outside closes it, as a menu does; the button that opened it closes it by itself.
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const at = e.target as Node;
      if (box.current && !box.current.contains(at) && !anchor.current?.contains(at)) onClose(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [onClose, anchor]);

  const byEmoji = useMemo(() => new Map((data.data ?? []).map((e) => [e.emoji, e])), [data.data]);
  const shown: Emoji[] = useMemo(() => {
    const all = data.data ?? [];
    if (query.trim()) return searchEmoji(all, query);
    if (tab === 'recent') return recent.map((r) => byEmoji.get(r) ?? { emoji: r, group: 'symbols', name: '', words: '', en: '' });
    return all.filter((e) => e.group === tab);
  }, [data.data, query, tab, recent, byEmoji]);

  const name = (e: string) => byEmoji.get(e)?.name || e;
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(true); return; }
    const buttons = [...(grid.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const next = at + step;
    if (next < 0 && step === -COLUMNS) field.current?.focus();
    else buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
  };

  return (
    <div ref={box} className="resp-palette" role="dialog" aria-label={t('responses.palette')} onKeyDown={keys}>
      <div className="resp-palette-quick" role="group" aria-label={t('responses.quick')}>
        {QUICK_REACTIONS.map((r) => (
          <button key={r} type="button" className="resp-cell" aria-pressed={mine.includes(r)} aria-label={name(r)} title={name(r)} onClick={() => onPick(r)}>{r}</button>
        ))}
      </div>
      <label className="resp-palette-search">
        <Search size={14} aria-hidden />
        <span className="sr-only">{t('responses.search_emoji')}</span>
        <input
          ref={field}
          className="input"
          type="search"
          placeholder={t('responses.search_emoji_ph')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); grid.current?.querySelector<HTMLButtonElement>('button')?.focus(); }
            if (e.key === 'Enter' && shown[0]) { e.preventDefault(); onPick(shown[0].emoji); }
          }}
          aria-controls={`${id}-grid`}
        />
      </label>
      {!query.trim() ? (
        <div className="resp-palette-tabs" role="tablist" aria-label={t('responses.categories')}>
          {(['recent', ...GROUPS] as Tab[]).map((g) => (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={tab === g}
              aria-controls={`${id}-grid`}
              className="resp-tab"
              title={t(`responses.group.${g}`)}
              onClick={() => setTab(g)}
            >
              <span aria-hidden>{TAB_MARK[g]}</span>
              <span className="sr-only">{t(`responses.group.${g}`)}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div id={`${id}-grid`} ref={grid} className="resp-palette-grid" role={query.trim() ? 'group' : 'tabpanel'} aria-label={query.trim() ? t('responses.results') : t(`responses.group.${tab}`)}>
        {data.isPending ? <p className="subtle resp-none">{t('responses.loading_emoji')}</p> : null}
        {data.isError ? <p className="subtle resp-none" role="alert">{t('responses.emoji_failed')}</p> : null}
        {data.isSuccess && !shown.length ? (
          <p className="subtle resp-none">{query.trim() ? t('responses.no_emoji') : t('responses.no_recent')}</p>
        ) : null}
        {shown.map((e) => (
          <button key={e.emoji} type="button" className="resp-cell" aria-pressed={mine.includes(e.emoji)} aria-label={e.name || e.emoji} title={e.name || undefined} onClick={() => onPick(e.emoji)}>
            {e.emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Each tab's own emoji, as chat apps mark them. */
const TAB_MARK: Record<Tab, string> = {
  recent: '🕘', smileys: '😀', people: '👋', nature: '🌿', food: '🍲', travel: '🏠', activities: '⚽', objects: '💡', symbols: '❤️', flags: '🏳️',
};
