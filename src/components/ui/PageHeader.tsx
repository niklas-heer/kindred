// PageHeader: a page's title block. Cinzel and centred under a fleuron rule in Codex; left-aligned
// with actions on the right in Paper and Night. On a phone the header is compact: actions that are all buttons with
// an icon go on the title's row. Secondary ones become icon buttons (their words stay as the accessible name); the
// page's main action keeps its words: a `.btn.primary`, or any button marked `data-keep-label`.
//
// Usage:
//   <PageHeader title="Almanac" subtitle="Birthdays, anniversaries and memorial days"
//     icon={<CalendarHeart size={26} />} actions={<button className="btn">Export .ics</button>} />
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import './ui.css';

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Buttons or links; they wrap under the title on narrow screens. */
  actions?: ReactNode;
  /** A small mark before the title. */
  icon?: ReactNode;
  className?: string;
  /** Heading id, e.g. for aria-labelledby on the page's main region. */
  id?: string;
}

export function PageHeader({ title, subtitle, actions, icon, className = '', id }: PageHeaderProps) {
  // "Only icon buttons" can't be said in CSS (:has() does not nest), so the header is marked here, after every render.
  const header = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = header.current;
    const kids = [...(el?.querySelector('.ui-page-header-actions')?.children ?? [])];
    const icons = kids.length > 0 && kids.every((k) => k.classList.contains('btn') && !!k.querySelector('svg'));
    if (icons) { el?.setAttribute('data-icon-actions', String(kids.length)); el?.style.setProperty('--ph-icons', String(kids.length)); }
    else { el?.removeAttribute('data-icon-actions'); el?.style.removeProperty('--ph-icons'); }
    // A main action keeps its words on a phone, and the header lays itself out for a wide button.
    el?.toggleAttribute('data-worded-action', icons && kids.some((k) => k.matches('.primary, [data-keep-label]')));
  });
  return (
    <header ref={header} className={`ui-page-header ${className}`}>
      <div className="ui-page-header-text">
        <h1 id={id}>
          {icon && <span className="ui-page-header-icon" aria-hidden>{icon}</span>}
          {title}
        </h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="ui-page-header-rule" aria-hidden>
        <Fleuron />
      </div>
      {actions && <div className="ui-page-header-actions">{actions}</div>}
    </header>
  );
}

/** A small heraldic ornament: a lozenge between two leaves. */
export function Fleuron({ size = 22 }: { size?: number }) {
  return (
    <svg width={size * 2} height={size / 2} viewBox="0 0 44 11" fill="currentColor" aria-hidden>
      <path d="M22 0.5 L26 5.5 L22 10.5 L18 5.5 Z" />
      <path d="M16 5.5 C12.5 1.5 7 1.5 3 5.5 C7 9.5 12.5 9.5 16 5.5 Z" opacity="0.75" />
      <path d="M28 5.5 C31.5 1.5 37 1.5 41 5.5 C37 9.5 31.5 9.5 28 5.5 Z" opacity="0.75" />
    </svg>
  );
}
