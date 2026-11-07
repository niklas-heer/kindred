// The character window: who this is, how they're yours, their family at a glance, what the family
// remembers about them, and the everyday things (birthday, how to reach them, what they like).
import { useForm, useStore } from '@tanstack/react-form';
import { Link, useBlocker } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Cake, Camera, Check, CookingPot, Crosshair, Crown, Gift, GitFork, Heart, Mail, MapPin, MessageCircle, MessagesSquare, Pencil,
  Phone, Plus, Quote, Route as RouteIcon, Sparkles, StickyNote, Trash2, UserRound, X,
} from 'lucide-react';
import { marked } from 'marked';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { addContact, addStory, deleteContact, removePerson, deleteStory, personQuery, updatePerson, uploadPhoto } from '~/lib/api';
import {
  ageAt, age, children, displayName, fmtDate, kinship, lifespan, parents, partnersOf, siblings, yearOf, type Family,
} from '~/lib/graph';
import { setPref, usePref } from '~/lib/prefs';
import type { GPerson, PersonDetail, Story } from '~/lib/types';
import { TRAITS } from '~/lib/traits';
import { validDate } from '~/lib/dates';
import { GAP_LABEL, GAP_WHERE, gapsOf, useRequired } from '~/lib/gaps';
import { GameIcon } from './GameIcon';
import { Arms } from './Heraldry';
import { Portrait } from './Portrait';
import { Dialog, Tabs, TabList, Tab as UiTab, TabPanel, Select, Switch, isOverlayOpen } from './ui';
import { QuickAdd } from './QuickAdd';
import type { AddRelation } from './Card';
import './panel.css';

type Tab = 'family' | 'stories' | 'everyday' | 'edit';

type Draft = { dirty: boolean; busy: boolean; save: () => Promise<boolean> };
const DraftContext = createContext<{ register: (draft: Draft | null) => void; leave: (next: () => void) => void }>({ register: () => {}, leave: (next) => next() });
function DraftTracker({ form }: { form: any }) {
  const { register } = useContext(DraftContext);
  const dirty = useStore(form.store, (s: any) => s.isDirty) as boolean;
  const busy = useStore(form.store, (s: any) => s.isSubmitting) as boolean;
  useEffect(() => { register({ dirty, busy, save: async () => { await form.handleSubmit(); return !form.state.isDirty; } }); }, [dirty, busy, form, register]);
  useEffect(() => () => register(null), [register]);
  return dirty ? <span className="pp-unsaved" role="status">Unsaved changes</span> : null;
}

interface Props {
  family: Family;
  tree: string;
  id: string;
  /** Who the reader said they are; null until they choose (then no kinship is shown). */
  me: string | null;
  onSelect: (id: string) => void;
  onCenter: () => void;
  onPath: () => void;
  onDynasty: () => void;
  onAncestors: () => void;
  onClose: () => void;
}

export function PersonPanel({ family: f, tree, id, me, onSelect, onCenter, onPath, onDynasty, onAncestors, onClose }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [add, setAdd] = useState<AddRelation | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const leave = (next: () => void) => draft?.dirty || draft?.busy ? setPending(() => next) : next();
  const blocker = useBlocker({ shouldBlockFn: () => !!(draft?.dirty || draft?.busy), enableBeforeUnload: !!(draft?.dirty || draft?.busy), withResolver: true });
  const guarded = pending || (blocker.status === 'blocked' ? blocker.proceed : null);
  const keep = () => { setPending(null); blocker.reset?.(); };
  const proceed = () => { setPending(null); guarded?.(); };
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (draft?.dirty || draft?.busy) && !isOverlayOpen()) {
        e.preventDefault(); e.stopImmediatePropagation(); setPending(() => onClose);
      }
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [draft, onClose]);
  const p = f.byId.get(id);
  const [tab, setTab] = useState<Tab>('family');
  const [required] = useRequired(tree);
  const { data: detail } = useQuery(personQuery(tree, id));
  const qc = useQueryClient();
  const k = useMemo(() => (p && me ? kinship(f, me, id) : undefined), [f, me, id, p]);
  const photo = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.set('tree', tree);
      fd.set('id', id);
      fd.set('file', file);
      return uploadPhoto({ data: fd });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph', tree] }),
  });

  if (!p) return null;
  const house = p.house ? f.house.get(p.house) : undefined;
  const a = age(p);


  return (
    <DraftContext.Provider value={{ register: setDraft, leave }}><aside className="person-panel panel" key={id}>
      <button className="btn icon ghost panel-close" onClick={() => leave(onClose)} aria-label="Close person panel" title="Close (Esc)"><X size={16} /></button>
      <header className="pp-head">
        <button type="button" disabled={photo.isPending} className="pp-portrait" aria-label="Change portrait" onClick={() => photoInput.current?.click()}>
          <Portrait person={p} tree={tree} size={124} />
          <span className="pp-photo"><Camera size={14} /></span>
        </button>
          <input ref={photoInput} type="file" accept="image/*" aria-label="Portrait image" hidden onChange={(e) => e.target.files?.[0] && photo.mutate(e.target.files[0])} />
        <div className="pp-id">
          <h2 className="display">{displayName(p, f)}</h2>
          {p.title && <div className="pp-title">{p.title}</div>}
          <div className="pp-life">
            {p.living && <span className="pp-living" title="Living">●</span>}
            {lifespan(p)}
            {a !== undefined && <span className="muted"> · {p.living ? `${a} years old` : `died aged ${a}`}</span>}
          </div>
          {house && (
            <button className="pp-house" onClick={onDynasty} title="Show this house's dynasty tree">
              <Arms arms={house.arms} size={22} /> <span>{house.name}</span>
            </button>
          )}
          {house?.motto && <div className="pp-motto">“{house.motto}”</div>}
        </div>
      </header>

      {photo.isError && <p className="err" role="alert">Could not change portrait. Try an image smaller than 5 MB.</p>}
      <div className="pp-kin">
        {!me ? (
          <span className="muted">Say who you are to see how you’re related</span>
        ) : id === me ? (
          <span className="pp-you"><UserRound size={14} /> This is you</span>
        ) : k ? (
          <span>Your <b>{k.label}</b></span>
        ) : (
          <span className="muted">Not related by blood or marriage to you</span>
        )}
        <span className="spacer" />
        {id !== me && k && <button className="btn ghost" onClick={onPath} title="Highlight the line between you"><RouteIcon size={14} /> How?</button>}
        {!me ? (
          <button className="btn ghost" onClick={() => setPref(`me:${tree}`, id)} title="Kinship labels will be relative to this person">This is me</button>
        ) : id !== me && <button className="btn ghost" onClick={() => setPref(`me:${tree}`, id)} title="See everyone's relationship from this person's point of view">Be them</button>}
      </div>

      {p.traits?.length ? (
        <div className="pp-traits">
          {p.traits.map((t) => {
            const tr = TRAITS[t];
            return (
              <span key={t} className={`trait ${tr?.kind ?? 'other'}`} title={t}>
                <span className="trait-medal">{tr ? <GameIcon name={tr.icon} size={16} /> : '◆'}</span> {t}
              </span>
            );
          })}
        </div>
      ) : null}

      {(() => {
        const gaps = gapsOf(f, p, required);
        if (!gaps.length) return null;
        return (
          <div className="pp-gaps">
            <span className="pp-gaps-title"><GameIcon name="quill-ink" size={14} /> Information needed</span>
            <div>
              {gaps.map((g) => (
                <button key={g} className="chip" onClick={() => (GAP_WHERE[g] === 'tree' ? onAncestors() : leave(() => setTab(GAP_WHERE[g] as Tab)))} title={GAP_WHERE[g] === 'tree' ? 'Open the ancestors view to fill the empty slots' : 'Fill it in'}>
                  {GAP_LABEL[g]}
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      <div className="pp-actions">
        <button className="btn" onClick={onCenter}><Crosshair size={14} /> Centre</button>
        <button className="btn" onClick={onAncestors}><GitFork size={14} style={{ transform: 'rotate(180deg)' }} /> Ancestors</button>
        <button className="btn" onClick={onDynasty}><Crown size={14} /> Dynasty</button>
      </div>

      <Tabs value={tab} onChange={(v) => leave(() => setTab(v as Tab))} label="Person details">
      <TabList className="pp-tabs">
        {(
          [
            ['family', 'Family', relativesCount(f, id)],
            ['stories', 'Stories', detail?.stories.length ?? p.stories],
            ['everyday', p.living ? 'Everyday' : 'Life', undefined],
            ['edit', 'Edit', undefined],
          ] as const
        ).map(([t, label, n]) => (
          <UiTab key={t} value={t}>
            {label} {n ? <span className="pp-count">{n}</span> : null}
          </UiTab>
        ))}
      </TabList>

      <div className="pp-body">
        <TabPanel value="family"><FamilyTab f={f} tree={tree} id={id} onSelect={(v) => leave(() => onSelect(v))} /></TabPanel>
        <TabPanel value="stories"><StoriesTab tree={tree} p={p} detail={detail} /></TabPanel>
        <TabPanel value="everyday"><EverydayTab f={f} tree={tree} p={p} detail={detail} /></TabPanel>
        <TabPanel value="edit">{detail && <EditTab tree={tree} p={p} detail={detail} done={() => setTab('family')} onRemoved={onClose} />}</TabPanel>
      </div></Tabs>
      <div className="pp-add-relative"><Select aria-label="Add relative" placeholder="Add relative" value="" onChange={(v) => { if (v) leave(() => setAdd(v as AddRelation)); }} options={['parent', 'partner', 'child', 'sibling'].map((v) => ({ value: v, label: `Add ${v}` }))} /></div>
      {add && <QuickAdd family={f} tree={tree} anchor={id} relation={add} onCancel={() => setAdd(null)} onDone={() => setAdd(null)} />}
      <Dialog open={!!guarded} onClose={keep} title="Unsaved changes" dismissible={!savingDraft && !draft?.busy} footer={<>
        <button className="btn ghost" disabled={savingDraft || draft?.busy} onClick={keep}>Keep editing</button>
        <button className="btn" disabled={savingDraft || draft?.busy} onClick={proceed}>Discard</button>
        <button className="btn primary" disabled={savingDraft || draft?.busy} onClick={async () => { setSavingDraft(true); try { if (await draft?.save()) proceed(); } finally { setSavingDraft(false); } }}>Save</button>
      </>}><p>Save your draft before leaving?</p></Dialog>
    </aside></DraftContext.Provider>
  );
}


function relativesCount(f: Family, id: string) {
  return parents(f, id).length + partnersOf(f, id).length + children(f, id).length + siblings(f, id).length;
}

// ---------- family ----------

function FamilyTab({ f, tree, id, onSelect }: { f: Family; tree: string; id: string; onSelect: (id: string) => void }) {
  const gps = [...new Set(parents(f, id).flatMap((p) => parents(f, p)))];
  const unions = f.unionsOf.get(id) ?? [];
  const groups: [string, string[]][] = [
    ['Parents', parents(f, id)],
    ['Partners', partnersOf(f, id)],
    ['Children', children(f, id)],
    ['Siblings', siblings(f, id)],
    ['Grandparents', gps],
  ];
  const any = groups.some(([, ids]) => ids.length);
  if (!any) return <p className="empty">No relatives recorded yet. Use the <Plus size={12} /> marks around the card to add some.</p>;
  return (
    <>
      {groups.map(([label, ids]) =>
        ids.length ? (
          <section key={label}>
            <div className="rule">{label} <span className="faint">{ids.length}</span></div>
            <div className="pp-grid">
              {ids.map((r) => {
                const rp = f.byId.get(r)!;
                const u = label === 'Partners' ? unions.find((u) => u.a === r || u.b === r) : undefined;
                return (
                  <button key={r} className="pp-rel" onClick={() => onSelect(r)} title={`${displayName(rp, f)} · ${lifespan(rp)}`}>
                    <Portrait person={rp} tree={tree} size={58} frame />
                    <span className="pp-rel-name">{rp.given}</span>
                    {u ? <span className="pp-rel-sub">{u.kind === 'marriage' ? '⚭' : '♡'} {u.start ? yearOf(u.start) : ''}{u.end ? `–${yearOf(u.end)}` : ''}</span> : <span className="pp-rel-sub">{lifespan(rp)}</span>}
                    {f.disputed.has(`${id}>${r}`) && <span className="pp-disputed" title="Parentage disputed"><GameIcon name="uncertainty" size={12} /></span>}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null,
      )}
    </>
  );
}

// ---------- stories ----------

const KINDS: { id: Story['kind']; label: string; icon: ReactNode }[] = [
  { id: 'memory', label: 'Memory', icon: <Sparkles size={14} /> },
  { id: 'quote', label: 'Saying', icon: <Quote size={14} /> },
  { id: 'anecdote', label: 'Anecdote', icon: <MessagesSquare size={14} /> },
  { id: 'recipe', label: 'Recipe', icon: <CookingPot size={14} /> },
  { id: 'note', label: 'Note', icon: <StickyNote size={14} /> },
];

function StoriesTab({ tree, p, detail }: { tree: string; p: GPerson; detail?: PersonDetail }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const remove = useMutation({
    mutationFn: (sid: string) => deleteStory({ data: { tree, id: sid } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['person', tree, p.id] }); qc.invalidateQueries({ queryKey: ['graph', tree] }); },
  });
  return (
    <>
      {detail?.bio && <div className="pp-bio" dangerouslySetInnerHTML={{ __html: marked.parse(detail.bio, { async: false }) as string }} />}
      {adding ? (
        <StoryForm tree={tree} person={p} done={() => setAdding(false)} />
      ) : (
        <button className="btn primary pp-add-story" onClick={() => setAdding(true)}><Plus size={14} /> Add a memory, saying or recipe</button>
      )}
      {detail && detail.stories.length === 0 && !adding && (
        <p className="empty">Nothing written down about {p.given} yet. What do you remember?</p>
      )}
      <div className="pp-stories">
        {detail?.stories.map((s) => (
          <article key={s.id} className={`story story-${s.kind}`}>
            <header>
              {KINDS.find((k) => k.id === s.kind)?.icon}
              <span>{s.title ?? KINDS.find((k) => k.id === s.kind)?.label}</span>
              <button className="btn icon ghost story-del" aria-label="Remove story" title="Remove story" onClick={() => confirm('Remove this story?') && remove.mutate(s.id)}><Trash2 size={13} /></button>
            </header>
            {s.kind === 'quote' ? (
              <blockquote>{s.body}</blockquote>
            ) : (
              <div className="story-body" dangerouslySetInnerHTML={{ __html: marked.parse(s.body, { async: false }) as string }} />
            )}
            <footer>
              {s.context && <span>{s.context} · </span>}
              <span>added by {s.author}</span> · <time dateTime={s.at}>{new Date(s.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</time>
            </footer>
          </article>
        ))}
      </div>
    </>
  );
}

function StoryForm({ tree, person, done }: { tree: string; person: GPerson; done: () => void }) {
  const { leave } = useContext(DraftContext);
  const [saveError, setSaveError] = useState('');
  const qc = useQueryClient();
  const author = usePref('author') ?? '';
  const form = useForm({
    defaultValues: { kind: 'memory' as Story['kind'], title: '', body: '', context: '', author },
    onSubmit: async ({ value }) => {
      setSaveError('');
      try {
      setPref('author', value.author);
      await addStory({ data: { tree, person: person.id, ...value, title: value.title || undefined, context: value.context || undefined } });
      await qc.invalidateQueries({ queryKey: ['person', tree, person.id] });
      qc.invalidateQueries({ queryKey: ['graph', tree] });
      qc.invalidateQueries({ queryKey: ['chronicle', tree] });
      form.reset(value);
      done();
      } catch (e) { setSaveError(e instanceof Error ? e.message : 'Could not save story'); }
    },
  });
  return (
    <form className="story-form" onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}>
      <DraftTracker form={form} />{saveError && <p role="alert" className="err">{saveError}</p>}
      <form.Field name="kind">
        {(field) => (
          <div className="seg">
            {KINDS.map((k) => (
              <button type="button" key={k.id} aria-pressed={field.state.value === k.id} className="btn" onClick={() => field.handleChange(k.id)}>
                {k.icon} {k.label}
              </button>
            ))}
          </div>
        )}
      </form.Field>
      <form.Subscribe selector={(s) => s.values.kind}>
        {(kind) => (
          <>
            {kind !== 'quote' && (
              <form.Field name="title">
                {(field) => <input aria-label="Story title (optional)" className="input" placeholder="Title (optional)" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />}
              </form.Field>
            )}
            <form.Field name="body" validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : 'Write something first') }}>
              {(field) => (
                <>
                  <textarea
                    aria-label="Story" aria-describedby="story-body-error" aria-invalid={!!field.state.meta.errors.length}
                    autoFocus
                    className={`input${kind === 'quote' ? ' quote-input' : ''}`}
                    placeholder={kind === 'quote' ? `Something ${person.given} always said…` : kind === 'recipe' ? 'Ingredients and method…' : `What do you remember about ${person.given}?`}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && form.handleSubmit()}
                  />
                  {field.state.meta.errors.length ? <span id="story-body-error" className="err">{field.state.meta.errors.join(', ')}</span> : null}
                </>
              )}
            </form.Field>
            {kind === 'quote' && (
              <form.Field name="context">
                {(field) => <input aria-label="When or where" className="input" placeholder={tree === 'realm' ? 'At the winter feast…' : 'At every family dinner…'} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />}
              </form.Field>
            )}
          </>
        )}
      </form.Subscribe>
      <div className="row">
        <form.Field name="author" validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : 'Who is writing?') }}>
          {(field) => (
            <label className="field grow">
              <span>Your name</span>
              <input aria-describedby="story-author-error" aria-invalid={!!field.state.meta.errors.length} className="input" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="So the family knows who remembered" />{field.state.meta.errors.length > 0 && <em className="err" id="story-author-error">{field.state.meta.errors.join(", ")}</em>}
            </label>
          )}
        </form.Field>
      </div>
      <div className="row end">
        <button type="button" className="btn ghost" onClick={() => leave(done)}>Cancel</button>
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(busy) => <button className="btn primary" disabled={busy}><Check size={14} /> Save <kbd>⌘↵</kbd></button>}
        </form.Subscribe>
      </div>
    </form>
  );
}

// ---------- everyday ----------

function nextOccurrence(date: string, from = new Date()): Date | undefined {
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) return undefined;
  const [, m, d] = date.split('-').map(Number);
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let next = new Date(today.getFullYear(), m - 1, d);
  if (next < today) next = new Date(today.getFullYear() + 1, m - 1, d);
  return next;
}
const daysUntil = (d: Date) => Math.round((d.getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000);
const inDays = (n: number) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

const CONTACT_ICON = { phone: <Phone size={14} />, email: <Mail size={14} />, address: <MapPin size={14} />, web: <MessageCircle size={14} />, messenger: <MessageCircle size={14} /> };
const contactHref = (kind: string, v: string) =>
  kind === 'phone' ? `tel:${v.replace(/\s/g, '')}` : kind === 'email' ? `mailto:${v}` : kind === 'address' ? `https://maps.apple.com/?q=${encodeURIComponent(v)}` : kind === 'web' ? v : undefined;

function EverydayTab({ f, tree, p, detail }: { f: Family; tree: string; p: GPerson; detail?: PersonDetail }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<'phone' | 'email' | 'address' | 'messenger'>('phone');
  const [value, setValue] = useState('');
  const add = useMutation({
    mutationFn: () => addContact({ data: { tree, person: p.id, kind, value } }),
    onSuccess: () => { setValue(''); qc.invalidateQueries({ queryKey: ['person', tree, p.id] }); qc.invalidateQueries({ queryKey: ['contacts', tree] }); },
  });
  const del = useMutation({
    mutationFn: (cid: number) => deleteContact({ data: { tree, id: cid } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['person', tree, p.id] }); qc.invalidateQueries({ queryKey: ['contacts', tree] }); },
  });

  const bday = p.born ? nextOccurrence(p.born) : undefined;
  const anniversaries = (f.unionsOf.get(p.id) ?? [])
    .filter((u) => u.kind === 'marriage' && u.start && !u.end)
    .map((u) => ({ u, next: nextOccurrence(u.start!), other: f.byId.get(u.a === p.id ? u.b : u.a) }))
    .filter((x) => x.next && x.other?.living);

  if (!p.living) {
    const died = p.died ? nextOccurrence(p.died) : undefined;
    return (
      <div className="pp-facts">
        <Fact icon={<Cake size={15} />} label="Born">{fmtDate(p.born) ?? 'unknown'}{detail?.bornPlace && <> in <PlaceLink tree={tree} name={detail.bornPlace} /></>}</Fact>
        <Fact icon={<span>✝</span>} label="Died">{fmtDate(p.died) ?? 'unknown'}{detail?.diedPlace && <> in {detail.diedPlace}</>}{age(p) !== undefined && <span className="muted"> · aged {age(p)}</span>}</Fact>
        {died && daysUntil(died) < 60 && <Fact icon={<Heart size={15} />} label="Remembrance">{inDays(daysUntil(died))}</Fact>}
        {p.occupation && <Fact icon={<Pencil size={15} />} label="Occupation">{p.occupation}</Fact>}
        {(f.unionsOf.get(p.id) ?? []).map((u) => {
          const o = f.byId.get(u.a === p.id ? u.b : u.a);
          return o ? <Fact key={u.id} icon={<Heart size={15} />} label={u.kind === 'marriage' ? 'Married' : 'Partner'}>{displayName(o, f)}{u.start && <> · {fmtDate(u.start)}</>}{u.place && <> · {u.place}</>}{u.endReason && u.endReason !== 'death' && <span className="muted"> ({u.endReason})</span>}</Fact> : null;
        })}
      </div>
    );
  }

  return (
    <div className="pp-facts">
      {bday ? (
        <div className="pp-countdown">
          <Cake size={20} />
          <div>
            <b>Birthday {inDays(daysUntil(bday))}</b>
            <div className="muted">{bday.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · turns {(ageAt(p.born) ?? 0) + 1}</div>
          </div>
        </div>
      ) : (
        <Fact icon={<Cake size={15} />} label="Born">{fmtDate(p.born) ?? 'unknown, add it in Edit'}</Fact>
      )}
      {anniversaries.map(({ u, next, other }) => (
        <div className="pp-countdown" key={u.id}>
          <Heart size={20} />
          <div>
            <b>Anniversary with {other!.given} {inDays(daysUntil(next!))}</b>
            <div className="muted">{next!.getFullYear() - yearOf(u.start)} years · married {fmtDate(u.start)}</div>
          </div>
        </div>
      ))}
      {p.nickname && <Fact icon={<UserRound size={15} />} label="Called">{p.nickname}</Fact>}
      {detail?.bornPlace && <Fact icon={<MapPin size={15} />} label="Born in"><PlaceLink tree={tree} name={detail.bornPlace} /></Fact>}
      {p.occupation && <Fact icon={<Pencil size={15} />} label="Does">{p.occupation}</Fact>}
      <Fact icon={<Gift size={15} />} label="Likes">{detail?.favourite ?? <span className="faint">Gift ideas, favourite food, music… add them in Edit</span>}</Fact>

      <div className="rule">Reach {p.given}</div>
      {detail?.contacts.map((c) => (
        <div key={c.id} className="pp-contact">
          {CONTACT_ICON[c.kind]}
          {contactHref(c.kind, c.value) ? <a href={contactHref(c.kind, c.value)} target={c.kind === 'address' ? '_blank' : undefined} rel="noreferrer">{c.value}</a> : <span>{c.value}</span>}
          {c.label && <span className="chip">{c.label}</span>}
          <button className="btn icon ghost" aria-label="Remove contact" title="Remove contact" onClick={() => del.mutate(c.id)}><Trash2 size={13} /></button>
        </div>
      ))}
      <form className="pp-contact-add" onSubmit={(e) => { e.preventDefault(); value.trim() && add.mutate(); }}>
        <Select aria-label="Contact kind" value={kind} onChange={setKind} options={(['phone', 'email', 'address', 'messenger'] as const).map((value) => ({value, label: value[0].toUpperCase() + value.slice(1)}))} />
        <input aria-label="Contact details" className="input" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === 'address' ? 'Street, town' : kind === 'email' ? 'name@example.com' : '+49 …'} />
        <button aria-label="Add contact" className="btn" disabled={!value.trim() || add.isPending}><Plus size={14} /></button>
      </form>
    </div>
  );
}

/** A place name that opens the Atlas there. */
function PlaceLink({ tree, name }: { tree: string; name: string }) {
  return <Link to="/$tree/atlas" params={{ tree }} search={{ place: name }} className="pp-place">{name}</Link>;
}

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="fact">
      <span className="fact-icon">{icon}</span>
      <span className="fact-label">{label}</span>
      <span className="fact-value">{children}</span>
    </div>
  );
}

// ---------- edit ----------

function EditTab({ tree, p, detail, done, onRemoved }: { tree: string; p: GPerson; detail: PersonDetail; done: () => void; onRemoved: () => void }) {
  const { leave } = useContext(DraftContext);
  const medieval = tree === 'realm' || (!!p.born && yearOf(p.born) < 1500);
  const qc = useQueryClient();
  const [saveError, setSaveError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: () => removePerson({ data: { tree, id: p.id } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['graph', tree] });
      onRemoved();
    },
  });
  const form = useForm({
    defaultValues: {
      given: p.given, surname: p.surname ?? '', nickname: p.nickname ?? '', sex: (p.sex ?? '') as '' | 'm' | 'f' | 'x',
      born: p.born ?? '', bornPlace: detail.bornPlace ?? '', died: p.died ?? '', diedPlace: detail.diedPlace ?? '', living: p.living,
      title: p.title ?? '', epithet: p.epithet ?? '', occupation: p.occupation ?? '', favourite: detail.favourite ?? '', bio: detail.bio ?? '',
    },
    onSubmit: async ({ value }) => {
      setSaveError(null);
      try {
        await updatePerson({ data: { tree, id: p.id, patch: { ...value, sex: value.sex || null } } });
        await Promise.all([qc.invalidateQueries({ queryKey: ['graph', tree] }), qc.invalidateQueries({ queryKey: ['person', tree, p.id] })]);
        form.reset(value);
        done();
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : 'Could not save');
      }
    },
  });
  const date = ({ value }: { value: string }) => (value === '' || validDate(value.trim()) ? undefined : 'Enter a year, year-month or year-month-day; use ~ for an approximate year');
  const text = (name: any, label: string, opts: { placeholder?: string; validate?: typeof date; wide?: boolean } = {}) => (
    <form.Field name={name} validators={opts.validate ? { onChange: opts.validate } : undefined}>
      {(field: any) => (
        <label className={`field${opts.wide ? ' wide' : ''}`}>
          <span>{label}</span>
          <input aria-invalid={!!field.state.meta.errors.length} aria-describedby={`edit-${name}-error`} className="input" value={field.state.value} placeholder={opts.placeholder} onChange={(e) => field.handleChange(e.target.value)} />
          {field.state.meta.errors.length ? <em id={`edit-${name}-error`} className="err">{field.state.meta.errors[0]}</em> : null}
        </label>
      )}
    </form.Field>
  );
  return (
    <form className="pp-edit" onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}>
      <DraftTracker form={form} />
      {text('given', 'Given name')}
      {text('surname', 'Surname at birth')}
      {text('nickname', 'Called', { placeholder: medieval ? 'A familiar name or byname' : 'Ellie, Grandpa Joe' })}
      <form.Field name="sex">
        {(field) => (
          <label className="field">
            <span>Sex</span>
            <Select aria-label="Sex" value={field.state.value} onChange={(v) => field.handleChange(v)} options={[{value: '', label: 'Unknown'}, {value: 'f', label: 'Female'}, {value: 'm', label: 'Male'}, {value: 'x', label: 'Other'}]} />
          </label>
        )}
      </form.Field>
      {text('born', 'Born', { placeholder: medieval ? '1120 or ~1120' : '1953 or 1953-08-08', validate: date })}
      {text('bornPlace', 'Birthplace')}
      <form.Field name="living">
        {(field) => (
          <label className="field check wide">
            <Switch checked={field.state.value} onChange={(v) => field.handleChange(v)}>Living</Switch>
          </label>
        )}
      </form.Field>
      <form.Subscribe selector={(s) => s.values.living}>
        {(living) => (living ? null : <>{text('died', 'Died', { validate: date })}{text('diedPlace', 'Place of death')}</>)}
      </form.Subscribe>
      {text('title', 'Title', { placeholder: medieval ? 'Duchess of Brennac' : 'Title, if any' })}
      {text('epithet', 'Epithet', { placeholder: 'the Bold' })}
      {text('occupation', 'Occupation', { wide: true })}
      {text('favourite', 'Likes & gift ideas', { wide: true, placeholder: medieval ? 'Honey cakes, falconry, music' : 'Liquorice, music, sailing' })}
      <form.Field name="bio">
        {(field) => (
          <label className="field wide">
            <span>Biography <small className="subtle">Markdown supported</small></span>
            <textarea className="input" rows={6} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
          </label>
        )}
      </form.Field>
      {saveError && <em role="alert" className="err wide">{saveError}</em>}
      <div className="row end wide">
        <button
          type="button"
          className="btn ghost danger"
          disabled={remove.isPending}
          onClick={() => confirm(`Remove ${p.given} from the tree? Their family links, stories, contacts and photo go too.`) && remove.mutate()}
        >
          <Trash2 size={14} /> Remove from tree
        </button>
        <span className="spacer" />
        <button type="button" className="btn ghost" onClick={() => leave(done)}>Cancel</button>
        <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting] as const}>
          {([ok, busy]) => <button className="btn primary" disabled={!ok || busy}><Check size={14} /> Save</button>}
        </form.Subscribe>
      </div>
    </form>
  );
}

