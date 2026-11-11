import { useToday } from '~/lib/clock';
import { PageHeader, Skeleton, ErrorState, EmptyState } from '~/components/ui';
import { useRememberedState, usePageTrail } from '~/lib/page-state';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChefHat, Clock, Plus, Quote, Search } from 'lucide-react';
import { renderMarkdown } from '~/lib/markdown';
import { useEffect, useMemo, useState } from 'react';
import { AddMemory } from '~/components/AddMemory';
import { EAGER_FACES, KINDS, PersonLink, StoryCard, TranslatedNote, useShownStory, type Kind, type StoryTranslation } from '~/components/chronicle/StoryCard';
import { GameIcon } from '~/components/GameIcon';
import { Portrait } from '~/components/Portrait';
import { Responses } from '~/components/responses/Responses';
import { chronicleQuery } from '~/lib/api';
import { useFamily, useTreeId } from '~/lib/family';
import { displayName, type Family } from '~/lib/graph';
import { translate, useT, type Locale } from '~/lib/i18n';
import type { Story } from '~/lib/types';
import { ago, dayLabel, exact } from '~/lib/when';
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
          actions={<>
            {/* The recipes have a page of their own, with their pictures (docs/recipes.md). */}
            <Link className="btn" to="/$tree/cookbook" params={{ tree }} title={t('recipes.to_cookbook')}><ChefHat size={15} /> {t('recipes.book.title')}</Link>
            {write && <button type="button" className="btn primary" onClick={write}><Plus size={15} /> {t('chronicle.add')}</button>}
          </>} />

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
                      <StoryCard key={s.id} s={s} f={f} tree={tree} now={now?.getTime()} tr={translations[s.id]} defer={before + i >= EAGER_FACES} />
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
      <Responses tree={tree} kind="story" target={s.id} />
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
