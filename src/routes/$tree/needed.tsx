// Information needed: the family's research to-do list, nearest relatives first, and a way to
// blaze through it: one person at a time, only the missing fields, save and on to the next.
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Camera, Check, Flame, SkipForward, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GameIcon } from '~/components/GameIcon';
import { Portrait } from '~/components/Portrait';
import { addContact, addRelative, addStory, patchPerson, uploadPhoto } from '~/lib/api';
import { fullDate, validDate } from '~/lib/dates';
import { useFamily, useMe, useTreeId } from '~/lib/family';
import { ALL_GAPS, GAP_HINT, GAP_LABEL, gapsOf, useRequired, type GapKey } from '~/lib/gaps';
import { ancestorDepths, children, displayName, kinship, lifespan, parents, partnersOf, type Family } from '~/lib/graph';
import { usePref } from '~/lib/prefs';
import { play } from '~/lib/sfx';
import '~/styles/needed.css';

export const Route = createFileRoute('/$tree/needed')({ component: Needed });

function Needed() {
  const f = useFamily();
  const tree = useTreeId();
  const me = useMe();
  const [required, setRequired] = useRequired(tree);
  const [only, setOnlyRaw] = useState<GapKey | null>(null);
  const [limit, setLimit] = useState(120);
  const setOnly = (g: GapKey | null) => { setOnlyRaw(g); setLimit(120); };
  const [blaze, setBlaze] = useState<string[] | null>(null);
  // A filtered run asks only for that kind of gap; "Fill in" on a row asks for everything.
  const [blazeOnly, setBlazeOnly] = useState<GapKey | null>(null);
  const [settings, setSettings] = useState(false);

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
        .map((p) => ({ p, gaps: gapsOf(f, p, required), hop: hops.get(p.id) ?? 99 }))
        .filter((r) => r.gaps.length)
        .sort((a, b) => a.hop - b.hop || b.gaps.length - a.gaps.length || a.p.given.localeCompare(b.p.given)),
    [f, hops, required],
  );
  const counts = useMemo(() => {
    const c = new Map<GapKey, number>();
    for (const r of rows) for (const g of r.gaps) c.set(g, (c.get(g) ?? 0) + 1);
    return c;
  }, [rows]);
  const shown = only ? rows.filter((r) => r.gaps.includes(only)) : rows;
  const complete = f.graph.people.length - rows.length;
  const toggle = (k: GapKey) => {
    const next = required.has(k) ? [...required].filter((x) => x !== k) : [...required, k];
    setRequired(ALL_GAPS.filter((x) => next.includes(x)));
    if (only === k) setOnly(null);
  };

  return (
    <div className="page">
      <div className="page-inner needed">
        <div className="needed-head">
          <div>
            <h1 className="display">Information needed</h1>
            <p className="muted">
              {rows.length.toLocaleString('en-GB')} of {f.graph.people.length.toLocaleString('en-GB')} people have something still to find out.
              {' '}{complete > 0 && <>{complete.toLocaleString('en-GB')} are complete.</>} Closest relatives first: they are the easiest to ask.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" aria-pressed={settings} onClick={() => setSettings((s) => !s)}>What counts?</button>
            {shown.length > 0 && (
              <button className="btn primary" onClick={() => { play('seal'); setBlazeOnly(only); setBlaze(shown.map((r) => r.p.id)); }} title="One person at a time, only what is missing: ↵ saves and moves on">
                <Flame size={16} /> Blaze through {only ? GAP_LABEL[only].toLowerCase() : 'everything'}
              </button>
            )}
          </div>
        </div>

        {settings && (
          <div className="needed-settings">
            <span>Count as needed — remembered for this tree</span>
            <div>
              {ALL_GAPS.map((k) => (
                <button key={k} className="btn" aria-pressed={required.has(k)} onClick={() => toggle(k)} title={GAP_HINT[k]}>
                  {required.has(k) ? <Check size={13} /> : null} {GAP_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="needed-filters">
          <button className="btn" aria-pressed={!only} onClick={() => setOnly(null)}>Everything <span className="faint">{rows.length}</span></button>
          {ALL_GAPS.filter((g) => counts.get(g)).map((g) => (
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
                  <button className="btn" onClick={() => { setBlazeOnly(null); setBlaze([p.id, ...shown.map((r) => r.p.id).filter((id) => id !== p.id)]); }} title="Fill in this person, then carry on down the list">Fill in</button>
                </li>
              );
            })}
          </ol>
        )}
        {shown.length > limit && <button className="btn needed-more" onClick={() => setLimit((l) => l + 200)}>Show {Math.min(200, shown.length - limit)} more</button>}
      </div>
      {blaze && <Blaze queue={blaze} only={blazeOnly} f={f} tree={tree} me={me} required={required} onClose={() => setBlaze(null)} />}
    </div>
  );
}

// ---------- blaze through ----------

type Values = Partial<Record<'born' | 'bornPlace' | 'died' | 'occupation' | 'fatherGiven' | 'fatherSurname' | 'motherGiven' | 'motherSurname' | 'contactKind' | 'contactValue' | 'story', string>> & {
  sex?: 'm' | 'f' | 'x';
  photo?: File;
};

function Blaze({ queue, only, f, tree, me, required, onClose }: { queue: string[]; only: GapKey | null; f: Family; tree: string; me: string; required: ReadonlySet<GapKey>; onClose: () => void }) {
  const qc = useQueryClient();
  const author = usePref('author') ?? '';
  const [i, setI] = useState(0);
  const [filled, setFilled] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState<Values>({});
  const first = useRef<HTMLInputElement | HTMLButtonElement | null>(null);

  const id = queue[i];
  const p = id ? f.byId.get(id) : undefined;
  const gaps = p ? gapsOf(f, p, required).filter((g) => !only || g === only) : [];
  const dialog = useRef<HTMLDivElement>(null);
  const done = i >= queue.length;

  // Someone already complete (filled in elsewhere) is passed over.
  useEffect(() => {
    if (!done && p && !gaps.length) setI((x) => x + 1);
  }, [done, p, gaps.length]);
  useEffect(() => {
    setV({ fatherSurname: p?.surname, contactKind: 'phone', born: gaps.includes('birthday') && p?.born ? `${p.born}-` : undefined });
    setError(null);
    // Focus the first field; with none that takes focus (a photo, a memory box), the dialog itself, so ↵ and Esc still work.
    requestAnimationFrame(() => (first.current ?? dialog.current)?.focus());
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (done) play('fanfare'); }, [done]);

  const set = (k: keyof Values) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const next = (saved: boolean) => {
    if (saved) setFilled((n) => n + 1);
    else setSkipped((n) => n + 1);
    setI((x) => x + 1);
  };
  const placeNames = useMemo(() => [...new Set([...f.graph.places.map((pl) => pl.name), ...f.graph.people.map((q) => q.bornPlace).filter(Boolean) as string[]])].sort(), [f]);

  const save = async () => {
    if (!p || busy) return;
    // The birthday field starts as "1950-" to help typing; untouched, it means "don't know yet".
    const born = v.born && v.born !== `${p.born}-` ? v.born.trim() : undefined;
    const died = v.died?.trim() || undefined;
    if (born && !validDate(born)) return setError('Born: use a real date — 1953, 1953-08 or 1953-08-08 (~1953 for about)');
    if (died && !validDate(died)) return setError('Died: use a real date — 1999, 1999-03 or 1999-03-02');
    if (born && gaps.includes('birthday') && !fullDate(born)) return setError('A full birthday looks like 1988-05-17');
    // Check the photo before writing anything, so a bad file never leaves half a save behind.
    if (v.photo && (!v.photo.type.startsWith('image/') || v.photo.size > 5_000_000)) return setError('The photo must be an image under 5 MB');
    setBusy(true);
    setError(null);
    // Each step that succeeds is removed from the form, so retrying after a failure never repeats it.
    const rest: Values = { ...v };
    let did = false;
    try {
      const patch = { born, bornPlace: v.bornPlace?.trim() || undefined, died, sex: v.sex, occupation: v.occupation?.trim() || undefined };
      if (Object.values(patch).some(Boolean)) {
        await patchPerson({ data: { tree, id: p.id, patch } });
        did = true;
        for (const k of ['born', 'bornPlace', 'died', 'sex', 'occupation'] as const) delete rest[k];
      }
      const slots = parentSlots(f, p.id, gaps);
      for (const [as, gk, sk] of [['m', 'fatherGiven', 'fatherSurname'], ['f', 'motherGiven', 'motherSurname']] as const) {
        const given = rest[gk]?.trim();
        if (!given) continue;
        // Parents of someone born after 1950 may well be alive.
        await addRelative({ data: { tree, anchor: p.id, relation: 'parent', person: { given, surname: rest[sk]?.trim() || undefined, sex: slots.includes('x') ? undefined : as, living: parseInt(p.born ?? '0', 10) >= 1950 } } });
        did = true;
        delete rest[gk];
        delete rest[sk];
      }
      if (rest.contactValue?.trim()) {
        await addContact({ data: { tree, person: p.id, kind: (rest.contactKind as 'phone') ?? 'phone', value: rest.contactValue.trim() } });
        did = true;
        delete rest.contactValue;
      }
      if (rest.story?.trim()) {
        await addStory({ data: { tree, person: p.id, kind: 'memory', body: rest.story.trim(), author: author || 'Family' } });
        did = true;
        delete rest.story;
      }
      if (rest.photo) {
        const fd = new FormData();
        fd.set('tree', tree);
        fd.set('id', p.id);
        fd.set('file', rest.photo);
        await uploadPhoto({ data: fd });
        did = true;
        delete rest.photo;
      }
      if (did) play('chime');
      next(did);
    } catch (e) {
      setV(rest);
      setError(`${did ? 'Partly saved. ' : ''}${e instanceof Error ? e.message : 'Could not save'}`);
    } finally {
      // The next person is ready at once; the tree refreshes in the background.
      setBusy(false);
      if (did) {
        qc.invalidateQueries({ queryKey: ['graph', tree] });
        qc.invalidateQueries({ queryKey: ['person', tree, p.id] });
      }
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    // ↵ saves from a text field (⌘↵ from the memory box); on a button it keeps meaning "press this button".
    else if (e.key === 'Enter') {
      const t = e.target;
      const field = (t instanceof HTMLInputElement && t.type !== 'file') || (t instanceof HTMLTextAreaElement && (e.metaKey || e.ctrlKey));
      if (field) { e.preventDefault(); save(); }
    }
  };

  if (done) {
    return (
      <div className="blaze-backdrop" onMouseDown={onClose}>
        <div className="blaze panel" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()} role="dialog" aria-modal="true" aria-label="Done">
          <div className="blaze-done">
            <GameIcon name="wax-seal" size={56} />
            <h2 className="display">The chronicle grows</h2>
            <p className="muted">{filled} filled in{skipped ? `, ${skipped} skipped for another day` : ''}.</p>
            <button className="btn primary" autoFocus onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }
  if (!p) return null;
  const k = p.id === me ? 'you' : kinship(f, me, p.id)?.label;
  const missingParents = parentSlots(f, p.id, gaps);
  let firstSet = false;
  const firstRef = <T extends HTMLInputElement | HTMLButtonElement>() => (firstSet ? undefined : ((firstSet = true), (el: T | null) => { first.current = el; }));

  return (
    <div className="blaze-backdrop" onMouseDown={onClose}>
      <div ref={dialog} tabIndex={-1} className="blaze panel" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey} role="dialog" aria-modal="true" aria-label={`Fill in ${displayName(p, f)}`}>
        <div className="blaze-progress"><i style={{ width: `${(i / queue.length) * 100}%` }} /></div>
        <div className="blaze-top">
          <span>{i + 1} of {queue.length} · {filled} filled</span>
          <button className="btn icon ghost" onClick={onClose} title="Stop (Esc)"><X size={16} /></button>
        </div>
        <div className="blaze-who">
          <Portrait person={p} tree={tree} size={84} />
          <div>
            <h2 className="display">{displayName(p, f)}</h2>
            <div className="muted">{[lifespan(p), k && (k === 'you' ? 'you' : `your ${k}`)].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        <datalist id="blaze-places">{placeNames.map((n) => <option key={n} value={n} />)}</datalist>
        <div className="blaze-fields">
          {(gaps.includes('born') || gaps.includes('birthday')) && (
            <label className="field">
              <span>{gaps.includes('birthday') ? 'Full birthday' : 'Born'}</span>
              <input ref={firstRef()} className="input" value={v.born ?? ''} onChange={set('born')} placeholder={gaps.includes('birthday') ? `${p.born ?? '1988'}-05-17` : '1953, 1953-08-08 or ~1890'} />
            </label>
          )}
          {gaps.includes('birthplace') && (
            <label className="field">
              <span>Birthplace</span>
              <input ref={firstRef()} className="input" list="blaze-places" value={v.bornPlace ?? ''} onChange={set('bornPlace')} placeholder="Town" />
            </label>
          )}
          {gaps.includes('died') && (
            <label className="field">
              <span>Died</span>
              <input ref={firstRef()} className="input" value={v.died ?? ''} onChange={set('died')} placeholder="1999 or 1999-03-02" />
            </label>
          )}
          {gaps.includes('occupation') && (
            <label className="field">
              <span>Occupation</span>
              <input ref={firstRef()} className="input" value={v.occupation ?? ''} onChange={set('occupation')} placeholder="Weaver, Lehrerin…" />
            </label>
          )}
          {gaps.includes('sex') && (
            <div className="field">
              <span>Sex</span>
              <div className="seg">
                {([['f', 'Female'], ['m', 'Male'], ['x', 'Other']] as const).map(([val, l], n) => (
                  <button key={val} ref={n === 0 ? firstRef<HTMLButtonElement>() : undefined} type="button" className="btn" aria-pressed={v.sex === val} onClick={() => setV((x) => ({ ...x, sex: val }))}>{l}</button>
                ))}
              </div>
            </div>
          )}
          {missingParents.map((sx) => (
            <div key={sx} className="field wide">
              <span>{sx === 'm' ? 'Father' : sx === 'f' ? 'Mother' : 'Other parent'}</span>
              <div className="blaze-parent">
                <input ref={firstRef()} className="input" value={(sx === 'f' ? v.motherGiven : v.fatherGiven) ?? ''} onChange={set(sx === 'f' ? 'motherGiven' : 'fatherGiven')} placeholder="Given name" />
                <input className="input" value={(sx === 'f' ? v.motherSurname : v.fatherSurname) ?? ''} onChange={set(sx === 'f' ? 'motherSurname' : 'fatherSurname')} placeholder="Surname at birth" />
              </div>
            </div>
          ))}
          {gaps.includes('contact') && (
            <div className="field wide">
              <span>Contact</span>
              <div className="blaze-parent" style={{ gridTemplateColumns: '120px 1fr' }}>
                <select className="input" value={v.contactKind} onChange={set('contactKind')}>
                  <option value="phone">Phone</option><option value="email">Email</option><option value="address">Address</option>
                </select>
                <input ref={firstRef()} className="input" value={v.contactValue ?? ''} onChange={set('contactValue')} placeholder="+49 …, name@example.com, Street 1, Town" />
              </div>
            </div>
          )}
          {gaps.includes('photo') && (
            <div className="field wide">
              <span>Photo</span>
              <label className="btn blaze-file">
                <Camera size={14} /> {v.photo ? v.photo.name : 'Choose a photo…'}
                <input type="file" accept="image/*" hidden onChange={(e) => setV((x) => ({ ...x, photo: e.target.files?.[0] }))} />
              </label>
            </div>
          )}
          {gaps.includes('story') && (
            <label className="field wide">
              <span>A memory of {p.given}</span>
              <textarea className="input" rows={3} value={v.story ?? ''} onChange={set('story')} placeholder={`Something you remember about ${p.given} (⌘↵ to save)`} />
              {!author && <em className="faint">Signed as “Family”; set your name when adding a story in the panel.</em>}
            </label>
          )}
          {error && <em className="err wide">{error}</em>}
        </div>
        <div className="blaze-foot">
          <span className="faint">Leave a field empty if nobody knows yet.</span>
          <span className="spacer" />
          <button className="btn" onClick={() => next(false)} title="Ask later"><SkipForward size={14} /> Skip</button>
          <button className="btn primary" onClick={save} disabled={busy}><Check size={14} /> Save & next <kbd>↵</kbd></button>
        </div>
      </div>
    </div>
  );
}


/**
 * Which parent fields to offer: both when none is known; the missing one when one is known; a single
 * "other parent" when the known one's sex is not recorded (so nobody ends up with three parents).
 */
function parentSlots(f: Family, id: string, gaps: GapKey[]): ('m' | 'f' | 'x')[] {
  if (!gaps.includes('parents')) return [];
  const known = parents(f, id);
  if (known.length >= 2) return [];
  if (!known.length) return ['m', 'f'];
  const sx = f.byId.get(known[0])?.sex;
  return sx === 'm' ? ['f'] : sx === 'f' ? ['m'] : ['x'];
}
