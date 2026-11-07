import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChefHat, Clock, MessageCircle, Quote, ScrollText, Search, Sparkles, StickyNote, type LucideIcon } from 'lucide-react';
import { Marked } from 'marked';
import { useMemo, useState } from 'react';
import { Portrait } from '~/components/Portrait';
import { chronicleQuery } from '~/lib/api';
import { useFamily, useTreeId } from '~/lib/family';
import { displayName, type Family } from '~/lib/graph';
import type { GPerson, Story } from '~/lib/types';
import '~/styles/chronicle.css';

export const Route = createFileRoute('/$tree/chronicle')({
  component: ChroniclePage,
});

// ---------- markdown ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Raw HTML in a story is shown as text, and script links are dropped.
const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html: ({ text }) => esc(text),
    link({ href, tokens }) {
      if (/^\s*(javascript|data|vbscript):/i.test(href)) return this.parser.parseInline(tokens);
      return false;
    },
  },
});
const render = (s: string) => md.parse(s, { async: false }) as string;

// ---------- kinds ----------

type Kind = Story['kind'];
const KINDS: { id: Kind; label: string; plural: string; verb: string; icon: LucideIcon }[] = [
  { id: 'note', label: 'Note', plural: 'Notes', verb: 'added a note on', icon: StickyNote },
  { id: 'quote', label: 'Saying', plural: 'Sayings', verb: 'recorded a saying of', icon: Quote },
  { id: 'anecdote', label: 'Story', plural: 'Stories', verb: 'told a story about', icon: MessageCircle },
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
  const { data, isPending } = useQuery(chronicleQuery(tree));
  const [tab, setTab] = useState<Tab>('recent');
  const [kind, setKind] = useState<Kind | null>(null);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(30);
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
        <header className="chr-head">
          <div>
            <h1>Chronicle</h1>
            <p className="muted">
              {isPending
                ? 'Unrolling the scroll…'
                : stories.length
                  ? `${stories.length} contributions from ${authors} ${authors === 1 ? 'voice' : 'voices'}`
                  : 'The family’s notes, sayings and memories'}
            </p>
          </div>
          <label className="chr-search">
            <Search size={16} />
            <input className="input" type="search" placeholder="Search the chronicle…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the chronicle" />
          </label>
        </header>

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
          <Portrait person={p} tree={tree} size={46} frame={false} />
        </Link>
      )}
      <article className="chr-card panel">
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
      <span className="chr-mark" aria-hidden>
        “
      </span>
      <blockquote dangerouslySetInnerHTML={{ __html: render(s.body) }} />
      <figcaption>
        {p && <Portrait person={p} tree={tree} size={36} frame={false} />}
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
    <div className="chr-empty panel">
      <ScrollText size={30} />
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
    <div className="chr-empty panel">
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
    <div className="chr-empty panel">
      <Search size={26} />
      <h2 className="display">Nothing matches</h2>
      <p className="muted">Try fewer words or another kind.</p>
      <button className="btn" onClick={onClear}>
        Clear filters
      </button>
    </div>
  );
}
