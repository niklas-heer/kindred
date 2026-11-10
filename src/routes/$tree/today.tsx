// Today: the page a relative opens again tomorrow. This week's question and its answers, today's quiz, the week's
// birthdays and anniversaries, the Campaign while it is on, and one small thing the family still wants to know. Each
// part is a card of its own in src/components/today/ that fetches what it needs. Members only: the layout sends a
// share-link guest back to the tree, and the server refuses them the question and the quiz.
import { createFileRoute } from '@tanstack/react-router';
import { useSyncExternalStore } from 'react';
import { CampaignCard } from '~/components/campaign/CampaignCard';
import { DatesCard } from '~/components/today/DatesCard';
import { NudgeCard } from '~/components/today/NudgeCard';
import { QuizCard } from '~/components/today/QuizCard';
import { WeekQuestionCard } from '~/components/today/WeekQuestionCard';
import { WhatsNew } from '~/components/today/WhatsNew';
import '~/components/today/today.css';
import { Fleuron, Switch } from '~/components/ui';
import { useToday } from '~/lib/clock';
import { formatDate, translate, useT, type Locale } from '~/lib/i18n';
import { usePageTrail } from '~/lib/page-state';
import { setPref, usePref } from '~/lib/prefs';
import { useSession } from '~/lib/session';
import { treeTitle } from '~/lib/title';
import { OPEN_PREF } from '~/lib/today/opening';
import { quizQuery, weekQuery } from '~/lib/today/today.functions';

export const Route = createFileRoute('/$tree/today')({
  // Fetched before the page renders, so the server sends the question and the quiz rather than two placeholders. A
  // failure is the card's to show.
  loader: async ({ context: { queryClient }, params: { tree } }) => {
    await Promise.all([queryClient.prefetchQuery(weekQuery(tree)), queryClient.prefetchQuery(quizQuery(tree))]);
  },
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'today.title')) }] }),
  component: TodayPage,
});

const never = () => () => {};
/** The part of the reader's day, for the greeting; undefined on the server, whose clock is not theirs. */
function usePartOfDay(): 'morning' | 'day' | 'evening' | undefined {
  return useSyncExternalStore(never, () => { const h = new Date().getHours(); return h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 18 ? 'day' : 'evening'; }, () => undefined);
}

function TodayPage() {
  const t = useT();
  const { tree } = Route.useParams();
  usePageTrail('today', tree, t.locale);
  const today = useToday();
  const part = usePartOfDay();
  const name = useSession()?.user?.name?.trim().split(/\s+/)[0];
  const opens = usePref(OPEN_PREF(tree)) === 'today';
  const hello = part === 'morning' ? 'today.hello_morning' : part === 'evening' ? 'today.hello_evening' : part === 'day' ? 'today.hello_day' : 'today.hello';

  return (
    <div className="page">
      <div className="page-inner td">
        <header className="td-hero">
          {/* The reader's own date: empty on the server, so the two never disagree around midnight. */}
          <p className="td-hero-date">{today ? formatDate(today, t.locale, { weekday: 'long', year: undefined }) : ' '}</p>
          <h1>{name ? t(hello, { name }) : t('today.title')}</h1>
          <p className="td-hero-sub">{t('today.subtitle')}</p>
          <span className="td-hero-rule" aria-hidden><Fleuron /></span>
        </header>

        <div className="td-grid">
          <div className="td-main">
            <WhatsNew tree={tree} />
            <WeekQuestionCard tree={tree} />
          </div>
          <div className="td-side">
            <QuizCard tree={tree} />
            <DatesCard tree={tree} />
            {/* Campaign slot: the card renders nothing while the game is off. */}
            <CampaignCard tree={tree} />
            <NudgeCard tree={tree} />
          </div>
        </div>

        <footer className="td-foot">
          <Switch checked={opens} onChange={(on) => setPref(OPEN_PREF(tree), on ? 'today' : null)}>{t('today.open_here')}</Switch>
        </footer>
      </div>
    </div>
  );
}
