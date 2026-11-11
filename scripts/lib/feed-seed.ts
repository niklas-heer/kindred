// What the invented families wrote to each other: the posts of their feed, with a few comments and reactions, and some
// photographs for their gallery (migration 0029, docs/feed.md). The modern family sounds like a family; the realm's
// people write as people of their time would, to their kin. Everyone who speaks is a person of the tree, found from the
// person the tree opens on (their parents, partner, children, brothers and sisters, cousins), so the names in a post
// are the family's own. Invented people only. The same tree gives the same feed.
import type { SeedPerson, SeedPost, SeedTree, SeedUpload } from '../../src/lib/seed-format.ts';

interface Kin {
  byId: Map<string, SeedPerson>;
  parents: (id: string) => string[];
  children: (id: string) => string[];
  partners: (id: string) => string[];
  siblings: (id: string) => string[];
  /** Everyone, nearest to `from` first (by parent, child and partner links). */
  near: (from: string) => string[];
}

function kinOf(tree: SeedTree): Kin {
  const byId = new Map(tree.people.map((p) => [p.id, p]));
  const up = new Map<string, string[]>(), down = new Map<string, string[]>(), beside = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); };
  for (const l of tree.parents) { push(up, l.child, l.parent); push(down, l.parent, l.child); }
  for (const u of tree.unions) { push(beside, u.a, u.b); push(beside, u.b, u.a); }
  const parents = (id: string) => up.get(id) ?? [];
  const children = (id: string) => down.get(id) ?? [];
  const partners = (id: string) => beside.get(id) ?? [];
  const siblings = (id: string) => [...new Set(parents(id).flatMap(children))].filter((s) => s !== id);
  const near = (from: string) => {
    const seen = new Set([from]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      for (const next of [...partners(queue[i]!), ...parents(queue[i]!), ...children(queue[i]!)]) {
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    return queue;
  };
  return { byId, parents, children, partners, siblings, near };
}

/** Picks people for the parts of a feed: each from those wanted when one of them fits and is free, else the nearest who is. */
function casting(kin: Kin, focus: string, fits: (p: SeedPerson) => boolean) {
  const used = new Set<string>();
  const pool = kin.near(focus).filter((id) => fits(kin.byId.get(id)!));
  return (wanted: string[] = []): string => {
    const id = [...wanted.filter((w) => kin.byId.has(w) && fits(kin.byId.get(w)!)), ...pool].find((x) => !used.has(x)) ?? pool[0] ?? focus;
    used.add(id);
    return id;
  };
}

const bornYear = (p: SeedPerson) => Number(/\d{4}/.exec(p.born ?? '')?.[0] ?? 0);

/** The Lindqvist–Ashworth family's last month: moves, exams, photographs from Sunday, a recipe nobody can find. */
export function modernFeed(tree: SeedTree, year = 2026): { posts: SeedPost[]; uploads: SeedUpload[] } {
  const kin = kinOf(tree);
  const me = tree.focus;
  const adult = (p: SeedPerson) => !!p.living && bornYear(p) > 0 && year - bornYear(p) >= 18;
  const cast = casting(kin, me, adult);
  const name = (id: string) => kin.byId.get(id)!.given;
  const self = cast([me]);
  const partner = cast(kin.partners(me));
  const mother = cast(kin.parents(me).filter((id) => kin.byId.get(id)!.sex === 'f'));
  const father = cast(kin.parents(me).filter((id) => kin.byId.get(id)!.sex === 'm'));
  const sibling = cast(kin.siblings(me));
  const sibling2 = cast(kin.siblings(me));
  const aunt = cast(kin.parents(me).flatMap(kin.siblings));
  const cousin = cast(kin.parents(me).flatMap(kin.siblings).flatMap(kin.children));
  const cousin2 = cast(kin.parents(me).flatMap(kin.siblings).flatMap(kin.children));
  // Someone young to be proud of, and someone gone to remember.
  const young = kin.near(me).find((id) => { const p = kin.byId.get(id)!; return !!p.living && year - bornYear(p) >= 9 && year - bornYear(p) <= 17; });
  const gone = kin.near(me).find((id) => { const p = kin.byId.get(id)!; return !p.living && p.sex === 'f' && bornYear(p) < 1950; });
  const town = (id: string) => kin.byId.get(id)!.bornPlace ?? 'Lund';

  const posts: SeedPost[] = [
    {
      by: sibling, daysAgo: 0, time: '08:10',
      body: `We are in! The new flat has a balcony just big enough for two chairs and Mum's geraniums. There are boxes everywhere, but the kettle has been found, so come and see us.`,
      pictures: [{ scene: 'street', seed: 11 }],
      reactions: [{ by: mother, kind: '❤️' }, { by: self, kind: '❤️' }, { by: cousin, kind: '🙏' }],
      comments: [{ by: mother, body: 'I will bring the geraniums on Saturday. And a cake.', hoursLater: 1 }, { by: self, body: 'Two chairs is one more than the last balcony had. Well done!', hoursLater: 2 }],
    },
    ...(young ? [{
      by: mother, daysAgo: 1, time: '17:40', people: [young],
      body: `${name(young)} passed the exam. You will not hear it from ${name(young)}, so you are hearing it from me: top marks in maths, and the neighbour's bicycle mended on the way home.`,
      reactions: [{ by: father, kind: '❤️' }, { by: aunt, kind: '❤️' }, { by: sibling, kind: '😂' }, { by: cousin2, kind: '❤️' }],
      comments: [{ by: aunt, body: 'That is our family in one sentence. Congratulations!', hoursLater: 3 }],
    }] : []),
    {
      by: self, daysAgo: 2, time: '19:05', people: [aunt],
      body: `Photos from Sunday at the lake. ${name(aunt)} swam; the rest of us held the towels and said how brave it was.`,
      pictures: [{ scene: 'lake', seed: 3 }, { scene: 'boat', seed: 5 }, { scene: 'table', seed: 8 }, { scene: 'lake', seed: 21, tall: true }],
      reactions: [{ by: aunt, kind: '😂' }, { by: partner, kind: '❤️' }, { by: mother, kind: '💭' }],
      comments: [{ by: aunt, body: 'It was fourteen degrees and I regret nothing.', hoursLater: 2 }],
    },
    ...(gone ? [{
      by: cousin, daysAgo: 4, time: '20:30', people: [gone],
      body: `Does anyone still have ${name(gone)}'s recipe for the cardamom buns? I tried from memory and made something closer to a paving stone.`,
      reactions: [{ by: self, kind: '😂' }, { by: mother, kind: '💭' }, { by: father, kind: '🕯️' }],
      comments: [
        { by: mother, body: `It is in the Chronicle, on her page. She never measured the cardamom, so neither does the recipe.`, hoursLater: 1 },
        { by: cousin, body: 'Found it. Thank you! Second attempt on Sunday.', hoursLater: 5 },
      ],
    }] : []),
    {
      by: father, daysAgo: 6, time: '09:15',
      body: `The apple tree behind the house has finally given up, after sixty years.\n\nI am keeping a branch for the mantelpiece. Say so if you would like one too.`,
      pictures: [{ scene: 'garden', seed: 2 }],
      reactions: [{ by: sibling, kind: '🕯️' }, { by: self, kind: '💭' }, { by: aunt, kind: '💭' }],
      comments: [{ by: sibling2, body: 'Yes, please. I fell out of that tree twice.', hoursLater: 4 }],
    },
    {
      by: aunt, daysAgo: 8, time: '12:20',
      body: `Booked: the summer house, the last week of July. Twelve beds, so tell me soon who is coming.\nThe details are here: https://sommarhus.example/boka/vecka-30`,
      reactions: [{ by: self, kind: '🙏' }, { by: cousin, kind: '❤️' }, { by: sibling, kind: '❤️' }],
      comments: [{ by: partner, body: 'Two of us, and we will bring the boat cushions.', hoursLater: 6 }],
    },
    { by: partner, daysAgo: 11, time: '18:45', body: 'First day at the new job, done. Nobody warned me about the coffee.', reactions: [{ by: self, kind: '❤️' }, { by: mother, kind: '👏' }] },
    {
      by: sibling2, daysAgo: 13, time: '21:10', people: [father],
      body: `Found in a shoebox: ${name(father)} at the helm, long before any of us could tell port from starboard.`,
      pictures: [{ scene: 'boat', seed: 14 }],
      reactions: [{ by: father, kind: '😂' }, { by: mother, kind: '💭' }, { by: self, kind: '❤️' }],
      comments: [{ by: father, body: 'I could not tell them apart either. We came home all the same.', hoursLater: 2 }],
    },
    { by: self, daysAgo: 16, time: '07:55', body: 'Thank you, all of you, for the birthday messages. I read every one of them twice.', reactions: [{ by: mother, kind: '❤️' }, { by: aunt, kind: '❤️' }] },
    {
      by: mother, daysAgo: 20, time: '10:30',
      body: `A reminder: family lunch on the 14th, at ours. Bring a chair if you own a folding one, and an appetite either way.`,
      pictures: [{ scene: 'table', seed: 4 }],
      reactions: [{ by: cousin2, kind: '🙏' }, { by: sibling, kind: '❤️' }],
    },
    {
      by: cousin2, daysAgo: 24, time: '16:00',
      body: `I walked past the old house in ${town(father)}. The blue door is green now. It felt wrong, so I am telling people.`,
      pictures: [{ scene: 'door', seed: 6, tall: true }],
      reactions: [{ by: father, kind: '💭' }, { by: aunt, kind: '💭' }, { by: self, kind: '😂' }],
      comments: [{ by: aunt, body: 'It was green before it was blue. Your grandfather painted it the week I was born.', hoursLater: 7 }],
    },
    { by: aunt, daysAgo: 29, time: '08:40', body: 'First frost this morning. The geese went over the house at seven, in a very untidy V.', reactions: [{ by: mother, kind: '😮' }] },
  ];
  const uploads: SeedUpload[] = [
    { by: father, daysAgo: 3, time: '15:20', album: 'Summer at the lake', pictures: [{ scene: 'lake', seed: 31 }, { scene: 'boat', seed: 32 }, { scene: 'lake', seed: 33 }, { scene: 'garden', seed: 34 }, { scene: 'boat', seed: 35, tall: true }] },
    { by: cousin, daysAgo: 18, time: '11:00', pictures: [{ scene: 'street', seed: 41, caption: 'The street where the bakery was' }, { scene: 'door', seed: 42 }] },
  ];
  return { posts, uploads };
}

/** Aurelmarch, in its own voice: the family of the house writes to its kin, as it would have by letter. */
export function realmFeed(tree: SeedTree): { posts: SeedPost[]; uploads: SeedUpload[] } {
  const kin = kinOf(tree);
  const me = tree.focus;
  const year = bornYear(kin.byId.get(me)!) + 35;
  // Those who shared the hall with the one the tree opens on: grown, and born within a lifetime of them.
  const cast = casting(kin, me, (p) => bornYear(p) > 0 && year - bornYear(p) >= 14 && year - bornYear(p) <= 70);
  const name = (id: string) => kin.byId.get(id)!.given;
  const lord = cast([me]);
  const lady = cast(kin.partners(me));
  const heir = cast(kin.children(me));
  const child = cast(kin.children(me));
  const brother = cast(kin.siblings(me));
  const seat = kin.byId.get(me)!.bornPlace ?? 'the old keep';
  const posts: SeedPost[] = [
    {
      by: lord, daysAgo: 1, time: '06:30',
      body: `Word from the northern march: the bridge holds, and the miller swears the flood spared his wheel. I rode across it myself this morning, and I am no light man.`,
      pictures: [{ scene: 'castle', seed: 9 }],
      reactions: [{ by: lady, kind: '❤️' }, { by: brother, kind: '😂' }],
      comments: [{ by: brother, body: 'Then it will bear the wine carts. I shall send six.', hoursLater: 5 }],
    },
    {
      by: lady, daysAgo: 4, time: '11:00',
      body: `All of our blood are bidden to ${seat} for Michaelmas. There will be goose, and music after.\n\nBring no quarrels to my table. They may wait in the yard with the horses.`,
      reactions: [{ by: lord, kind: '❤️' }, { by: heir, kind: '🙏' }, { by: child, kind: '❤️' }],
    },
    {
      by: heir, daysAgo: 9, time: '19:20', people: [child],
      body: `Let it be remembered that ${name(child)} took a boar of four winters this morning, alone, and came home on foot, because the horse would not carry it.`,
      reactions: [{ by: lord, kind: '❤️' }, { by: lady, kind: '😂' }, { by: brother, kind: '💭' }],
      comments: [{ by: child, body: 'The horse has been spoken to.', hoursLater: 2 }],
    },
    {
      by: brother, daysAgo: 15, time: '08:00',
      body: `The white falcon is flown and has not come back. Whoever finds her: she answers to no name, but she will come to a red lure.`,
      pictures: [{ scene: 'falcon', seed: 12 }],
      reactions: [{ by: lady, kind: '🕯️' }, { by: heir, kind: '❤️' }],
    },
  ];
  const uploads: SeedUpload[] = [{ by: lady, daysAgo: 6, time: '14:00', album: 'The keep in spring', pictures: [{ scene: 'castle', seed: 51 }, { scene: 'falcon', seed: 52 }, { scene: 'castle', seed: 53 }] }];
  return { posts, uploads };
}
