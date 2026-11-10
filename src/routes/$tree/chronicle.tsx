import { useToday } from '~/lib/clock';
import { PageHeader, Skeleton, ErrorState, EmptyState } from '~/components/ui';
import { useRememberedState, usePageTrail } from '~/lib/page-state';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChefHat, Clock, Plus, Quote, Search, Sparkles, StickyNote } from 'lucide-react';
import { renderMarkdown } from '~/lib/markdown';
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { AddMemory } from '~/components/AddMemory';
import { GameIcon } from '~/components/GameIcon';
import { Portrait } from '~/components/Portrait';
import { PortraitZoom } from '~/components/photos/PortraitZoom';
import { chronicleQuery } from '~/lib/api';
import { useFamily, useTreeId } from '~/lib/family';
import { displayName, type Family } from '~/lib/graph';
import { locales, richText, translate, useT, type Key, type Locale, type Translator } from '~/lib/i18n';
import type { GPerson, Story } from '~/lib/types';
import '~/styles/chronicle.css';
import { useDealt } from '~/lib/dealt';
import { useCan } from '~/lib/session';
import { treeTitle } from '~/lib/title';
import { storyTranslationsQuery } from '~/lib/ai/background.functions';
import '~/components/assistant/ai-tasks.css';

export const Route = createFileRoute('/$tree/chronicle')({
  // The same queries the page runs, fetched before it renders: on the server, so the first page shows the stories rather
  // than a placeholder, and on a client navigation, while the link is hovered. Every reader of the family may read them
  // (the layout's beforeLoad has let only members and the family's guest this far). A failure is the page's to show.
  loader: async ({ context: { queryClient, locale }, params: { tree } }) => {
    await Promise.all([queryClient.prefetchQuery(chronicleQuery(tree)), queryClient.prefetchQuery(storyTranslationsQuery(tree, locale))]);
  },
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'chronicle.title')) }] }),
  component: ChroniclePage,
});

// ---------- markdown ----------

// Raw HTML in a story is shown as text, and script links are dropped.
const render = renderMarkdown;

// ---------- kinds ----------

type Kind = Story['kind'];
/** Stories are written with a quill; the rest keep their line icons. */
const Quill = ({ size = 14 }: { size?: number }) => <GameIcon name="quill-ink" size={size} />;
const KINDS: { id: Kind; label: Key; plural: Key; line: Key; icon: ComponentType<{ size?: number }> }[] = [
  { id: 'note', label: 'chronicle.kind.note', plural: 'chronicle.kind.note_plural', line: 'chronicle.line.note', icon: StickyNote },
  { id: 'quote', label: 'chronicle.kind.quote', plural: 'chronicle.kind.quote_plural', line: 'chronicle.line.quote', icon: Quote },
  { id: 'anecdote', label: 'chronicle.kind.anecdote', plural: 'chronicle.kind.anecdote_plural', line: 'chronicle.line.anecdote', icon: Quill },
  { id: 'recipe', label: 'chronicle.kind.recipe', plural: 'chronicle.kind.recipe_plural', line: 'chronicle.line.recipe', icon: ChefHat },
  { id: 'memory', label: 'chronicle.kind.memory', plural: 'chronicle.kind.memory_plural', line: 'chronicle.line.memory', icon: Sparkles },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.id, k])) as Record<Kind, (typeof KINDS)[number]>;

// ---------- time ----------

function ago(at: string, now: number, tr: Translator): string {
  const rtf = new Intl.RelativeTimeFormat(locales[tr.locale], { numeric: 'auto' });
  const s = (new Date(at).getTime() - now) / 1000;
  const a = Math.abs(s);
  if (a < 60) return tr('chronicle.just_now');
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86_400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 86_400 * 7) return rtf.format(Math.round(s / 86_400), 'day');
  if (a < 86_400 * 30) return rtf.format(Math.round(s / (86_400 * 7)), 'week');
  if (a < 86_400 * 365) return rtf.format(Math.round(s / (86_400 * 30)), 'month');
  return rtf.format(Math.round(s / (86_400 * 365)), 'year');
}
function dayLabel(at: string, now: Date, tr: Translator): string {
  const d = new Date(at);
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  if (days <= 0) return tr('chronicle.today');
  if (days === 1) return tr('chronicle.yesterday');
  if (days < 7) return tr('chronicle.earlier_week');
  if (days < 30) return tr('chronicle.earlier_month');
  return d.toLocaleDateString(locales[tr.locale], { month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
const exact = (at: string, locale: Locale) => new Date(at).toLocaleString(locales[locale], { dateStyle: 'long', timeStyle: 'short' });

// ---------- page ----------

type Tab = 'recent' | 'sayings';

function ChroniclePage() {
  const f = useFamily();
  const tree = useTreeId();
  const t = useT();
  usePageTrail('chronicle', tree, t.locale);
  const { data, isPending, isError, refetch } = useQuery(chronicleQuery(tree));
  // AI translations into the reader's language, shown beside the originals (see background-tasks.server.ts). Optional: a
  // failure here shows the originals, as it always did.
  const translations: Record<string, StoryTranslation> = useQuery(storyTranslationsQuery(tree, t.locale)).data ?? {};
  const [tab, setTab] = useRememberedState<Tab>(`chronicle:${tree}:tab`, 'recent');
  const [kind, setKind] = useRememberedState<Kind | null>(`chronicle:${tree}:kind`, null);
  const [q, setQ] = useRememberedState(`chronicle:${tree}:q`, '');
  // A filter remembered from before sayings left the row of kinds: without its chip it could not be switched off.
  useEffect(() => { if (kind === 'quote') setKind(null); }, [kind, setKind]);
  const [limit, setLimit] = useRememberedState(`chronicle:${tree}:limit`, 30);
  const today = useToday();
  const [openedAt] = useState(() => Date.now());
  const now = useMemo(() => today ? new Date(openedAt) : undefined, [today, openedAt]);

  const stories = useMemo(
    () =>
      ((data ?? []) as (Omit<Story, 'title' | 'context'> & { title: string | null; context: string | null })[])
        .map((s): Story => ({ ...s, title: s.title ?? undefined, context: s.context ?? undefined }))
        .filter((s) => f.byId.has(s.person)),
    [data, f],
  );
  const counts = useMemo(() => {
    const c: Partial<Record<Kind, number>> = {};
    for (const s of stories) c[s.kind] = (c[s.kind] ?? 0) + 1;
    return c;
  }, [stories]);
  const authors = useMemo(() => new Set(stories.map((s) => s.author)).size, [stories]);

  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (s: Story) => {
    if (!tokens.length) return true;
    const p = f.byId.get(s.person);
    const hay = `${s.title ?? ''} ${s.body} ${s.author} ${s.context ?? ''} ${p ? displayName(p, f) : ''}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  };
  const recent = useMemo(
    () => stories.filter((s) => (!kind || s.kind === kind) && match(s)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stories, kind, q],
  );
  const sayings = useMemo(
    () => stories.filter((s) => s.kind === 'quote' && match(s)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stories, q],
  );

  const groups = useMemo(() => {
    const m = new Map<string, Story[]>();
    for (const s of recent.slice(0, limit)) {
      const k = now ? dayLabel(s.at, now, t) : '';
      const a = m.get(k);
      if (a) a.push(s);
      else m.set(k, [s]);
    }
    return [...m.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent, limit, now, t.locale]);

  const dealt = useDealt(!isPending);
  // Anyone whose role may write a memory can start one here, without finding the person on the tree first.
  const canWrite = useCan('add-story');
  const [adding, setAdding] = useState(false);
  const write = canWrite ? () => setAdding(true) : undefined;
  const pick = (t: Tab) => {
    setTab(t);
    setLimit(30);
  };

  return (
    <div className="page">
      <div className="page-inner chr">
        <PageHeader title={t('chronicle.title')} subtitle={<>
              {isPending
                ? t('chronicle.unrolling')
                : stories.length
                  ? t('chronicle.contributions', { count: stories.length, voices: t('chronicle.voices', { count: authors }) })
                  : t('chronicle.subtitle')}
            </>}
          actions={write && <button type="button" className="btn primary" onClick={write}><Plus size={15} /> {t('chronicle.add')}</button>} />

        {isPending && <div className="page-loading" aria-busy="true" aria-label={t('chronicle.loading')}>{Array.from({ length: 4 }, (_, i) => <div className="ui-card" key={i} style={{ padding: 20, marginBottom: 12 }}><Skeleton width={48} height={48} radius="50%" /><Skeleton lines={3} /></div>)}</div>}
        {isError && <ErrorState title={t('chronicle.error')} message={t('chronicle.error_text')} onRetry={() => { void refetch(); }} />}
        {!isPending && !isError && <>
        <div className="chr-bar">
          {/* One row: the two views, then the kinds. On a phone it scrolls sideways instead of wrapping. */}
          <div className="chr-strip">
          <div className="chr-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'recent'} onClick={() => pick('recent')}>
              <Clock size={15} /> {t('chronicle.tab_recent')} <span>{stories.length}</span>
            </button>
            <button role="tab" aria-selected={tab === 'sayings'} onClick={() => pick('sayings')}>
              <Quote size={15} /> {t('chronicle.kind.quote_plural')} <span>{counts.quote ?? 0}</span>
            </button>
          </div>
          {tab === 'recent' && stories.length > 0 && (
            <div className="chr-kinds" role="group" aria-label={t('chronicle.filter_kind')}>
              <button className="btn" aria-pressed={kind === null} onClick={() => setKind(null)}>
                {t('chronicle.all')}
              </button>
              {/* Sayings have their own view beside "Recent", so they are not offered a second time as a kind here. */}
              {KINDS.filter((k) => counts[k.id] && k.id !== 'quote').map((k) => (
                <button key={k.id} className="btn" aria-pressed={kind === k.id} onClick={() => setKind(kind === k.id ? null : k.id)}>
                  <k.icon size={14} /> {t(k.plural)} <span className="muted">{counts[k.id]}</span>
                </button>
              ))}
            </div>
          )}
          </div>
          <label className="chr-search">
            <Search size={16} />
            <input className="input" type="search" placeholder={t('chronicle.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('chronicle.search_label')} />
          </label>
        </div>

        {!isPending && stories.length === 0 && <Empty tree={tree} write={write} />}

        {stories.length > 0 && tab === 'recent' && (
          <>
            {recent.length === 0 && <NoMatch onClear={() => { setQ(''); setKind(null); }} />}
            {groups.map(([label, items], gi) => {
              // Entries before this one, in the earlier days: only the first screenful draws its faces in the server's HTML.
              const before = groups.slice(0, gi).reduce((n, [, g]) => n + g.length, 0);
              return (
                <section key={label} className="chr-day">
                  <h2 className="rule">{label}</h2>
                  <ol className={`chr-feed ${gi === 0 ? dealt : ''}`}>
                    {items.map((s, i) => (
                      <FeedItem key={s.id} s={s} f={f} tree={tree} now={now?.getTime()} tr={translations[s.id]} defer={before + i >= EAGER_FACES} />
                    ))}
                  </ol>
                </section>
              );
            })}
            {recent.length > limit && (
              <button className="btn chr-more" onClick={() => setLimit(limit + 30)}>
                {t('chronicle.show_more', { count: Math.min(30, recent.length - limit) })}
              </button>
            )}
          </>
        )}

        {stories.length > 0 && tab === 'sayings' && (
          <>
            {sayings.length === 0 && (q ? <NoMatch onClear={() => setQ('')} /> : <NoSayings tree={tree} write={write} />)}
            <div className={`chr-wall ${dealt}`}>
              {sayings.map((s, i) => (
                <SayingCard key={s.id} s={s} f={f} tree={tree} now={now?.getTime()} tr={translations[s.id]} defer={i >= EAGER_FACES} />
              ))}
            </div>
          </>
        )}
        </>}
        {adding && <AddMemory tree={tree} onClose={() => setAdding(false)} />}
      </div>
    </div>
  );
}

// ---------- pieces ----------

function PersonLink({ p, f, tree }: { p?: GPerson; f: Family; tree: string }) {
  const t = useT();
  if (!p) return <>{t('chronicle.someone')}</>;
  return (
    <Link to="/$tree/person/$id" params={{ tree, id: p.id }} className="chr-person">
      {displayName(p, f)}
    </Link>
  );
}

/** An AI translation of a story into the reader's language (its source text was current when it was made). */
type StoryTranslation = { title: string | null; body: string };

/**
 * The text a story card shows: its translation while there is one and the reader has not asked for the original. The
 * original is always one click away (TranslatedNote), and it is what a story without a translation shows.
 */
function useShownStory(s: Story, tr: StoryTranslation | undefined) {
  const [original, setOriginal] = useState(false);
  const translated = !!tr && !original;
  return {
    title: translated ? (tr?.title ?? s.title) : s.title,
    body: translated && tr ? tr.body : s.body,
    hasTranslation: !!tr,
    original,
    toggle: () => setOriginal((v) => !v),
  };
}

/** "Translated by AI", with the other text one click away. Nothing when the story has no translation. */
function TranslatedNote({ shown }: { shown: ReturnType<typeof useShownStory> }) {
  const t = useT();
  if (!shown.hasTranslation) return null;
  return (
    <p className="chr-ai">
      <Sparkles size={14} /> {t('aitasks.chronicle.translated')}
      <button type="button" className="btn ghost" onClick={shown.toggle}>
        {shown.original ? t('aitasks.chronicle.showTranslation') : t('aitasks.chronicle.showOriginal')}
      </button>
    </p>
  );
}

/**
 * How many entries draw their faces in the server's HTML. A drawn face is about 8 kB of inline SVG and each entry has two
 * (beside the card, and in its first line on a phone), so the rest follow at once after hydration (Portrait's `defer`), in the
 * same frame and house colour: the first screen looks the same, and the page is several hundred kB lighter.
 */
const EAGER_FACES = 6;

function FeedItem({ s, f, tree, now, tr, defer }: { s: Story; f: Family; tree: string; now?: number; tr?: StoryTranslation; defer?: boolean }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const p = f.byId.get(s.person);
  const k = KIND[s.kind];
  const shown = useShownStory(s, tr);
  const long = shown.body.length > 360 || shown.body.split('\n').length > 6;
  return (
    <li className="chr-item" data-kind={s.kind}>
      {p && (
        <PortraitZoom person={p} tree={tree} size={50} className="chr-face" defer={defer} />
      )}
      <article className="chr-card ui-card">
        <header>
          {/* On a phone the face sits in the card's first line; the column beside the card is for wider screens. */}
          {p && <span className="chr-face-in"><Portrait person={p} tree={tree} size={28} decorative defer={defer} /></span>}
          <span className="chr-kind">
            <k.icon size={14} /> {t(k.label)}
          </span>
          <span className="chr-line">
            {richText(t, k.line, { author: <b>{s.author}</b>, subject: <PersonLink p={p} f={f} tree={tree} /> })}
          </span>
          <time dateTime={s.at} title={now === undefined ? undefined : exact(s.at, t.locale)}>
            {now === undefined ? '' : ago(s.at, now, t)}
          </time>
        </header>
        {shown.title && <h3>{shown.title}</h3>}
        {s.kind === 'quote' ? (
          <blockquote className="chr-inline-quote" dangerouslySetInnerHTML={{ __html: render(shown.body) }} />
        ) : (
          <div className="chr-md" data-clamped={(long && !open) || undefined} dangerouslySetInnerHTML={{ __html: render(shown.body) }} />
        )}
        <TranslatedNote shown={shown} />
        {s.context && <p className="chr-ctx">{s.context}</p>}
        {long && s.kind !== 'quote' && (
          <button className="btn ghost chr-toggle" onClick={() => setOpen(!open)}>
            {open ? t('chronicle.show_less') : t('chronicle.read_more')}
          </button>
        )}
      </article>
    </li>
  );
}

function SayingCard({ s, f, tree, now, tr, defer }: { s: Story; f: Family; tree: string; now?: number; tr?: StoryTranslation; defer?: boolean }) {
  const p = f.byId.get(s.person);
  const t = useT();
  const shown = useShownStory(s, tr);
  return (
    <figure className="chr-saying">
      <blockquote dangerouslySetInnerHTML={{ __html: render(shown.body) }} />
      <TranslatedNote shown={shown} />
      <figcaption>
        {p && <Portrait person={p} tree={tree} size={42} defer={defer} />}
        <div>
          <PersonLink p={p} f={f} tree={tree} />
          {s.context && <em>{s.context}</em>}
          <small>
            {t('chronicle.heard_by', { author: s.author })} · <time dateTime={s.at} title={now === undefined ? undefined : exact(s.at, t.locale)}>{now === undefined ? '' : ago(s.at, now, t)}</time>
          </small>
        </div>
      </figcaption>
    </figure>
  );
}

/** `write` is there for a reader whose role may add a memory: they are offered that, not a walk to the tree. */
function Empty({ tree, write }: { tree: string; write?: () => void }) {
  const t = useT();
  return (
    <EmptyState
      icon={<GameIcon name="quill-ink" size={34} />}
      title={t('chronicle.empty_title')}
      text={t(write ? 'chronicle.empty_text_write' : 'chronicle.empty_text')}
      action={write
        ? <button type="button" className="btn primary" onClick={write}><Plus size={15} /> {t('chronicle.add_first')}</button>
        : <Link className="btn primary" to="/$tree" params={{ tree }}>{t('chronicle.open_tree')}</Link>}
    />
  );
}

function NoSayings({ tree, write }: { tree: string; write?: () => void }) {
  const t = useT();
  return (
    <EmptyState
      icon={<Quote size={30} />}
      title={t('chronicle.no_sayings')}
      text={t(write ? 'chronicle.no_sayings_text_write' : 'chronicle.no_sayings_text')}
      action={write
        ? <button type="button" className="btn primary" onClick={write}><Plus size={15} /> {t('chronicle.add_saying')}</button>
        : <Link className="btn primary" to="/$tree" params={{ tree }}>{t('chronicle.open_tree')}</Link>}
    />
  );
}

function NoMatch({ onClear }: { onClear: () => void }) {
  const t = useT();
  return (
    <EmptyState
      icon={<Search size={26} />}
      title={t('chronicle.no_match')}
      text={t('chronicle.no_match_text')}
      action={<button className="btn" onClick={onClear}>{t('chronicle.clear_filters')}</button>}
    />
  );
}
