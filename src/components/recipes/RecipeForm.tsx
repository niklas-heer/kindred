// The form a recipe is written in (docs/recipes.md): its name, whose it is, what it serves and how long it takes, the
// ingredients in rows, the method in steps, a picture, the story that goes with it, and tags. One form for a new recipe
// and for changing one; the person panel and the composer show it when "Recipe" is picked, the Cookbook and a recipe's
// page open it in a window (RecipeDialog).
//
//   <RecipeForm tree={tree} person={p} onDone={close} onCancel={close} />      a new recipe of p's
//   <RecipeForm tree={tree} edit={recipe} onDone={close} onCancel={close} />   changing one
//
// Made to be quick on a phone. A row takes a whole line typed into it ("800 g beef, diced" sorts itself into amount,
// unit, what and how), a pasted list becomes rows and a pasted method steps, and Enter in a row starts the next one.
// The pictures are scaled down and stripped of their location data in the browser, and travel with the recipe in one
// request, so nothing is stored for a recipe that is not saved. They are the recipe's alone, never the Gallery's.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, ClipboardPaste, ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { useContext, useEffect, useMemo, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
import { DraftContext } from '~/components/fields/draft';
import { scaledPicture } from '~/components/photos/image';
import { PersonPicker } from '~/components/photos/PersonPicker';
import { Portrait } from '~/components/Portrait';
import { Notice } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { errorText } from '~/lib/errortext';
import { useFamily, useMeChosen } from '~/lib/family';
import { displayName } from '~/lib/graph';
import { useT } from '~/lib/i18n';
import { closestFamily } from '~/lib/person-overview';
import {
  cleanTags, foldTag, parseIngredient, parseIngredientLines, parseStepLines, recipeImageUrl, COVER_EDGE, COVER_THUMB_EDGE, MAX_GROUPS, MAX_GROUP_NAME, MAX_INGREDIENTS,
  MAX_ITEM, MAX_NOTE, MAX_NOTES, MAX_SERVINGS, MAX_SOURCE, MAX_STEP, MAX_STEPS, MAX_STEP_IMAGES, MAX_TAG, MAX_TAGS, MAX_TITLE, STEP_EDGE,
  type Ingredient, type RecipeDetail,
} from '~/lib/recipes/model';
import { cookbookQuery, saveRecipe } from '~/lib/recipes/recipes.functions';
import { toast } from '~/lib/toast';
import type { GPerson } from '~/lib/types';
import './recipes.css';

const ACCEPT = 'image/jpeg,image/png,image/webp';
// The unit signs, the same in English, German and Afrikaans.
const HOURS = 'h';
const MINUTES = 'min';

/** A picture chosen in the form, as it will be sent: scaled, re-encoded, without EXIF or GPS. */
interface Fresh { blob: Blob; thumb?: Blob; width: number; height: number; preview: string }
interface Row extends Ingredient { id: string }
interface Group { id: string; name: string; items: Row[] }
interface Step { id: string; text: string; image: string | null; fresh?: Fresh }

const uid = () => crypto.randomUUID();
const emptyRow = (): Row => ({ id: uid(), amount: '', unit: '', item: '', note: '' });
const emptyStep = (): Step => ({ id: uid(), text: '', image: null });
const hm = (minutes: number | null) => (minutes === null ? { h: '', m: '' } : { h: minutes >= 60 ? String(Math.floor(minutes / 60)) : '', m: String(minutes % 60) });
const minutesOf = (t: { h: string; m: string }) => (t.h.trim() === '' && t.m.trim() === '' ? null : Math.max(0, (Number(t.h) || 0) * 60 + (Number(t.m) || 0)));

/** What the form starts from: the recipe being changed, or an empty one with three rows and one step waiting. */
function initial(edit: RecipeDetail | undefined) {
  if (!edit) return { title: '', source: '', servings: '', prep: hm(null), cook: hm(null), groups: [{ id: uid(), name: '', items: [emptyRow(), emptyRow(), emptyRow()] }], steps: [emptyStep()], notes: '', tags: [] as string[] };
  // A recipe from before the form: its words become the notes, to be sorted into rows and steps by hand.
  if (!edit.structured) return { title: edit.title, source: '', servings: '', prep: hm(null), cook: hm(null), groups: [{ id: uid(), name: '', items: [emptyRow()] }], steps: [emptyStep()], notes: edit.body, tags: [] as string[] };
  return {
    title: edit.title, source: edit.source, servings: edit.servings ? String(edit.servings) : '', prep: hm(edit.prepMinutes), cook: hm(edit.cookMinutes),
    groups: edit.groups.length ? edit.groups.map((g) => ({ id: uid(), name: g.name, items: g.items.map((i) => ({ id: uid(), ...i })) })) : [{ id: uid(), name: '', items: [emptyRow()] }],
    steps: edit.steps.length ? edit.steps.map((s) => ({ id: uid(), text: s.text, image: s.image })) : [emptyStep()],
    notes: edit.notes, tags: edit.tags,
  };
}

export function RecipeForm({ tree, person, edit, onDone, onCancel, onDirty, lockPerson = false }: {
  tree: string;
  /** Whose recipe it is, to start with. Without one it is the reader's own person, or theirs to choose. */
  person?: GPerson;
  /** The recipe to change. */
  edit?: RecipeDetail;
  /** Called with the recipe's id once it is saved. */
  onDone: (id: string) => void;
  onCancel: () => void;
  /** Told whether something is typed, so a window can ask before throwing it away. */
  onDirty?: (dirty: boolean) => void;
  /** The person is decided by where the form is (someone's own page): no row to change them. */
  lockPerson?: boolean;
}) {
  const t = useT();
  const f = useFamily();
  const qc = useQueryClient();
  const me = useMeChosen();
  const { register, leave } = useContext(DraftContext);
  const [start] = useState(() => initial(edit));
  const [title, setTitle] = useState(start.title);
  const [whose, setWhose] = useState<string | null>(edit?.person ?? person?.id ?? me ?? null);
  const [picking, setPicking] = useState(false);
  const [source, setSource] = useState(start.source);
  const [servings, setServings] = useState(start.servings);
  const [prep, setPrep] = useState(start.prep);
  const [cook, setCook] = useState(start.cook);
  const [groups, setGroups] = useState<Group[]>(start.groups);
  const [steps, setSteps] = useState<Step[]>(start.steps);
  const [notes, setNotes] = useState(start.notes);
  const [tags, setTags] = useState<string[]>(start.tags);
  const [tagText, setTagText] = useState('');
  // The cover: the one the recipe has, a new one, or none.
  const [cover, setCover] = useState<{ kept: boolean; fresh?: Fresh }>({ kept: !!edit?.cover });
  const [busyPicture, setBusyPicture] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [keys] = useState(opKeys);
  const root = useRef<HTMLFormElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const stepInput = useRef<HTMLInputElement>(null);
  const stepFor = useRef<string | null>(null);
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const dirty = touched;
  const touch = () => { if (!touched) setTouched(true); };
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);

  // The tags the family already uses, most used first: one press instead of typing them again.
  const book = useQuery(cookbookQuery(tree)).data;
  const known = useMemo(() => {
    const n = new Map<string, { tag: string; n: number }>();
    for (const r of book ?? []) for (const tag of r.tags) n.set(foldTag(tag), { tag: n.get(foldTag(tag))?.tag ?? tag, n: (n.get(foldTag(tag))?.n ?? 0) + 1 });
    const mine = new Set(tags.map(foldTag));
    return [...n.entries()].filter(([k]) => !mine.has(k)).sort((a, b) => b[1].n - a[1].n).map(([, v]) => v.tag).slice(0, 10);
  }, [book, tags]);

  // ---------- rows ----------

  const focusLater = (selector: string) => requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(selector)?.focus());
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  const setRow = (gid: string, id: string, patch: Partial<Row>) => {
    touch();
    setGroups((gs) => gs.map((g) => (g.id !== gid ? g : { ...g, items: g.items.map((r) => (r.id === id ? { ...r, ...patch } : r)) })));
  };
  const addRow = (gid: string, after?: string) => {
    if (count >= MAX_INGREDIENTS) return;
    const row = emptyRow();
    touch();
    setGroups((gs) => gs.map((g) => {
      if (g.id !== gid) return g;
      const at = after ? g.items.findIndex((r) => r.id === after) + 1 : g.items.length;
      return { ...g, items: [...g.items.slice(0, at), row, ...g.items.slice(at)] };
    }));
    focusLater(`[data-row="${row.id}"] input`);
  };
  const removeRow = (gid: string, id: string) => {
    touch();
    setGroups((gs) => gs.map((g) => (g.id !== gid ? g : { ...g, items: g.items.length > 1 ? g.items.filter((r) => r.id !== id) : [emptyRow()] })));
  };
  /** A whole line typed into the first box sorts itself: "800 g beef, diced" becomes amount, unit, what and how. */
  const settle = (gid: string, r: Row) => {
    const text = r.amount.trim();
    if (r.unit || r.item || r.note || !text) return;
    const parsed = parseIngredient(text);
    // It came apart into an amount and a thing; or it is words alone ("salt"), which belong in the third box. A bare
    // number ("800", "1 1/2") stays where it is: the rest is still to come.
    if (parsed.item !== text || !/^[\d½⅓⅔¼¾⅛⅜⅝⅞]/.test(text)) setRow(gid, r.id, parsed);
  };
  /** Pasted lines become rows from this row on; a pasted heading starts a group of its own. */
  const takeLines = (text: string, gid: string, at?: string) => {
    const parsed = parseIngredientLines(text);
    if (!parsed.length) return false;
    touch();
    setGroups((gs) => {
      const out: Group[] = [];
      for (const g of gs) {
        if (g.id !== gid) { out.push(g); continue; }
        const [first, ...rest] = parsed;
        const own = first!.name ? [] : first!.items.map((i) => ({ id: uid(), ...i }));
        const index = at ? g.items.findIndex((r) => r.id === at) : g.items.length - 1;
        // The row pasted into is replaced when it is empty; rows left empty are dropped once there is something real.
        const before = g.items.slice(0, Math.max(0, index)).filter((r) => r.amount || r.item);
        const here = g.items[index];
        const after = g.items.slice(index + 1).filter((r) => r.amount || r.item);
        const items = [...before, ...(here && (here.amount || here.item) ? [here] : []), ...own, ...after];
        out.push({ ...g, items: items.length ? items : [emptyRow()] });
        for (const p of first!.name ? parsed : rest) out.push({ id: uid(), name: p.name, items: p.items.map((i) => ({ id: uid(), ...i })) });
      }
      return out.slice(0, MAX_GROUPS);
    });
    return true;
  };
  const pasteRows = (e: ClipboardEvent<HTMLInputElement>, gid: string, id: string) => {
    const text = e.clipboardData.getData('text');
    if (!/\n/.test(text.trim())) return;
    if (takeLines(text, gid, id)) e.preventDefault();
  };

  // ---------- steps ----------

  const setStep = (id: string, patch: Partial<Step>) => { touch(); setSteps((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s))); };
  const addStep = () => {
    if (steps.length >= MAX_STEPS) return;
    const s = emptyStep();
    touch();
    setSteps((ss) => [...ss, s]);
    focusLater(`[data-step="${s.id}"] textarea`);
  };
  const moveStep = (id: string, by: -1 | 1) => {
    touch();
    setSteps((ss) => {
      const i = ss.findIndex((s) => s.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= ss.length) return ss;
      const next = [...ss];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  };
  /** A method pasted into an empty step becomes one step per paragraph or numbered line. */
  const pasteSteps = (e: ClipboardEvent<HTMLTextAreaElement>, s: Step) => {
    if (s.text.trim()) return;
    const parts = parseStepLines(e.clipboardData.getData('text'));
    if (parts.length < 2) return;
    e.preventDefault();
    touch();
    setSteps((ss) => {
      const i = ss.findIndex((x) => x.id === s.id);
      return [...ss.slice(0, i), { ...s, text: parts[0]! }, ...parts.slice(1).map((text) => ({ ...emptyStep(), text })), ...ss.slice(i + 1)].slice(0, MAX_STEPS);
    });
  };
  const stepPictures = steps.filter((s) => s.image || s.fresh).length;

  // ---------- pictures ----------

  async function prepare(file: File, edge: number, withThumb: boolean): Promise<Fresh | null> {
    if (!ACCEPT.split(',').includes(file.type)) { setNotice(t('recipes.form.picture_failed', { name: file.name })); return null; }
    setBusyPicture(true);
    try {
      const scaled = await scaledPicture(file, edge, 0.86);
      const thumb = withThumb ? await scaledPicture(scaled.blob, COVER_THUMB_EDGE, 0.82).then((x) => x.blob, () => undefined) : undefined;
      const preview = URL.createObjectURL(thumb ?? scaled.blob);
      previews.current.push(preview);
      setNotice(null);
      return { blob: scaled.blob, thumb, width: scaled.width, height: scaled.height, preview };
    } catch {
      setNotice(t('recipes.form.picture_failed', { name: file.name }));
      return null;
    } finally {
      setBusyPicture(false);
    }
  }
  const chooseCover = async (file: File | undefined) => {
    if (!file) return;
    const fresh = await prepare(file, COVER_EDGE, true);
    if (fresh) { touch(); setCover({ kept: false, fresh }); }
  };
  const chooseStepPicture = async (file: File | undefined) => {
    const id = stepFor.current;
    if (!file || !id) return;
    const fresh = await prepare(file, STEP_EDGE, false);
    if (fresh) setStep(id, { fresh, image: null });
  };

  // ---------- tags ----------

  const addTags = (text: string) => {
    const next = cleanTags([...tags, ...text.split(',')]);
    if (next.length !== tags.length) touch();
    setTags(next);
    setTagText('');
  };

  // ---------- saving ----------

  const chosen = whose ? f.byId.get(whose) : undefined;
  const hasRows = groups.some((g) => g.items.some((r) => r.item.trim() || (r.amount.trim() && !r.unit && !r.note)));
  const hasSteps = steps.some((s) => s.text.trim() || s.image || s.fresh);
  const problem = !title.trim() ? t('recipes.form.need_title') : !chosen ? t('recipes.form.need_person') : !hasRows && !hasSteps ? t('recipes.form.need_substance') : null;
  const [showProblem, setShowProblem] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      const sizes: Record<string, { width: number; height: number }> = {};
      const fd = new FormData();
      let n = 0;
      const sentSteps = steps.map((s) => {
        if (!s.fresh) return { text: s.text, image: s.image };
        const at = n++;
        sizes[String(at)] = { width: s.fresh.width, height: s.fresh.height };
        fd.set(`step:${at}`, new File([s.fresh.blob], `step-${at}.jpg`, { type: 'image/jpeg' }));
        return { text: s.text, image: `new:${at}` };
      });
      const data = {
        ...(edit ? { id: edit.id } : {}),
        person: whose!, title: title.trim(), source, servings: Number(servings) >= 1 ? Math.min(MAX_SERVINGS, Math.round(Number(servings))) : null,
        prepMinutes: minutesOf(prep), cookMinutes: minutesOf(cook),
        // A line still sitting whole in its first box is sorted as it is sent.
        groups: groups.map((g) => ({ name: g.name, items: g.items.map(({ id: _id, ...r }) => (!r.item.trim() && r.amount.trim() && !r.unit && !r.note ? parseIngredient(r.amount) : r)) })),
        steps: sentSteps, notes, tags: cleanTags([...tags, ...tagText.split(',')]),
        cover: cover.fresh ? 'new' : cover.kept ? 'keep' : 'remove',
        ...(cover.fresh ? { coverSize: { width: cover.fresh.width, height: cover.fresh.height } } : {}),
        stepSizes: sizes, locale: t.locale,
      };
      if (cover.fresh) {
        fd.set('cover', new File([cover.fresh.blob], 'cover.jpg', { type: 'image/jpeg' }));
        if (cover.fresh.thumb) fd.set('coverThumb', new File([cover.fresh.thumb], 'cover-thumb.jpg', { type: 'image/jpeg' }));
      }
      fd.set('tree', tree);
      fd.set('data', JSON.stringify(data));
      // One key per attempt at this exact recipe: a retry after a lost answer never writes it twice.
      fd.set('opKey', keys.for('recipe', [data, cover.fresh?.blob.size ?? 0, steps.map((s) => s.fresh?.blob.size ?? 0)]));
      return saveRecipe({ data: fd });
    },
    onSuccess: async ({ id }) => {
      keys.clear();
      setTouched(false);
      onDirty?.(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['cookbook', tree] }),
        qc.invalidateQueries({ queryKey: ['recipe', tree, id] }),
        qc.invalidateQueries({ queryKey: ['chronicle', tree] }),
        qc.invalidateQueries({ queryKey: ['feed', tree] }),
        qc.invalidateQueries({ queryKey: ['person', tree] }),
        qc.invalidateQueries({ queryKey: ['graph', tree] }),
        qc.invalidateQueries({ queryKey: ['story-translations', tree] }),
      ]);
      toast({ title: edit ? t('recipes.form.changed') : t('recipes.form.saved'), body: edit ? title.trim() : t('recipes.form.saved_body', { title: title.trim() }), person: whose ?? undefined, icon: 'quill-ink' });
      onDone(id);
    },
  });
  const submit = () => {
    if (problem) { setShowProblem(true); return; }
    if (!save.isPending && !busyPicture) save.mutate();
  };
  // The person panel asks before leaving a form with something typed in it.
  useEffect(() => {
    register({ dirty, busy: save.isPending, save: async () => { submit(); return false; } });
    // `submit` reads the latest state when it is called; registering again on every keystroke would only churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, save.isPending, register]);
  useEffect(() => () => register(null), [register]);

  const suggested = useMemo(() => (me ? [me, ...closestFamily(f, me, 7).shown.map((r) => r.id)] : undefined), [f, me]);
  const coverSrc = cover.fresh?.preview ?? (cover.kept && edit?.cover ? recipeImageUrl(tree, edit.cover.key, 'thumb') : null);
  const multi = groups.length > 1 || !!groups[0]?.name;
  // Rows are numbered through the whole list, so no two of them answer to the same name.
  const before = (gi: number) => groups.slice(0, gi).reduce((n, g) => n + g.items.length, 0);
  // The example ("800 g beef, diced") is shown in the first row alone: on every row it would read as a filled-in list.
  const eg = (gi: number, ri: number, key: 'recipes.form.amount_ph' | 'recipes.form.unit_ph' | 'recipes.form.item_ph' | 'recipes.form.note_ph') => (gi === 0 && ri === 0 ? t(key) : undefined);

  return (
    <form ref={root} className="rcp-form" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {/* ---- the picture and the name ---- */}
      <div className="rcp-form-top">
        <input ref={coverInput} type="file" accept={ACCEPT} hidden onChange={(e) => { void chooseCover(e.target.files?.[0]); e.target.value = ''; }} />
        {coverSrc ? (
          <div className="rcp-form-cover has">
            <img src={coverSrc} alt={t('recipes.form.cover_alt')} />
            <div className="rcp-form-cover-tools">
              <button type="button" className="btn" onClick={() => coverInput.current?.click()} disabled={busyPicture}><ImagePlus size={15} aria-hidden /> {t('recipes.form.cover_replace')}</button>
              <button type="button" className="btn icon" aria-label={t('recipes.form.cover_remove')} title={t('recipes.form.cover_remove')} onClick={() => { touch(); setCover({ kept: false }); }}><X size={15} aria-hidden /></button>
            </div>
          </div>
        ) : (
          <button type="button" className="rcp-form-cover" onClick={() => coverInput.current?.click()} disabled={busyPicture}>
            <ImagePlus size={22} aria-hidden />
            <b>{busyPicture ? t('recipes.form.picture_preparing') : t('recipes.form.cover_add')}</b>
            <span>{t('recipes.form.cover_hint')}</span>
          </button>
        )}
        <div className="rcp-form-name">
          <label htmlFor="rcp-title">{t('recipes.form.title')}</label>
          <input
            id="rcp-title" className="input rcp-title-input" value={title} maxLength={MAX_TITLE} placeholder={t('recipes.form.title_ph')}
            onChange={(e) => { touch(); setTitle(e.target.value); }} aria-invalid={showProblem && !title.trim()} {...(edit ? {} : { 'data-autofocus': true })}
          />
          <label htmlFor="rcp-source">{t('recipes.form.source')}</label>
          <input id="rcp-source" className="input" value={source} maxLength={MAX_SOURCE} placeholder={t('recipes.form.source_ph')} onChange={(e) => { touch(); setSource(e.target.value); }} />
        </div>
      </div>

      {/* ---- whose it is ---- */}
      {lockPerson ? null : (
        <div className="rcp-form-whose">
          <span className="rcp-label" id="rcp-whose-label">{t('recipes.form.whose')}</span>
          {chosen && !picking ? (
            <div className="rcp-form-person">
              <Portrait person={chosen} tree={tree} size={36} decorative />
              <b>{displayName(chosen, f)}</b>
              <button type="button" className="btn ghost" onClick={() => setPicking(true)}>{t('chronicle.add_change')}</button>
            </div>
          ) : (
            <div className="rcp-form-pick" onKeyDown={(e) => { if (e.key === 'Escape' && chosen) { e.stopPropagation(); setPicking(false); } }}>
              <p className="rcp-hint">{t('recipes.form.whose_hint')}</p>
              <PersonPicker label={t('recipes.form.whose')} suggested={suggested} portraits={tree} onPick={(p) => { touch(); setWhose(p.id); setPicking(false); }} />
            </div>
          )}
        </div>
      )}

      {/* ---- the facts ---- */}
      <div className="rcp-form-facts">
        <label className="rcp-fact">
          <span>{t('recipes.form.servings')}</span>
          <input className="input" inputMode="numeric" value={servings} placeholder="4" maxLength={3} onChange={(e) => { touch(); setServings(e.target.value.replace(/[^\d]/g, '')); }} />
        </label>
        <Duration label={t('recipes.prep')} value={prep} onChange={(v) => { touch(); setPrep(v); }} />
        <Duration label={t('recipes.cook')} value={cook} onChange={(v) => { touch(); setCook(v); }} />
      </div>

      {/* ---- ingredients ---- */}
      <Section title={t('recipes.ingredients')} hint={t('recipes.form.ingredients_hint')} tools={
        <button type="button" className="btn ghost rcp-small" aria-expanded={pasting} onClick={() => setPasting(!pasting)}><ClipboardPaste size={14} aria-hidden /> {t('recipes.form.paste')}</button>
      }>
        {pasting ? (
          <div className="rcp-paste">
            <textarea className="input" rows={5} value={pasteText} placeholder={t('recipes.form.paste_example')} aria-label={t('recipes.form.paste')} onChange={(e) => setPasteText(e.target.value)} />
            <div className="rcp-row-end">
              <button type="button" className="btn primary" disabled={!pasteText.trim()} onClick={() => { if (takeLines(pasteText, groups[groups.length - 1]!.id)) { setPasteText(''); setPasting(false); } }}>
                <Check size={14} aria-hidden /> {t('recipes.form.paste_add')}
              </button>
              <button type="button" className="btn ghost" onClick={() => setPasting(false)}>{t('common.cancel')}</button>
            </div>
          </div>
        ) : null}
        {groups.map((g, gi) => (
          <div className="rcp-group" key={g.id}>
            {multi ? (
              <div className="rcp-group-name">
                <input
                  className="input" value={g.name} maxLength={MAX_GROUP_NAME} placeholder={t('recipes.form.group_ph')} aria-label={t('recipes.form.group_n', { n: gi + 1 })}
                  onChange={(e) => { touch(); setGroups((gs) => gs.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x))); }}
                />
                {groups.length > 1 ? (
                  <button type="button" className="btn icon ghost" aria-label={t('recipes.form.group_remove', { n: gi + 1 })} title={t('recipes.form.group_remove', { n: gi + 1 })}
                    onClick={() => { touch(); setGroups((gs) => gs.filter((x) => x.id !== g.id)); }}><Trash2 size={14} aria-hidden /></button>
                ) : null}
              </div>
            ) : null}
            <ul className="rcp-rows">
              {g.items.map((r, ri) => (
                <li key={r.id} data-row={r.id} className="rcp-row">
                  <input
                    className="input rcp-amount" value={r.amount} placeholder={eg(gi, ri, 'recipes.form.amount_ph')} aria-label={t('recipes.form.amount_n', { n: before(gi) + ri + 1 })} autoComplete="off"
                    onChange={(e) => setRow(g.id, r.id, { amount: e.target.value })} onBlur={() => settle(g.id, r)} onPaste={(e) => pasteRows(e, g.id, r.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); settle(g.id, r); addRow(g.id, r.id); } }}
                  />
                  <input
                    className="input rcp-unit" value={r.unit} placeholder={eg(gi, ri, 'recipes.form.unit_ph')} aria-label={t('recipes.form.unit_n', { n: before(gi) + ri + 1 })} autoComplete="off" autoCapitalize="off"
                    onChange={(e) => setRow(g.id, r.id, { unit: e.target.value })} onPaste={(e) => pasteRows(e, g.id, r.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRow(g.id, r.id); } }}
                  />
                  <input
                    className="input rcp-item" value={r.item} maxLength={MAX_ITEM} placeholder={eg(gi, ri, 'recipes.form.item_ph')} aria-label={t('recipes.form.item_n', { n: before(gi) + ri + 1 })} autoComplete="off"
                    onChange={(e) => setRow(g.id, r.id, { item: e.target.value })} onPaste={(e) => pasteRows(e, g.id, r.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRow(g.id, r.id); } }}
                  />
                  <input
                    className="input rcp-note" data-has={r.note ? '' : undefined} value={r.note} maxLength={MAX_NOTE} placeholder={eg(gi, ri, 'recipes.form.note_ph')} aria-label={t('recipes.form.note_n', { n: before(gi) + ri + 1 })} autoComplete="off"
                    onChange={(e) => setRow(g.id, r.id, { note: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRow(g.id, r.id); } }}
                  />
                  <button type="button" className="btn icon ghost rcp-row-del" aria-label={t('recipes.form.row_remove', { n: before(gi) + ri + 1 })} title={t('recipes.form.row_remove', { n: before(gi) + ri + 1 })} onClick={() => removeRow(g.id, r.id)}><X size={14} aria-hidden /></button>
                </li>
              ))}
            </ul>
            <button type="button" className="btn ghost rcp-small" disabled={count >= MAX_INGREDIENTS} onClick={() => addRow(g.id)}><Plus size={14} aria-hidden /> {t('recipes.form.row_add')}</button>
          </div>
        ))}
        {groups.length < MAX_GROUPS ? (
          <button type="button" className="btn ghost rcp-small" onClick={() => { const g = { id: uid(), name: '', items: [emptyRow()] }; touch(); setGroups((gs) => [...gs, g]); focusLater(`[data-row="${g.items[0]!.id}"] input`); }}>
            <Plus size={14} aria-hidden /> {t('recipes.form.group_add')}
          </button>
        ) : null}
      </Section>

      {/* ---- method ---- */}
      <Section title={t('recipes.method')} hint={t('recipes.form.method_hint')}>
        <input ref={stepInput} type="file" accept={ACCEPT} hidden onChange={(e) => { void chooseStepPicture(e.target.files?.[0]); e.target.value = ''; }} />
        <ol className="rcp-steps-edit">
          {steps.map((s, si) => {
            const src = s.fresh?.preview ?? (s.image ? recipeImageUrl(tree, s.image) : null);
            return (
              <li key={s.id} data-step={s.id}>
                <span className="rcp-step-n" aria-hidden>{si + 1}</span>
                <div className="rcp-step-body">
                  <textarea
                    className="input" rows={2} value={s.text} maxLength={MAX_STEP} placeholder={si === 0 ? t('recipes.form.step_ph') : undefined} aria-label={t('recipes.form.step_n', { n: si + 1 })}
                    onChange={(e) => setStep(s.id, { text: e.target.value })} onPaste={(e) => pasteSteps(e, s)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
                  />
                  {src ? (
                    <div className="rcp-step-pic">
                      <img src={src} alt={t('recipes.step_picture', { n: si + 1 })} />
                      <button type="button" className="btn icon" aria-label={t('recipes.form.step_picture_remove', { n: si + 1 })} title={t('recipes.form.step_picture_remove', { n: si + 1 })} onClick={() => setStep(s.id, { fresh: undefined, image: null })}><X size={14} aria-hidden /></button>
                    </div>
                  ) : null}
                </div>
                <div className="rcp-step-tools">
                  {!src && stepPictures < MAX_STEP_IMAGES ? (
                    <button type="button" className="btn icon ghost" disabled={busyPicture} aria-label={t('recipes.form.step_picture_add', { n: si + 1 })} title={t('recipes.form.step_picture_add', { n: si + 1 })} onClick={() => { stepFor.current = s.id; stepInput.current?.click(); }}><ImagePlus size={15} aria-hidden /></button>
                  ) : null}
                  <button type="button" className="btn icon ghost" disabled={si === 0} aria-label={t('recipes.form.step_up', { n: si + 1 })} title={t('recipes.form.step_up', { n: si + 1 })} onClick={() => moveStep(s.id, -1)}><ArrowUp size={15} aria-hidden /></button>
                  <button type="button" className="btn icon ghost" disabled={si === steps.length - 1} aria-label={t('recipes.form.step_down', { n: si + 1 })} title={t('recipes.form.step_down', { n: si + 1 })} onClick={() => moveStep(s.id, 1)}><ArrowDown size={15} aria-hidden /></button>
                  <button type="button" className="btn icon ghost" aria-label={t('recipes.form.step_remove', { n: si + 1 })} title={t('recipes.form.step_remove', { n: si + 1 })}
                    onClick={() => { touch(); setSteps((ss) => (ss.length > 1 ? ss.filter((x) => x.id !== s.id) : [emptyStep()])); }}><Trash2 size={14} aria-hidden /></button>
                </div>
              </li>
            );
          })}
        </ol>
        <button type="button" className="btn ghost rcp-small" disabled={steps.length >= MAX_STEPS} onClick={addStep}><Plus size={14} aria-hidden /> {t('recipes.form.step_add')}</button>
      </Section>

      {/* ---- the story, and tags ---- */}
      <Section title={t('recipes.notes')} hint={t('recipes.form.notes_hint')}>
        <textarea className="input" rows={4} value={notes} maxLength={MAX_NOTES} aria-label={t('recipes.notes')} placeholder={t('recipes.form.notes_ph')} onChange={(e) => { touch(); setNotes(e.target.value); }} />
      </Section>
      <Section title={t('recipes.tags')} hint={t('recipes.form.tags_hint')}>
        <div className="rcp-tags-edit">
          {tags.map((tag) => (
            <span className="rcp-tag" key={tag}>
              {tag}
              <button type="button" aria-label={t('recipes.form.tag_remove', { tag })} onClick={() => { touch(); setTags(tags.filter((x) => x !== tag)); }}><X size={12} aria-hidden /></button>
            </span>
          ))}
          {tags.length < MAX_TAGS ? (
            <input
              className="input" value={tagText} maxLength={MAX_TAG} placeholder={t('recipes.form.tag_ph')} aria-label={t('recipes.form.tag_add')} autoCapitalize="off" enterKeyHint="done"
              onChange={(e) => { if (e.target.value.includes(',')) addTags(e.target.value); else setTagText(e.target.value); }}
              onBlur={() => { if (tagText.trim()) addTags(tagText); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); if (tagText.trim()) addTags(tagText); }
                if (e.key === 'Backspace' && !tagText && tags.length) { touch(); setTags(tags.slice(0, -1)); }
              }}
            />
          ) : null}
        </div>
        {known.length && tags.length < MAX_TAGS ? (
          <div className="rcp-tags-known" role="group" aria-label={t('recipes.form.tags_known')}>
            {known.map((tag) => <button type="button" className="rcp-tag is-offer" key={tag} onClick={() => addTags(tag)}><Plus size={11} aria-hidden /> {tag}</button>)}
          </div>
        ) : null}
      </Section>

      {notice ? <Notice onDismiss={() => setNotice(null)}>{notice}</Notice> : null}
      {showProblem && problem ? <p role="alert" className="err">{problem}</p> : null}
      {save.isError ? <p role="alert" className="err">{errorText(save.error, t.locale) || t('recipes.form.failed')}</p> : null}
      <div className="rcp-form-actions">
        <button type="submit" className="btn primary" disabled={save.isPending || busyPicture}>
          <Check size={15} aria-hidden /> {save.isPending ? t('recipes.form.saving') : edit ? t('recipes.form.save_changes') : t('recipes.form.save')}
        </button>
        <button type="button" className="btn ghost" disabled={save.isPending} onClick={() => leave(onCancel)}>{t('common.cancel')}</button>
        {dirty && !save.isPending ? <span className="pp-unsaved" role="status">{t('draft.unsaved')}</span> : null}
      </div>
    </form>
  );
}

function Section({ title, hint, tools, children }: { title: string; hint?: string; tools?: ReactNode; children: ReactNode }) {
  return (
    <section className="rcp-form-section">
      <header>
        <h3>{title}</h3>
        {tools}
      </header>
      {hint ? <p className="rcp-hint">{hint}</p> : null}
      {children}
    </section>
  );
}

/** A length of time as hours and minutes: two small boxes, either of which may stay empty. */
function Duration({ label, value, onChange }: { label: string; value: { h: string; m: string }; onChange: (v: { h: string; m: string }) => void }) {
  const t = useT();
  const digits = (s: string) => s.replace(/[^\d]/g, '').slice(0, 3);
  return (
    <fieldset className="rcp-fact rcp-duration">
      <legend>{label}</legend>
      <label><input className="input" inputMode="numeric" value={value.h} placeholder="0" aria-label={t('recipes.form.hours_of', { what: label })} onChange={(e) => onChange({ ...value, h: digits(e.target.value) })} /><span aria-hidden>{HOURS}</span></label>
      <label><input className="input" inputMode="numeric" value={value.m} placeholder="0" aria-label={t('recipes.form.minutes_of', { what: label })} onChange={(e) => onChange({ ...value, m: digits(e.target.value) })} /><span aria-hidden>{MINUTES}</span></label>
    </fieldset>
  );
}
