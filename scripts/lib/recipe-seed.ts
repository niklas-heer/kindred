// The invented families' recipes (migration 0031, docs/recipes.md): a few written with the recipe form, with their
// ingredients in rows, their steps, a tag or two and a painted picture, so a fresh family's Cookbook has something to
// cook from. The people are the family's own, found from the person the tree opens on: a grandmother who is gone, the
// parent who wrote her recipes down. Invented people only. The same tree gives the same recipes.
import type { SeedPerson, SeedRecipe, SeedTree } from '../../src/lib/seed-format.ts';

const bornYear = (p: SeedPerson) => Number(/\d{4}/.exec(p.born ?? '')?.[0] ?? 0);

/** Everyone, nearest to `from` first (by parent, child and partner links). */
function near(tree: SeedTree, from: string): SeedPerson[] {
  const byId = new Map(tree.people.map((p) => [p.id, p]));
  const next = new Map<string, string[]>();
  const push = (a: string, b: string) => { const l = next.get(a); if (l) l.push(b); else next.set(a, [b]); };
  for (const l of tree.parents) { push(l.child, l.parent); push(l.parent, l.child); }
  for (const u of tree.unions) { push(u.a, u.b); push(u.b, u.a); }
  const seen = new Set([from]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) for (const id of next.get(queue[i]!) ?? []) if (!seen.has(id)) { seen.add(id); queue.push(id); }
  return queue.map((id) => byId.get(id)!).filter(Boolean);
}

/** The Lindqvist–Ashworth family's cookbook: a grandmother's goulash and her cardamom buns, and a quick thing for the lake. */
export function modernRecipes(tree: SeedTree, year = 2026): { recipes: SeedRecipe[] } {
  const kin = near(tree, tree.focus);
  const adults = kin.filter((p) => !!p.living && bornYear(p) > 0 && year - bornYear(p) >= 18);
  // Two grandmothers who are gone (the nearest first: the feed asks after her cardamom buns), and the living who wrote for them.
  const gone = kin.filter((p) => !p.living && p.sex === 'f' && bornYear(p) > 0 && bornYear(p) < 1950);
  const writer = adults.find((p) => p.sex === 'f' && year - bornYear(p) >= 45) ?? adults[0];
  const cook = adults.find((p) => p.id !== writer?.id && year - bornYear(p) >= 25) ?? adults[1] ?? writer;
  if (!writer || !cook) return { recipes: [] };
  const grandmother = gone[0], other = gone[1] ?? gone[0];
  const recipes: SeedRecipe[] = [];
  if (other) {
    recipes.push({
      person: other.id, by: writer.id, title: `${other.given}'s goulash`, daysAgo: 3, time: '18:20',
      source: `Grandma ${other.given}'s`, servings: 4, prepMinutes: 25, cookMinutes: 150,
      groups: [
        { lines: ['800 g beef shin, in large cubes', '3 onions, sliced', '2 tbsp lard or oil', '2 tbsp sweet paprika', '1 tsp hot paprika', '1 tsp caraway seeds', '2 cloves garlic, crushed', '2 tbsp tomato purée', '1 red pepper, in strips', '750 ml beef stock', '2 bay leaves', 'salt and black pepper'] },
        { name: 'To serve', lines: ['4 tbsp soured cream', '1 small bunch parsley, chopped', 'bread or boiled potatoes'] },
      ],
      steps: [
        'Pat the beef dry and salt it. Heat the lard in a heavy pot and brown the beef in two batches, without hurry, until it has a dark crust. Lift it out.',
        'Soften the onions in the same pot over a low heat for a good fifteen minutes, until golden and sweet. Stir in the garlic and the caraway.',
        'Take the pot off the heat before the paprika goes in, or it turns bitter. Stir in both paprikas and the tomato purée, then put it back and pour in the stock.',
        'Return the beef with the bay leaves. Put the lid on, leave a small gap, and let it simmer very gently for two hours.',
        'Add the pepper strips and cook for another twenty minutes, lid off, until the sauce coats a spoon. Taste, and season.',
        'Serve with a spoonful of soured cream, parsley, and bread to wipe the plate.',
      ],
      notes: `Better the next day, and better still the day after. She never measured the paprika: she said the pot would tell you. If the sauce is thin at the end, a grated raw potato stirred in for the last ten minutes thickens it without anyone noticing.`,
      tags: ['stew', 'Sunday', 'winter'],
      cover: { scene: 'dish', seed: 7 },
    });
  }
  if (grandmother) {
    recipes.push({
      person: grandmother.id, by: writer.id, title: `${grandmother.given}'s cardamom buns`, daysAgo: 4, time: '21:15',
      source: 'From the blue notebook', servings: 12, prepMinutes: 40, cookMinutes: 12,
      groups: [
        { name: 'For the dough', lines: ['250 ml milk, lukewarm', '25 g fresh yeast', '75 g butter, soft', '60 g sugar', '2 tsp cardamom, freshly ground', '1/2 tsp salt', '450 g strong white flour'] },
        { name: 'For the filling', lines: ['80 g butter, very soft', '60 g sugar', '1 tbsp cardamom, freshly ground'] },
        { name: 'To finish', lines: ['1 egg, beaten', 'pearl sugar'] },
      ],
      steps: [
        'Crumble the yeast into the milk and stir until it has gone. Add the butter, sugar, cardamom and salt, then the flour, and knead for ten minutes until the dough leaves the bowl clean.',
        'Cover it and leave it somewhere warm for an hour, until it has doubled.',
        'Roll it out to a rectangle about the size of a tea towel. Spread the filling right to the edges, fold it in three like a letter, and cut it into twelve strips.',
        'Twist each strip, wind it twice around two fingers and tuck the end underneath. Leave the buns on a tray for half an hour.',
        'Brush with egg, scatter with pearl sugar, and bake at 225 °C for ten to twelve minutes, until deep gold.',
      ],
      notes: `She ground the cardamom herself, in the brass mortar, and so should you: the powder from a jar is a different spice. Eat them warm. They freeze well, though in this family they rarely get the chance.`,
      tags: ['baking', 'fika', 'Christmas'],
      cover: { scene: 'bake', seed: 12 },
    });
  }
  recipes.push({
    person: cook.id, by: cook.id, title: 'Herring salad for the lake', daysAgo: 9, time: '11:05',
    servings: 6, prepMinutes: 20,
    groups: [{ lines: ['6 pickled herring fillets, in pieces', '4 boiled potatoes, cold, diced', '2 apples, diced', '1 red onion, finely chopped', '3 pickled gherkins, diced', '200 g soured cream', '1 tbsp mustard', '1 bunch dill, chopped'] }],
    steps: [
      'Mix the soured cream with the mustard and most of the dill.',
      'Fold in everything else, gently, so the potatoes keep their shape.',
      'Leave it in the cold for at least an hour. Scatter the rest of the dill over it before it goes in the basket.',
    ],
    tags: ['summer', 'quick', 'picnic'],
  });
  return { recipes };
}

/** The realm's kitchen: one dish from the great hall, as a steward's wife would have had it written down. */
export function realmRecipes(tree: SeedTree): { recipes: SeedRecipe[] } {
  const kin = near(tree, tree.focus);
  const whose = kin.find((p) => !p.living && p.sex === 'f') ?? kin.find((p) => !p.living);
  const by = kin.find((p) => p.id !== whose?.id) ?? whose;
  if (!whose || !by) return { recipes: [] };
  return {
    recipes: [{
      person: whose.id, by: by.id, title: 'Spiced pottage of barley and leeks', daysAgo: 6, time: '16:30',
      source: `As ${whose.given} had it made`, servings: 8, prepMinutes: 30, cookMinutes: 90,
      groups: [
        { lines: ['300 g pearl barley, soaked overnight', '4 leeks, washed and sliced', '2 onions, chopped', '2 tbsp butter', '2 l broth of fowl or of roots', '1 handful parsley, chopped', '1 pinch saffron', '1/2 tsp ground ginger', 'salt'] },
        { name: 'For the table', lines: ['1 loaf bread, a day old', '2 tbsp honey'] },
      ],
      steps: [
        'Melt the butter in the great pot and soften the onions and leeks in it, slowly, so that they take no colour.',
        'Add the barley and the broth and bring it to a gentle boil. Let it seethe for an hour and a half, and stir it often, for barley catches.',
        'Steep the saffron in a spoonful of the hot broth, and stir it in with the ginger when the barley is soft.',
        'Salt it at the last, strew it with parsley, and send it up with the bread. A little honey at the table, for those who wish it.',
      ],
      notes: 'The saffron must be bought, never borrowed. On fast days the broth is of roots, and nobody is the poorer for it.',
      tags: ['pottage', 'fast day', 'great hall'],
      cover: { scene: 'table', seed: 31 },
    }],
  };
}
