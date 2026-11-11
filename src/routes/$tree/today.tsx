// Today: the family's common room, and the page a relative opens again tomorrow. The family's feed leads (a way to say
// something, then what people wrote, remembered, photographed and added: src/components/feed/, docs/feed.md). Beside it
// on a wide screen are the cards that were Today before the feed: this week's question, today's quiz, the week's
// birthdays and anniversaries, what's new since the last visit, the Campaign, and one small thing the family still
// wants to know. On a phone and a tablet those cards fold into one strip of buttons above the feed, one card open at a
// time, so the first things on the screen are the family and a way to answer it. Each card fetches what it needs.
// Members only: the layout sends a share-link guest back to the tree, and the server refuses them all of it.
//
// The cards come before the feed in the page's source: the strip is above the feed on a phone, and with a keyboard a
// reader passes a handful of cards rather than a feed without end to reach them.
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { CalendarHeart, Sparkles, Sprout, Swords, UserSearch } from 'lucide-react';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { CampaignCard, useCampaignCard } from '~/components/campaign/CampaignCard';
import { Feed } from '~/components/feed/Feed';
import { GameIcon } from '~/components/GameIcon';
import { DatesCard } from '~/components/today/DatesCard';
import { NudgeCard, useNudge } from '~/components/today/NudgeCard';
import { QuizCard } from '~/components/today/QuizCard';
import { WeekQuestionCard } from '~/components/today/WeekQuestionCard';
import { WhatsNew } from '~/components/today/WhatsNew';
import { useWhoIsThis, WhoIsThis } from '~/components/whois/WhoIsThis';
import '~/components/today/today.css';
import { Fleuron, Switch } from '~/components/ui';
import { useToday } from '~/lib/clock';
import { feedQuery } from '~/lib/feed/feed.functions';
import { formatDate, translate, useT, type Locale } from '~/lib/i18n';
import { usePageTrail } from '~/lib/page-state';
import { setPref, usePref } from '~/lib/prefs';
import { useSession } from '~/lib/session';
import { treeTitle } from '~/lib/title';
import { OPEN_PREF } from '~/lib/today/opening';
import { quizQuery, weekQuery } from '~/lib/today/today.functions';

export const Route = createFileRoute('/$tree/today')({
  // Fetched before the page renders, so the server sends the feed's first page, the question and the quiz rather than
  // three placeholders. A failure is the card's to show.
  loader: async ({ context: { queryClient }, params: { tree } }) => {
    await Promise.all([queryClient.prefetchInfiniteQuery(feedQuery(tree)), queryClient.prefetchQuery(weekQuery(tree)), queryClient.prefetchQuery(quizQuery(tree))]);
  },
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'today.title')) }] }),
  component: TodayPage,
});

const never = () => () => {};
/** The part of the reader's day, for the greeting; undefined on the server, whose clock is not theirs. */
function usePartOfDay(): 'morning' | 'day' | 'evening' | undefined {
  return useSyncExternalStore(never, () => { const h = new Date().getHours(); return h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 18 ? 'day' : 'evening'; }, () => undefined);
}

type CardId = 'week' | 'quiz' | 'dates' | 'news' | 'campaign' | 'nudge' | 'whois';

function TodayPage() {
  const t = useT();
  const { tree } = Route.useParams();
  usePageTrail('today', tree, t.locale);
  const today = useToday();
  const part = usePartOfDay();
  const name = useSession()?.user?.name?.trim().split(/\s+/)[0];
  const opens = usePref(OPEN_PREF(tree)) === 'today';
  const hello = part === 'morning' ? 'today.hello_morning' : part === 'evening' ? 'today.hello_evening' : part === 'day' ? 'today.hello_day' : 'today.hello';

  // The cards. Three of them have nothing to show for some readers (the Campaign while it is off, a day without a nudge,
  // "Who is this?" while every photograph has someone named in it):
  // those have no button in the strip either.
  const campaign = useCampaignCard(tree);
  const nudge = useNudge(tree);
  const whois = useWhoIsThis(tree);
  const quiz = useQuery(quizQuery(tree)).data;
  const quizOpen = !!quiz?.enabled && !!quiz.question && !quiz.mine;
  const cards: { id: CardId; label: string; icon: ReactNode; mark?: string; card: ReactNode }[] = [
    { id: 'week', label: t('feed.strip.week'), icon: <GameIcon name="quill-ink" size={16} />, card: <WeekQuestionCard tree={tree} /> },
    { id: 'quiz', label: t('feed.strip.quiz'), icon: <GameIcon name="laurel-crown" size={16} />, mark: quizOpen ? t('feed.strip.quiz_open') : undefined, card: <QuizCard tree={tree} /> },
    { id: 'dates', label: t('feed.strip.dates'), icon: <CalendarHeart size={16} aria-hidden />, card: <DatesCard tree={tree} /> },
    { id: 'news', label: t('feed.strip.news'), icon: <Sparkles size={16} aria-hidden />, card: <WhatsNew tree={tree} /> },
    ...(campaign ? [{ id: 'campaign' as const, label: t('campaign.nav'), icon: <Swords size={16} aria-hidden />, card: <CampaignCard tree={tree} /> }] : []),
    ...(whois ? [{ id: 'whois' as const, label: t('whois.title'), icon: <UserSearch size={16} aria-hidden />, card: <WhoIsThis tree={tree} /> }] : []),
    ...(nudge ? [{ id: 'nudge' as const, label: t('feed.strip.nudge'), icon: <Sprout size={16} aria-hidden />, card: <NudgeCard tree={tree} nudge={nudge} /> }] : []),
  ];
  // Which card the strip has open, on a phone and a tablet. None at first: the feed is what the page is for.
  const [open, setOpen] = useState<CardId | null>(null);

  return (
    <div className="page">
      <div className="page-inner td">
        <header className="td-hero" data-tour="today-hero">
          {/* The reader's own date: empty on the server, so the two never disagree around midnight. */}
          <p className="td-hero-date">{today ? formatDate(today, t.locale, { weekday: 'long', year: undefined }) : ' '}</p>
          <h1>{name ? t(hello, { name }) : t('today.title')}</h1>
          <p className="td-hero-sub">{t('today.subtitle')}</p>
          <span className="td-hero-rule" aria-hidden><Fleuron /></span>
        </header>

        <div className="td-grid">
          <aside className="td-side" aria-label={t('feed.strip.label')} data-tour="today-cards">
            <div className="td-strip" role="group" aria-label={t('feed.strip.label')}>
              {cards.map((c) => (
                <button key={c.id} type="button" className="td-strip-btn" aria-expanded={open === c.id} aria-controls={`td-card-${c.id}`} onClick={() => setOpen(open === c.id ? null : c.id)}>
                  {c.icon} <span>{c.label}</span>
                  {c.mark ? <span className="td-strip-dot" role="img" aria-label={c.mark} title={c.mark} /> : null}
                </button>
              ))}
            </div>
            {cards.map((c) => <div key={c.id} className="td-panel" id={`td-card-${c.id}`} data-open={open === c.id || undefined}>{c.card}</div>)}
            <div className="td-foot">
              <Switch checked={opens} onChange={(on) => setPref(OPEN_PREF(tree), on ? 'today' : null)}>{t('today.open_here')}</Switch>
            </div>
          </aside>
          <div className="td-main" data-tour="feed">
            <Feed tree={tree} />
          </div>
        </div>
      </div>
    </div>
  );
}
