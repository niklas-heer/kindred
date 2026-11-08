import { useT } from '~/lib/i18n';
// First visit to a tree: "Who are you in this family?", then, once and on its own, the offer of the guided tour.
// The answer is saved with the reader's membership and as the `me:<tree>` preference (a person id,
// or BROWSING); the offer is remembered once answered (`tour`). Until the reader answers,
// kinship labels stay hidden. `WhoPicker` is the same list, for the invitation page.
import { useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BROWSING, chooseMe, useFamily, useMeAnswered, useTreeId } from '~/lib/family';
import { children, displayName, lifespan, parents, partnersOf, siblings, type Family } from '~/lib/graph';
import { usePref } from '~/lib/prefs';
import { useSession } from '~/lib/session';
import { searchPeople } from './Palette';
import { Portrait } from './Portrait';
import { Tour } from './tour/Tour';
import { markTourSeen, startTour, TOUR_SEEN_PREF } from './tour/store';
import { Dialog } from './ui/Dialog';
import { useOverlayOpen } from './ui/overlay';
import './firstrun.css';

/** Starts the guided tour; the ⌘K palette's command. */
export const reopenTour = startTour;

/** How long the page settles before the tour is offered, so the offer never lands on top of another dialog. */
const OFFER_DELAY = 700;

export function FirstRun() {
  const f = useFamily();
  const tree = useTreeId();
  const qc = useQueryClient();
  const answered = useMeAnswered();
  // Closing without answering only defers the question to the next visit.
  const [later, setLater] = useState(false);

  const choose = (id: string) => {
    // The account's picture comes from the session's membership, so refresh the session once the link is saved.
    void chooseMe(tree, id).then(() => qc.invalidateQueries({ queryKey: ['session'] }));
  };

  // An empty family has nobody to choose from: the start card in the tree is the first thing to do there.
  return (
    <>
      <WhoAreYou open={!answered && !later && f.graph.people.length > 0} onChoose={choose} onLater={() => setLater(true)} familyName={f.graph.tree.name} />
      <TourOffer eligible={answered && f.graph.people.length > 0} />
      <Tour />
    </>
  );
}

/** Offers the tour once, after the reader has said who they are, and only while no other dialog is open. */
function TourOffer({ eligible }: { eligible: boolean }) {
  const t = useT();
  const seen = usePref(TOUR_SEEN_PREF) !== null;
  const busy = useOverlayOpen();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!eligible || seen || busy || open) return;
    const timer = setTimeout(() => setOpen(true), OFFER_DELAY);
    return () => clearTimeout(timer);
  }, [eligible, seen, busy, open]);

  const answer = (start: boolean) => {
    setOpen(false);
    if (start) startTour();
    else markTourSeen();
  };

  return (
    <Dialog
      open={open}
      onClose={() => answer(false)}
      variant="event"
      width={460}
      title={t('tour.offer.title')}
      footer={
        <>
          <button className="btn ghost" onClick={() => answer(false)}>{t('tour.offer.no')}</button>
          <button className="btn primary" data-autofocus onClick={() => answer(true)}>{t('tour.offer.yes')}</button>
        </>
      }
    >
      <p className="tour-offer">{t('tour.offer.body')}</p>
    </Dialog>
  );
}

function WhoAreYou({ open, onChoose, onLater, familyName }: { open: boolean; onChoose: (id: string) => void; onLater: () => void; familyName: string }) {
  const t = useT();
  const f = useFamily();
  const tree = useTreeId();
  const name = useSession()?.user?.name;
  return (
    <Dialog
      open={open}
      onClose={onLater}
      variant="event"
      width={520}
      title={t("firstrun.who_are_you_in_this_family")}
      description={<>{t("firstrun.kindred_names_everyone_in")} <b>{familyName}</b> {t("firstrun.from_your_point_of_view_your_great_aunt_your_second_cousin")}</>}
    >
      <WhoChooser f={f} tree={tree} onChoose={onChoose} name={name} />
    </Dialog>
  );
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Whether a person's name is exactly what was typed: "Kerstin Holm", "Kerstin", or their nickname. */
function exactName(f: Family, id: string, q: string): boolean {
  const p = f.byId.get(id);
  const fq = fold(q);
  if (!p || !fq) return false;
  return [displayName(p, f), [p.given, p.surname].filter(Boolean).join(' '), p.nickname && [p.nickname, p.surname].filter(Boolean).join(' ')]
    .some((n) => !!n && fold(n) === fq);
}

/**
 * "Who are you?": search for yourself (prefilled with your account name, exact matches first and
 * highlighted), or pick from the living people around the tree's starting point, or just browse.
 * The steward's first-run dialog and the invitation page both use this.
 */
export function WhoChooser({ f, tree, onChoose, name, autoFocus, busy }: { f: Family; tree: string; onChoose: (id: string) => void; name?: string; autoFocus?: boolean; busy?: boolean }) {
  const t = useT();
  return (
    <div className="who" aria-busy={busy || undefined}>
      <WhoPicker f={f} tree={tree} onChoose={onChoose} initialQuery={name} autoFocus={autoFocus} />
      <div className="who-foot">
        <p>{t("firstrun.not_in_the_tree_yet_or_not_sure_you_can_choose_later_with_this_is_me_on_someone_s_card")}</p>
        <button className="btn" onClick={() => onChoose(BROWSING)} disabled={busy}>{t("firstrun.just_browsing")}</button>
      </div>
    </div>
  );
}

/** Search for yourself, or pick from the living people around the tree's starting point. */
export function WhoPicker({ f, tree, onChoose, autoFocus, initialQuery }: { f: Family; tree: string; onChoose: (id: string) => void; autoFocus?: boolean; initialQuery?: string }) {
  const t = useT();
  const [q, setQ] = useState(initialQuery?.trim() ?? '');
  const results = useMemo(() => {
    const ids = searchPeople(f, q, 8).map((r) => r.id);
    // Your own name, exactly, goes to the top.
    return [...ids.filter((id) => exactName(f, id, q)), ...ids.filter((id) => !exactName(f, id, q))];
  }, [f, q]);
  // Before any typing: the living people around the tree's starting point, a likely "you".
  const suggested = useMemo(() => {
    const c = f.graph.tree.focus;
    const near = [c, ...partnersOf(f, c), ...children(f, c), ...siblings(f, c), ...parents(f, c)];
    return [...new Set(near)].filter((id) => f.byId.get(id)?.living).slice(0, 6);
  }, [f]);
  // A prefilled name nobody has: show the likely people instead of an empty list.
  const prefilledMiss = !!initialQuery && q === initialQuery.trim() && !results.length;
  const list = q.trim() && !prefilledMiss ? results : suggested;
  const selectedOnce = useRef(false);

  return (
    <>
      <div className="who-search">
        <Search size={16} />
        <input
          className="input"
          value={q}
          autoFocus={autoFocus}
          data-autofocus
          onChange={(e) => setQ(e.target.value)}
          // The prefilled name is selected, so typing another replaces it.
          onFocus={(e) => { if (!selectedOnce.current && initialQuery) { selectedOnce.current = true; e.target.select(); } }}
          onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) { e.preventDefault(); onChoose(list[0]); } }}
          placeholder={t("firstrun.your_name")}
          aria-label={t("firstrun.search_for_yourself_by_name")}
          aria-controls="who-list"
        />
      </div>
      <div className="who-label">{prefilledMiss ? <>{t("firstrun.no_one_called")}{q}{t("firstrun.yet_perhaps_you_are")}</> : q.trim() ? t("firstrun.matches") : t("firstrun.perhaps_you_are")}</div>
      <ul className="who-list" id="who-list" aria-live="polite">
        {list.length === 0 && <li className="who-empty">{t("firstrun.nobody_by_that_name_yet_try_a_nickname_or_browse_for_now")}</li>}
        {list.map((id) => {
          const p = f.byId.get(id)!;
          const exact = !prefilledMiss && exactName(f, id, q);
          return (
            <li key={id}>
              <button className={`who-item${exact ? ' exact' : ''}`} onClick={() => onChoose(id)}>
                <Portrait person={p} tree={tree} size={38} frame={false} />
                <div>
                  <b>{displayName(p, f)}</b>
                  <span>{lifespan(p, t.locale) || (p.living ? t('firstrun.living') : '')}</span>
                </div>
                {exact && <em className="who-exact">{t("firstrun.your_name")}</em>}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
