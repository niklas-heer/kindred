// Information needed: the family's research to-do list, nearest relatives first.
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { GameIcon } from '~/components/GameIcon';
import { Portrait } from '~/components/Portrait';
import { useFamily, useMe, useTreeId } from '~/lib/family';
import { GAP_LABEL, gapsOf, type GapKey } from '~/lib/gaps';
import { children, displayName, kinship, lifespan, parents, partnersOf, ancestorDepths } from '~/lib/graph';
import '~/styles/needed.css';

export const Route = createFileRoute('/$tree/needed')({ component: Needed });

const ORDER: GapKey[] = ['parents', 'birthday', 'born', 'birthplace', 'died', 'sex'];

function Needed() {
  const f = useFamily();
  const tree = useTreeId();
  const me = useMe();
  const [only, setOnlyRaw] = useState<GapKey | null>(null);
  const [limit, setLimit] = useState(120);
  const setOnly = (g: GapKey | null) => { setOnlyRaw(g); setLimit(120); };

  // Steps from you through parents, children and partners: who is closest gets asked first.
  const hops = useMemo(() => {
    const d = new Map<string, number>([[me, 0]]);
    const q = [me];
    while (q.length) {
      const x = q.shift()!;
      for (const y of [...parents(f, x), ...children(f, x), ...partnersOf(f, x)]) if (!d.has(y)) { d.set(y, d.get(x)! + 1); q.push(y); }
    }
    return d;
  }, [f, me]);
  const myAnc = useMemo(() => ancestorDepths(f, me), [f, me]);

  const rows = useMemo(
    () =>
      f.graph.people
        .map((p) => ({ p, gaps: gapsOf(f, p), hop: hops.get(p.id) ?? 99 }))
        .filter((r) => r.gaps.length)
        .sort((a, b) => a.hop - b.hop || b.gaps.length - a.gaps.length || a.p.given.localeCompare(b.p.given)),
    [f, hops],
  );
  const counts = useMemo(() => {
    const c = new Map<GapKey, number>();
    for (const r of rows) for (const g of r.gaps) c.set(g, (c.get(g) ?? 0) + 1);
    return c;
  }, [rows]);
  const shown = only ? rows.filter((r) => r.gaps.includes(only)) : rows;
  const complete = f.graph.people.length - rows.length;

  return (
    <div className="page">
      <div className="page-inner needed">
        <h1 className="display">Information needed</h1>
        <p className="muted">
          {rows.length.toLocaleString('en-GB')} of {f.graph.people.length.toLocaleString('en-GB')} people have something still to find out.
          {' '}{complete > 0 && <>{complete.toLocaleString('en-GB')} are complete.</>} Closest relatives first: they are the easiest to ask.
        </p>
        <div className="needed-filters">
          <button className="btn" aria-pressed={!only} onClick={() => setOnly(null)}>Everything <span className="faint">{rows.length}</span></button>
          {ORDER.filter((g) => counts.get(g)).map((g) => (
            <button key={g} className="btn" aria-pressed={only === g} onClick={() => setOnly(only === g ? null : g)}>
              {GAP_LABEL[g]} <span className="faint">{counts.get(g)}</span>
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="empty"><GameIcon name="wax-seal" size={28} /><br />Nothing missing here. The chroniclers would be proud.</p>
        ) : (
          <ol className="needed-list">
            {shown.slice(0, limit).map(({ p, gaps }) => {
              const k = p.id === me ? 'you' : kinship(f, me, p.id, myAnc)?.label;
              return (
                <li key={p.id} className="panel">
                  <Portrait person={p} tree={tree} size={48} />
                  <div className="needed-who">
                    <b className="display">{displayName(p, f)}</b>
                    <span className="muted">{[lifespan(p), k && (k === 'you' ? 'you' : `your ${k}`)].filter(Boolean).join(' · ')}</span>
                  </div>
                  <div className="needed-gaps">
                    {gaps.map((g) => <button key={g} className={`chip${only === g ? ' on' : ''}`} onClick={() => setOnly(only === g ? null : g)} title={`Show everyone missing: ${GAP_LABEL[g]}`}>{GAP_LABEL[g]}</button>)}
                  </div>
                  <Link className="btn" to="/$tree" params={{ tree }} search={gaps.includes('parents') ? { focus: p.id, view: 'ancestors' } : { focus: p.id }}>
                    {gaps.includes('parents') ? 'Find parents' : 'Open'}
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
        {shown.length > limit && <button className="btn needed-more" onClick={() => setLimit((l) => l + 200)}>Show {Math.min(200, shown.length - limit)} more</button>}
      </div>
    </div>
  );
}
