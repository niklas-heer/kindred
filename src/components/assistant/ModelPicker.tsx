// A steward's choice of model: a compact control in the composer for the chat, and the same menu for asking one answer
// again on another model. Nobody else sees either, and the server refuses a choice from anyone else.
import { Check, ChevronDown, Star } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ModelChoice, ModelChoices } from '~/lib/ai/model-choice';
import { PROVIDER_LABEL, type Provider } from '~/lib/ai/types';
import { useT } from '~/lib/i18n';
import { isTopOverlay, useOverlayLayer } from '~/components/ui/overlay';

export interface PickedModel { provider: Provider; model: string }

/** A model's name in the reader's list, or its id when the list does not have it. */
export const modelName = (choices: ModelChoices | undefined, id: string) => choices?.models.find((m) => m.id === id)?.name ?? id;

/** The menu and its button. Closes on Esc (only this, not the window), on a click away, and when something is picked. */
function Menu({ className, label, button, children }: { className?: string; label: string; button: (o: { open: boolean; toggle: () => void; id: string }) => ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const layer = useOverlayLayer(open);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open && isTopOverlay(layer)) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      root.current?.querySelector('button')?.focus();
    }
  }
  return (
    <div className={`ai-pick ${className ?? ''}`} ref={root} onKeyDown={onKeyDown}>
      {button({ open, toggle: () => setOpen((o) => !o), id })}
      {open && <div className="ai-pick-pop" id={id} role="group" aria-label={label}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

function ModelList({ choices, current, familyRow, onPick }: { choices: ModelChoices; current: string | null; familyRow?: { active: boolean; onPick: () => void }; onPick: (m: ModelChoice) => void }) {
  const t = useT();
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    const words = filter.trim().toLowerCase();
    const models = words ? choices.models.filter((m) => `${m.name} ${m.id}`.toLowerCase().includes(words)) : choices.models;
    // A provider's whole catalogue can run to hundreds: the picks come first, and the rest follow the filter.
    return [...models].sort((a, b) => Number(b.recommended) - Number(a.recommended)).slice(0, words ? 60 : 30);
  }, [choices.models, filter]);
  const providers = [...new Set(shown.map((m) => m.provider))];
  return (
    <>
      {choices.models.length > 8 && <input className="ai-pick-filter" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('ai.modelFilter')} aria-label={t('ai.modelFilter')} autoFocus />}
      <div className="ai-pick-list">
        {familyRow && (
          <button type="button" className="ai-pick-row" aria-pressed={familyRow.active} onClick={familyRow.onPick}>
            <span className="ai-pick-name">{t('ai.modelFamily')}</span>
            {choices.familyDefault && <span className="ai-pick-meta subtle">{modelName(choices, choices.familyDefault.model)}</span>}
            {familyRow.active && <Check size={14} aria-hidden />}
          </button>
        )}
        {providers.map((p) => (
          <div key={p} className="ai-pick-group">
            {providers.length > 1 && <p className="ai-pick-head">{PROVIDER_LABEL[p]}</p>}
            {shown.filter((m) => m.provider === p).map((m) => (
              <button key={`${m.provider}:${m.id}`} type="button" className="ai-pick-row" aria-pressed={current === m.id} onClick={() => onPick(m)}>
                <span className="ai-pick-name">{m.name}</span>
                {m.recommended && <span className="ai-pick-star" title={t('ai.pickRecommended')}><Star size={12} aria-hidden /><span className="ai-sr">{t('ai.pickRecommended')}</span></span>}
                {m.cost && <span className="ai-pick-cost" title={t('ai.modelCost')}>{m.cost}</span>}
                {current === m.id && <Check size={14} aria-hidden />}
              </button>
            ))}
          </div>
        ))}
        {shown.length === 0 && <p className="ai-pick-none subtle">{t('ai.pickNone')}</p>}
      </div>
    </>
  );
}

/** The control in the composer: this chat's model. */
export function ModelPicker({ choices, override, onChange, disabled }: { choices: ModelChoices; override: { provider: string; model: string } | null; onChange: (m: PickedModel | null) => void; disabled?: boolean }) {
  const t = useT();
  const currentId = override?.model ?? choices.familyDefault?.model ?? null;
  const name = currentId ? modelName(choices, currentId) : t('ai.modelFamily');
  const cost = choices.models.find((m) => m.id === currentId)?.cost;
  return (
    <Menu
      className="ai-pick-composer"
      label={t('ai.modelChoose')}
      button={({ open, toggle, id }) => (
        <button type="button" className="btn ghost ai-touch ai-pick-button" onClick={toggle} disabled={disabled} aria-expanded={open} aria-controls={open ? id : undefined} title={t('ai.modelChoose')} aria-label={`${t('ai.modelChoose')}: ${name}`}>
          <span className="ai-pick-current">{name}</span>
          {cost && <span className="ai-pick-cost">{cost}</span>}
          <ChevronDown size={13} aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <ModelList
          choices={choices}
          current={override ? override.model : null}
          familyRow={{ active: !override, onPick: () => { onChange(null); close(); } }}
          onPick={(m) => { onChange({ provider: m.provider, model: m.id }); close(); }}
        />
      )}
    </Menu>
  );
}

/** "Or pick one": choosing a model to ask this question on. */
export function RetryModelMenu({ choices, onPick, label }: { choices: ModelChoices; onPick: (m: PickedModel) => void; label: string }) {
  return (
    <Menu
      className="ai-pick-retry"
      label={label}
      button={({ open, toggle, id }) => (
        <button type="button" className="ai-answer-link" onClick={toggle} aria-expanded={open} aria-controls={open ? id : undefined}>{label}</button>
      )}
    >
      {(close) => <ModelList choices={choices} current={null} onPick={(m) => { onPick({ provider: m.provider, model: m.id }); close(); }} />}
    </Menu>
  );
}
