// The minimized window: a small bar at the foot of the screen that stays while the reader moves between pages. It names the
// open chats and says which is still working and which has a reply waiting. Choosing one restores the window, at the same
// size and place, with that chat in front. Not on a phone, where nothing floats.
import { useQuery } from '@tanstack/react-query';
import { Sparkles, X } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { aiThreadsQuery } from '~/lib/ai.functions';
import { threadTitle } from '~/lib/ai/thread-title';
import { useT } from '~/lib/i18n';
import { chatName, RunMark } from './ChatList';
import { getRun, useRunSummary } from './chat-runs';
import { EMPTY_TABS, getTabs, subscribeTabs, updateTabs } from './chat-tabs';
import { closeAssistant, openAssistant } from './store';

const SHOWN = 4;

export function useTabs(tree: string) {
  return useSyncExternalStore((l) => subscribeTabs(tree, l), () => getTabs(tree), () => EMPTY_TABS);
}

export function ChatDock({ tree }: { tree: string }) {
  const t = useT();
  const tabs = useTabs(tree);
  const runs = useRunSummary();
  const threads = useQuery(aiThreadsQuery(tree)).data;
  const name = (conv: string) => {
    const pending = getRun(conv).pending;
    return chatName(t, threads?.find((x) => x.conv === conv), pending ? threadTitle(pending) : t('ai.chatNew'));
  };
  const restore = (conv?: string) => {
    if (conv) updateTabs(tree, (s) => ({ ...s, active: conv }));
    openAssistant();
  };
  // The chats that need attention stay in view when there are more than fit.
  const ordered = [...tabs.tabs].sort((a, b) => Number(runs.busy.has(b) || runs.unread.has(b)) - Number(runs.busy.has(a) || runs.unread.has(a)));
  const shown = ordered.slice(0, SHOWN);
  const more = ordered.length - shown.length;
  return (
    <div className="ai-dock" role="region" aria-label={t('ai.title')}>
      <button type="button" className="ai-dock-restore" onClick={() => restore()} aria-label={t('ai.dockRestore')} title={t('ai.dockRestore')}>
        <Sparkles size={14} aria-hidden />
      </button>
      {shown.map((conv) => (
        <button key={conv} type="button" className="ai-dock-chat" onClick={() => restore(conv)} title={name(conv)}>
          <RunMark conv={conv} summary={runs} />
          <span className="ai-dock-name">{name(conv)}</span>
        </button>
      ))}
      {more > 0 && <button type="button" className="ai-dock-chat ai-dock-more" onClick={() => restore()}>{t('ai.dockMore', { count: more })}</button>}
      <button type="button" className="ai-dock-close" onClick={closeAssistant} aria-label={t('ai.close')} title={t('ai.close')}>
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
