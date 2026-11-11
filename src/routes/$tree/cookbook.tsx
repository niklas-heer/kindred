// The Cookbook, at /<family>/cookbook (docs/recipes.md): every recipe the family has written down, as cards with their
// pictures, to search and to narrow by tag, by whose recipe it is and by house. It is the Chronicle's recipes with their
// own page: reached from the Chronicle and from a person's memories, and from every recipe. A recipe from before
// recipes had a form is here too, as free text. Every reader of the family reads it; members who may add a memory may
// add a recipe.
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ChefHat, Plus, ScrollText, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Arms } from '~/components/Heraldry';
import { RecipeCard } from '~/components/recipes/RecipeCard';
import { RecipeDialog } from '~/components/recipes/RecipeDialog';
import { EmptyState, ErrorState, PageHeader, Select, Skeleton } from '~/components/ui';
import { useDealt } from '~/lib/dealt';
import { useFamily, useTreeId } from '~/lib/family';
import { displayName } from '~/lib/graph';
import { translate, useT, type Locale } from '~/lib/i18n';
import { usePageTrail, useRememberedState } from '~/lib/page-state';
import { foldTag, type RecipeSummary } from '~/lib/recipes/model';
import { cookbookQuery } from '~/lib/recipes/recipes.functions';
import { useCan } from '~/lib/session';
import { treeTitle } from '~/lib/title';
import '~/styles/chronicle.css';
import '~/components/recipes/recipes.css';

interface BookSearch { tag?: string; person?: string; house?: string }
const word = (v: unknown) => (typeof v === 'string' && v.length <= 200 ? v : undefined);

export const Route = createFileRoute('/$tree/cookbook')({
  // The filters are in the address, so a recipe's tag is a link into the Cookbook, and a filtered view can be sent on.
  validateSearch: (s: Record<string, unknown>): BookSearch => {
    const out: BookSearch = {};
    for (const k of ['tag', 'person', 'house'] as const) { const v = word(s[k]); if (v) out[k] = v; }
    return out;
  },
  loader: async ({ context: { queryClient }, params: { tree } }) => { await queryClient.prefetchQuery(cookbookQuery(tree)); },
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'recipes.book.title')) }] }),
  component: CookbookPage,
});

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

function CookbookPage() {
  const f = useFamily();
  const tree = useTreeId();
  const t = useT();
  const navigate = useNavigate();
  usePageTrail('cookbook', tree, t.locale);
  const search = Route.useSearch();
  const { data, isPending, isError, refetch } = useQuery(cookbookQuery(tree));
  const [q, setQ] = useRememberedState(`cookbook:${tree}:q`, '');
  const [adding, setAdding] = useState(false);
  const canWrite = useCan('add-story');
  const dealt = useDealt(!isPending);
  const filter = (patch: BookSearch) => navigate({ to: '/$tree/cookbook', params: { tree }, search: (s) => ({ ...s, ...patch }), replace: true });

  const recipes = useMemo(() => (data ?? []).filter((r) => f.byId.has(r.person)), [data, f]);
  // The tags as the family spells them (the first spelling met), most used first.
  const tags = useMemo(() => {
    const n = new Map<string, { tag: string; n: number }>();
    for (const r of recipes) for (const tag of r.tags) { const k = foldTag(tag); n.set(k, { tag: n.get(k)?.tag ?? tag, n: (n.get(k)?.n ?? 0) + 1 }); }
    return [...n.entries()].sort((a, b) => b[1].n - a[1].n || a[1].tag.localeCompare(b[1].tag)).map(([key, v]) => ({ key, ...v }));
  }, [recipes]);
  const people = useMemo(() => {
    const n = new Map<string, number>();
    for (const r of recipes) n.set(r.person, (n.get(r.person) ?? 0) + 1);
    return [...n.entries()].map(([id, count]) => ({ p: f.byId.get(id)!, count })).sort((a, b) => b.count - a.count || displayName(a.p, f).localeCompare(displayName(b.p, f)));
  }, [recipes, f]);
  const houses = useMemo(() => {
    const n = new Map<string, number>();
    for (const r of recipes) { const h = f.byId.get(r.person)?.house; if (h && f.house.has(h)) n.set(h, (n.get(h) ?? 0) + 1); }
    return [...n.entries()].map(([id, count]) => ({ h: f.house.get(id)!, count })).sort((a, b) => b.count - a.count || a.h.name.localeCompare(b.h.name));
  }, [recipes, f]);

  const tagKey = search.tag ? foldTag(search.tag) : null;
  const tokens = fold(q).split(/\s+/).filter(Boolean);
  const shown = useMemo(() => recipes.filter((r: RecipeSummary) => {
    const p = f.byId.get(r.person)!;
    if (tagKey && !r.tags.some((x) => foldTag(x) === tagKey)) return false;
    if (search.person && r.person !== search.person) return false;
    if (search.house && p.house !== search.house) return false;
    if (!tokens.length) return true;
    const hay = fold(`${r.title} ${r.source} ${r.author} ${displayName(p, f)} ${r.tags.join(' ')} ${r.items.join(' ')}`);
    return tokens.every((x) => hay.includes(x));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [recipes, f, tagKey, search.person, search.house, q]);
  const filtered = !!(tagKey || search.person || search.house || tokens.length);
  const clear = () => { setQ(''); void navigate({ to: '/$tree/cookbook', params: { tree }, search: {}, replace: true }); };

  return (
    <div className="page">
      <div className="page-inner rcp-book">
        <PageHeader
          title={t('recipes.book.title')} icon={<ChefHat size={26} />}
          subtitle={isPending ? t('recipes.loading') : recipes.length ? t('recipes.book.count', { count: recipes.length, kitchens: t('recipes.book.kitchens', { count: people.length }) }) : t('recipes.book.subtitle')}
          actions={<>
            <Link className="btn" to="/$tree/chronicle" params={{ tree }}><ScrollText size={15} aria-hidden /> {t('chronicle.title')}</Link>
            {canWrite ? <button type="button" className="btn primary" onClick={() => setAdding(true)}><Plus size={15} aria-hidden /> {t('recipes.book.add')}</button> : null}
          </>}
        />

        {isPending ? <div className="rcp-grid" aria-busy="true" aria-label={t('recipes.loading')}>{Array.from({ length: 6 }, (_, i) => <div className="ui-card rcp-card" key={i}><Skeleton height={150} radius={0} /><div style={{ padding: 14 }}><Skeleton lines={2} /></div></div>)}</div> : null}
        {isError ? <ErrorState title={t('recipes.error')} message={t('chronicle.error_text')} onRetry={() => { void refetch(); }} /> : null}

        {!isPending && !isError && recipes.length === 0 ? (
          <EmptyState
            icon={<ChefHat size={32} />} title={t('recipes.book.empty_title')} text={t(canWrite ? 'recipes.book.empty_text_write' : 'recipes.book.empty_text')}
            action={canWrite ? <button type="button" className="btn primary" onClick={() => setAdding(true)}><Plus size={15} aria-hidden /> {t('recipes.book.add_first')}</button> : undefined}
          />
        ) : null}

        {!isPending && !isError && recipes.length > 0 ? (
          <>
            <div className="rcp-filters">
              <label className="chr-search rcp-search">
                <Search size={16} aria-hidden />
                <input className="input" type="search" value={q} placeholder={t('recipes.book.search')} aria-label={t('recipes.book.search')} onChange={(e) => setQ(e.target.value)} />
              </label>
              {people.length > 1 ? (
                <Select
                  aria-label={t('recipes.book.by_person')} value={search.person ?? ''} onChange={(v) => { void filter({ person: v || undefined }); }}
                  options={[{ value: '', label: t('recipes.book.everyone') }, ...people.map(({ p, count }) => ({ value: p.id, label: displayName(p, f), hint: String(count) }))]}
                />
              ) : null}
              {houses.length > 1 ? (
                <Select
                  aria-label={t('recipes.book.by_house')} value={search.house ?? ''} onChange={(v) => { void filter({ house: v || undefined }); }}
                  options={[{ value: '', label: t('recipes.book.all_houses') }, ...houses.map(({ h, count }) => ({ value: h.id, label: h.name, hint: String(count), icon: <Arms arms={h.arms} size={18} /> }))]}
                />
              ) : null}
            </div>
            {tags.length ? (
              <div className="rcp-tagbar" role="group" aria-label={t('recipes.book.by_tag')}>
                {tags.map((x) => (
                  <button key={x.key} type="button" className="rcp-tag" aria-pressed={tagKey === x.key} onClick={() => { void filter({ tag: tagKey === x.key ? undefined : x.tag }); }}>
                    {x.tag} <span>{x.n}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {filtered ? (
              <p className="rcp-result" role="status">
                {t('recipes.book.showing', { count: shown.length })}
                <button type="button" className="btn ghost rcp-small" onClick={clear}><X size={13} aria-hidden /> {t('chronicle.clear_filters')}</button>
              </p>
            ) : null}
            {shown.length === 0 ? (
              <EmptyState icon={<Search size={26} />} title={t('chronicle.no_match')} text={t('recipes.book.no_match_text')} action={<button type="button" className="btn" onClick={clear}>{t('chronicle.clear_filters')}</button>} />
            ) : (
              <div className={`rcp-grid ${dealt}`}>
                {shown.map((r, i) => <RecipeCard key={r.id} r={r} tree={tree} defer={i >= 8} />)}
              </div>
            )}
          </>
        ) : null}
        {adding ? <RecipeDialog tree={tree} onClose={() => setAdding(false)} onSaved={(id) => { void navigate({ to: '/$tree/recipe/$id', params: { tree, id } }); }} /> : null}
      </div>
    </div>
  );
}
