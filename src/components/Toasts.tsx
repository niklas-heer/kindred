import { X } from 'lucide-react';
import { useFamily, useTreeId } from '~/lib/family';
import { dismiss, pauseToast, resumeToast, useToasts } from '~/lib/toast';
import { GameIcon } from './GameIcon';
import { Portrait } from './Portrait';
import './toasts.css';

export function Toasts() {
  const list = useToasts();
  const f = useFamily();
  const tree = useTreeId();
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => {
        const p = t.person ? f.byId.get(t.person) : undefined;
        return (
          <div
            key={t.id}
            className="toast panel"
            // Held while the reader hovers or focuses it; an Undo never times out (see lib/toast.ts).
            onMouseEnter={() => pauseToast(t.id)}
            onMouseLeave={() => resumeToast(t.id)}
            onFocus={() => pauseToast(t.id)}
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resumeToast(t.id); }}
          >
            {p ? <Portrait person={p} tree={tree} size={52} /> : t.icon ? <span className="toast-icon"><GameIcon name={t.icon} size={28} /></span> : null}
            <div className="toast-text">
              <b className="display">{t.icon && p && <GameIcon name={t.icon} size={15} />} {t.title}</b>
              {t.body && <span>{t.body}</span>}
              {t.action && (
                <button className="btn primary" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>
              )}
            </div>
            <button className="btn icon ghost toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss"><X size={14} /></button>
          </div>
        );
      })}
    </div>
  );
}
