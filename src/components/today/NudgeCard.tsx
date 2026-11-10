// One gentle nudge from the Needed page, as a card for the Today page: a single thing the family does not know yet
// about someone close to the reader, asked as a question. One a day (the same all day), only something the reader's
// role may fill in, and never about a death. Renders nothing when there is nothing to ask.
//
//   const nudge = useNudge(tree);          the Today page asks first, to know whether the card has a place in its strip
//   <NudgeCard tree={tree} nudge={nudge} />
import { Link } from '@tanstack/react-router';
import { Sprout } from 'lucide-react';
import { useId, useMemo } from 'react';
import { Portrait } from '~/components/Portrait';
import { hashSeed } from '~/lib/campaign/rng';
import { useToday } from '~/lib/clock';
import { useFamily, useMe } from '~/lib/family';
import { GAP_ACTION, gapsOf, useRequired, type GapKey } from '~/lib/gaps';
import { displayName, stepsFrom } from '~/lib/graph';
import type { GPerson } from '~/lib/types';
import { richText, useT } from '~/lib/i18n';
import type { Key } from '~/lib/i18n/dictionary';
import { can } from '~/lib/roles';
import { useRole, useSession } from '~/lib/session';
import './today.css';

/** The gaps a nudge may ask about, each as a question. A death date, a sex and contact details are left to the Needed page. */
const ASK: Partial<Record<GapKey, Key>> = {
  birthplace: 'today.nudge.birthplace',
  born: 'today.nudge.born',
  birthday: 'today.nudge.birthday',
  parents: 'today.nudge.parents',
  photo: 'today.nudge.photo',
  occupation: 'today.nudge.occupation',
  story: 'today.nudge.story',
};
/** How far from the reader a nudge looks: parents, grandparents, their brothers and sisters. */
const CLOSE = 4;
const POOL = 12;

export interface Nudge { p: GPerson; gap: GapKey }

/** Today's nudge for this reader, or null when there is nothing to ask (and until the page runs in the browser). */
export function useNudge(tree: string): Nudge | null {
  const f = useFamily();
  const me = useMe();
  const role = useRole();
  const guest = useSession()?.guest?.tree === tree;
  const today = useToday();
  const [required] = useRequired(tree);

  return useMemo(() => {
    if (!today || guest) return null;
    const steps = stepsFrom(f, me);
    // A memory is always worth asking for, whatever the reader counts as needed.
    const wanted = new Set<GapKey>([...required, 'story']);
    const open = f.graph.people
      .map((p) => ({ p, hop: steps.get(p.id) ?? 99, gaps: gapsOf(f, p, wanted).filter((g) => ASK[g] && can(role, GAP_ACTION[g])) }))
      .filter((r) => r.gaps.length && r.p.given.trim())
      .sort((a, b) => a.hop - b.hop || (a.p.id < b.p.id ? -1 : 1));
    const near = open.filter((r) => r.hop <= CLOSE);
    const pool = (near.length ? near : open).slice(0, POOL);
    if (!pool.length) return null;
    const seed = hashSeed(`${tree}:${me}:${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`);
    const row = pool[seed % pool.length]!;
    return { p: row.p, gap: row.gaps[(seed >>> 8) % row.gaps.length]! };
  }, [f, me, role, guest, today, required, tree]);
}

export function NudgeCard({ tree, nudge }: { tree: string; nudge: Nudge | null }) {
  const t = useT();
  const f = useFamily();
  const id = useId();
  if (!nudge) return null;
  const name = displayName(nudge.p, f);
  return (
    <section className="ui-card td-card td-nudge" aria-labelledby={`${id}-h`}>
      <h2 className="td-h" id={`${id}-h`}><Sprout size={18} aria-hidden /> {t('today.nudge.title')}</h2>
      <div className="td-nudge-row">
        <Portrait person={nudge.p} tree={tree} size={48} decorative />
        <p>{richText(t, ASK[nudge.gap]!, { name: <b>{name}</b> })}</p>
      </div>
      <div className="td-nudge-actions">
        <Link className="btn" to="/$tree/person/$id" params={{ tree, id: nudge.p.id }}>{t('today.nudge.open', { name: nudge.p.given })}</Link>
        <Link className="td-more-link" to="/$tree/needed" params={{ tree }}>{t('today.nudge.more')}</Link>
      </div>
    </section>
  );
}
