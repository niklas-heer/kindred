// Suggestions on a person's page and in the tree's person panel (PersonPanel): the "Suggest a change" button for those who
// suggest rather than edit, the reader's own suggestions about this person, and for an editor or steward how many about
// them wait, with a link to the Suggestions page filtered to them.
//
// Who is offered the button: a member whose role may suggest but not edit people (a viewer or a contributor; editors edit
// directly), and a share-link guest while the family lets guests suggest, unless the link protects living people and this
// person is living (the server refuses that anyway, as if the person were not there).
//
//   const maySuggest = useMaySuggest(tree, p);
//   {maySuggest && <SuggestButton tree={tree} p={p} />}
//   <PersonSuggestions tree={tree} p={p} />
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Inbox, MessageSquarePlus } from 'lucide-react';
import { useId, useState } from 'react';
import { useFamily } from '~/lib/family';
import { useT } from '~/lib/i18n';
import { can } from '~/lib/roles';
import { useMember, useRole, useSession } from '~/lib/session';
import { mySuggestionsQuery, suggestionCountsQuery, suggestSettingsQuery } from '~/lib/suggestions/suggestions.functions';
import type { GPerson } from '~/lib/types';
import { MySuggestions } from './MySuggestions';
import { SuggestDialog } from './SuggestDialog';
import './suggestions.css';

/** Whether this reader suggests changes rather than making them: a member, by role; a guest, by the family's switch. */
function useSuggester(tree: string) {
  const member = !!useMember(tree);
  const role = useRole();
  const guest = useSession()?.guest?.tree === tree;
  const guests = !!useQuery({ ...suggestSettingsQuery(tree), enabled: guest }).data?.guests;
  return { member, guest, suggests: member ? can(role, 'suggest') && !can(role, 'edit-person') : guest && guests, reviews: member && can(role, 'review-suggestions') };
}

/** Whether "Suggest a change" is offered on this person. */
export function useMaySuggest(tree: string, p: GPerson | undefined): boolean {
  const f = useFamily();
  const { suggests, guest } = useSuggester(tree);
  if (!p || !suggests) return false;
  return !(guest && f.graph.livingProtected && p.living);
}

export function SuggestButton({ tree, p }: { tree: string; p: GPerson }) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn sg-open" aria-haspopup="dialog" aria-describedby={`${id}-h`} onClick={() => setOpen(true)}>
        <MessageSquarePlus size={15} aria-hidden /> {t('suggest.open')}
      </button>
      <small className="subtle sg-open-hint" id={`${id}-h`}>{t('suggest.open_hint')}</small>
      {open && <SuggestDialog tree={tree} p={p} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The reader's own suggestions about this person, and for a reviewer how many wait. Nothing when there is neither. */
export function PersonSuggestions({ tree, p }: { tree: string; p: GPerson }) {
  const t = useT();
  const id = useId();
  const { member, guest, reviews } = useSuggester(tree);
  // A member below editing suggests; a guest may have suggested before the family turned guests off, so asks either way.
  const mine = useQuery({ ...mySuggestionsQuery(tree, p.id), enabled: (member && !reviews) || guest }).data ?? [];
  const waiting = useQuery({ ...suggestionCountsQuery(tree), enabled: reviews }).data?.people[p.id] ?? 0;
  if (!mine.length && !waiting) return null;
  return (
    <section className="sg-person" aria-labelledby={mine.length ? `${id}-h` : undefined} aria-label={mine.length ? undefined : t('suggest.nav')}>
      {waiting > 0 && (
        <Link className="sg-waiting" to="/$tree/suggestions" params={{ tree }} search={{ person: p.id }}>
          <Inbox size={15} aria-hidden /> {t('suggest.person.waiting', { count: waiting })}
        </Link>
      )}
      {mine.length > 0 && (
        <>
          <h3 className="rule" id={`${id}-h`}>{t('suggest.person.mine')}</h3>
          <MySuggestions tree={tree} list={mine} />
          <Link className="sg-all" to="/$tree/suggestions" params={{ tree }}>{t('suggest.person.all_mine')}</Link>
        </>
      )}
    </section>
  );
}
