// PageHeader: a page's title block. Cinzel and centred under a fleuron rule in Codex; left-aligned
// with actions on the right in Paper and Night.
//
// Usage:
//   <PageHeader title="Almanac" subtitle="Birthdays, anniversaries and memorial days"
//     icon={<CalendarHeart size={26} />} actions={<button className="btn">Export .ics</button>} />
import type { ReactNode } from 'react';
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
  return (
    <header className={`ui-page-header ${className}`}>
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
