// First visit to a tree: "Who are you in this family?", then an optional three-step tour.
// The answer is the `me:<tree>` preference (a person id, or BROWSING); the tour is remembered
// once seen or skipped (`tour`). Until the reader answers, kinship labels stay hidden.
import { MousePointerClick, Search, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BROWSING, useFamily, useMeAnswered, useTreeId } from '~/lib/family';
import { children, displayName, lifespan, parents, partnersOf, siblings } from '~/lib/graph';
import { setPref, usePref } from '~/lib/prefs';
import { searchPeople } from './Palette';
import { Portrait } from './Portrait';
import { Dialog } from './ui/Dialog';
import './firstrun.css';

const STEPS: { title: string; art: ReactNode; body: ReactNode }[] = [
  {
    title: 'Select, then centre',
    art: <MousePointerClick size={38} />,
    body: <>A <b>click</b> shows someone in the side panel and leaves the tree where it is. <b>Double-click</b>, or press <kbd>↵</kbd>, to centre the tree on them.</>,
  },
  {
    title: 'Add with the + marks',
    art: <UserPlus size={38} />,
    body: <>Dashed <b>+</b> marks surround the selected card: a parent above, a child below, a partner to the right, a sibling to the left. Only a name is needed.</>,
  },
  {
    title: 'Find anyone',
    art: <Search size={38} />,
    body: <>Press <kbd>⌘K</kbd> or <kbd>/</kbd> and type a name, nickname, title or house. It also switches views and themes.</>,
  },
];

export function reopenTour() { window.dispatchEvent(new Event('kindred:reopen-tour')); }

export function FirstRun() {
  const f = useFamily();
  const tree = useTreeId();
  const answered = useMeAnswered();
  const tourSeen = usePref('tour') !== null;
  // Closing without answering only defers the question to the next visit.
  const [later, setLater] = useState(false);
  const [touring, setTouring] = useState(false);
  const [step, setStep] = useState(0);
  useEffect(() => { const reopen = () => { setStep(0); setTouring(true); }; window.addEventListener('kindred:reopen-tour', reopen); return () => window.removeEventListener('kindred:reopen-tour', reopen); }, []);

  const choose = (id: string) => {
    setPref(`me:${tree}`, id);
    if (!tourSeen) setTouring(true);
  };
  const endTour = () => {
    setPref('tour', 'seen');
    setTouring(false);
  };

  if (touring) {
    const s = STEPS[step];
    const last = step === STEPS.length - 1;
    return (
      <Dialog
        open
        onClose={endTour}
        variant="event"
        width={460}
        title={s.title}
        footer={
          <>
            <span className="tour-dots" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
              {STEPS.map((_, i) => <i key={i} data-on={i === step || undefined} />)}
            </span>
            {!last && <button className="btn ghost" onClick={endTour}>Skip tour</button>}
            {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>Back</button>}
            <button className="btn primary" data-autofocus onClick={() => (last ? endTour() : setStep(step + 1))}>{last ? 'Start exploring' : 'Next'}</button>
          </>
        }
      >
        <div className="tour" key={step}>
          <span className="tour-art" aria-hidden>{s.art}</span>
          <p>{s.body}</p>
        </div>
      </Dialog>
    );
  }

  return <WhoAreYou open={!answered && !later} onChoose={choose} onLater={() => setLater(true)} familyName={f.graph.tree.name} />;
}

function WhoAreYou({ open, onChoose, onLater, familyName }: { open: boolean; onChoose: (id: string) => void; onLater: () => void; familyName: string }) {
  const f = useFamily();
  const tree = useTreeId();
  const [q, setQ] = useState('');
  const results = useMemo(() => searchPeople(f, q, 8).map((r) => r.id), [f, q]);
  // Before any typing: the living people around the tree's starting point, a likely "you".
  const suggested = useMemo(() => {
    const c = f.graph.tree.focus;
    const near = [c, ...partnersOf(f, c), ...children(f, c), ...siblings(f, c), ...parents(f, c)];
    return [...new Set(near)].filter((id) => f.byId.get(id)?.living).slice(0, 6);
  }, [f]);
  const list = q.trim() ? results : suggested;

  return (
    <Dialog
      open={open}
      onClose={onLater}
      variant="event"
      width={520}
      title="Who are you in this family?"
      description={<>Kindred names everyone in <b>{familyName}</b> from your point of view: “your great-aunt”, “your second cousin”.</>}
      footer={
        <div className="who-foot">
          <p>You can change this any time with “This is me” on someone’s card.</p>
          <button className="btn" onClick={() => onChoose(BROWSING)}>Just browsing</button>
        </div>
      }
    >
      <div className="who-search">
        <Search size={16} />
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) { e.preventDefault(); onChoose(list[0]); } }}
          placeholder="Your name…"
          aria-label="Search for yourself by name"
          aria-controls="who-list"
        />
      </div>
      <div className="who-label">{q.trim() ? 'Matches' : 'Perhaps you are…'}</div>
      <ul className="who-list" id="who-list" aria-live="polite">
        {list.length === 0 && <li className="who-empty">Nobody by that name yet. Try a nickname, or browse for now.</li>}
        {list.map((id) => {
          const p = f.byId.get(id)!;
          return (
            <li key={id}>
              <button className="who-item" onClick={() => onChoose(id)}>
                <Portrait person={p} tree={tree} size={38} frame={false} />
                <div>
                  <b>{displayName(p, f)}</b>
                  <span>{lifespan(p) || (p.living ? 'living' : '')}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
