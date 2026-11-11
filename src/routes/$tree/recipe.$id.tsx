// One recipe on a page of its own, at /<family>/recipe/<id> (docs/recipes.md): the picture, whose it is, the ingredients
// to tick off with the amounts for as many as are coming, the method, and the story that goes with it. "Start cooking"
// turns it into large steps on a screen that stays awake; Print gives a clean sheet. Every reader of the family reads
// it, as they read the Chronicle; what a guest may see is decided on the server.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ChefHat, CookingPot, Minus, Pencil, Plus, Printer, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PersonLink } from '~/components/chronicle/StoryCard';
import { NotFoundPage } from '~/components/NotFoundPage';
import { PortraitZoom } from '~/components/photos/PortraitZoom';
import { CookMode } from '~/components/recipes/CookMode';
import { IngredientList, useTicks } from '~/components/recipes/IngredientList';
import { totalMinutes } from '~/components/recipes/RecipeCard';
import { RecipeDialog } from '~/components/recipes/RecipeDialog';
import { Responses } from '~/components/responses/Responses';
import { ConfirmDialog, ErrorState, Skeleton } from '~/components/ui';
import { storyTranslationsQuery } from '~/lib/ai/background.functions';
import { deleteStory, newOpKey, restoreStory } from '~/lib/api';
import { errorText } from '~/lib/errortext';
import { useFamily } from '~/lib/family';
import { dateText, richText, translate, useT, type Locale } from '~/lib/i18n';
import { renderMarkdown } from '~/lib/markdown';
import { useRememberedState } from '~/lib/page-state';
import { formatAmount, minutesText, parseServings, recipeImageUrl, type RecipeDetail } from '~/lib/recipes/model';
import { recipeQuery } from '~/lib/recipes/recipes.functions';
import { treeTitle } from '~/lib/title';
import { toast } from '~/lib/toast';
import '~/styles/chronicle.css';
import '~/components/assistant/ai-tasks.css';
import '~/components/recipes/recipes.css';

export const Route = createFileRoute('/$tree/recipe/$id')({
  // The page's own read, fetched before it renders, so the server sends the recipe and not a placeholder.
  loader: async ({ context: { queryClient }, params: { tree, id } }) => {
    const r = await queryClient.fetchQuery(recipeQuery(tree, id)).catch(() => null);
    return { title: r?.title ?? null };
  },
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, ctx.loaderData?.title || translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'recipes.recipe')) }] }),
  component: RecipePage,
});

function RecipePage() {
  const { tree, id } = Route.useParams();
  const t = useT();
  const { data, isPending, isError, refetch } = useQuery(recipeQuery(tree, id));
  if (isPending) return <div className="page"><div className="page-inner rcp-page" aria-busy="true" aria-label={t('recipes.loading')}><div className="ui-card" style={{ padding: 24 }}><Skeleton height={220} /><Skeleton lines={5} /></div></div></div>;
  if (isError) return <div className="page"><div className="page-inner rcp-page"><ErrorState title={t('recipes.error')} message={t('chronicle.error_text')} onRetry={() => { void refetch(); }} /></div></div>;
  if (!data) return <NotFoundPage />;
  return <Recipe tree={tree} r={data} />;
}

function Recipe({ tree, r }: { tree: string; r: RecipeDetail }) {
  const t = useT();
  const f = useFamily();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const p = f.byId.get(r.person);
  const ticks = useTicks(tree, r.id);
  const [editing, setEditing] = useState(false);
  const [cooking, setCooking] = useState(false);
  const [asking, setAsking] = useState(false);
  // How many are coming (or, for a recipe that does not say what it serves, how many times the recipe).
  const [wanted, setWanted] = useRememberedState<number | null>(`recipe:${tree}:${r.id}:servings`, null);
  const base = r.servings;
  const factor = base ? (wanted ?? base) / base : (wanted ?? 1);
  // An AI translation of the written-out recipe into the reader's language, when the family has those (docs/ai.md).
  const tr = (useQuery(storyTranslationsQuery(tree, t.locale)).data ?? {})[r.id];
  const [translated, setTranslated] = useState(!r.structured);
  const showTranslation = !!tr && translated;
  const title = (showTranslation ? tr.title : null) || r.title || t('recipes.untitled');
  const total = totalMinutes(r);

  const remove = useMutation({
    mutationFn: async () => {
      const removal = newOpKey();
      await deleteStory({ data: { tree, id: r.id, opKey: removal } });
      return removal;
    },
    onSuccess: async (removal) => {
      const refresh = () => Promise.all(['cookbook', 'chronicle', 'feed', 'person', 'graph', 'recipe'].map((k) => qc.invalidateQueries({ queryKey: [k, tree] })));
      setAsking(false);
      toast({
        title: t('recipes.removed'), body: r.title, person: r.person, icon: 'quill-ink',
        // Removed the wrong one? The server kept it, with its pictures, and puts it back as it was.
        action: {
          label: t('quick.undo'),
          run: async () => {
            try {
              await restoreStory({ data: { tree, removal } });
              await refresh();
              await navigate({ to: '/$tree/recipe/$id', params: { tree, id: r.id } });
            } catch (e) {
              toast({ title: t('quick.undoFailed'), body: errorText(e, t.locale) || undefined });
            }
          },
        },
      });
      await navigate({ to: '/$tree/cookbook', params: { tree } });
      await refresh();
    },
  });

  return (
    <div className="page">
      <div className="page-inner rcp-page">
        <nav className="rcp-crumbs">
          <Link to="/$tree/cookbook" params={{ tree }} className="btn ghost"><ArrowLeft size={15} aria-hidden /> {t('recipes.book.title')}</Link>
        </nav>
        <article className="rcp rcp-doc ui-card" data-tour="recipe" data-cover={r.cover ? '' : undefined}>
          {r.cover ? (
            <figure className="rcp-hero" style={{ aspectRatio: `${r.cover.width} / ${r.cover.height}` }}>
              <img src={recipeImageUrl(tree, r.cover.key)} alt={t('recipes.cover_of', { title })} width={r.cover.width} height={r.cover.height} />
            </figure>
          ) : null}
          <header className="rcp-head">
            <p className="rcp-kicker"><ChefHat size={15} aria-hidden /> {r.source || t('recipes.recipe')}</p>
            <h1>{title}</h1>
            <div className="rcp-byline">
              {p ? <PortraitZoom person={p} tree={tree} size={52} className="rcp-face" /> : null}
              <div>
                <span className="rcp-whose">{richText(t, 'recipes.from_kitchen', { person: <PersonLink p={p} f={f} tree={tree} /> })}</span>
                <small>
                  {t('recipes.shared_by', { author: r.author })} · <time dateTime={r.at}>{dateText(new Date(r.at), t.locale, { day: 'numeric', month: 'short', year: 'numeric' })}</time>
                </small>
              </div>
            </div>
            {r.structured && (total !== null || base) ? (
              <dl className="rcp-meta">
                {r.prepMinutes !== null ? <div><dt>{t('recipes.prep')}</dt><dd>{minutesText(r.prepMinutes)}</dd></div> : null}
                {r.cookMinutes !== null ? <div><dt>{t('recipes.cook')}</dt><dd>{minutesText(r.cookMinutes)}</dd></div> : null}
                {r.prepMinutes !== null && r.cookMinutes !== null ? <div><dt>{t('recipes.total')}</dt><dd>{minutesText(total!)}</dd></div> : null}
                {base ? <div><dt>{t('recipes.makes')}</dt><dd>{t('recipes.servings', { count: base })}</dd></div> : null}
              </dl>
            ) : null}
            {r.tags.length ? (
              <ul className="rcp-tags" aria-label={t('recipes.tags')}>
                {r.tags.map((tag) => <li key={tag}><Link className="rcp-tag" to="/$tree/cookbook" params={{ tree }} search={{ tag }}>{tag}</Link></li>)}
              </ul>
            ) : null}
            <div className="rcp-actions">
              {r.structured && r.steps.length ? <button type="button" className="btn primary" data-tour="recipe-cook" onClick={() => setCooking(true)}><CookingPot size={16} aria-hidden /> {t('recipes.start_cooking')}</button> : null}
              <button type="button" className="btn" onClick={() => window.print()}><Printer size={15} aria-hidden /> {t('recipes.print')}</button>
              {r.editable ? <button type="button" className="btn" onClick={() => setEditing(true)}><Pencil size={15} aria-hidden /> {r.structured ? t('recipes.edit') : t('recipes.structure')}</button> : null}
              {r.removable ? <button type="button" className="btn ghost" onClick={() => { remove.reset(); setAsking(true); }}><Trash2 size={15} aria-hidden /> {t('recipes.remove')}</button> : null}
            </div>
            {tr ? (
              <p className="chr-ai rcp-translated">
                <Sparkles size={14} aria-hidden /> {showTranslation ? t('aitasks.chronicle.translated') : t('recipes.translation_there')}
                <button type="button" className="btn ghost" onClick={() => setTranslated(!translated)}>{showTranslation ? t('aitasks.chronicle.showOriginal') : t('aitasks.chronicle.showTranslation')}</button>
              </p>
            ) : null}
          </header>

          {showTranslation || !r.structured ? (
            <div className="rcp-plain">
              <div className="chr-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(showTranslation ? tr.body : r.body) }} />
              {!r.structured && r.editable ? <p className="rcp-hint rcp-plain-hint">{t('recipes.structure_hint')}</p> : null}
            </div>
          ) : (
            <div className="rcp-body">
              {r.groups.length ? (
                <section className="rcp-col-ing" aria-labelledby="rcp-ing-title">
                  <div className="rcp-col-head">
                    <h2 id="rcp-ing-title">{t('recipes.ingredients')}</h2>
                    {ticks.count ? <button type="button" className="btn ghost rcp-small" onClick={ticks.clear}>{t('recipes.ticks_clear')}</button> : null}
                  </div>
                  <Scaler base={base} wanted={wanted} onChange={setWanted} />
                  <IngredientList groups={r.groups} factor={factor} ticks={ticks} />
                </section>
              ) : null}
              <section className="rcp-col-method" aria-labelledby="rcp-method-title">
                {r.steps.length ? (
                  <>
                    <h2 id="rcp-method-title">{t('recipes.method')}</h2>
                    <ol className="rcp-steps">
                      {r.steps.map((s, i) => (
                        <li key={i}>
                          <span className="rcp-step-n" aria-hidden>{i + 1}</span>
                          <div>
                            {s.text ? <p>{s.text}</p> : null}
                            {s.image && r.pictures[s.image] ? (
                              <img src={recipeImageUrl(tree, s.image)} alt={t('recipes.step_picture', { n: i + 1 })} loading="lazy" width={r.pictures[s.image]!.width} height={r.pictures[s.image]!.height} />
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </>
                ) : null}
                {r.notes ? (
                  <div className="rcp-notes">
                    <h2>{t('recipes.notes')}</h2>
                    <div className="chr-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(r.notes) }} />
                  </div>
                ) : null}
              </section>
            </div>
          )}
          <footer className="rcp-print-foot">{t('recipes.print_foot', { family: f.graph.tree.name })}</footer>
        </article>
        {/* Members only: for a guest it draws nothing and asks nothing. */}
        <div className="rcp-responses"><Responses tree={tree} kind="story" target={r.id} /></div>
      </div>
      {editing ? <RecipeDialog tree={tree} edit={r} onClose={() => setEditing(false)} /> : null}
      {cooking ? <CookMode tree={tree} recipe={r} factor={factor} ticks={ticks} onClose={() => setCooking(false)} /> : null}
      <ConfirmDialog
        open={asking} onClose={() => setAsking(false)} onConfirm={() => remove.mutate()} title={t('recipes.remove_title')} confirmLabel={t('recipes.remove_yes')}
        busy={remove.isPending} error={remove.isError ? errorText(remove.error, t.locale) || t('recipes.remove_failed') : undefined}
      >
        <blockquote className="ui-confirm-quote">{r.title}<small>{t('recipes.shared_by', { author: r.author })}</small></blockquote>
      </ConfirmDialog>
    </div>
  );
}

/**
 * How much to make. A recipe that says what it serves is scaled by people: fewer, more, or any number typed in; half and
 * double are one press. One that does not is scaled by times: ½×, 1×, 2×, 3×.
 */
function Scaler({ base, wanted, onChange }: { base: number | null; wanted: number | null; onChange: (n: number | null) => void }) {
  const t = useT();
  const now = wanted ?? base ?? 1;
  const factor = base ? now / base : now;
  const set = (n: number) => onChange(base ? (Math.abs(n - base) < 1e-9 ? null : n) : n === 1 ? null : n);
  const times = (x: number) => set(base ? base * x : x);
  const quick = base ? [0.5, 1, 2] : [0.5, 1, 2, 3];
  const [draft, setDraft] = useState<string | null>(null);
  // A number the box cannot read leaves the servings as they were.
  const commit = () => {
    if (draft === null) return;
    const n = parseServings(draft);
    if (n !== null) set(n);
    setDraft(null);
  };
  return (
    <div className="rcp-scaler" role="group" aria-label={t('recipes.scale')}>
      {base ? (
        <div className="rcp-stepper">
          <button type="button" className="btn icon" aria-label={t('recipes.scale_fewer')} disabled={now <= 1} onClick={() => set(Math.max(1, Math.ceil(now) - 1))}><Minus size={15} aria-hidden /></button>
          <label>
            {/* What is typed stays as typed ("1,", or nothing for a moment) and counts on Enter or when the box is left. */}
            <input
              className="input" inputMode="decimal" aria-label={t('recipes.scale_servings')} value={draft ?? formatAmount(now, t.locale, true)}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => { setDraft(formatAmount(now, t.locale, true)); e.target.select(); }}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commit(); }
                else if (e.key === 'Escape' && draft !== null) { e.preventDefault(); setDraft(formatAmount(now, t.locale, true)); }
              }}
            />
            <span>{t('recipes.servings_word', { count: Math.round(now) || 1 })}</span>
          </label>
          <button type="button" className="btn icon" aria-label={t('recipes.scale_more')} disabled={now >= 999} onClick={() => set(Math.min(999, Math.floor(now) + 1))}><Plus size={15} aria-hidden /></button>
        </div>
      ) : null}
      <div className="rcp-times">
        {quick.map((x) => (
          <button key={x} type="button" className="btn" aria-pressed={Math.abs(factor - x) < 1e-9} onClick={() => times(x)}>{x === 0.5 ? '½' : x}×</button>
        ))}
      </div>
    </div>
  );
}
