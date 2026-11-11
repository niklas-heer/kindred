// /ui/character: the portrait system on one page. A contact sheet of real people from a tree at every
// size the app uses, and the character editor. A reference for building screens, not a feature.
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { CharacterEditor } from '~/components/CharacterEditor';
import { z } from 'zod';
import { Portrait } from '~/components/Portrait';
import { graphQuery } from '~/lib/api';
import {
  BACKDROPS, BEARD_SHAPES, BEARDS, CLOTH, CLOTHING, EARRINGS, EXPRESSIONS, EXTRAS, EYE_SHAPES, EYES, FACE_SHAPES, FRAMES, GLASSES, HAIR, HAIR_STYLES, HEADWEAR, LIPS, MARKS,
  MOUSTACHES, NECKLACES, NOSE_SHAPES, SKIN,
} from '~/lib/portrait-look';
import type { GPerson, House, Look } from '~/lib/types';

export const Route = createFileRoute('/ui_/character')({
  validateSearch: z.object({
    theme: z.enum(['codex', 'modern', 'night']).optional(),
    tree: z.enum(['realm', 'modern']).optional(),
    view: z.enum(['sheet', 'editor', 'matrix', 'photo', 'parts', 'family', 'all']).optional(),
    part: z.string().optional(),
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
  const { theme, tree = 'modern', view = 'all', sex = 'm', size, part } = Route.useSearch();
  useEffect(() => { if (theme) document.documentElement.dataset.theme = theme; }, [theme]);
  const graph = useQuery(graphQuery(tree));
  const people = graph.data ? sample(graph.data.people, 36) : [];
  return (
    <div className="page" style={{ minHeight: '100vh' }}>
      <div className="page-inner" style={{ display: 'grid', gap: 18 }}>
        {view === 'matrix' && <Matrix sex={sex} size={size} />}
        {view === 'photo' && <PhotoPairs />}
        {view === 'parts' && <Parts only={part} />}
        {view === 'family' && <Showcase />}
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

/** The sitters every part is shown on: a woman, a man and a child, so each part is seen on more than one face. */
const SITTERS: GPerson[] = [
  { id: 'sit-a', given: 'A', sex: 'f', born: '1988', living: true, stories: 0, contacts: 0, look: { skin: 2, hair: 3, eyes: 4, age: 34 } },
  { id: 'sit-b', given: 'B', sex: 'm', born: '1950', living: true, stories: 0, contacts: 0, look: { skin: 4, hair: 0, eyes: 0, age: 58, beardStyle: 'none', moustache: 'none' } },
  { id: 'sit-c', given: 'C', sex: 'f', born: '2014', living: true, stories: 0, contacts: 0, look: { skin: 0, hair: 5, eyes: 3, age: 10 } },
];

/** Every part of the catalogue on the sitters, at the size of a tree node and of a list row. */
function Parts({ only }: { only?: string }) {
  const index = (xs: readonly unknown[]) => xs.map((_, i) => i);
  const lists: [keyof Look, readonly (string | number | string[])[]][] = [
    ['hairStyle', HAIR_STYLES.map((o) => o.id)], ['headwear', HEADWEAR.map((o) => o.id)], ['clothing', CLOTHING.map((o) => o.id)],
    ['beardStyle', BEARDS.map((o) => o.id)], ['beardLength', [0, 2, 5, 7, 9, 10]], ['beardShape', BEARD_SHAPES.map((o) => o.id)],
    ['beardHex', ['#b5522c', '#ece5d0', '#2b201b']], ['hairHex', ['#5c3b21', '#d9b36c', '#2f6fd0', '#101014']],
    ['moustache', MOUSTACHES.map((o) => o.id)], ['glasses', GLASSES.map((o) => o.id)],
    ['face', FACE_SHAPES.map((o) => o.id)], ['noseShape', NOSE_SHAPES.map((o) => o.id)], ['eyeShape', EYE_SHAPES.map((o) => o.id)],
    ['expression', EXPRESSIONS.map((o) => o.id)], ['marks', MARKS.map((o) => [o.id])], ['earrings', EARRINGS.map((o) => o.id)],
    ['necklace', NECKLACES.map((o) => o.id)], ['extras', EXTRAS.map((o) => [o.id])], ['backdrop', BACKDROPS.map((o) => o.id)],
    ['skin', index(SKIN)], ['hair', index(HAIR)], ['eyes', index(EYES)], ['lips', index(LIPS)], ['frames', index(FRAMES)],
    ['clothColour', index(CLOTH)], ['hatColour', index(CLOTH)], ['grey', [0, 1, 2, 3]], ['lines', [0, 1, 2, 3]], ['build', [0, 2, 5, 8, 10]],
  ];
  const bearded: Partial<Look> = { beardStyle: 'full', moustache: 'chevron' };
  const base: Partial<Record<keyof Look, Partial<Look>>> = {
    frames: { glasses: 'round' }, hatColour: { headwear: 'beanie' }, lips: { marks: ['lashes'] },
    beardLength: bearded, beardHex: bearded, beardShape: { ...bearded, beardLength: 8 },
  };
  return (
    <>
      {lists.filter(([field]) => !only || only.split(',').includes(field)).map(([field, values]) => (
        <section key={field} className="ui-card" style={{ display: 'grid', gap: 10 }}>
          <h2 className="rule" style={{ margin: 0 }}>{field}</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {values.map((v) => (
              <figure key={String(v)} style={{ margin: 0, display: 'grid', justifyItems: 'center', gap: 4 }}>
                <span style={{ display: 'flex', gap: 4, alignItems: 'end' }}>
                  {SITTERS.map((p) => <Portrait key={p.id} person={{ ...p, look: { ...p.look!, ...base[field], [field]: v } }} tree="none" house={null} size={96} />)}
                  {SITTERS.slice(0, 2).map((p) => <Portrait key={p.id} person={{ ...p, look: { ...p.look!, ...base[field], [field]: v } }} tree="none" house={null} size={40} />)}
                </span>
                <figcaption className="subtle" style={{ fontSize: 12 }}>{String(v)}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

const house = (id: string, field: House['arms']['field'], field2: House['arms']['field']): House =>
  ({ id, name: id, arms: { field, field2, division: 'per-pale', charge: 'none', chargeTincture: 'or' } }) as House;
const BLUE = house('blue', 'azure', 'or');
const RED = house('red', 'gules', 'argent');
const GREEN = house('green', 'vert', 'or');

/** An invented family dressed by hand: what the portrait can say about people since the editor's second version. */
const SHOWCASE: [Pick<GPerson, 'id' | 'sex' | 'born' | 'died'> & { living?: boolean }, Look, string, House | null][] = [
  [{ id: 'f1', sex: 'm', born: '1898', died: '1975' }, { skin: 1, hair: 2, eyes: 5, hairStyle: 'slicked', grey: 2, glasses: 'monocle', moustache: 'imperial', clothing: 'waistcoat', expression: 'stern', backdrop: 'drape', age: 62 }, 'Great-great-grandfather', BLUE],
  [{ id: 'f2', sex: 'f', born: '1925', died: '2010' }, { skin: 9, hair: 5, eyes: 4, hairStyle: 'beehive', grey: 1, glasses: 'cat-eye', frames: 4, clothing: 'pearls', clothColour: 8, earrings: 'pearls', lips: 0, expression: 'smile', age: 58 }, 'Grandmother, 1950s', RED],
  [{ id: 'f3', sex: 'f', born: '1961', living: true }, { skin: 13, hair: 8, eyes: 6, headwear: 'headwrap', hatColour: 11, clothing: 'kaftan', clothColour: 12, trimColour: 11, earrings: 'hoops', necklace: 'beads', expression: 'grin', backdrop: 'garden' }, 'Aunt', null],
  [{ id: 'f4', sex: 'm', born: '1958', living: true }, { skin: 12, hair: 0, eyes: 0, headwear: 'turban', hatColour: 5, beardStyle: 'full', moustache: 'chevron', grey: 1, clothing: 'kurta', clothColour: 0, expression: 'calm' }, 'Uncle', null],
  [{ id: 'f5', sex: 'f', born: '1990', living: true }, { skin: 11, hair: 0, eyes: 1, headwear: 'hijab', hatColour: 8, clothing: 'jacket', clothColour: 6, expression: 'smile', backdrop: 'books', glasses: 'round' }, 'Cousin, a teacher', null],
  [{ id: 'f6', sex: 'm', born: '1994', living: true }, { skin: 5, hair: 8, eyes: 6, hairStyle: 'locs', beardStyle: 'circle', clothing: 'hoodie', clothColour: 13, expression: 'grin', earrings: 'studs' }, 'Cousin', GREEN],
  [{ id: 'f7', sex: 'f', born: '2003', living: true }, { skin: 0, hair: 12, eyes: 8, hairStyle: 'fringe', marks: ['freckles', 'lashes'], extras: ['nose-stud'], clothing: 'plaid', expression: 'smile', backdrop: 'night' }, 'Niece, blue hair', BLUE],
  [{ id: 'f8', sex: 'm', born: '1940', living: true }, { skin: 2, hair: 1, eyes: 2, hairStyle: 'thinning', grey: 3, glasses: 'half', extras: ['hearing-aid', 'pipe'], clothing: 'cardigan', lines: 3, expression: 'smile', build: 8 }, 'Grandfather', RED],
  [{ id: 'f9', sex: 'f', born: '1972', living: true }, { skin: 14, hair: 8, eyes: 6, hairStyle: 'box-braids', clothing: 'white-coat', glasses: 'rimless', expression: 'calm', earrings: 'drops' }, 'Aunt, a doctor', GREEN],
  [{ id: 'f10', sex: 'm', born: '1968', living: true }, { skin: 10, hair: 8, eyes: 6, eyeShape: 'monolid', hairStyle: 'side-part', grey: 1, clothing: 'suit-slim', glasses: 'horn', expression: 'calm' }, 'Uncle by marriage', null],
  [{ id: 'f11', sex: 'f', born: '1996', living: true }, { skin: 1, hair: 4, eyes: 3, hairStyle: 'crown-braid', headwear: 'flower-crown', clothing: 'dirndl', expression: 'grin', backdrop: 'hills' }, 'Midsummer', GREEN],
  [{ id: 'f12', sex: 'm', born: '1922', died: '1944' }, { skin: 1, hair: 3, eyes: 4, headwear: 'peaked-cap', clothing: 'uniform', expression: 'stern', age: 21 }, 'Great-uncle, 1943', BLUE],
  [{ id: 'f13', sex: 'f', born: '1995', living: true }, { skin: 3, hair: 0, eyes: 0, hairStyle: 'chignon', headwear: 'bridal-veil', clothing: 'wedding-dress', necklace: 'pearls', expression: 'smile', extras: ['bindi'] }, 'Wedding day', null],
  [{ id: 'f14', sex: 'm', born: '1985', living: true }, { skin: 2, hair: 2, eyes: 2, headwear: 'kippah', beardStyle: 'short', clothing: 'shirt', clothColour: 0, expression: 'smile', marks: ['vitiligo'] }, 'Cousin', null],
  [{ id: 'f15', sex: 'f', born: '2017', living: true }, { skin: 4, hair: 0, eyes: 0, hairStyle: 'space-buns', clothing: 'overalls', expression: 'grin', marks: ['dimples'], backdrop: 'sky' }, 'The youngest', RED],
  [{ id: 'f16', sex: 'x', born: '1999', living: true }, { skin: 9, hair: 13, eyes: 5, hairStyle: 'fade', clothing: 'turtleneck', clothColour: 4, earrings: 'hoops', glasses: 'round', frames: 1, expression: 'calm', marks: ['birthmark'] }, 'Cousin', BLUE],
  [{ id: 'f17', sex: 'm', born: '1105', died: '1160' }, { skin: 1, hair: 6, eyes: 4, headwear: 'crown', beardStyle: 'long', clothing: 'tunic', expression: 'stern', backdrop: 'house', marks: ['scar'] }, 'A king of the realm', RED],
  [{ id: 'f18', sex: 'f', born: '1130', died: '1190' }, { skin: 5, hair: 0, eyes: 6, headwear: 'tiara', hairStyle: 'braid', clothing: 'gown', necklace: 'pendant', expression: 'calm', backdrop: 'rays' }, 'A queen of the realm', GREEN],
];

/** The showcase family at the size of a person's panel and of a list row. The dead are shown in colour here, to show the drawing. */
function Showcase() {
  const people = SHOWCASE.map(([p, look, caption, h]) => ({ person: { living: false, ...p, given: caption, stories: 0, contacts: 0, look } as GPerson, caption, h }));
  return (
    <section className="ui-card" style={{ display: 'grid', gap: 16 }} data-showcase>
      <h2 className="rule" style={{ margin: 0 }}>What a family can look like</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '18px 12px' }}>
        {people.map(({ person, caption, h }) => (
          <figure key={person.id} style={{ margin: 0, display: 'grid', justifyItems: 'center', gap: 6 }}>
            <Portrait person={person} tree="none" house={h} size={140} mourn={false} />
            <figcaption className="subtle" style={{ fontSize: 13, textAlign: 'center' }}>{caption}</figcaption>
          </figure>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {people.map(({ person, h }) => <Portrait key={person.id} person={person} tree="none" house={h} size={40} mourn={false} decorative />)}
      </div>
    </section>
  );
}
