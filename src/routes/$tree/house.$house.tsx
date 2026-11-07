// One house: its arms, motto, founder, seats and size; a way into its dynasty tree; its notable and all
// its members; and the stories the family has written about them. Stewards can redesign the arms.
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronLeft, Lock, Network, PenLine, ScrollText, Search } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { ArmsEditor } from '~/components/ArmsEditor';
import { Arms, TINCTURE_HEX } from '~/components/Heraldry';
import { Portrait } from '~/components/Portrait';
import { ErrorState, NotFound, Skeleton } from '~/components/ui';
import { chronicleQuery, graphQuery } from '~/lib/api';
import { useFamily, useTreeId } from '~/lib/family';
import { lifespan } from '~/lib/graph';
import { houseStats, memberOrder, notables, spanLabel } from '~/lib/houses';
import { useCan } from '~/lib/session';
import { treeTitle } from '~/lib/title';
import type { GPerson, Story } from '~/lib/types';
import '~/styles/house.css';

export const Route = createFileRoute('/$tree/house/$house')({
  // "House Valcourt · The Realm of Aurelmarch · Kindred", from the graph already in the cache.
  head: (ctx) => {
    const qc = (ctx.match.context as { queryClient?: QueryClient }).queryClient;
    const name = qc?.getQueryData(graphQuery(ctx.params.tree).queryKey)?.houses.find((h) => h.id === ctx.params.house)?.name;
    return { meta: [{ title: treeTitle(ctx, name ?? 'House') }] };
  },
  component: HousePage,
});

const nameOf = (p: GPerson) => [p.given, p.surname].filter(Boolean).join(' ');
/** A name in the body serif, with the epithet in italics. */
const Name = ({ p }: { p: GPerson }) => (
  <>
    {nameOf(p)}
    {p.epithet && <i> {p.epithet}</i>}
  </>
);
const fmt = (n: number) => n.toLocaleString('en-GB');

function HousePage() {
  const { house: id } = Route.useParams();
  const tree = useTreeId();
  const f = useFamily();
  const house = f.house.get(id);
  const canEdit = useCan('edit-house');
  const [editing, setEditing] = useState(false);
  const s = useMemo(() => (house ? houseStats(f, house) : undefined), [f, house]);

  if (!house || !s) {
    return (
      <div className="page">
        <div className="page-inner">
          <NotFound title="House not found" text="This family has no such house. It may have been renamed or removed.">
            <Link className="btn primary" to="/$tree/houses" params={{ tree }}>All houses</Link>
          </NotFound>
        </div>
      </div>
    );
  }

  const span = spanLabel(s);
  const total = s.members.length;
  const seats = s.seats.slice(0, 3);
  return (
    <div className="page">
      <div className="page-inner hp">
        <nav className="hp-crumbs" aria-label="Breadcrumb">
          <Link to="/$tree/houses" params={{ tree }}><ChevronLeft size={16} /> All houses</Link>
        </nav>

        <header className="ui-card hp-head" style={{ '--house': TINCTURE_HEX[house.arms.field] } as CSSProperties}>
          <div className="hp-shield">
            <Arms arms={house.arms} size={176} title={`Arms of ${house.name}`} />
          </div>
          <div className="hp-text">
            <h1>{house.name}</h1>
            {house.motto && <p className="hp-motto">“{house.motto}”</p>}
            <p className="hp-summary">
              {total ? (
                <>A house of <b className="hs-num">{fmt(total)}</b> {total === 1 ? 'member' : 'members'} across <b className="hs-num">{s.generations}</b> {s.generations === 1 ? 'generation' : 'generations'}{s.living ? <>, <b className="hs-num">{fmt(s.living)}</b> living</> : null}.</>
              ) : (
                'No one belongs to this house yet.'
              )}
            </p>
            <dl className="hp-facts">
              {s.founder && (
                <div>
                  <dt>Founder</dt>
                  <dd>
                    <Link className="hp-link" to="/$tree" params={{ tree }} search={{ focus: s.founder.id }}><Name p={s.founder} /></Link>
                  </dd>
                </div>
              )}
              {span && (
                <div>
                  <dt>Years</dt>
                  <dd className="hs-num">{span}</dd>
                </div>
              )}
              {seats.length > 0 && (
                <div>
                  <dt>{seats.length === 1 ? 'Seat' : 'Seats'}</dt>
                  <dd className="hp-seats">
                    {seats.map((x, i) => (
                      <span key={x.place} className="hp-seat">
                        <Link className="hp-link" to="/$tree/atlas" params={{ tree }} search={{ place: x.place }} title={`${x.n} born in ${x.place}. Show on the Atlas`}>{x.place}</Link>
                        <small aria-label={`${x.n} born there`}>×{x.n}</small>
                        {i < seats.length - 1 && <span aria-hidden className="subtle">·</span>}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
            <div className="hp-actions">
              {s.founder && (
                <Link className="btn primary" to="/$tree" params={{ tree }} search={{ view: 'dynasty', line: 'house', root: s.founder.id }}>
                  <Network size={16} /> Dynasty tree
                </Link>
              )}
              {canEdit ? (
                <button type="button" className="btn" onClick={() => setEditing(true)} aria-haspopup="dialog">
                  <PenLine size={16} /> Edit arms
                </button>
              ) : (
                <p className="hp-hint subtle"><Lock size={14} aria-hidden /> Only a steward can change the arms</p>
              )}
            </div>
          </div>
        </header>

        <Notables s={s} tree={tree} />

        <div className="hp-cols">
          <Members members={s.members} tree={tree} />
          <HouseChronicle members={s.members} tree={tree} houseName={house.name} />
        </div>
      </div>
      {canEdit && <ArmsEditor open={editing} onClose={() => setEditing(false)} house={house} tree={tree} />}
    </div>
  );
}

// ---------- notable members ----------

function Notables({ s, tree }: { s: ReturnType<typeof houseStats>; tree: string }) {
  const list = notables(s);
  if (!list.length) return null;
  const titled = list.some((n) => n.person.title);
  return (
    <section className="hp-section" aria-labelledby="hp-notables">
      <h2 className="rule" id="hp-notables">{titled ? 'Rulers and titled members' : 'Notable members'}</h2>
      <ul className="hp-notables">
        {list.map(({ person: p, role }) => (
          <li key={p.id}>
            <Link to="/$tree" params={{ tree }} search={{ focus: p.id }} className="ui-card interactive hp-notable">
              <Portrait person={p} tree={tree} size={84} house={s.house} />
              <b><Name p={p} /></b>
              {(p.title || p.occupation) && <span className="hp-title">{p.title ?? p.occupation}</span>}
              {lifespan(p) && <span className="hp-years">{lifespan(p)}</span>}
              {role && <span className="hs-chip hp-role">{role}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- members ----------

const PAGE = 40;

function Members({ members, tree }: { members: GPerson[]; tree: string }) {
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(
    () =>
      [...members]
        .filter((p) => {
          if (!tokens.length) return true;
          const hay = `${p.given} ${p.surname ?? ''} ${p.nickname ?? ''} ${p.epithet ?? ''} ${p.title ?? ''}`.toLowerCase();
          return tokens.every((t) => hay.includes(t));
        })
        .sort(memberOrder),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [members, q],
  );
  const page = shown.slice(0, limit);
  const living = page.filter((p) => p.living);
  const dead = page.filter((p) => !p.living);
  const livingTotal = shown.filter((p) => p.living).length;

  return (
    <section className="hp-section" aria-labelledby="hp-members">
      <div className="hp-section-head">
        <h2 className="rule" id="hp-members">Members <span className="subtle hs-num">{fmt(members.length)}</span></h2>
        {members.length > 12 && (
          <label className="hp-filter">
            <Search size={15} />
            <input className="input" type="search" placeholder="Find a member…" aria-label="Find a member of this house" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
          </label>
        )}
      </div>
      <div className="ui-card hp-members">
        {members.length === 0 && <p className="hp-none">No one belongs to this house yet.</p>}
        {members.length > 0 && shown.length === 0 && (
          <p className="hp-none">
            No member matches “{q}”. <button className="btn ghost" onClick={() => setQ('')}>Clear</button>
          </p>
        )}
        {living.length > 0 && <MemberGroup title={`Living · ${fmt(livingTotal)}`} people={living} tree={tree} />}
        {dead.length > 0 && <MemberGroup title={`Remembered · ${fmt(shown.length - livingTotal)}`} people={dead} tree={tree} />}
        {shown.length > limit && (
          <button className="btn hp-more" onClick={() => setLimit(limit + 80)}>
            Show {fmt(Math.min(80, shown.length - limit))} more of {fmt(shown.length - limit)}
          </button>
        )}
      </div>
    </section>
  );
}

function MemberGroup({ title, people, tree }: { title: string; people: GPerson[]; tree: string }) {
  return (
    <>
      <h3 className="hp-group">{title}</h3>
      <ul className="hp-list">
        {people.map((p) => (
          <li key={p.id}>
            <Link to="/$tree" params={{ tree }} search={{ focus: p.id }} className="hp-row">
              <Portrait person={p} tree={tree} size={40} />
              <span className="hp-row-name">
                <b><Name p={p} /></b>
                {(p.title || p.occupation || p.nickname) && <small>{p.title ?? p.occupation ?? `“${p.nickname}”`}</small>}
              </span>
              <span className="hp-row-years">{lifespan(p)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

// ---------- chronicle ----------

const KIND_LABEL: Record<Story['kind'], string> = { note: 'Note', quote: 'Saying', anecdote: 'Story', recipe: 'Recipe', memory: 'Memory' };
/** Markdown to a plain excerpt: enough for a three-line preview. */
const plain = (md: string) =>
  md.replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#>*_`~]+/g, '').replace(/\s+/g, ' ').trim();
const when = (at: string) => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function HouseChronicle({ members, tree, houseName }: { members: GPerson[]; tree: string; houseName: string }) {
  const { data, isPending, isError, refetch } = useQuery(chronicleQuery(tree));
  const [limit, setLimit] = useState(6);
  const byId = useMemo(() => new Map(members.map((p) => [p.id, p])), [members]);
  const stories = useMemo(() => ((data ?? []) as Story[]).filter((st) => byId.has(st.person)), [data, byId]);

  return (
    <section className="hp-section" aria-labelledby="hp-chronicle" aria-busy={isPending || undefined}>
      <div className="hp-section-head">
        <h2 className="rule" id="hp-chronicle">Chronicle {!isPending && !isError && stories.length > 0 && <span className="subtle hs-num">{fmt(stories.length)}</span>}</h2>
      </div>
      {isPending && (
        <div className="hp-feed" aria-label="Loading the house’s stories">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="ui-card hp-story"><Skeleton width={40} height={40} radius="50%" /><Skeleton lines={3} /></div>
          ))}
        </div>
      )}
      {isError && <ErrorState title="Could not open the chronicle" message="The house’s stories could not be loaded. Please try again." onRetry={() => { void refetch(); }} />}
      {!isPending && !isError && stories.length === 0 && (
        <div className="ui-card hp-none">
          <p style={{ margin: '0 0 10px' }}>Nothing has been written about {houseName} yet. Open a member and add a memory, a saying or a recipe.</p>
          <Link className="btn" to="/$tree/chronicle" params={{ tree }}><ScrollText size={15} /> The whole chronicle</Link>
        </div>
      )}
      {!isPending && !isError && stories.length > 0 && (
        <>
          <ol className="hp-feed">
            {stories.slice(0, limit).map((st) => {
              const p = byId.get(st.person)!;
              return (
                <li key={st.id} className="ui-card hp-story">
                  <Link to="/$tree" params={{ tree }} search={{ focus: p.id }} className="hp-story-face" aria-label={nameOf(p)}>
                    <Portrait person={p} tree={tree} size={40} />
                  </Link>
                  <div className="hp-story-main">
                    <div className="hp-story-meta">
                      <span className="hp-story-kind">{KIND_LABEL[st.kind] ?? 'Note'}</span>
                      <span>
                        {st.kind === 'quote' ? 'of' : 'about'}{' '}
                        <Link className="hp-link" to="/$tree" params={{ tree }} search={{ focus: p.id }}><Name p={p} /></Link>
                        {' '}· {st.author}
                      </span>
                      <time dateTime={st.at}>{when(st.at)}</time>
                    </div>
                    {st.title && <h3>{st.title}</h3>}
                    <p className={st.kind === 'quote' ? 'hp-quote' : undefined}>{st.kind === 'quote' ? `“${plain(st.body)}”` : plain(st.body)}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="hp-feed-foot">
            {stories.length > limit && <button className="btn" onClick={() => setLimit(limit + 10)}>Show {Math.min(10, stories.length - limit)} more</button>}
            <Link className="btn ghost" to="/$tree/chronicle" params={{ tree }}><ScrollText size={15} /> The whole chronicle</Link>
          </div>
        </>
      )}
    </section>
  );
}
