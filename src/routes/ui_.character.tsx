// /ui/character: the portrait system on one page. A contact sheet of real people from a tree at every
// size the app uses, and the character editor. A reference for building screens, not a feature.
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { CharacterEditor } from '~/components/CharacterEditor';
import { z } from 'zod';
import { Portrait } from '~/components/Portrait';
import { graphQuery } from '~/lib/api';
import type { GPerson, Look } from '~/lib/types';

export const Route = createFileRoute('/ui_/character')({
  validateSearch: z.object({
    theme: z.enum(['codex', 'modern', 'night']).optional(),
    tree: z.enum(['realm', 'modern']).optional(),
    view: z.enum(['sheet', 'editor', 'matrix', 'photo', 'all']).optional(),
    sex: z.enum(['m', 'f', 'x']).optional(),
    size: z.number().optional(),
  }),
  head: () => ({ meta: [{ title: 'Characters · Kindred' }] }),
  component: CharacterGallery,
});

const SIZES = [28, 40, 58, 84, 124];
const ERA_YEARS = [1000, 1300, 1520, 1650, 1750, 1860, 1920, 1958, 1985, 2015];
const AGES = [1, 8, 16, 30, 52, 78];

/** A made-up person shown at `age` in `year`, so every era and life stage can be seen side by side. */
function synthetic(year: number, age: number, sex: 'm' | 'f' | 'x', i: number): GPerson {
  const born = Math.round(year - Math.min(age, 35) - Math.max(0, age - 35) / 2);
  return {
    id: `syn-${year}-${age}-${sex}`, given: `${sex}${age}`, sex, born: String(born), living: true, stories: 0, contacts: 0,
    look: { skin: (i * 3) % 8, hair: (i * 7) % 10, eyes: i % 7, age },
  };
}

function Matrix({ sex, size = 100 }: { sex: 'm' | 'f' | 'x'; size?: number }) {
  return (
    <section className="ui-card" style={{ display: 'grid', gap: 10 }}>
      <h2 className="rule" style={{ margin: 0 }}>Eras × ages · {sex}</h2>
      {ERA_YEARS.map((y, r) => (
        <div key={y} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className="subtle" style={{ width: 44, fontSize: 12 }}>{y}</span>
          {AGES.map((age, c) => <Portrait key={age} person={synthetic(y, age, sex, r * 6 + c)} tree="none" house={null} size={size} />)}
        </div>
      ))}
    </section>
  );
}
const yearOf = (s?: string) => Number(s?.match(/\d{3,4}/)?.[0] ?? NaN);

/** A spread of people: by birth decade, both sexes, living and dead, so every era and age shows. */
function sample(people: GPerson[], n: number): GPerson[] {
  const dated = people.filter((p) => !Number.isNaN(yearOf(p.born))).sort((a, b) => yearOf(a.born) - yearOf(b.born));
  const step = Math.max(1, dated.length / n);
  return Array.from({ length: Math.min(n, dated.length) }, (_, i) => dated[Math.floor(i * step)]);
}

function ageText(p: GPerson): string {
  const b = yearOf(p.born);
  const d = yearOf(p.died);
  const end = Number.isNaN(d) ? (p.living ? new Date().getFullYear() : NaN) : d;
  return Number.isNaN(b) ? '?' : `${b}${Number.isNaN(end) ? '' : ` · ${end - b}`}${p.living ? '' : ' †'}`;
}

function CharacterGallery() {
  const { theme, tree = 'modern', view = 'all', sex = 'm', size } = Route.useSearch();
  useEffect(() => { if (theme) document.documentElement.dataset.theme = theme; }, [theme]);
  const graph = useQuery(graphQuery(tree));
  const people = graph.data ? sample(graph.data.people, 36) : [];
  return (
    <div className="page" style={{ minHeight: '100vh' }}>
      <div className="page-inner" style={{ display: 'grid', gap: 18 }}>
        {view === 'matrix' && <Matrix sex={sex} size={size} />}
        {view === 'photo' && <PhotoPairs />}
        {(view === 'editor' || view === 'all') && <EditorDemo people={graph.data?.people} tree={tree} />}
        {(view === 'sheet' || view === 'all') && (
          <section className="ui-card" style={{ display: 'grid', gap: 14 }}>
            <h2 className="rule" style={{ margin: 0 }}>Contact sheet · {tree}</h2>
            {graph.isPending ? <p className="muted">Loading…</p> : graph.isError ? <p className="muted">Sign in to see a tree.</p> : null}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }} data-sheet="large">
              {people.map((p) => (
                <figure key={p.id} style={{ margin: 0, display: 'grid', justifyItems: 'center', gap: 4, width: 92 }}>
                  <Portrait person={p} tree={tree} size={84} />
                  <figcaption className="subtle" style={{ fontSize: 11, textAlign: 'center' }}>{p.given} · {p.sex ?? '?'}<br />{ageText(p)}</figcaption>
                </figure>
              ))}
            </div>
            <div style={{ display: 'grid', gap: 10 }} data-sheet="sizes">
              {people.slice(0, 8).map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'end', gap: 14 }}>
                  {SIZES.map((s) => <Portrait key={s} person={p} tree={tree} size={s} />)}
                  {[28, 40].map((s) => <Portrait key={`b${s}`} person={p} tree={tree} size={s} frame={false} />)}
                  <span className="subtle" style={{ fontSize: 12 }}>{p.given} {p.surname} · {ageText(p)}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/** The editor on a real person (nothing is saved), and the Look it emits. */
function EditorDemo({ people, tree }: { people?: GPerson[]; tree: string }) {
  const [who, setWho] = useState(0);
  const candidates = people ? sample(people, 12) : [];
  const person = candidates[who % Math.max(1, candidates.length)];
  const [looks, setLooks] = useState<Record<string, Look | undefined>>({});
  if (!person) return null;
  const value = person.id in looks ? looks[person.id] : person.look;
  return (
    <section className="ui-card" style={{ display: 'grid', gap: 14 }}>
      <h2 className="rule" style={{ margin: 0 }}>Character editor · {person.given} {person.surname} ({ageText(person)})</h2>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {candidates.map((p, i) => (
          <button key={p.id} type="button" className="btn" aria-pressed={i === who % candidates.length} onClick={() => setWho(i)}>
            {p.given} · {ageText(p)}
          </button>
        ))}
      </div>
      <CharacterEditor person={person} tree={tree} value={value} onChange={(l) => setLooks((m) => ({ ...m, [person.id]: l }))} />
      <pre className="subtle" style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }} data-look>{JSON.stringify(value)}</pre>
    </section>
  );
}

/** A photo and the drawing standing in for it, side by side: same frame, same mourning print. The
 *  photo URL 404s here (no photo is stored); a test swaps in a picture. */
function PhotoPairs() {
  const living: GPerson = { id: 'demo-photo-a', given: 'Ada', sex: 'f', born: '1961', living: true, stories: 0, contacts: 0, photo: 'demo', look: { skin: 1, hair: 3, eyes: 4 } };
  const dead: GPerson = { ...living, id: 'demo-photo-b', given: 'Bertil', sex: 'm', born: '1902', died: '1979', living: false, look: { skin: 2, hair: 1, eyes: 0, beard: true } };
  return (
    <section className="ui-card" style={{ display: 'grid', gap: 14 }}>
      <h2 className="rule" style={{ margin: 0 }}>Photo and avatar</h2>
      {[living, dead].map((p) => (
        <div key={p.id} style={{ display: 'flex', gap: 14, alignItems: 'end' }}>
          {[124, 84, 40].map((s) => (
            <span key={s} style={{ display: 'flex', gap: 6 }}>
              <span data-demo-photo><Portrait person={p} tree="none" house={null} size={s} /></span>
              <Portrait person={p} tree="none" house={null} size={s} prefer="avatar" />
            </span>
          ))}
          <span className="subtle">{p.given} · {p.living ? 'living' : 'dead'}</span>
        </div>
      ))}
    </section>
  );
}
