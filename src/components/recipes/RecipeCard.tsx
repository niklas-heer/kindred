// A recipe as a card (docs/recipes.md): its picture, its name, whose it is, how many it serves and how long it takes.
// The Cookbook is a grid of these; the Chronicle, the feed and a person's page show one in place of a recipe's text
// (RecipeTeaser), so a recipe looks like a recipe wherever it is met, and opens on its own page.
//
//   <RecipeCard r={summary} tree={tree} />
//   <RecipeTeaser tree={tree} id={story.id} fallback={<p>…</p>} />
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChefHat, Clock, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Portrait } from '~/components/Portrait';
import { useFamily } from '~/lib/family';
import { displayName } from '~/lib/graph';
import { useT } from '~/lib/i18n';
import { minutesText, recipeImageUrl, type RecipeSummary } from '~/lib/recipes/model';
import { cookbookQuery } from '~/lib/recipes/recipes.functions';
import './recipes.css';

/** Prep and cooking together, when either is known. */
export const totalMinutes = (r: { prepMinutes: number | null; cookMinutes: number | null }) =>
  r.prepMinutes === null && r.cookMinutes === null ? null : (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0);

/** The line of small facts under a recipe's name: how long, how many. */
export function RecipeFacts({ r }: { r: Pick<RecipeSummary, 'servings' | 'prepMinutes' | 'cookMinutes'> }) {
  const t = useT();
  const total = totalMinutes(r);
  if (total === null && !r.servings) return null;
  return (
    <span className="rcp-facts">
      {total !== null ? <span><Clock size={13} aria-hidden /> <span className="sr-only">{t('recipes.total')} </span>{minutesText(total)}</span> : null}
      {r.servings ? <span><Users size={13} aria-hidden /> {t('recipes.serves', { count: r.servings })}</span> : null}
    </span>
  );
}

/** Where a recipe's picture goes when it has none: the dish's first letter on the theme's paper, so a grid still reads as one. */
export function CoverPlaceholder({ title }: { title: string }) {
  return (
    <span className="rcp-nocover" aria-hidden>
      <ChefHat size={26} />
      <b>{[...title.trim()][0]?.toUpperCase() ?? ''}</b>
    </span>
  );
}

export function RecipeCard({ r, tree, defer }: { r: RecipeSummary; tree: string; defer?: boolean }) {
  const t = useT();
  const f = useFamily();
  const p = f.byId.get(r.person);
  const title = r.title || t('recipes.untitled');
  return (
    <Link to="/$tree/recipe/$id" params={{ tree, id: r.id }} className="rcp-card ui-card interactive" data-tour="recipe-card">
      <span className="rcp-card-cover">
        {r.cover
          ? <img src={recipeImageUrl(tree, r.cover.key, 'thumb')} alt="" loading="lazy" width={r.cover.width} height={r.cover.height} />
          : <CoverPlaceholder title={title} />}
      </span>
      <span className="rcp-card-text">
        <b className="rcp-card-title">{title}</b>
        <span className="rcp-card-by">
          {p ? <Portrait person={p} tree={tree} size={24} decorative defer={defer} /> : null}
          <span>{r.source || (p ? displayName(p, f) : r.author)}</span>
        </span>
        <RecipeFacts r={r} />
        {r.tags.length ? <span className="rcp-card-tags">{r.tags.slice(0, 3).map((tag) => <span className="rcp-tag" key={tag}>{tag}</span>)}</span> : null}
      </span>
    </Link>
  );
}

/**
 * A recipe inside another list (a Chronicle entry, the feed, a person's memories): the picture, the facts and the way to
 * its page. `fallback` is what the entry showed before recipes had a form, its text; it stays for a recipe from before
 * (above the way in), and while the cookbook is still on its way.
 */
export function RecipeTeaser({ tree, id, title, fallback }: { tree: string; id: string; title?: string; fallback: ReactNode }) {
  const t = useT();
  const { data } = useQuery(cookbookQuery(tree));
  const r = data?.find((x) => x.id === id);
  if (!r) return <>{fallback}</>;
  const open = (
    <Link className="btn rcp-open" to="/$tree/recipe/$id" params={{ tree, id }}>
      <ChefHat size={15} aria-hidden /> {t('recipes.open')}
    </Link>
  );
  if (!r.structured) return <>{fallback}<div className="rcp-teaser-foot">{open}</div></>;
  const name = title ?? r.title;
  return (
    <div className="rcp-teaser">
      {r.cover ? (
        <Link to="/$tree/recipe/$id" params={{ tree, id }} className="rcp-teaser-cover" aria-label={t('recipes.open_named', { title: name })}>
          <img src={recipeImageUrl(tree, r.cover.key, 'thumb')} alt="" loading="lazy" width={r.cover.width} height={r.cover.height} />
        </Link>
      ) : null}
      <div className="rcp-teaser-text">
        {r.source ? <span className="rcp-teaser-source">{r.source}</span> : null}
        <RecipeFacts r={r} />
        {r.items.length ? <p className="rcp-teaser-items">{r.items.slice(0, 8).join(' · ')}{r.items.length > 8 ? ' …' : ''}</p> : null}
        {r.tags.length ? <span className="rcp-card-tags">{r.tags.slice(0, 4).map((tag) => <span className="rcp-tag" key={tag}>{tag}</span>)}</span> : null}
        <div className="rcp-teaser-foot">{open}</div>
      </div>
    </div>
  );
}
