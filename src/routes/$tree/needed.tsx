import { PageSkeleton, ErrorState, PageHeader, EmptyState, Select } from '~/components/ui';
// Information needed: the family's research to-do list, nearest relatives first, and a way to
// blaze through it: one person at a time, only the missing fields, save and on to the next.
import { useQueryClient } from '@tanstack/react-query';
import { Link, useRouter, createFileRoute } from '@tanstack/react-router';
import { Camera, Check, Flame, Link2, SkipForward, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GameIcon } from '~/components/GameIcon';
import { Dialog } from '~/components/ui/Dialog';
import { Portrait } from '~/components/Portrait';
import { PlaceInput, savePlacesKeyed, type PlaceValue } from '~/components/PlaceInput';
import { PersonRow } from '~/components/Palette';
import { LinkCandidates } from '~/components/QuickAdd';
import { addContact, addRelative, addStory, linkRelative, opKeys, patchPerson, uploadPhoto } from '~/lib/api';
import { fullDate, validDate } from '~/lib/dates';
import { useFamily, useMe, useMeChosen, useTreeId } from '~/lib/family';
import { ALL_GAPS, GAP_ACTION, GAP_HINT, GAP_LABEL, gapsOf, useRequired, type GapKey } from '~/lib/gaps';
import { ancestorDepths, children, displayName, kinship, lifespan, parents, partnersOf, type Family } from '~/lib/graph';
import { can, type Role } from '~/lib/roles';
import { useRole } from '~/lib/session';
import { play } from '~/lib/sfx';
import '~/styles/needed.css';
import { sectionHead } from '~/lib/title';

export const Route = createFileRoute('/$tree/needed')({
  pendingComponent: PageSkeleton,
  errorComponent: function PageError() { const router = useRouter(); return <div className="page"><PageHeader title="Information needed" /><ErrorState message="This page could not be loaded." onRetry={() => { void router.invalidate(); }} /></div>; },
  head: sectionHead('Information needed'), component: Needed });

function Needed() {
  const f = useFamily();
  const tree = useTreeId();
  usePageTrail('needed', tree);
  const me = useMe();
  // Kinship labels only once the reader has said who they are.
  const who = useMeChosen();
  const [required, setRequired] = useRequired(tree);
  const [only, setOnlyRaw] = useRememberedState<GapKey | null>(`needed:${tree}:only`, null);
  const [limit, setLimit] = useRememberedState(`needed:${tree}:limit`, 120);
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
  const myAnc = useMemo(() => (who ? ancestorDepths(f, who) : new Map<string, number>()), [f, who]);

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
  // Each gap needs the right to fill it in (the server checks the same): a viewer only browses the list,
  // a contributor can add photos and memories, an editor everything else.
  const role = useRole();
  const fillable = (g: GapKey) => can(role, GAP_ACTION[g]);
  const canFill = (gaps: GapKey[]) => gaps.some((g) => (!only || g === only) && fillable(g));
  const queue = shown.filter((r) => canFill(r.gaps));
  const complete = f.graph.people.length - rows.length;
  const toggle = (k: GapKey) => {
    const next = required.has(k) ? [...required].filter((x) => x !== k) : [...required, k];
    setRequired(ALL_GAPS.filter((x) => next.includes(x)));
    if (only === k) setOnly(null);
  };

  return (
    <div className="page">
      <div className="page-inner needed">
        <PageHeader title="Information needed" subtitle={<>
              {rows.length.toLocaleString('en-GB')} of {f.graph.people.length.toLocaleString('en-GB')} people have something still to find out.
              {' '}{complete > 0 && <>{complete.toLocaleString('en-GB')} are complete.</>} Closest relatives first: they are the easiest to ask.
            </>} actions={<div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" aria-pressed={settings} onClick={() => setSettings((s) => !s)}>What counts?</button>
            {queue.length > 0 && (
              <button className="btn primary" onClick={() => { play('seal'); setBlazeOnly(only); setBlaze(queue.map((r) => r.p.id)); }} title="One person at a time, only what is missing: ↵ saves and moves on">
                <Flame size={16} /> Blaze through {only ? GAP_LABEL[only].toLowerCase() : 'everything'}
              </button>
            )}
          </div>} />

        {shown.length > 0 && queue.length === 0 && (
          <p className="needed-ask subtle" role="note">
            {role === 'viewer'
              ? 'You can browse what’s missing; ask an editor to fill it in.'
              : 'Only an editor can fill these in. You can add photos and memories: choose them under “What counts?”.'}
          </p>
        )}

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
          <EmptyState icon={<GameIcon name="wax-seal" size={28} />} title={only ? 'No one has this gap' : f.graph.people.length ? 'Everything counted is complete' : 'No people recorded yet'} text={only ? 'Try another filter to continue your research.' : 'Choose “What counts?” to decide which details to collect.'} action={only ? <button className="btn" onClick={() => setOnly(null)}>Clear filter</button> : undefined} />
        ) : (
          <ol className={`needed-list${queue.length ? '' : ' readonly'}`}>
            {shown.slice(0, limit).map(({ p, gaps }) => {
              const k = !who ? undefined : p.id === who ? 'you' : safeRelation(f, who, p.id, myAnc);
              const filled = required.size ? (required.size - gaps.length) / required.size : 1;
              const may = gaps.some(fillable);
              // The gaps in view first, so the filter's own gap is never the one hidden behind "+2".
              const tags = only ? [only, ...gaps.filter((g) => g !== only)] : gaps;
              return (
                <li key={p.id} className="needed-row">
                  <span
                    className="needed-ring"
                    style={{ '--filled': `${filled * 100}%` } as React.CSSProperties}
                    role="img"
                    aria-label={`${required.size - gaps.length} of ${required.size} counted details known`}
                    title={`${required.size - gaps.length} of ${required.size} counted details known`}
                  >
                    <Portrait person={p} tree={tree} size={40} frame={false} />
                  </span>
                  <div className="needed-who">
                    <Link className="needed-name" to="/$tree" params={{ tree }} search={((s: Record<string, unknown>) => ({ ...s, focus: p.id, sel: p.id })) as never} title="Show on the tree">{displayName(p, f)}</Link>
                    <span className="needed-meta">{[lifespan(p), k && (k === 'you' ? 'you' : `your ${k}`)].filter(Boolean).join(' · ')}</span>
                  </div>
                  <ul className="needed-tags" aria-label="Still to find out">
                    {tags.slice(0, 3).map((g) => <li key={g} className={`needed-tag${only === g ? ' on' : ''}`}>{GAP_LABEL[g]}</li>)}
                    {tags.length > 3 && <li className="needed-tag more" title={tags.slice(3).map((g) => GAP_LABEL[g]).join(', ')}>+{tags.length - 3}</li>}
                  </ul>
                  {may ? (
                    <button className="btn needed-fill" onClick={() => { setBlazeOnly(null); setBlaze([p.id, ...queue.map((r) => r.p.id).filter((id) => id !== p.id)]); }} title="Fill in this person, then carry on down the list">Fill in</button>
                  ) : queue.length ? <span aria-hidden /> : null}
                </li>
              );
            })}
          </ol>
        )}
        {shown.length > limit && <button className="btn needed-more" onClick={() => setLimit((l) => l + 200)}>Show {Math.min(200, shown.length - limit)} more</button>}
      </div>
      {blaze && <Blaze queue={blaze} only={blazeOnly} f={f} tree={tree} me={who} role={role} required={required} onClose={() => setBlaze(null)} />}
    </div>
  );
}

// ---------- blaze through ----------

type Values = Partial<Record<'born' | 'bornPlace' | 'died' | 'occupation' | 'fatherGiven' | 'fatherSurname' | 'motherGiven' | 'motherSurname' | 'fatherLink' | 'motherLink' | 'contactKind' | 'contactValue' | 'story', string>> & {
  sex?: 'm' | 'f' | 'x';
  photo?: File;
  /** Where the birthplace is, when it was picked from the suggestions or pinned on the map. */
  bornPin?: Omit<PlaceValue, 'name'>;
};

function Blaze({ queue, only, f, tree, me, role, required, onClose }: { queue: string[]; only: GapKey | null; f: Family; tree: string; me: string | null; role: Role; required: ReadonlySet<GapKey>; onClose: () => void }) {
  const qc = useQueryClient();
  const [i, setI] = useState(0);
  const [filled, setFilled] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [stamped, setStamped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState<Values>({});
  // Leaving with something typed asks first: the ✕, Skip, Escape and a press outside all come here.
  const [confirm, setConfirm] = useState<null | 'close' | 'skip'>(null);
  const first = useRef<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement | null>(null);
  const keep = useRef<HTMLButtonElement>(null);
  // One key per step and payload for this person: a retry after a lost answer never writes twice.
  const keys = useRef(opKeys());

  const id = queue[i];
  const p = id ? f.byId.get(id) : undefined;
  // Only what this reader may fill in: the rest waits for someone who can.
  const gaps = p ? gapsOf(f, p, required).filter((g) => (!only || g === only) && can(role, GAP_ACTION[g])) : [];
  const dialog = useRef<HTMLDivElement>(null);
  const done = i >= queue.length;

  // Someone already complete (filled in elsewhere) is passed over.
  useEffect(() => {
    if (!done && p && !gaps.length) setI((x) => x + 1);
  }, [done, p, gaps.length]);
  // What the form starts with for this person: typing anything beyond it makes the dialog "dirty".
  const initial = useRef<Values>({});
  const dirty = (Object.keys({ ...v, ...initial.current }) as (keyof Values)[]).some((k) => (v[k] ?? '') !== (initial.current[k] ?? ''));
  useEffect(() => {
    initial.current = { fatherSurname: p?.surname, contactKind: 'phone', born: gaps.includes('birthday') && p?.born ? `${p.born}-` : undefined };
    keys.current = opKeys();
    setV(initial.current);
    setError(null);
    setConfirm(null);
    // Focus the first field; with none that takes focus (a photo, a memory box), the dialog itself, so ↵ and Esc still work.
    requestAnimationFrame(() => (first.current ?? dialog.current)?.focus());
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!done) return;
    play('fanfare');
    requestAnimationFrame(() => dialog.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus());
  }, [done]);
  useEffect(() => { if (confirm) keep.current?.focus(); }, [confirm]);

  const set = (k: keyof Values) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const next = (saved: boolean) => {
    if (saved) setFilled((n) => n + 1);
    else setSkipped((n) => n + 1);
    setI((x) => x + 1);
  };
  const askClose = () => { if (busy) return; if (confirm) return setConfirm(null); if (dirty) setConfirm('close'); else onClose(); };
  const askSkip = () => { if (busy) return; if (dirty) setConfirm('skip'); else next(false); };
  const confirmed = () => { const c = confirm; setConfirm(null); if (c === 'close') onClose(); else if (c === 'skip') next(false); };

  const save = async () => {
    if (!p || busy || confirm) return;
    // The birthday field starts as "1950-" to help typing; untouched, it means "don't know yet".
    const born = v.born && v.born !== `${p.born}-` ? v.born.trim() : undefined;
    const died = v.died?.trim() || undefined;
    if (born && !validDate(born)) return setError('Born: use a real date — 1953, 1953-08 or 1953-08-08 (~1953 for about)');
    if (died && !validDate(died)) return setError('Died: use a real date — 1999, 1999-03 or 1999-03-02');
    if (born && gaps.includes('birthday') && !fullDate(born)) return setError('A full birthday looks like 1988-05-17');
    // Check the photo before writing anything, so a bad file never leaves half a save behind.
    if (v.photo && (!v.photo.type.startsWith('image/') || v.photo.size > 5_000_000)) return setError('The photo must be an image under 5 MB');
    if (v.fatherLink && v.fatherLink === v.motherLink) return setError('The same person can’t be both parents.');
    setBusy(true);
    setError(null);
    const key = (step: string, payload: unknown) => keys.current.for(step, payload);
    // Each step that succeeds is removed from the form, so retrying after a failure never repeats it;
    // a step whose answer was lost is sent again with the same key, and the server replays it.
    const rest: Values = { ...v };
    let did = false;
    try {
      const patch = { born, bornPlace: v.bornPlace?.trim() || undefined, died, sex: v.sex, occupation: v.occupation?.trim() || undefined };
      if (Object.values(patch).some(Boolean)) {
        // The pin first: repeating it on a retry changes nothing, and the Atlas has it as soon as the person points there.
        if (patch.bornPlace) await savePlacesKeyed(tree, (pl) => key('places', pl), { ...v.bornPin, name: patch.bornPlace });
        await patchPerson({ data: { tree, id: p.id, patch, opKey: key('patch', patch) } });
        did = true;
        for (const k of ['born', 'bornPlace', 'bornPin', 'died', 'sex', 'occupation'] as const) delete rest[k];
      }
      const slots = parentSlots(f, p.id, gaps);
      for (const [as, gk, sk, lk] of [['m', 'fatherGiven', 'fatherSurname', 'fatherLink'], ['f', 'motherGiven', 'motherSurname', 'motherLink']] as const) {
        const link = rest[lk];
        const given = rest[gk]?.trim();
        if (link) {
          // Someone already in the tree: link them, never a second copy.
          const data = { tree, anchor: p.id, person: link, relation: 'parent' as const };
          await linkRelative({ data: { ...data, opKey: key(`link-${as}`, data) } });
        } else if (given) {
          // Parents of someone born after 1950 may well be alive.
          const data = { tree, anchor: p.id, relation: 'parent' as const, person: { given, surname: rest[sk]?.trim() || undefined, sex: slots.includes('x') ? undefined : as, living: parseInt(p.born ?? '0', 10) >= 1950 } };
          await addRelative({ data: { ...data, opKey: key(`parent-${as}`, data) } });
        } else continue;
        did = true;
        delete rest[gk];
        delete rest[sk];
        delete rest[lk];
      }
      if (rest.contactValue?.trim()) {
        const data = { tree, person: p.id, kind: (rest.contactKind as 'phone') ?? 'phone', value: rest.contactValue.trim() };
        await addContact({ data: { ...data, opKey: key('contact', data) } });
        did = true;
        delete rest.contactValue;
      }
      if (rest.story?.trim()) {
        // Signed with the writer's account name by the server.
        const data = { tree, person: p.id, kind: 'memory' as const, body: rest.story.trim() };
        await addStory({ data: { ...data, opKey: key('story', data) } });
        did = true;
        delete rest.story;
      }
      if (rest.photo) {
        const fd = new FormData();
        fd.set('tree', tree);
        fd.set('id', p.id);
        fd.set('file', rest.photo);
        fd.set('opKey', key('photo', [p.id, rest.photo.name, rest.photo.size, rest.photo.lastModified]));
        await uploadPhoto({ data: fd });
        did = true;
        delete rest.photo;
      }
      if (did) { play('seal'); setStamped(true); setTimeout(() => setStamped(false), 900); }
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
    // ↵ saves from a text field (⌘↵ from the memory box); on a button it keeps meaning "press this button".
    // Escape and Tab are the Dialog's.
    if (e.key === 'Enter' && !confirm) {
      const t = e.target;
      // The dialog itself counts too: it holds focus when the only gap is a photo or a memory.
      const field = t === dialog.current || (t instanceof HTMLInputElement && t.type !== 'file') || (t instanceof HTMLTextAreaElement && (e.metaKey || e.ctrlKey));
      if (field) { e.preventDefault(); void save(); }
    }
  };

  // One Dialog for the whole run, so focus and the overlay layer carry from person to person.
  if (done) {
    return (
      <Dialog open onClose={onClose} variant="event" label="Done" bare width={640} className="blaze" panelRef={dialog}>
        <div className="blaze-done">
          <GameIcon name="wax-seal" size={56} />
          <h2 className="display">The chronicle grows</h2>
          <p className="muted">{filled} filled in{skipped ? `, ${skipped} skipped for another day` : ''}.</p>
          <button className="btn primary" data-autofocus onClick={onClose}>Close</button>
        </div>
      </Dialog>
    );
  }
  if (!p) return null;
  const k = !me ? undefined : p.id === me ? 'you' : safeRelation(f, me, p.id);
  const missingParents = parentSlots(f, p.id, gaps);
  let firstSet = false;
  const firstRef = <T extends HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement>() => (firstSet ? undefined : ((firstSet = true), (el: T | null) => { first.current = el; }));

  return (
    <Dialog
      open
      // Escape and a press outside: through the same guard as the ✕ (busy never closes; typed asks first).
      onClose={askClose}
      dismissible={!busy}
      variant="event"
      label={`Fill in ${displayName(p, f)}`}
      bare
      width={640}
      className="blaze"
      panelRef={dialog}
      onKeyDown={onKey}
    >
        {stamped && <div className="blaze-stamp" role="status"><GameIcon name="wax-seal" size={42} /><span>Recorded</span></div>}
        <div className="blaze-progress"><i style={{ width: `${(i / queue.length) * 100}%` }} /></div>
        <div className="blaze-top">
          <span>{i + 1} of {queue.length} · {filled} filled</span>
          <button className="btn icon ghost" onClick={askClose} disabled={busy} aria-label="Stop" title="Stop (Esc)"><X size={16} /></button>
        </div>
        <div className="blaze-who">
          <Portrait person={p} tree={tree} size={84} />
          <div>
            <h2 className="display">{displayName(p, f)}</h2>
            <div className="muted">{[lifespan(p), k && (k === 'you' ? 'you' : `your ${k}`)].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        <fieldset className="blaze-fields" disabled={busy}>
          {(gaps.includes('born') || gaps.includes('birthday')) && (
            <label className="field">
              <span>{gaps.includes('birthday') ? 'Full birthday' : 'Born'}</span>
              <input ref={firstRef()} className="input" value={v.born ?? ''} onChange={set('born')} placeholder={gaps.includes('birthday') ? `${p.born ?? '1988'}-05-17` : '1953, 1953-08-08 or ~1890'} />
            </label>
          )}
          {gaps.includes('birthplace') && (
            <div className="field wide">
              <span id="blaze-bornplace">Birthplace</span>
              <PlaceInput
                tree={tree}
                inputRef={firstRef<HTMLInputElement>()}
                aria-labelledby="blaze-bornplace"
                value={{ ...v.bornPin, name: v.bornPlace ?? '' }}
                onChange={({ name, ...pin }) => setV((x) => ({ ...x, bornPlace: name, bornPin: pin.lat !== undefined ? pin : undefined }))}
                placeholder="Town, village or farm"
              />
            </div>
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
          {missingParents.map((sx) => {
            const [gk, sk, lk] = sx === 'f' ? (['motherGiven', 'motherSurname', 'motherLink'] as const) : (['fatherGiven', 'fatherSurname', 'fatherLink'] as const);
            const word = sx === 'm' ? 'Father' : sx === 'f' ? 'Mother' : 'Other parent';
            const linked = v[lk];
            return (
              <div key={sx} className="field wide blaze-parent-slot">
                <span>{word}</span>
                {linked ? (
                  <div className="blaze-linked">
                    <span className="palette-item" aria-label={`${word}: already in the tree`}><PersonRow f={f} tree={tree} id={linked} who={me} note={<><Link2 size={11} aria-hidden /> Linking someone already in the tree</>} /></span>
                    <button type="button" className="btn ghost" onClick={() => setV((x) => ({ ...x, [lk]: undefined }))}>Change</button>
                  </div>
                ) : (
                  <>
                    <div className="blaze-parent">
                      <input ref={firstRef()} className="input" aria-label={`${word}: given name`} value={v[gk] ?? ''} onChange={set(gk)} placeholder="Given name" />
                      <input className="input" aria-label={`${word}: surname at birth`} value={v[sk] ?? ''} onChange={set(sk)} placeholder="Surname at birth" />
                    </div>
                    {(v[gk] ?? '').trim().length >= 2 && (
                      <div className="blaze-matches">
                        <span className="subtle">Already in the tree? Pick them instead of adding someone new.</span>
                        <LinkCandidates
                          f={f} tree={tree} anchor={p.id} relation="parent" query={v[gk] ?? ''} surname={v[sk]} limit={3}
                          prefer={sx === 'x' ? undefined : sx} label={`${word}: people already in the tree`}
                          onPick={(pid) => setV((x) => ({ ...x, [lk]: pid }))}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
          {gaps.includes('contact') && (
            <div className="field wide">
              <span>Contact</span>
              <div className="blaze-parent" style={{ gridTemplateColumns: '120px 1fr' }}>
                <Select value={v.contactKind ?? 'phone'} onChange={(value) => setV((x) => ({ ...x, contactKind: value }))} aria-label="Contact kind" options={[{ value: 'phone', label: 'Phone' }, { value: 'email', label: 'Email' }, { value: 'address', label: 'Address' }]} />
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
              <textarea ref={firstRef<HTMLTextAreaElement>()} className="input" rows={3} value={v.story ?? ''} onChange={set('story')} placeholder={`Something you remember about ${p.given} (⌘↵ to save)`} />
            </label>
          )}
          {error && <em className="err wide" role="alert">{error}</em>}
        </fieldset>
        <div className="blaze-foot">
          <span className="faint">Leave a field empty if nobody knows yet.</span>
          <span className="spacer" />
          <button className="btn" onClick={askSkip} disabled={busy} title="Ask later"><SkipForward size={14} /> Skip</button>
          <button className="btn primary" onClick={() => void save()} disabled={busy}><Check size={14} /> {busy ? 'Saving…' : 'Save & next'} <kbd>↵</kbd></button>
        </div>
        {confirm && (
          <div className="ui-dialog-confirm" role="alertdialog" aria-modal="true" aria-labelledby="blaze-confirm">
            <div>
              <b id="blaze-confirm">{confirm === 'skip' ? `Skip ${p.given} without saving?` : 'Stop without saving?'}</b>
              <p>What you typed for {p.given} will be lost.</p>
              <div className="ui-row">
                <button ref={keep} type="button" className="btn" onClick={() => setConfirm(null)}>Keep editing</button>
                <button type="button" className="btn primary" onClick={confirmed}>{confirm === 'skip' ? 'Skip' : 'Stop'}</button>
              </div>
            </div>
          </div>
        )}
    </Dialog>
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

function safeRelation(f: Family, me: string, id: string, ancestors?: Map<string, number>) {
  try { return kinship(f, me, id, ancestors)?.label; } catch { return undefined; }
}
