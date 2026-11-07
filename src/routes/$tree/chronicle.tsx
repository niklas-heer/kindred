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
import type { GPerson, Story } from '~/lib/types';
import '~/styles/chronicle.css';
import { sectionHead } from '~/lib/title';

export const Route = createFileRoute('/$tree/chronicle')({
  head: sectionHead('Chronicle'),
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
const KINDS: { id: Kind; label: string; plural: string; verb: string; icon: ComponentType<{ size?: number }> }[] = [
  { id: 'note', label: 'Note', plural: 'Notes', verb: 'added a note on', icon: StickyNote },
  { id: 'quote', label: 'Saying', plural: 'Sayings', verb: 'recorded a saying of', icon: Quote },
  { id: 'anecdote', label: 'Story', plural: 'Stories', verb: 'told a story about', icon: Quill },
  { id: 'recipe', label: 'Recipe', plural: 'Recipes', verb: 'shared a recipe from', icon: ChefHat },
  { id: 'memory', label: 'Memory', plural: 'Memories', verb: 'remembered', icon: Sparkles },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.id, k])) as Record<Kind, (typeof KINDS)[number]>;

// ---------- time ----------

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
function ago(at: string, now: number): string {
  const s = (new Date(at).getTime() - now) / 1000;
  const a = Math.abs(s);
  if (a < 60) return 'just now';
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86_400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 86_400 * 7) return rtf.format(Math.round(s / 86_400), 'day');
  if (a < 86_400 * 30) return rtf.format(Math.round(s / (86_400 * 7)), 'week');
  if (a < 86_400 * 365) return rtf.format(Math.round(s / (86_400 * 30)), 'month');
  return rtf.format(Math.round(s / (86_400 * 365)), 'year');
}
function dayLabel(at: string, now: Date): string {
  const d = new Date(at);
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Earlier this week';
  if (days < 30) return 'Earlier this month';
  return d.toLocaleDateString('en-GB', { month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
const exact = (at: string) => new Date(at).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });

// ---------- page ----------

type Tab = 'recent' | 'sayings';

function ChroniclePage() {
  const f = useFamily();
  const tree = useTreeId();
  usePageTrail('chronicle', tree);
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
      const k = dayLabel(s.at, now);
      const a = m.get(k);
      if (a) a.push(s);
      else m.set(k, [s]);
    }
    return [...m.entries()];
  }, [recent, limit, now]);

  const pick = (t: Tab) => {
    setTab(t);
    setLimit(30);
  };

  return (
    <div className="page">
      <div className="page-inner chr">
        <PageHeader title="Chronicle" subtitle={<>
              {isPending
                ? 'Unrolling the scroll…'
                : stories.length
                  ? `${stories.length} contributions from ${authors} ${authors === 1 ? 'voice' : 'voices'}`
                  : 'The family’s notes, sayings and memories'}
            </>} actions={<><label className="chr-search">
            <Search size={16} />
            <input className="input" type="search" placeholder="Search the chronicle…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the chronicle" />
          </label></>} />

        {isPending && <div className="page-loading" aria-busy="true" aria-label="Loading chronicle">{Array.from({ length: 4 }, (_, i) => <div className="ui-card" key={i} style={{ padding: 20, marginBottom: 12 }}><Skeleton width={48} height={48} radius="50%" /><Skeleton lines={3} /></div>)}</div>}
        {isError && <ErrorState title="Could not open the chronicle" message="Your family’s information is still safe. Please try again." onRetry={() => { void refetch(); }} />}
        {!isPending && !isError && <>
        <div className="chr-bar">
          <div className="chr-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'recent'} onClick={() => pick('recent')}>
              <Clock size={15} /> Recent <span>{stories.length}</span>
            </button>
            <button role="tab" aria-selected={tab === 'sayings'} onClick={() => pick('sayings')}>
              <Quote size={15} /> Sayings <span>{counts.quote ?? 0}</span>
            </button>
          </div>
          {tab === 'recent' && stories.length > 0 && (
            <div className="chr-kinds" role="group" aria-label="Filter by kind">
              <button className="btn" aria-pressed={kind === null} onClick={() => setKind(null)}>
                All
              </button>
              {KINDS.filter((k) => counts[k.id]).map((k) => (
                <button key={k.id} className="btn" aria-pressed={kind === k.id} onClick={() => setKind(kind === k.id ? null : k.id)}>
                  <k.icon size={14} /> {k.plural} <span className="muted">{counts[k.id]}</span>
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
                Show {Math.min(30, recent.length - limit)} more
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
  if (!p) return <>someone</>;
  return (
    <Link to="/$tree" params={{ tree }} search={{ focus: p.id }} className="chr-person">
      {displayName(p, f)}
    </Link>
  );
}

function FeedItem({ s, f, tree, now }: { s: Story; f: Family; tree: string; now: number }) {
  const [open, setOpen] = useState(false);
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
            <k.icon size={14} /> {k.label}
          </span>
          <span className="chr-line">
            <b>{s.author}</b> {k.verb} <PersonLink p={p} f={f} tree={tree} />
          </span>
          <time dateTime={s.at} title={exact(s.at)}>
            {ago(s.at, now)}
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
            {open ? 'Show less' : 'Read more'}
          </button>
        )}
      </article>
    </li>
  );
}

function SayingCard({ s, f, tree, now }: { s: Story; f: Family; tree: string; now: number }) {
  const p = f.byId.get(s.person);
  return (
    <figure className="chr-saying">
      <blockquote dangerouslySetInnerHTML={{ __html: render(s.body) }} />
      <figcaption>
        {p && <Portrait person={p} tree={tree} size={42} />}
        <div>
          <PersonLink p={p} f={f} tree={tree} />
          {s.context && <em>{s.context}</em>}
          <small>
            heard by {s.author} · <time dateTime={s.at} title={exact(s.at)}>{ago(s.at, now)}</time>
          </small>
        </div>
      </figcaption>
    </figure>
  );
}

function Empty({ tree }: { tree: string }) {
  return (
    <div className="chr-empty ui-card">
      <GameIcon name="quill-ink" size={34} />
      <h2 className="display">Nothing written yet</h2>
      <p className="muted">
        Open anyone on the tree and add a note, a recipe, a memory or something they always said. Whatever the family adds shows up here, newest first.
      </p>
      <Link className="btn primary" to="/$tree" params={{ tree }}>
        Open the tree
      </Link>
    </div>
  );
}

function NoSayings({ tree }: { tree: string }) {
  return (
    <div className="chr-empty ui-card">
      <Quote size={30} />
      <h2 className="display">No sayings yet</h2>
      <p className="muted">The things people always say are worth keeping. Open someone on the tree and add one.</p>
      <Link className="btn primary" to="/$tree" params={{ tree }}>
        Open the tree
      </Link>
    </div>
  );
}

function NoMatch({ onClear }: { onClear: () => void }) {
  return (
    <div className="chr-empty ui-card">
      <Search size={26} />
      <h2 className="display">Nothing matches</h2>
      <p className="muted">Try fewer words or another kind.</p>
      <button className="btn" onClick={onClear}>
        Clear filters
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
