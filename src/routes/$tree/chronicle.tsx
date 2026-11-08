import { PageHeader, Skeleton, ErrorState } from '~/components/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChefHat, Clock, Quote, Search, Sparkles, StickyNote } from 'lucide-react';
import { renderMarkdown } from '~/lib/markdown';
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { GameIcon } from '~/components/GameIcon';
import { Portrait } from '~/components/Portrait';
import { chronicleQuery } from '~/lib/api';
import { useFamily, useTreeId } from '~/lib/family';
import { displayName, type Family } from '~/lib/graph';
import { locales, translate, useT, type Key, type Locale, type Translator } from '~/lib/i18n';
import type { GPerson, Story } from '~/lib/types';
import '~/styles/chronicle.css';
import { treeTitle } from '~/lib/title';

export const Route = createFileRoute('/$tree/chronicle')({
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'chronicle.title')) }] }),
  component: ChroniclePage,
});

// ---------- markdown ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Raw HTML in a story is shown as text, and script links are dropped.
const render = renderMarkdown;

// ---------- kinds ----------

type Kind = Story['kind'];
/** Stories are written with a quill; the rest keep their line icons. */
const Quill = ({ size = 14 }: { size?: number }) => <GameIcon name="quill-ink" size={size} />;
const KINDS: { id: Kind; label: Key; plural: Key; verb: Key; icon: ComponentType<{ size?: number }> }[] = [
  { id: 'note', label: 'chronicle.kind.note', plural: 'chronicle.kind.note_plural', verb: 'chronicle.verb.note', icon: StickyNote },
  { id: 'quote', label: 'chronicle.kind.quote', plural: 'chronicle.kind.quote_plural', verb: 'chronicle.verb.quote', icon: Quote },
  { id: 'anecdote', label: 'chronicle.kind.anecdote', plural: 'chronicle.kind.anecdote_plural', verb: 'chronicle.verb.anecdote', icon: Quill },
  { id: 'recipe', label: 'chronicle.kind.recipe', plural: 'chronicle.kind.recipe_plural', verb: 'chronicle.verb.recipe', icon: ChefHat },
  { id: 'memory', label: 'chronicle.kind.memory', plural: 'chronicle.kind.memory_plural', verb: 'chronicle.verb.memory', icon: Sparkles },
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
  const [tab, setTab] = useRememberedState<Tab>(`chronicle:${tree}:tab`, 'recent');
  const [kind, setKind] = useRememberedState<Kind | null>(`chronicle:${tree}:kind`, null);
  const [q, setQ] = useRememberedState(`chronicle:${tree}:q`, '');
  const [limit, setLimit] = useRememberedState(`chronicle:${tree}:limit`, 30);
  const [now] = useState(() => new Date());

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
      const k = dayLabel(s.at, now, t);
      const a = m.get(k);
      if (a) a.push(s);
      else m.set(k, [s]);
    }
    return [...m.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent, limit, now, t.locale]);

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
            </>} actions={<><label className="chr-search">
            <Search size={16} />
            <input className="input" type="search" placeholder={t('chronicle.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('chronicle.search_label')} />
          </label></>} />

        {isPending && <div className="page-loading" aria-busy="true" aria-label={t('chronicle.loading')}>{Array.from({ length: 4 }, (_, i) => <div className="ui-card" key={i} style={{ padding: 20, marginBottom: 12 }}><Skeleton width={48} height={48} radius="50%" /><Skeleton lines={3} /></div>)}</div>}
        {isError && <ErrorState title={t('chronicle.error')} message={t('chronicle.error_text')} onRetry={() => { void refetch(); }} />}
        {!isPending && !isError && <>
        <div className="chr-bar">
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
              {KINDS.filter((k) => counts[k.id]).map((k) => (
                <button key={k.id} className="btn" aria-pressed={kind === k.id} onClick={() => setKind(kind === k.id ? null : k.id)}>
                  <k.icon size={14} /> {t(k.plural)} <span className="muted">{counts[k.id]}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {!isPending && stories.length === 0 && <Empty tree={tree} />}

        {stories.length > 0 && tab === 'recent' && (
          <>
            {recent.length === 0 && <NoMatch onClear={() => { setQ(''); setKind(null); }} />}
            {groups.map(([label, items]) => (
              <section key={label} className="chr-day">
                <h2 className="rule">{label}</h2>
                <ol className="chr-feed">
                  {items.map((s) => (
                    <FeedItem key={s.id} s={s} f={f} tree={tree} now={now.getTime()} />
                  ))}
                </ol>
              </section>
            ))}
            {recent.length > limit && (
              <button className="btn chr-more" onClick={() => setLimit(limit + 30)}>
                {t('chronicle.show_more', { count: Math.min(30, recent.length - limit) })}
              </button>
            )}
          </>
        )}

        {stories.length > 0 && tab === 'sayings' && (
          <>
            {sayings.length === 0 && (q ? <NoMatch onClear={() => setQ('')} /> : <NoSayings tree={tree} />)}
            <div className="chr-wall">
              {sayings.map((s) => (
                <SayingCard key={s.id} s={s} f={f} tree={tree} now={now.getTime()} />
              ))}
            </div>
          </>
        )}
        </>}
      </div>
    </div>
  );
}

// ---------- pieces ----------

function PersonLink({ p, f, tree }: { p?: GPerson; f: Family; tree: string }) {
  const t = useT();
  if (!p) return <>{t('chronicle.someone')}</>;
  return (
    <Link to="/$tree" params={{ tree }} search={{ focus: p.id }} className="chr-person">
      {displayName(p, f)}
    </Link>
  );
}

function FeedItem({ s, f, tree, now }: { s: Story; f: Family; tree: string; now: number }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const p = f.byId.get(s.person);
  const k = KIND[s.kind];
  const long = s.body.length > 360 || s.body.split('\n').length > 6;
  return (
    <li className="chr-item" data-kind={s.kind}>
      {p && (
        <Link to="/$tree" params={{ tree }} search={{ focus: p.id }} className="chr-face" aria-label={displayName(p, f)}>
          <Portrait person={p} tree={tree} size={50} />
        </Link>
      )}
      <article className="chr-card ui-card">
        <header>
          <span className="chr-kind">
            <k.icon size={14} /> {t(k.label)}
          </span>
          <span className="chr-line">
            <b>{s.author}</b> {t(k.verb)} <PersonLink p={p} f={f} tree={tree} />
          </span>
          <time dateTime={s.at} title={exact(s.at, t.locale)}>
            {ago(s.at, now, t)}
          </time>
        </header>
        {s.title && <h3>{s.title}</h3>}
        {s.kind === 'quote' ? (
          <blockquote className="chr-inline-quote" dangerouslySetInnerHTML={{ __html: render(s.body) }} />
        ) : (
          <div className="chr-md" data-clamped={(long && !open) || undefined} dangerouslySetInnerHTML={{ __html: render(s.body) }} />
        )}
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

function SayingCard({ s, f, tree, now }: { s: Story; f: Family; tree: string; now: number }) {
  const p = f.byId.get(s.person);
  const t = useT();
  return (
    <figure className="chr-saying">
      <blockquote dangerouslySetInnerHTML={{ __html: render(s.body) }} />
      <figcaption>
        {p && <Portrait person={p} tree={tree} size={42} />}
        <div>
          <PersonLink p={p} f={f} tree={tree} />
          {s.context && <em>{s.context}</em>}
          <small>
            {t('chronicle.heard_by', { author: s.author })} · <time dateTime={s.at} title={exact(s.at, t.locale)}>{ago(s.at, now, t)}</time>
          </small>
        </div>
      </figcaption>
    </figure>
  );
}

function Empty({ tree }: { tree: string }) {
  const t = useT();
  return (
    <div className="chr-empty ui-card">
      <GameIcon name="quill-ink" size={34} />
      <h2 className="display">{t('chronicle.empty_title')}</h2>
      <p className="muted">
        {t('chronicle.empty_text')}
      </p>
      <Link className="btn primary" to="/$tree" params={{ tree }}>
        {t('chronicle.open_tree')}
      </Link>
    </div>
  );
}

function NoSayings({ tree }: { tree: string }) {
  const t = useT();
  return (
    <div className="chr-empty ui-card">
      <Quote size={30} />
      <h2 className="display">{t('chronicle.no_sayings')}</h2>
      <p className="muted">{t('chronicle.no_sayings_text')}</p>
      <Link className="btn primary" to="/$tree" params={{ tree }}>
        {t('chronicle.open_tree')}
      </Link>
    </div>
  );
}

function NoMatch({ onClear }: { onClear: () => void }) {
  const t = useT();
  return (
    <div className="chr-empty ui-card">
      <Search size={26} />
      <h2 className="display">{t('chronicle.no_match')}</h2>
      <p className="muted">{t('chronicle.no_match_text')}</p>
      <button className="btn" onClick={onClear}>
        {t('chronicle.clear_filters')}
      </button>
    </div>
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
function usePageTrail(page: string, tree: string, locale: Locale) {
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
        try { localStorage.setItem('kindred:last-visit', JSON.stringify({ tree, person, name: link.textContent?.trim() || translate(locale, 'chronicle.your_family') })); } catch {}
      }
    };
    document.addEventListener('click', click, true);
    return () => { clearTimeout(timer); document.removeEventListener('scroll', scroll, true); document.removeEventListener('click', click, true); };
  }, [page, tree, locale]);
}
