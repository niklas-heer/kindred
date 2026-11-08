import { X } from 'lucide-react';
import { useFamily, useTreeId } from '~/lib/family';
import { useT } from '~/lib/i18n';
import { dismiss, pauseToast, resumeToast, useToasts } from '~/lib/toast';
import { GameIcon } from './GameIcon';
import { Portrait } from './Portrait';
import './toasts.css';

export function Toasts() {
  const t = useT();
  const list = useToasts();
  const f = useFamily();
  const tree = useTreeId();
  return (
    <div className="toasts" aria-live="polite">
      {list.map((toast) => {
        const p = toast.person ? f.byId.get(toast.person) : undefined;
        return (
          <div
            key={toast.id}
            className="toast panel"
            // Held while the reader hovers or focuses it; an Undo never times out (see lib/toast.ts).
            onMouseEnter={() => pauseToast(toast.id)}
            onMouseLeave={() => resumeToast(toast.id)}
            onFocus={() => pauseToast(toast.id)}
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resumeToast(toast.id); }}
          >
            {p ? <Portrait person={p} tree={tree} size={52} /> : toast.icon ? <span className="toast-icon"><GameIcon name={toast.icon} size={28} /></span> : null}
            <div className="toast-text">
              <b className="display">{toast.icon && p && <GameIcon name={toast.icon} size={15} />} {toast.title}</b>
              {toast.body && <span>{toast.body}</span>}
              {toast.action && (
                <button className="btn primary" onClick={() => { toast.action!.run(); dismiss(toast.id); }}>{toast.action.label}</button>
              )}
            </div>
            <button className="btn icon ghost toast-close" onClick={() => dismiss(toast.id)} aria-label={t('ui.dismiss')}><X size={14} /></button>
          </div>
        );
      })}
    </div>
  );
}
