// The messages in the family's feed that are about one person, on their page (the Stories tab of the person panel):
// newest first, each as the feed shows it, with its reactions and comments. Members only: for a share-link guest it
// draws nothing and asks nothing. Nothing either while nobody has written about them.
//
//   <PersonPosts tree={tree} person={p} />
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useToday } from '~/lib/clock';
import { personPostsQuery } from '~/lib/feed/feed.functions';
import { useT } from '~/lib/i18n';
import { useMember } from '~/lib/session';
import type { GPerson } from '~/lib/types';
import { PostCard } from './PostCard';
import './feed.css';

export function PersonPosts({ tree, person }: { tree: string; person: GPerson }) {
  const t = useT();
  const member = !!useMember(tree);
  const posts = useQuery({ ...personPostsQuery(tree, person.id), enabled: member }).data;
  // The reader's own clock, for "3 days ago": undefined until the page runs in the browser.
  const today = useToday();
  const [openedAt] = useState(() => Date.now());
  const now = useMemo(() => (today ? openedAt : undefined), [today, openedAt]);
  if (!member || !posts?.length) return null;
  return (
    <section className="fd fd-person" aria-label={t('feed.person.title')}>
      <div className="rule">{t('feed.person.title')}</div>
      <p className="subtle" style={{ margin: 0 }}>{t('feed.person.hint', { count: posts.length, name: person.given })}</p>
      <ol className="chr-feed fd-person-list">
        {posts.map((post) => <PostCard key={post.id} post={post} tree={tree} now={now} defer />)}
      </ol>
    </section>
  );
}
