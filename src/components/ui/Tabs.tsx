// Tabs: tablist, tab and tabpanel with arrow keys (automatic activation).
//
// Usage:
//   <Tabs value={tab} onChange={setTab} label="Person">        // or defaultValue="about" uncontrolled
//     <TabList>
//       <Tab value="about">About</Tab>
//       <Tab value="stories" badge={3} icon={<BookOpen size={14} />}>Stories</Tab>
//     </TabList>
//     <TabPanel value="about">…</TabPanel>
//     <TabPanel value="stories">…</TabPanel>
//   </Tabs>
//
// ←/→ (↑/↓ when vertical) move and select, Home/End jump. Only the selected tab is in the Tab order.
// Panels for other tabs are not rendered unless `keepMounted`.
import { createContext, useContext, useId, useRef, useState, type ReactNode } from 'react';
import './ui.css';

interface Ctx { value: string; select: (v: string) => void; base: string; vertical: boolean; label?: string }
const TabsCtx = createContext<Ctx | null>(null);
const useTabs = () => {
  const c = useContext(TabsCtx);
  if (!c) throw new Error('Tab, TabList and TabPanel must be inside <Tabs>');
  return c;
};
const key = (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, '_');

export interface TabsProps {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** The tablist's accessible name. */
  label?: string;
  orientation?: 'horizontal' | 'vertical';
  children: ReactNode;
}

export function Tabs({ value, defaultValue, onChange, label, orientation = 'horizontal', children }: TabsProps) {
  const [inner, setInner] = useState(defaultValue ?? '');
  const base = useId();
  const current = value ?? inner;
  const select = (v: string) => { if (value === undefined) setInner(v); onChange?.(v); };
  return <TabsCtx.Provider value={{ value: current, select, base, vertical: orientation === 'vertical', label }}>{children}</TabsCtx.Provider>;
}

export function TabList({ children, className = '', 'aria-label': ariaLabel }: { children: ReactNode; className?: string; 'aria-label'?: string }) {
  const { vertical, label } = useTabs();
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const prev = vertical ? 'ArrowUp' : 'ArrowLeft';
    const next = vertical ? 'ArrowDown' : 'ArrowRight';
    if (![prev, next, 'Home', 'End'].includes(e.key)) return;
    const tabs = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])') ?? [])];
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (!tabs.length) return;
    e.preventDefault();
    e.stopPropagation();
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === next ? 1 : -1) + tabs.length) % tabs.length;
    tabs[j].focus();
    tabs[j].click();
  };
  return (
    <div ref={ref} role="tablist" aria-label={ariaLabel ?? label} aria-orientation={vertical ? 'vertical' : undefined} className={`ui-tablist ${className}`} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

export function Tab({ value, children, icon, badge, disabled, className = '', title, tour }: { value: string; children: ReactNode; icon?: ReactNode; badge?: ReactNode; disabled?: boolean; className?: string; title?: string; /** A name the guided tour can point at (`data-tour`). */ tour?: string }) {
  const { value: current, select, base } = useTabs();
  const on = current === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${base}-t-${key(value)}`}
      aria-selected={on}
      aria-controls={`${base}-p-${key(value)}`}
      tabIndex={on ? 0 : -1}
      disabled={disabled}
      title={title}
      className={`ui-tab ${className}`}
      data-tour={tour}
      onClick={() => select(value)}
    >
      {icon}
      {children}
      {badge !== undefined && badge !== null && badge !== 0 && <span className="ui-tab-badge">{badge}</span>}
    </button>
  );
}

export function TabPanel({ value, children, className = '', keepMounted, tour }: { value: string; children: ReactNode; className?: string; keepMounted?: boolean; /** A name the guided tour can point at (`data-tour`), there only while the panel is open. */ tour?: string }) {
  const { value: current, base } = useTabs();
  const on = current === value;
  if (!on && !keepMounted) return null;
  return (
    <div role="tabpanel" id={`${base}-p-${key(value)}`} aria-labelledby={`${base}-t-${key(value)}`} hidden={!on} tabIndex={0} className={`ui-tabpanel ${className}`} data-tour={on ? tour : undefined}>
      {children}
    </div>
  );
}
