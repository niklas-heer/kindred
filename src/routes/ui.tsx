// /ui: the design system on one page, in the current theme. A reference for building screens, not a
// feature; ?theme=codex|modern|night previews a theme without changing the reader's choice.
import { createFileRoute } from '@tanstack/react-router';
import { BookOpen, CalendarHeart, Feather, Inbox, Shield } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import {
  Dialog, EmptyState, ErrorState, Notice, PageHeader, Range, Select, Skeleton, Switch, Tab, TabList, TabPanel, Tabs,
} from '~/components/ui';
import { THEMES } from '~/lib/prefs';

export const Route = createFileRoute('/ui')({
  validateSearch: z.object({ theme: z.enum(['codex', 'modern', 'night']).optional() }),
  head: () => ({ meta: [{ title: 'Design system · Kindred' }] }),
  component: Gallery,
});

const swatch = (c: string) => <span style={{ width: 14, height: 14, borderRadius: 3, background: c, boxShadow: 'inset 0 0 0 1px #0004' }} />;

function Gallery() {
  const { theme } = Route.useSearch();
  useEffect(() => { if (theme) document.documentElement.dataset.theme = theme; }, [theme]);
  const [house, setHouse] = useState('valcourt');
  const [on, setOn] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [year, setYear] = useState(1040);
  const [tab, setTab] = useState('about');
  const [dialog, setDialog] = useState<null | 'event' | 'plain'>(null);
  const [text, setText] = useState('');
  return (
    <div className="page" style={{ height: '100vh' }}>
      <div className="page-inner">
        <PageHeader
          title="The Almanac"
          subtitle="Birthdays, anniversaries and memorial days, nearest first."
          icon={<CalendarHeart size={26} />}
          actions={<>{THEMES.map((t) => <a key={t.id} className="btn" href={`?theme=${t.id}`} aria-pressed={(theme ?? 'codex') === t.id}>{t.label}</a>)}</>}
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18 }}>
          <section className="ui-card" style={{ display: 'grid', gap: 14 }}>
            <h2 className="rule" style={{ margin: 0 }}>Controls</h2>
            <Select
              aria-label="House"
              value={house}
              onChange={setHouse}
              options={[
                { value: 'valcourt', label: 'House Valcourt', hint: 412, icon: swatch('#7a2430'), group: 'Great houses' },
                { value: 'aurel', label: 'House Aurel', hint: 388, icon: swatch('#24427a'), group: 'Great houses' },
                { value: 'thorne', label: 'House Thorne', hint: 96, icon: swatch('#2f5d34'), group: 'Lesser houses' },
                { value: 'mire', label: 'House Mire', hint: 12, icon: swatch('#6b5a2a'), group: 'Lesser houses', disabled: true },
              ]}
            />
            <Select size="sm" aria-label="Lens" value="none" onChange={() => {}} options={[{ value: 'none', label: 'Everyone' }, { value: 'living', label: 'Living people' }]} />
            <Switch checked={on} onChange={setOn}>Still living</Switch>
            <Switch checked={!on} onChange={(v) => setOn(!v)} size="sm">Small switch</Switch>
            <Range aria-label="Replay speed" value={speed} onChange={setSpeed} min={0.5} max={4} step={0.5}
              ticks={[{ value: 0.5, label: '½×' }, { value: 1, label: '1×' }, { value: 2, label: '2×' }, { value: 4, label: '4×' }]} format={(v) => `${v}×`} />
            <Range aria-label="Year" value={year} onChange={setYear} min={880} max={1210} ticks={4} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn primary" onClick={() => setDialog('event')}>Event dialog</button>
              <button className="btn" onClick={() => setDialog('plain')}>Plain dialog</button>
              <button className="btn ghost"><Shield size={15} /> Ghost</button>
            </div>
            <p style={{ margin: 0 }}>Body text, <span className="muted">muted secondary text</span>, <span className="subtle">subtle tertiary text</span>.</p>
          </section>
          <section className="ui-card">
            <Tabs value={tab} onChange={setTab} label="Person">
              <TabList>
                <Tab value="about">About</Tab>
                <Tab value="stories" badge={3} icon={<BookOpen size={14} />}>Stories</Tab>
                <Tab value="edit">Edit</Tab>
              </TabList>
              <TabPanel value="about"><p className="muted">Born 1988 in Uppsala. Carpenter.</p></TabPanel>
              <TabPanel value="stories"><p className="muted">Three stories.</p></TabPanel>
              <TabPanel value="edit"><p className="muted">The editor.</p></TabPanel>
            </Tabs>
            <h2 className="rule">Loading</h2>
            <Skeleton lines={3} />
            <div style={{ marginTop: 14 }}><Notice onDismiss={() => {}}>That person isn’t in this tree</Notice></div>
          </section>
          <section className="ui-card"><EmptyState icon={<Inbox size={28} />} title="No stories yet" text="Add a memory, saying or recipe from anyone's panel." action={<button className="btn primary"><Feather size={14} /> Add a story</button>} /></section>
          <section className="ui-card"><ErrorState message="The Atlas could not be drawn." onRetry={() => {}} error={new Error('fetch failed: 502')} /></section>
        </div>
      </div>
      <Dialog
        open={dialog !== null}
        onClose={() => { setDialog(null); setText(''); }}
        variant={dialog ?? 'plain'}
        title={dialog === 'event' ? 'A daughter for House Valcourt' : 'Rename'}
        description={dialog === 'event' ? 'Type something, then press Escape: it asks before discarding.' : undefined}
        dirty={text !== ''}
        footer={<><button className="btn" onClick={() => { setDialog(null); setText(''); }}>Cancel</button><button className="btn primary" onClick={() => { setDialog(null); setText(''); }}>Save</button></>}
      >
        <label className="field"><span>Given name</span><input className="input" value={text} onChange={(e) => setText(e.target.value)} /></label>
        <div style={{ marginTop: 12 }}><Select aria-label="House" value={house} onChange={setHouse} options={[{ value: 'valcourt', label: 'House Valcourt' }, { value: 'aurel', label: 'House Aurel' }]} /></div>
      </Dialog>
    </div>
  );
}
