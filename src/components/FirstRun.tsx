import { useT } from '~/lib/i18n';
// First visit to a tree: "Who are you in this family?", then an optional three-step tour.
// The answer is saved with the reader's membership and as the `me:<tree>` preference (a person id,
// or BROWSING); the tour is remembered once seen or skipped (`tour`). Until the reader answers,
// kinship labels stay hidden. `WhoPicker` is the same list, for the invitation page.
import { useQueryClient } from '@tanstack/react-query';
import { MousePointerClick, Search, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BROWSING, chooseMe, useFamily, useMeAnswered, useTreeId } from '~/lib/family';
import { children, displayName, lifespan, parents, partnersOf, siblings, type Family } from '~/lib/graph';
import { setPref, usePref } from '~/lib/prefs';
import { useCan, useSession } from '~/lib/session';
import { searchPeople } from './Palette';
import { Portrait } from './Portrait';
import { Dialog } from './ui/Dialog';
import './firstrun.css';



export function reopenTour() { window.dispatchEvent(new Event('kindred:reopen-tour')); }

export function FirstRun() {
  const t = useT();
const STEPS: { title: string; art: ReactNode; body: ReactNode; adds?: boolean }[] = [
  {
    title: t("firstrun.select_then_centre"),
    art: <MousePointerClick size={38} />,
    body: <>{t("firstrun.a")} <b>{t("firstrun.click")}</b> {t("firstrun.shows_someone_in_the_side_panel_and_leaves_the_tree_where_it_is")} <b>{t("firstrun.double_click")}</b>{t("firstrun.or_press")} <kbd>↵</kbd>{t("firstrun.to_centre_the_tree_on_them")}</>,
  },
  {
    title: t("firstrun.add_with_the_marks"),
    adds: true,
    art: <UserPlus size={38} />,
    body: <>{t("firstrun.dashed")} <b>+</b> {t("firstrun.marks_surround_the_selected_card_a_parent_above_a_child_below_a_partner_to_the_right_a_sibling_to_the_left_only_a_name_is_needed")}</>,
  },
  {
    title: t("firstrun.find_anyone"),
    art: <Search size={38} />,
    body: <>{t("firstrun.press")} <kbd>⌘K</kbd> {t("firstrun.or")} <kbd>/</kbd> {t("firstrun.and_type_a_name_nickname_title_or_house_it_also_switches_views_and_themes")}</>,
  },
];
  const f = useFamily();
  const tree = useTreeId();
  const qc = useQueryClient();
  const answered = useMeAnswered();
  const tourSeen = usePref('tour') !== null;
  // Closing without answering only defers the question to the next visit.
  const [later, setLater] = useState(false);
  const [touring, setTouring] = useState(false);
  const [step, setStep] = useState(0);
  // Readers who can't add people skip the step about the + marks: they don't see them.
  const canAdd = useCan('add-person');
  const steps = canAdd ? STEPS : STEPS.filter((s) => !s.adds);
  useEffect(() => { const reopen = () => { setStep(0); setTouring(true); }; window.addEventListener('kindred:reopen-tour', reopen); return () => window.removeEventListener('kindred:reopen-tour', reopen); }, []);

  const choose = (id: string) => {
    // The account's picture comes from the session's membership, so refresh the session once the link is saved.
    void chooseMe(tree, id).then(() => qc.invalidateQueries({ queryKey: ['session'] }));
    if (!tourSeen) setTouring(true);
  };
  const endTour = () => {
    setPref('tour', 'seen');
    setTouring(false);
  };

  if (touring) {
    const s = steps[Math.min(step, steps.length - 1)];
    const last = step >= steps.length - 1;
    return (
      <Dialog
        open
        onClose={endTour}
        variant="event"
        width={460}
        title={s.title}
        footer={
          <>
            <span className="tour-dots" aria-label={t('common.step', {step:step+1,count:steps.length})}>
              {steps.map((_, i) => <i key={i} data-on={i === step || undefined} />)}
            </span>
            {!last && <button className="btn ghost" onClick={endTour}>{t("firstrun.skip_tour")}</button>}
            {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>{t("firstrun.back")}</button>}
            <button className="btn primary" data-autofocus onClick={() => (last ? endTour() : setStep(step + 1))}>{last ? t("firstrun.start_exploring") : t("firstrun.next")}</button>
          </>
        }
      >
        <div className="tour" key={step}>
          <span className="tour-art" aria-hidden>{s.art}</span>
          <p>{s.body}</p>
        </div>
      </Dialog>
    );
  }

  return <WhoAreYou open={!answered && !later} onChoose={choose} onLater={() => setLater(true)} familyName={f.graph.tree.name} />;
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
