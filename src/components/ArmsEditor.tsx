// The arms editor: a coat-of-arms designer in the manner of CK3's. A large live shield, then pickers for
// the field, the division, the second tincture, the charge and its tincture, plus the house's name and
// motto. Randomise keeps the rule of tincture; breaking it by hand is allowed, with a gentle warning.
//
// Usage (only for readers who may edit houses):
//   {canEdit && <ArmsEditor open={open} onClose={() => setOpen(false)} house={house} tree={tree} />}
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dices, Info, RotateCcw, Undo2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { graphQuery, updateHouse } from '~/lib/api';
import { myFamiliesQuery } from '~/lib/auth/functions';
import { useCan } from '~/lib/session';
import type { Tincture } from '~/lib/seed-format';
import { play } from '~/lib/sfx';
import { toast } from '~/lib/toast';
import type { House } from '~/lib/types';
import { CHARGE_ICONS } from './charges.gen';
import {
  Arms, CHARGE_NAME, CHARGES, DIVISIONS, TINCTURE_HEX, TINCTURES, isMetal, randomArms, secondOf, tinctureClashes, tinctureLabel,
} from './Heraldry';
import { Dialog } from './ui/Dialog';
import './armseditor.css';

type ArmsT = House['arms'];
interface Draft {
  name: string;
  motto: string;
  arms: ArmsT;
}

const draftOf = (h: House): Draft => ({ name: h.name, motto: h.motto ?? '', arms: { ...h.arms } });
const sameArms = (a: ArmsT, b: ArmsT) =>
  a.field === b.field && a.division === b.division && a.charge === b.charge && a.chargeTincture === b.chargeTincture &&
  (a.division === 'plain' || secondOf(a) === secondOf(b));
const same = (a: Draft, b: Draft) => a.name.trim() === b.name.trim() && a.motto.trim() === b.motto.trim() && sameArms(a.arms, b.arms);

/** The draft plus an undo stack. Typing in one text field counts as a single step. */
function useHistory(initial: Draft) {
  const [state, setState] = useState<{ now: Draft; past: Draft[]; key?: string }>({ now: initial, past: [] });
  return {
    draft: state.now,
    canUndo: state.past.length > 0,
    set(next: Draft, key?: string) {
      setState((s) => (same(s.now, next) && !key ? s : { now: next, past: key && key === s.key ? s.past : [...s.past.slice(-49), s.now], key }));
    },
    undo() {
      setState((s) => (s.past.length ? { now: s.past[s.past.length - 1], past: s.past.slice(0, -1) } : s));
    },
    restart(d: Draft) {
      setState({ now: d, past: [] });
    },
  };
}

export function ArmsEditor({ open, onClose, house, tree }: { open: boolean; onClose: () => void; house: House; tree: string }) {
  const qc = useQueryClient();
  // Only a steward may change a house; the server refuses anyone else too.
  const allowed = useCan('edit-house');
  const saved = draftOf(house);
  const h = useHistory(saved);
  const { draft } = h;
  const a = draft.arms;

  // Each opening starts from the arms as they are now.
  useEffect(() => {
    if (open) {
      h.restart(draftOf(house));
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = useMutation({
    mutationFn: (d: Draft) =>
      updateHouse({ data: { tree, id: house.id, name: d.name.trim(), motto: d.motto.trim() || null, arms: d.arms } }),
    onSuccess: async (h2) => {
      // Every shield in the app reads the graph, so they all change together.
      await Promise.all([qc.invalidateQueries({ queryKey: graphQuery(tree).queryKey }), qc.invalidateQueries({ queryKey: myFamiliesQuery.queryKey })]);
      play('seal');
      toast({ title: 'Arms sealed', body: `${h2.name} bears its new arms.`, icon: 'crown' });
      onClose();
    },
  });

  const dirty = !same(draft, saved);
  const nameOk = draft.name.trim().length > 0;
  const setArms = (patch: Partial<ArmsT>) => {
    const next = { ...a, ...patch };
    // Keep the second tincture explicit once a division needs it, so what you see is what is saved.
    if (next.division !== 'plain' && !next.field2) next.field2 = secondOf(a);
    h.set({ ...draft, arms: next });
  };
  const clashes = tinctureClashes(a);
  const divided = a.division !== 'plain';
  const charged = a.charge !== 'none';

  const onKeyDown = (e: KeyboardEvent) => {
    // ⌘Z / Ctrl+Z undoes a pick; inside a text field it stays the field's own undo.
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !(e.target as HTMLElement).closest('input, textarea')) {
      e.preventDefault();
      h.undo();
    }
  };

  if (!allowed) return null;
  return (
    <Dialog
      open={open}
      onClose={() => { if (!save.isPending) onClose(); }}
      title="Coat of arms"
      description={<>Design the arms of <b>{saved.name}</b>. Every shield in the family changes when you seal them.</>}
      variant="event"
      width={980}
      dirty={dirty}
      dismissible={!save.isPending}
      initialFocus=".ae-pickers [role='radio'][tabindex='0']"
      className="ae-dialog"
      bodyClassName="ae-body"
      onKeyDown={onKeyDown}
      footer={
        <div className="ae-foot">
          <div className="ae-tools">
            <button type="button" className="btn" onClick={() => { h.set({ ...draft, arms: randomArms() }); play('tick'); }}>
              <Dices size={16} /> Randomise
            </button>
            <button type="button" className="btn ghost" onClick={h.undo} disabled={!h.canUndo} aria-keyshortcuts="Meta+Z Control+Z">
              <Undo2 size={16} /> Undo
            </button>
            <button type="button" className="btn ghost" onClick={() => h.set(draftOf(house))} disabled={!dirty}>
              <RotateCcw size={16} /> Reset
            </button>
          </div>
          {save.isError && (
            <p className="ae-error" role="alert">
              {save.error instanceof Error && save.error.message ? save.error.message : 'The arms could not be saved.'} Your design is still here; try again.
            </p>
          )}
          <div className="ae-actions">
            <button type="button" className="btn" onClick={onClose} disabled={save.isPending}>Cancel</button>
            <button type="button" className="btn primary" onClick={() => save.mutate(draft)} disabled={!dirty || !nameOk || save.isPending}>
              {save.isPending ? 'Sealing…' : 'Seal the arms'}
            </button>
          </div>
        </div>
      }
    >
      <div className="ae-grid">
        <div className="ae-preview">
          <div className="ae-stage" aria-hidden>
            <Arms arms={a} size={228} />
          </div>
          <div className="ae-caption">
            <b className="ae-name">{draft.name.trim() || 'Unnamed house'}</b>
            {draft.motto.trim() && <i className="ae-motto">“{draft.motto.trim()}”</i>}
            <span className="ae-blazon">{blazon(a)}</span>
          </div>
          <div className="ae-rule" aria-live="polite">
            {clashes.length > 0 && (
              <p className="ae-warn">
                <Info size={16} aria-hidden />
                <span>
                  {clashes.join(' ')} Heralds keep metal off metal and colour off colour so arms read from afar. You may keep it.
                </span>
              </p>
            )}
          </div>
        </div>

        <div className="ae-pickers">
          <div className="ae-texts">
            <label className="field">
              <span>House name</span>
              <input
                className="input" value={draft.name} maxLength={80} required aria-invalid={!nameOk || undefined}
                onChange={(e) => h.set({ ...draft, name: e.target.value }, 'name')}
              />
            </label>
            <label className="field">
              <span>Motto</span>
              <input
                className="input" value={draft.motto} maxLength={160} placeholder="Words to live by"
                onChange={(e) => h.set({ ...draft, motto: e.target.value }, 'motto')}
              />
            </label>
          </div>

          <Section title="Field">
            <TincturePicker label="Field tincture" value={a.field} onChange={(field) => setArms({ field })} />
          </Section>

          <Section title="Division">
            <Choices
              label="Division"
              className="ae-divisions"
              value={a.division}
              onChange={(division) => setArms({ division })}
              options={DIVISIONS.map((d) => ({ value: d.id, label: d.label }))}
              render={(o) => (
                <>
                  <Arms arms={{ ...a, division: o.value, charge: 'none', field2: secondOf(a) }} size={38} />
                  <small>{o.label}</small>
                </>
              )}
            />
          </Section>

          <Section title="Second tincture" note={divided ? undefined : 'A plain field has only one.'}>
            <TincturePicker label="Second tincture" value={secondOf(a)} disabled={!divided} onChange={(field2) => setArms({ field2 })} />
          </Section>

          <Section title="Charge">
            <Choices
              label="Charge"
              className="ae-charges"
              value={a.charge}
              onChange={(charge) => setArms({ charge })}
              options={CHARGES.map((c) => ({ value: c.id, label: c.label }))}
              render={(o) =>
                o.value === 'none' ? (
                  <span className="ae-none" aria-hidden>
                    <svg width="30" height="30" viewBox="0 0 30 30"><circle cx="15" cy="15" r="11" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M7 23L23 7" stroke="currentColor" strokeWidth="1.6" /></svg>
                  </span>
                ) : (
                  <ChargeGlyph name={o.value} />
                )
              }
            />
          </Section>

          <Section title="Charge tincture" note={charged ? undefined : 'Pick a charge first.'}>
            <TincturePicker label="Charge tincture" value={a.chargeTincture} disabled={!charged} onChange={(chargeTincture) => setArms({ chargeTincture })} />
          </Section>
        </div>
      </div>
    </Dialog>
  );
}

/** "Quarterly or and azure, a lion gules": the arms in words, for the reader and for screen readers. */
export function blazon(a: ArmsT): string {
  const t = (x: Tincture) => tinctureLabel(x).toLowerCase();
  const div = DIVISIONS.find((d) => d.id === a.division);
  const field =
    a.division === 'plain' ? tinctureLabel(a.field)
      : div?.ordinary ? `${tinctureLabel(a.field)}, a ${div.label.toLowerCase()} ${t(secondOf(a))}`
        : `${div?.label} ${t(a.field)} and ${t(secondOf(a))}`;
  if (a.charge === 'none') return field;
  const charge = CHARGES.find((c) => c.id === a.charge)?.label.toLowerCase();
  return `${field}, ${div?.ordinary ? 'over all ' : ''}a ${charge} ${t(a.chargeTincture)}`;
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="ae-section">
      <h3 className="ae-h">
        {title}
        {note && <small className="subtle"> · {note}</small>}
      </h3>
      {children}
    </section>
  );
}

function ChargeGlyph({ name }: { name: Exclude<ArmsT['charge'], 'none'> }) {
  const icon = CHARGE_ICONS[CHARGE_NAME[name]];
  return (
    <svg width="34" height="34" viewBox={icon.viewBox} aria-hidden>
      <g dangerouslySetInnerHTML={{ __html: icon.body }} />
    </svg>
  );
}

function TincturePicker({ label, value, onChange, disabled }: { label: string; value: Tincture; onChange: (t: Tincture) => void; disabled?: boolean }) {
  return (
    <Choices
      label={label}
      className="ae-tinctures"
      value={value}
      onChange={onChange}
      disabled={disabled}
      options={TINCTURES.map((t) => ({ value: t.id, label: `${t.label} (${t.plain})`, group: isMetal(t.id) ? 'metal' : 'colour' }))}
      render={(o) => (
        <>
          <span className="ae-swatch" data-tincture={o.value} style={{ background: TINCTURE_HEX[o.value] }} aria-hidden />
          <small>{TINCTURES.find((t) => t.id === o.value)?.label}</small>
        </>
      )}
    />
  );
}

interface Choice<V> {
  value: V;
  label: string;
  group?: string;
}

/**
 * A radio group of tiles with a roving tab stop: Tab enters at the chosen tile, the arrow keys move
 * and choose, Home and End jump to the ends. Each tile is labelled for screen readers.
 */
function Choices<V extends string>({
  label, value, onChange, options, render, className = '', disabled,
}: {
  label: string;
  value: V;
  onChange: (v: V) => void;
  options: Choice<V>[];
  render: (o: Choice<V>) => ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const at = Math.max(0, options.findIndex((o) => o.value === value));
  const move = (e: KeyboardEvent, i: number) => {
    const n = options.length;
    const to =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % n
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + n) % n
          : e.key === 'Home' ? 0
            : e.key === 'End' ? n - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    refs.current[to]?.focus();
    onChange(options[to].value);
  };
  return (
    <div role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} className={`ae-choices ${className}`} id={id}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.label}
          title={o.label}
          data-group={o.group}
          data-group-start={(o.group && i > 0 && options[i - 1].group !== o.group) || undefined}
          tabIndex={i === at ? 0 : -1}
          disabled={disabled}
          className="ae-tile"
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => move(e, i)}
        >
          {render(o)}
        </button>
      ))}
    </div>
  );
}
