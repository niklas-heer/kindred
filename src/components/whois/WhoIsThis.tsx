// "Who is this?" (docs/who-is-this.md): a few gallery photographs nobody is named in, one at a time. The reader may tap a
// face, then picks who it is (or "I don't know", or Skip). A name is a proposal until someone who may tag photographs agrees;
// those readers also get the proposals waiting for them. The same component is a card on Today and the whole of the
// "Who is this?" page. Members only: Today and the page are members' pages, and the server refuses everyone else.
//
//   const who = useWhoIsThis(tree);   Today asks first, to know whether the card has a place in its strip
//   <WhoIsThis tree={tree} />          the card; `page` on the page, where an empty round says so instead of vanishing
//   <WhoIsThisLink tree={tree} />      the way in from the Gallery and the Needed page
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, HelpCircle, SkipForward, UserSearch, X } from 'lucide-react';
import { useId, useState, type MouseEvent } from 'react';
import { PersonPicker } from '~/components/photos/PersonPicker';
import { EmptyState, Skeleton } from '~/components/ui';
import { errorText } from '~/lib/errortext';
import { useFamily } from '~/lib/family';
import { displayName } from '~/lib/graph';
import { useT } from '~/lib/i18n';
import { mediaUrl, type Box } from '~/lib/photos/types';
import { useMember } from '~/lib/session';
import { boxAround } from '~/lib/whois/rules';
import type { WhoOutcome, WhoReview } from '~/lib/whois/types';
import { answerWho, decideWho, whoRoundQuery } from '~/lib/whois/whois.functions';
import './whois.css';

/** The first round, for Today's strip: undefined until it is known, and for anyone who is not a member. */
export function useWhoIsThis(tree: string) {
  const member = !!useMember(tree);
  const q = useQuery({ ...whoRoundQuery(tree), enabled: member });
  if (!member || !q.data) return undefined;
  return q.data.photos.length || q.data.review.length ? q.data : undefined;
}

/** The way in from the Gallery and the Needed page: a link to the game, while it has something for this member. */
export function WhoIsThisLink({ tree }: { tree: string }) {
  const t = useT();
  const who = useWhoIsThis(tree);
  if (!who) return null;
  return (
    <p className="wi-entry-row">
      <Link className="btn wi-entry" to="/$tree/who-is-this" params={{ tree }}><UserSearch size={16} aria-hidden /> {t('whois.entry')}</Link>
    </p>
  );
}

type Said = { outcome: WhoOutcome; name?: string };

export function WhoIsThis({ tree, page = false }: { tree: string; page?: boolean }) {
  const t = useT();
  const f = useFamily();
  const qc = useQueryClient();
  const id = useId();
  // What this visit showed already, so the next round never deals the same photograph again straight away.
  const [seen, setSeen] = useState<string[]>([]);
  const [round, setRound] = useState(0);
  const [at, setAt] = useState(0);
  const [mark, setMark] = useState<Box | null>(null);
  const [said, setSaid] = useState<Said | null>(null);
  // Names given since the round was dealt, for the month's count until the next round brings the server's.
  const [since, setSince] = useState({ named: 0, confirmed: 0 });
  const q = useQuery(whoRoundQuery(tree, seen, round));
  const photos = q.data?.photos ?? [];
  const photo = photos[at];

  const next = (key: string) => {
    setSeen((s) => (s.includes(key) ? s : [...s, key]));
    setMark(null);
    setAt((n) => n + 1);
  };
  const send = useMutation({
    mutationFn: (a: { key: string; verdict: 'named'; person: string; box: Box | null } | { key: string; verdict: 'unknown' | 'skip' }) => answerWho({ data: { tree, answer: a } }),
    onSuccess: (outcome, a) => {
      setSaid({ outcome, name: a.verdict === 'named' ? nameOf(a.person) : undefined });
      if (outcome === 'proposed' || outcome === 'confirmed') setSince((n) => ({ named: n.named + 1, confirmed: n.confirmed + (outcome === 'confirmed' ? 1 : 0) }));
      next(a.key);
      if (outcome === 'confirmed') void qc.invalidateQueries({ queryKey: ['gallery', tree] });
    },
  });
  const nameOf = (person: string) => {
    const p = f.byId.get(person);
    return p ? displayName(p, f) : person;
  };

  const tap = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    // A keyboard press has no point: the mark goes to the middle.
    const x = e.detail === 0 || !r.width ? 0.5 : (e.clientX - r.left) / r.width;
    const y = e.detail === 0 || !r.height ? 0.4 : (e.clientY - r.top) / r.height;
    setMark(boxAround(x, y));
  };
  const again = () => {
    setRound((n) => n + 1);
    setAt(0);
    setSaid(null);
    setSince({ named: 0, confirmed: 0 });
  };

  const month = q.data && { named: q.data.month.named + since.named, confirmed: q.data.month.confirmed + since.confirmed };
  const empty = q.data && !photos.length && !q.data.review.length;
  if (!page && empty) return null;

  return (
    <section className="ui-card td-card wi" aria-labelledby={page ? undefined : `${id}-h`} aria-label={page ? t('whois.title') : undefined} data-testid="who-is-this">
      {/* On its own page the page's heading names it already. */}
      {!page && (
        <header className="td-card-head">
          <h2 className="td-h" id={`${id}-h`}><UserSearch size={18} aria-hidden /> {t('whois.title')}</h2>
          <Link className="td-more-link" to="/$tree/who-is-this" params={{ tree }}>{t('whois.play')}</Link>
        </header>
      )}
      {q.isError ? (
        <p role="alert" className="td-note">{errorText(q.error, t.locale)} <button type="button" className="btn ghost" onClick={() => void q.refetch()}>{t('today.retry')}</button></p>
      ) : !q.data ? (
        <Skeleton height={220} />
      ) : (
        <>
          {said && <p className="wi-said" role="status">{saidText(said, t)}</p>}
          {photo ? (
            <div className="wi-play">
              <p className="td-note">{t('whois.sub')}</p>
              <p className="subtle wi-progress">{t('whois.progress', { n: at + 1, total: photos.length })}</p>
              <figure className="wi-figure">
                <button type="button" className="wi-photo" onClick={tap} aria-label={t('whois.tap_hint')} title={t('whois.tap_hint')} style={{ aspectRatio: `${photo.width} / ${photo.height}`, width: `min(100%, ${Math.round((360 * photo.width) / photo.height)}px)` }}>
                  <img src={mediaUrl(tree, photo.key)} alt={photo.caption ?? t('whois.photo_alt')} width={photo.width} height={photo.height} />
                  {mark && <span className="wi-mark" aria-hidden style={boxStyle(mark)} />}
                </button>
                {(photo.caption || photo.taken) && (
                  <figcaption className="subtle">{[photo.caption, photo.taken?.slice(0, 4)].filter(Boolean).join(' · ')}</figcaption>
                )}
              </figure>
              {mark && (
                <p className="wi-marked subtle">
                  {t('whois.marked')} <button type="button" className="btn ghost" onClick={() => setMark(null)}>{t('whois.clear_mark')}</button>
                </p>
              )}
              <PersonPicker label={t('whois.picker_label')} portraits={tree} onPick={(p) => send.mutate({ key: photo.key, verdict: 'named', person: p.id, box: mark })} />
              {send.isError && <p role="alert" className="td-note">{errorText(send.error, t.locale)}</p>}
              <div className="wi-actions">
                <button type="button" className="btn" disabled={send.isPending} onClick={() => send.mutate({ key: photo.key, verdict: 'unknown' })}><HelpCircle size={14} aria-hidden /> {t('whois.unknown')}</button>
                <button type="button" className="btn ghost" disabled={send.isPending} onClick={() => send.mutate({ key: photo.key, verdict: 'skip' })}><SkipForward size={14} aria-hidden /> {t('whois.skip')}</button>
              </div>
            </div>
          ) : photos.length ? (
            <div className="wi-done">
              <p><b>{t('whois.done_title')}</b></p>
              <p className="td-note">{t('whois.done_text')}</p>
              <button type="button" className="btn" onClick={again}>{t('whois.more')}</button>
            </div>
          ) : page && !q.data.review.length ? (
            <EmptyState title={t('whois.none_title')} text={t('whois.none_text')} />
          ) : null}
          {!!month?.named && (
            <p className="subtle wi-month">
              {t('whois.month', { count: month.named })}{month.confirmed ? ` ${t('whois.month_confirmed', { count: month.confirmed })}` : ''}
            </p>
          )}
          {!!q.data.review.length && <Review tree={tree} items={q.data.review} nameOf={nameOf} />}
        </>
      )}
    </section>
  );
}

const boxStyle = (b: Box) => ({ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` });

function saidText(s: Said, t: ReturnType<typeof useT>): string {
  const name = s.name ?? '';
  switch (s.outcome) {
    case 'proposed': return t('whois.proposed', { name });
    case 'confirmed': return t('whois.confirmed', { name });
    case 'already': return t('whois.already', { name });
    case 'not-stored': return t('whois.not_stored');
    case 'noted': return '';
  }
}

/** The proposals waiting for this reader: Confirm makes the tag, "Not right" sets it aside. */
function Review({ tree, items, nameOf }: { tree: string; items: WhoReview[]; nameOf: (person: string) => string }) {
  const t = useT();
  const qc = useQueryClient();
  const id = useId();
  const [done, setDone] = useState<Record<number, string>>({});
  const decide = useMutation({
    mutationFn: (v: { id: number; accept: boolean }) => decideWho({ data: { tree, ...v } }),
    onSuccess: (outcome, v) => {
      setDone((d) => ({ ...d, [v.id]: outcome === 'not-stored' ? t('whois.not_stored') : t(v.accept ? 'whois.decided_confirmed' : 'whois.decided_declined') }));
      if (outcome !== 'not-stored') void qc.invalidateQueries({ queryKey: ['gallery', tree] });
    },
  });
  return (
    <div className="wi-review" aria-labelledby={`${id}-h`} role="group">
      <h3 className="td-h wi-review-h" id={`${id}-h`}>{t('whois.review_title')}</h3>
      {decide.isError && <p role="alert" className="td-note">{errorText(decide.error, t.locale)}</p>}
      <ul>
        {items.map((r) => (
          <li key={r.id} className="wi-review-row">
            <span className="wi-thumb" style={{ aspectRatio: `${r.width} / ${r.height}` }}>
              <img src={mediaUrl(tree, r.key, 'thumb')} alt="" loading="lazy" />
              {r.box && <span className="wi-mark" aria-hidden style={boxStyle(r.box)} />}
            </span>
            <span className="wi-review-text">{t('whois.review_says', { name: nameOf(r.person), names: r.names.join(', ') })}</span>
            {done[r.id] ? (
              <span className="subtle" role="status">{done[r.id]}</span>
            ) : (
              <span className="wi-review-actions">
                <button type="button" className="btn primary" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, accept: true })}><Check size={14} aria-hidden /> {t('whois.confirm')}</button>
                <button type="button" className="btn ghost" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, accept: false })}><X size={14} aria-hidden /> {t('whois.decline')}</button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
