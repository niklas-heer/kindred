// One person on a page of their own, at /<family>/person/<id>. The same PersonPanel the tree opens, in its wide layout, so what
// a reader may see or change is decided in one place.
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { NotFoundPage } from '~/components/NotFoundPage';
import { PersonPanel } from '~/components/PersonPanel';
import { useFamily, useMeChosen } from '~/lib/family';
import { graphQuery } from '~/lib/api';
import { houseMeaningsQuery, houseTranslationsQuery } from '~/lib/house-meaning.functions';
import { personDetailQuery } from '~/lib/person.functions';
import { personPhotosQuery } from '~/lib/photos.functions';
import { personResearchQuery } from '~/lib/research.functions';
import { personName, treeTitle } from '~/lib/title';

export const Route = createFileRoute('/$tree/person/$id')({
  // What the panel's overview fetches for itself, fetched before the page renders, so the server sends the details, the
  // photos and the research rather than "Loading…". Each of them is open to every reader of the family (the server shapes
  // what each role sees); the house's meaning only when the person has a house, as the panel asks. Failures are the panel's.
  loader: async ({ context: { queryClient, locale }, params: { tree, id } }) => {
    const graph = await queryClient.ensureQueryData(graphQuery(tree));
    const house = graph.people.find((p) => p.id === id)?.house;
    await Promise.all([
      queryClient.prefetchQuery(personDetailQuery(tree, id)),
      queryClient.prefetchQuery(personPhotosQuery(tree, id)),
      queryClient.prefetchQuery(personResearchQuery(tree, id)),
      ...(house ? [queryClient.prefetchQuery(houseMeaningsQuery(tree)), queryClient.prefetchQuery(houseTranslationsQuery(tree, locale))] : []),
    ]);
  },
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, personName(ctx, ctx.match.params.id)) }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { tree, id } = Route.useParams();
  const f = useFamily();
  const me = useMeChosen();
  const navigate = useNavigate();
  const page = useRef<HTMLDivElement>(null);
  // Going from one relative to the next starts at the top of the new page.
  useEffect(() => { page.current?.scrollTo({ top: 0 }); }, [id]);
  if (!f.byId.has(id)) return <NotFoundPage />;
  const toTree = (search: { focus?: string; view?: 'dynasty' | 'ancestors'; lens?: 'path'; to?: string }) => navigate({ to: '/$tree', params: { tree }, search });
  return (
    <div ref={page} className="page profile-page">
      <PersonPanel
        page
        family={f}
        tree={tree}
        id={id}
        me={me}
        onSelect={(next) => navigate({ to: '/$tree/person/$id', params: { tree, id: next } })}
        onCenter={() => toTree({ focus: id })}
        onPath={() => toTree({ focus: id, lens: 'path', to: id })}
        onDynasty={() => toTree({ focus: id, view: 'dynasty' })}
        onAncestors={() => toTree({ focus: id, view: 'ancestors' })}
        onClose={() => toTree({})}
      />
    </div>
  );
}
