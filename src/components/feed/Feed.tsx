// The family's feed on the Today page (docs/feed.md): a way to say something, then one stream, newest first, of what
// people in the family did: their messages, new memories and sayings, a day's photographs, people added to the tree, a
// day's updates to the records (details, contact details, life events, sources, a portrait), a season of the Campaign
// ending, and at the very top whose birthday it is today. The events (people added, updates, a birthday) take reactions
// and comments as a message does. Members only: for a share-link guest it draws nothing and asks nothing, and the server
// refuses a guest anyway.
//
//   <Feed tree={tree} />
//
// The first page comes with the page (the route's loader); earlier ones follow as the reader scrolls for a while, and
// then at the press of a button, so the end of the page stays reachable.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Baby, FileInput, Images, Lock, PencilLine, ScrollText, Swords, UserPlus } from 'lucide-react';
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { EAGER_FACES, StoryCard, type StoryTranslation } from '~/components/chronicle/StoryCard';
import { contactHref } from '~/components/fields/FieldsView';
import { GameIcon } from '~/components/GameIcon';
import { Responses } from '~/components/responses/Responses';
import { comingUp, nth } from '~/components/today/DatesCard';
import { EmptyState, ErrorState, Fleuron, Skeleton } from '~/components/ui';
import { storyTranslationsQuery } from '~/lib/ai/background.functions';
import { useToday } from '~/lib/clock';
import { useDealt } from '~/lib/dealt';
import { useFamily } from '~/lib/family';
import { feedQuery } from '~/lib/feed/feed.functions';
import type { ContactKind, FeedItem, UpdatePerson, UpdateValue } from '~/lib/feed/types';
import { isContactType, type FieldType } from '~/lib/fields/model';
import { displayName, type Family } from '~/lib/graph';
import { fieldName, valueText } from '~/lib/history-text';
import { datePrecision, formatDate, richText, useT, type Key, type Translator } from '~/lib/i18n';
import { mediaUrl } from '~/lib/photos/types';
import { useCan, useMember, useSession } from '~/lib/session';
import type { GPerson, Story } from '~/lib/types';
import { dayLabel } from '~/lib/when';
import { ComposeRow } from './ComposeRow';
import { authorFaces, PostCard, useAuthorName, When } from './PostCard';
import '~/styles/chronicle.css';
import './feed.css';

/** How many pages follow by themselves as the reader scrolls; after that, a button asks. */
const AUTO_PAGES = 4;

export function Feed({ tree }: { tree: string }) {
  const t = useT();
  const f = useFamily();
  const heading = useId();
  const member = !!useMember(tree);
  const session = useSession();
  // A demo's visitor and a steward's preview read: the row above says why, and nothing here offers to write.
  const canPost = useCan('post') && !session?.demo && !session?.viewAs;
  const q = useInfiniteQuery({ ...feedQuery(tree), enabled: member });
  // AI translations of memories into the reader's language, as the Chronicle shows them. Optional: without them the originals show.
  const translations: Record<string, StoryTranslation> = useQuery({ ...storyTranslationsQuery(tree, t.locale), enabled: member }).data ?? {};
  // The reader's own clock: undefined on the server, so the two never disagree about "today" or "3 hours ago".
  const today = useToday();
  const [openedAt] = useState(() => Date.now());
  const now = useMemo(() => (today ? new Date(openedAt) : undefined), [today, openedAt]);
  const dealt = useDealt(!q.isPending);
  const [writing, setWriting] = useState(false);

  const items = useMemo(() => {
    const seen = new Set<string>();
    // A post written while an earlier page was on screen can come round again on a later one: each entry is shown once.
    return (q.data?.pages ?? []).flatMap((p) => p.items).filter((i) => !seen.has(i.key) && !!seen.add(i.key) && shows(i, f));
  }, [q.data, f]);
  const groups = useMemo(() => {
    const m = new Map<string, FeedItem[]>();
    for (const i of items) {
      const k = now ? dayLabel(i.at, now, t) : '';
      const g = m.get(k);
      if (g) g.push(i);
      else m.set(k, [i]);
    }
    return [...m.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, now, t.locale]);
  const celebrating = useMemo(() => (today ? comingUp(f, today).filter((e) => e.days === 0) : []), [f, today]);
  // A birthday today is said under "Today", which then has a heading also when nobody has written yet.
  const todayLabel = t('chronicle.today');
  const shownGroups = celebrating.length && groups[0]?.[0] !== todayLabel ? [[todayLabel, [] as FeedItem[]] as [string, FeedItem[]], ...groups] : groups;

  // Earlier pages follow as the button comes into view, for a few pages; then it waits to be pressed.
  const more = useRef<HTMLButtonElement>(null);
  const pages = q.data?.pages.length ?? 0;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;
  useEffect(() => {
    const el = more.current;
    if (!el || !hasNextPage || isFetchingNextPage || pages > AUTO_PAGES || typeof IntersectionObserver === 'undefined') return;
    const seen = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) void fetchNextPage(); }, { rootMargin: '600px 0px' });
    seen.observe(el);
    return () => seen.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, pages]);

  if (!member) return null;
  const empty = q.isSuccess && !items.length && !celebrating.length && !hasNextPage;
  // Only the first few entries draw their faces in the server's HTML (see EAGER_FACES).
  const place = new Map(items.map((i, at) => [i.key, at]));

  return (
    <section className="fd" aria-labelledby={heading}>
      <ComposeRow tree={tree} open={writing} onOpen={setWriting} />
      <div className="fd-head">
        <h2 id={heading}>{t('feed.title')}</h2>
        <Link to="/$tree/chronicle" params={{ tree }} title={t('feed.to_chronicle_hint')}><ScrollText size={15} aria-hidden /> {t('shell.chronicle')}</Link>
      </div>

      {q.isPending ? (
        <div aria-busy="true" aria-label={t('feed.loading')} style={{ marginTop: 14, display: 'grid', gap: 14 }}>
          {Array.from({ length: 3 }, (_, i) => <div className="ui-card" key={i} style={{ padding: 18 }}><Skeleton lines={3} /></div>)}
        </div>
      ) : q.isError && !q.data ? (
        <ErrorState title={t('feed.failed')} error={q.error} onRetry={() => void q.refetch()} />
      ) : empty ? (
        <EmptyState
          className="fd-empty"
          icon={<GameIcon name="quill-ink" size={34} />}
          title={t('feed.empty_title')}
          text={t(canPost ? 'feed.empty_text' : 'feed.empty_viewer')}
          action={canPost ? <button type="button" className="btn primary" onClick={() => setWriting(true)}>{t('feed.empty_cta')}</button> : undefined}
        />
      ) : (
        <>
          {shownGroups.map(([label, entries], gi) => (
            <section key={label} className="chr-day">
              {label ? <h3 className="rule">{label}</h3> : null}
              <ol className={`chr-feed ${gi === 0 ? dealt : ''}`} style={label ? undefined : { marginTop: 14 }}>
                {/* Whose day it is comes first under "Today": a line, not a card. */}
                {gi === 0 && celebrating.map((e) => {
                  const people = e.ids.map((id) => f.byId.get(id)).filter((p): p is GPerson => !!p);
                  const names = nameLinks(people, f, tree, t);
                  return (
                    <Quiet
                      key={e.key}
                      today
                      icon={<GameIcon name={e.kind === 'birthday' ? 'cake-slice' : 'linked-rings'} size={16} />}
                      after={<Responses tree={tree} kind="event" target={`${e.key}:${e.date.getFullYear()}`} compact />}
                    >
                      <span>{e.kind === 'birthday' ? richText(t, 'feed.line.birthday', { name: names }, { count: e.n }) : richText(t, 'feed.line.anniversary', { names }, { ord: nth(e.n, t.locale) })}</span>
                    </Quiet>
                  );
                })}
                {entries.map((item) => <Entry key={item.key} item={item} f={f} tree={tree} now={now?.getTime()} tr={translations} defer={(place.get(item.key) ?? 0) >= EAGER_FACES} />)}
              </ol>
            </section>
          ))}
          {hasNextPage ? (
            <button ref={more} type="button" className="btn fd-more" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
              {isFetchingNextPage ? t('feed.more_loading') : t('feed.more')}
            </button>
          ) : items.length > 6 ? (
            <p className="fd-end"><Fleuron />{t('feed.end')}</p>
          ) : null}
          {q.isFetchNextPageError ? <p role="alert" className="fd-end">{t('feed.failed')}</p> : null}
        </>
      )}
    </section>
  );
}

/** Whether an entry has anything to show in this family as the reader has it (a memory of someone since removed has not). */
function shows(item: FeedItem, f: Family): boolean {
  if (item.type === 'story') return f.byId.has(item.person);
  if (item.type === 'people') return item.people.some((p) => f.byId.has(p.id));
  if (item.type === 'updates') return item.imported > 0 || item.people.some((p) => p.id === null || f.byId.has(p.id));
  return true;
}

/** People as links to their pages: one, "A and B", or "A, B" before "and 3 more". */
function nameLinks(people: GPerson[], f: Family, tree: string, t: Translator): ReactNode {
  const link = (p: GPerson) => <Link key={p.id} to="/$tree/person/$id" params={{ tree, id: p.id }}>{displayName(p, f)}</Link>;
  if (people.length === 2) return richText(t, 'feed.pair', { a: link(people[0]!), b: link(people[1]!) });
  return people.map((p, i) => <Fragment key={p.id}>{i > 0 && ', '}{link(p)}</Fragment>);
}

/** A quiet line between the entries: a mark, a sentence, and when; `after` goes under the sentence (reactions, a list). */
function Quiet({ icon, children, today, after }: { icon: ReactNode; children: ReactNode; today?: boolean; after?: ReactNode }) {
  return (
    <li className="fd-quiet" data-today={today || undefined}>
      <span className="fd-quiet-mark" aria-hidden>{icon}</span>
      <div className="fd-quiet-body">
        <p>{children}</p>
        {after}
      </div>
    </li>
  );
}

function Entry({ item, f, tree, now, tr, defer }: { item: FeedItem; f: Family; tree: string; now?: number; tr: Record<string, StoryTranslation>; defer: boolean }) {
  const t = useT();
  switch (item.type) {
    case 'post':
      return <PostCard post={item.post} tree={tree} now={now} defer={defer} />;
    case 'story': {
      const s: Story = { id: item.id, person: item.person, kind: item.kind, title: item.title ?? undefined, body: item.body, author: item.author, at: item.at, context: item.context ?? undefined };
      return <StoryCard s={s} f={f} tree={tree} now={now} tr={tr[item.id]} defer={defer} line={item.week ? 'feed.line.answer' : undefined} kindLink />;
    }
    case 'photos':
      return <PhotosEntry item={item} tree={tree} now={now} defer={defer} />;
    case 'people': {
      const known = item.people.map((p) => ({ person: f.byId.get(p.id), born: p.born })).filter((p): p is { person: GPerson; born: string | null } => !!p.person);
      const newborns = known.filter((p) => p.born);
      const others = known.filter((p) => !p.born).map((p) => p.person);
      // Those named here, and how many more the day brought beyond them.
      const named = others.slice(0, 2);
      const rest = item.count - newborns.length - named.length;
      const names = nameLinks(named, f, tree, t);
      return (
        <>
          {newborns.map(({ person, born }) => (
            <Quiet key={person.id} icon={<Baby size={16} />}>
              <span>{richText(t, `feed.line.newborn_${datePrecision(born!)}`, { name: nameLinks([person], f, tree, t) }, { date: formatDate(born, t.locale) })}</span>
              <When at={item.at} now={now} t={t} />
            </Quiet>
          ))}
          {named.length > 0 && (
            <Quiet icon={<UserPlus size={16} />} after={<Responses tree={tree} kind="event" target={item.target} compact />}>
              <span>
                {item.by
                  ? rest > 0 ? richText(t, 'feed.line.added', { author: <b>{item.by}</b>, names }, { count: rest }) : richText(t, 'feed.line.added_one', { author: <b>{item.by}</b>, names })
                  : rest > 0 ? richText(t, 'feed.line.joined', { names }, { count: rest }) : richText(t, 'feed.line.joined_one', { names })}
              </span>
              <When at={item.at} now={now} t={t} />
            </Quiet>
          )}
        </>
      );
    }
    case 'updates':
      return <UpdatesEntry item={item} f={f} tree={tree} now={now} />;
    case 'season':
      return (
        <Quiet icon={<Swords size={16} />}>
          <span>
            <Link to="/$tree/campaign" params={{ tree }}>{t('campaign.title')}</Link>{': '}
            {item.winner ? t('feed.line.season_won', { season: item.season, winner: item.winner }) : t('feed.line.season_over', { season: item.season })}
          </span>
          <When at={item.at} now={now} t={t} />
        </Quiet>
      );
  }
}

/** The new values an update shows at first; the rest open with "and 2 more". */
const VALUES_SHOWN = 3;
/** What a long text is: shown as a two-line excerpt that leads to the person. */
const LONG = new Set(['bio', 'field:notes', 'field:custom', 'field:medical', 'field:allergies', 'field:favourites', 'field:gifts']);
/** The key of a contact's value that its link is made from (fields/model.ts VALUE). An address is one line of text here. */
const CONTACT_KEY: Record<ContactKind, string> = { phone: 'number', email: 'address', website: 'url', social: 'handle', address: 'street' };

/** What a detail is called: a person's own fact by its column, a field by its type. */
const detailName = (t: Translator, name: string) => (name.startsWith('field:') ? t(`type.${name.slice(6)}` as Key) : fieldName(t, name));

/**
 * The phrases of one update's new values: "new phone number: +49 …" (a link that calls), "born 3 May 1950 in Graz",
 * "Occupation: Baker", a biography's first lines, "Occupation removed". Text all through, so a screen reader reads a sentence.
 */
function valuePhrases(values: UpdateValue[], t: Translator, to: { tree: string; id: string } | null): ReactNode[] {
  const by = new Map(values.map((v) => [v.name, v]));
  const out: ReactNode[] = [];
  const said = new Set<string>();
  // A birth or a death with its place is one phrase.
  for (const [date, place] of [['born', 'born_place'], ['died', 'died_place']] as const) {
    const d = by.get(date)?.value, pl = by.get(place)?.value;
    if (d) out.push(t(`feed.value.${date}${pl ? '_in' : ''}_${datePrecision(d)}`, { date: formatDate(d, t.locale), place: pl ?? '' }));
    else if (pl) out.push(t(`feed.value.${place}`, { place: pl }));
    if (d) said.add(date);
    if (pl) said.add(place);
  }
  for (const v of values) {
    if (said.has(v.name)) continue;
    const name = detailName(t, v.name);
    if (v.value === null) { out.push(t('feed.value.removed', { name })); continue; }
    const type = v.name.startsWith('field:') ? (v.name.slice(6) as FieldType) : null;
    if (type && isContactType(type)) {
      const href = contactHref({ type, label: v.label ?? '', value: { [CONTACT_KEY[type as ContactKind]]: v.value } });
      const outward = type === 'address' || type === 'website' || type === 'social';
      const value = href ? <a href={href} target={outward ? '_blank' : undefined} rel="noopener noreferrer">{v.value}</a> : v.value;
      out.push(richText(t, `feed.value.contact.${type}` as Key, { value }));
    } else if (LONG.has(v.name)) {
      const excerpt = to ? <Link className="fd-excerpt" to="/$tree/person/$id" params={to}>{v.value}</Link> : <span className="fd-excerpt">{v.value}</span>;
      out.push(richText(t, 'feed.value.set', { name, value: excerpt }));
    } else {
      const text = type === 'dates' ? formatDate(v.value, t.locale) : type ? v.value : valueText(t, v.name, v.value);
      out.push(t('feed.value.set', { name, value: text }));
    }
  }
  return out;
}

/** What one update to one person said, as short phrases: "has a new address", "a life event", "details changed (Born)". */
function updateParts(p: UpdatePerson, t: Translator, valued: ReadonlySet<string> = new Set()): string[] {
  const parts: string[] = p.contact.filter((c) => !valued.has(`field:${c}`)).map((c) => t(`feed.update.contact.${c}`));
  const details = p.details.filter((d) => !valued.has(d));
  if (details.length) parts.push(t('feed.update.details', { list: details.map((d) => detailName(t, d)).join(', ') }));
  if (p.events) parts.push(t('feed.update.events', { count: p.events }));
  if (p.sources && p.id !== null) parts.push(t('feed.update.sources', { count: p.sources }));
  if (p.portrait) parts.push(t('feed.update.portrait'));
  if (p.tagged) parts.push(t('feed.update.tagged', { count: p.tagged }));
  return parts;
}

/**
 * What one update to one person said: the new values this reader may see first (the first few, then "and 2 more", which
 * opens the rest), then what changed without a value it may show, by its kind.
 */
function UpdateWhat({ p, tree }: { p: UpdatePerson; tree: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const values = p.values ?? [];
  const phrases = valuePhrases(values, t, p.id ? { tree, id: p.id } : null);
  const shown = open ? phrases : phrases.slice(0, VALUES_SHOWN);
  const hidden = phrases.length - shown.length;
  const more = hidden > 0
    ? <button type="button" className="fd-values-more" aria-expanded={false} onClick={() => setOpen(true)}>{t('feed.line.updated_more', { count: hidden })}</button>
    : null;
  const parts: ReactNode[] = [...shown, ...updateParts(p, t, new Set(values.map((v) => v.name)))];
  // "and 2 more" follows the values it stands for, before what is said by its kind.
  return <>{parts.map((x, i) => <Fragment key={i}>{i > 0 ? ', ' : null}{x}{i === shown.length - 1 && more ? <>{' '}{more}</> : null}</Fragment>)}</>;
}

/**
 * One member's updates of one day, as a quiet line: one person said in a sentence ("Ada updated Carl: has a new address,
 * new phone number"), more as a short list under it, each name a link to the person's page. A GEDCOM import is one line.
 */
function UpdatesEntry({ item, f, tree, now }: { item: Extract<FeedItem, { type: 'updates' }>; f: Family; tree: string; now?: number }) {
  const t = useT();
  const author = <b>{item.by || t('feed.someone')}</b>;
  const people = item.people.filter((p) => p.id !== null && f.byId.has(p.id));
  const nobody = item.people.find((p) => p.id === null);
  const link = (id: string) => <Link to="/$tree/person/$id" params={{ tree, id }}>{displayName(f.byId.get(id)!, f)}</Link>;
  const what = (p: UpdatePerson) => <UpdateWhat p={p} tree={tree} />;
  const responses = <Responses tree={tree} kind="event" target={item.target} compact />;
  const lines: ReactNode[] = [];
  if (item.imported) lines.push(<span key="import">{richText(t, 'feed.line.imported', { author }, { count: item.imported })}</span>);
  if (people.length === 1 && item.count === 1 && !item.more) {
    lines.push(<span key="one">{richText(t, 'feed.line.updated_one', { author, name: link(people[0]!.id!), what: what(people[0]!) })}</span>);
  } else if (people.length) {
    lines.push(<span key="many">{richText(t, 'feed.line.updated', { author }, { count: item.count })}</span>);
  }
  if (nobody?.sources) lines.push(<span key="sources">{richText(t, 'feed.line.recorded', { author }, { what: t('feed.update.sources', { count: nobody.sources }) })}</span>);
  if (!lines.length) return null;
  const rest = item.count - people.length;
  const list = people.length > 1 || (people.length === 1 && (item.count > 1 || item.more)) ? (
    <ul className="fd-updates">
      {people.map((p) => <li key={p.id}>{link(p.id!)}{': '}{what(p)}</li>)}
      {rest > 0 ? <li className="fd-updates-more">{t('feed.line.updated_more', { count: rest })}</li> : null}
      {item.more ? <li className="fd-updates-more">{t('feed.line.updated_and_more')}</li> : null}
    </ul>
  ) : null;
  return (
    <Quiet icon={item.imported && !people.length ? <FileInput size={16} /> : <PencilLine size={16} />} after={<>{list}{responses}</>}>
      {lines.map((l, i) => <Fragment key={i}>{i > 0 ? ' ' : null}{l}</Fragment>)}
      {item.editors ? <small className="subtle fd-editors" title={t('field.vis.editorsHint')}><Lock size={12} aria-hidden /> {t('field.vis.editors')}</small> : null}
      <When at={item.at} now={now} t={t} />
    </Quiet>
  );
}

/** One member's photographs of one day: who added how many, to which album, and the newest few, which lead to the Gallery. */
function PhotosEntry({ item, tree, now, defer }: { item: Extract<FeedItem, { type: 'photos' }>; tree: string; now?: number; defer: boolean }) {
  const t = useT();
  const { name: known, person } = useAuthorName(item.by);
  // An upload keeps no name of its own: someone who has left is "someone".
  const name = item.by.name || person ? known : t('feed.someone');
  const faces = authorFaces({ person, name, tree, defer });
  const author = <b>{name}</b>;
  const line = item.more
    ? richText(t, 'feed.line.photos_more', { author }, { count: item.count })
    : item.album
      ? richText(t, 'feed.line.photos_album', { author, album: <b>{item.album.name}</b> }, { count: item.count })
      : richText(t, 'feed.line.photos', { author }, { count: item.count });
  return (
    <li className="chr-item fd-photos">
      {faces.beside}
      <article className="chr-card ui-card">
        <header>
          {faces.inline}
          <span className="chr-kind"><Images size={14} aria-hidden /> {t('shell.gallery')}</span>
          <span className="fd-line-text">{line}</span>
          <When at={item.at} now={now} t={t} />
        </header>
        <ul className="fd-pics" data-n={item.pictures.length}>
          {item.pictures.map((p, i) => (
            <li key={p.key} style={item.pictures.length === 1 ? { aspectRatio: `${p.width || 4} / ${p.height || 3}` } : undefined}>
              <Link to="/$tree/gallery" params={{ tree }}>
                <img src={mediaUrl(tree, p.key, 'thumb')} alt={t('feed.photos.alt', { n: i + 1, name })} loading="lazy" decoding="async" />
                {item.count > item.pictures.length && i === item.pictures.length - 1 ? <span className="fd-pics-more" aria-hidden>+{item.count - item.pictures.length}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
        <Link className="fd-card-link" to="/$tree/gallery" params={{ tree }}>{t('feed.photos.open')}</Link>
      </article>
    </li>
  );
}
