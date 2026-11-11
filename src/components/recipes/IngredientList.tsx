// A recipe's ingredients as a list to tick off while cooking (docs/recipes.md): each line a checkbox with its amount
// scaled to the servings chosen. The ticks are the reader's own and are kept in this browser, per recipe, so they
// survive a reload with floury hands, and are the same on the recipe's page and in cooking mode.
//
//   const ticks = useTicks(tree, recipe.id);
//   <IngredientList groups={recipe.groups} factor={1.5} ticks={ticks} />
import { useCallback, useEffect, useState } from 'react';
import { useT } from '~/lib/i18n';
import { scaleAmount, type IngredientGroup } from '~/lib/recipes/model';
import './recipes.css';

export interface Ticks { has: (key: string) => boolean; toggle: (key: string) => void; clear: () => void; count: number }

/** Which lines the reader has ticked, kept in this browser for this recipe. Read after hydration, so the server's page and the browser's agree. */
export function useTicks(tree: string, id: string): Ticks {
  const key = `kindred:recipe-ticks:${tree}:${id}`;
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
      setDone(new Set(Array.isArray(stored) ? stored.filter((x): x is string => typeof x === 'string') : []));
    } catch { /* Private browsing can disable storage: the ticks then last as long as the page. */ }
  }, [key]);
  const keep = useCallback((next: ReadonlySet<string>) => {
    setDone(next);
    try {
      if (next.size) localStorage.setItem(key, JSON.stringify([...next]));
      else localStorage.removeItem(key);
    } catch { /* As above. */ }
  }, [key]);
  return {
    has: (k) => done.has(k),
    toggle: (k) => { const next = new Set(done); if (!next.delete(k)) next.add(k); keep(next); },
    clear: () => keep(new Set()),
    count: done.size,
  };
}

export function IngredientList({ groups, factor, ticks, large }: { groups: IngredientGroup[]; factor: number; ticks: Ticks; large?: boolean }) {
  const t = useT();
  return (
    <div className={`rcp-ingredients${large ? ' is-large' : ''}`}>
      {groups.map((g, gi) => (
        <div key={gi} className="rcp-ing-group">
          {g.name ? <h4>{g.name}</h4> : null}
          <ul>
            {g.items.map((i, ii) => {
              // The line itself is the key, so a tick stays with its ingredient when the recipe is changed around it.
              const key = `${g.name}|${i.item}|${i.unit}`;
              const amount = [scaleAmount(i.amount, factor, t.locale), i.unit].filter(Boolean).join(' ');
              return (
                <li key={ii}>
                  <label data-done={ticks.has(key) || undefined}>
                    <input type="checkbox" checked={ticks.has(key)} onChange={() => ticks.toggle(key)} />
                    <span className="rcp-ing-amount">{amount}</span>
                    <span className="rcp-ing-item">{i.item}{i.note ? <em>, {i.note}</em> : null}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
