import { errorText } from '~/lib/errortext';
import { useT } from '~/lib/i18n';
// Loading, empty, error and not-found states, so no screen is ever blank or shows a developer hint.
//
// Usage:
//   <Skeleton width={220} height={18} />                 // one bar, appears after 300 ms
//   <Skeleton lines={3} />                               // a paragraph of bars
//   <PageSkeleton />                                     // a whole page (the router's pending view)
//   <EmptyState icon={<CalendarHeart size={28} />} title="No birthdays this month"
//     text="Add a birthday from anyone's panel." action={<button className="btn primary">Add</button>} />
//   <ErrorState message="The tree could not be loaded." onRetry={() => refetch()} error={err} />
//   <NotFound title="Family not found" text="…">{links}</NotFound>
//   <Notice onDismiss={…}>That person isn't in this tree</Notice>
import { AlertTriangle, Compass, Info, RotateCcw, X } from 'lucide-react';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import './ui.css';

/** True once `ms` have passed: quick loads never flash a placeholder. */
export function useDelayed(ms = 300): boolean {
  const [on, setOn] = useState(ms <= 0);
  useEffect(() => {
    if (ms <= 0) return;
    const t = setTimeout(() => setOn(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return on;
}

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  /** Border radius; `'50%'` for a portrait. */
  radius?: number | string;
  /** Render this many text-like bars instead of one block (the last one shorter). */
  lines?: number;
  /** Wait this long before showing anything. Default 300 ms. */
  delay?: number;
  className?: string;
  style?: CSSProperties;
}

export function Skeleton({ width, height = 14, radius, lines, delay = 300, className = '', style }: SkeletonProps) {
  const shown = useDelayed(delay);
  if (!shown) return <span aria-hidden className={className} style={{ display: 'block', width, height: lines ? undefined : height, ...style }} />;
  if (lines) {
    return (
      <span className={`ui-skel-lines ${className}`} aria-hidden style={{ width, ...style }}>
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="ui-skel" style={{ height, borderRadius: radius, width: i === lines - 1 && lines > 1 ? '62%' : '100%' }} />
        ))}
      </span>
    );
  }
  return <span aria-hidden className={`ui-skel ${className}`} style={{ width, height, borderRadius: radius, ...style }} />;
}

/** A page-shaped placeholder: a title, a line, and a few rows. Used as the router's pending view. */
export function PageSkeleton({ delay = 300 }: { delay?: number }) {
  const t = useT();
  const shown = useDelayed(delay);
  return (
    <div className="page" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("ui.loading")}</span>
      {shown && (
        <div className="ui-skel-page">
          <Skeleton delay={0} width="min(320px, 70%)" height={34} style={{ justifySelf: 'center' }} />
          <Skeleton delay={0} width="min(460px, 90%)" height={16} style={{ justifySelf: 'center', marginBottom: 18 }} />
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} delay={0} height={56} radius="var(--radius-lg)" />
          ))}
        </div>
      )}
    </div>
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  text?: ReactNode;
  /** One or more buttons or links. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, text, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`ui-state ${className}`}>
      {icon && <span className="ui-state-icon" aria-hidden>{icon}</span>}
      <h2 className="ui-state-title">{title}</h2>
      {text && <p className="ui-state-text">{text}</p>}
      {action && <div className="ui-state-actions">{action}</div>}
    </div>
  );
}

export interface ErrorStateProps {
  title?: ReactNode;
  /** What went wrong, in words for the reader. */
  message?: ReactNode;
  /** Shows a Retry button. */
  onRetry?: () => void;
  /** The raw error; its message is shown small, for reporting. */
  error?: unknown;
  /** More actions next to Retry. */
  action?: ReactNode;
  className?: string;
}

export function ErrorState({ title, message, onRetry, error, action, className = '' }: ErrorStateProps) {
  const t = useT();
  const detail = error instanceof Error || typeof error === 'string' ? errorText(error, t.locale) : undefined;
  return (
    <div className={`ui-state error ${className}`} role="alert">
      <span className="ui-state-icon" aria-hidden><AlertTriangle size={28} /></span>
      <h2 className="ui-state-title">{title ?? t('ui.something_went_wrong')}</h2>
      {(message ?? t('ui.could_not_show')) && <p className="ui-state-text">{message ?? t('ui.could_not_show')}</p>}
      {(onRetry || action) && (
        <div className="ui-state-actions">
          {onRetry && <button className="btn primary" onClick={onRetry}><RotateCcw size={14} /> {t("ui.retry")}</button>}
          {action}
        </div>
      )}
      {detail && <code className="ui-state-detail">{detail}</code>}
    </div>
  );
}

export interface NotFoundProps {
  title?: ReactNode;
  text?: ReactNode;
  icon?: ReactNode;
  /** Links or buttons, e.g. a list of families. */
  children?: ReactNode;
  className?: string;
}

export function NotFound({ title, text, icon = <Compass size={28} />, children, className = '' }: NotFoundProps) {
  const t = useT();
  return (
    <div className={`ui-state ${className}`}>
      <span className="ui-state-icon" aria-hidden>{icon}</span>
      <h1 className="ui-state-title">{title ?? t('ui.nothing_here')}</h1>
      {(text ?? t('ui.page_missing')) && <p className="ui-state-text">{text ?? t('ui.page_missing')}</p>}
      {children}
    </div>
  );
}

/** A small notice line with an optional dismiss button. */
export function Notice({ children, onDismiss, icon = <Info size={15} />, className = '' }: { children: ReactNode; onDismiss?: () => void; icon?: ReactNode; className?: string }) {
  const t = useT();
  return (
    <div className={`ui-notice ${className}`} role="status">
      {icon}
      <span>{children}</span>
      {onDismiss && <button className="btn icon ghost" style={{ width: 26, height: 26 }} onClick={onDismiss} aria-label={t("ui.dismiss")}><X size={13} /></button>}
    </div>
  );
}
