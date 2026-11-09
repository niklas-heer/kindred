// What every family page carries of the assistant: the "Ask" button and the host that shows the window. The window and the
// minimized bar are loaded on demand (about 40 kB gzipped), when the reader first opens them, or a moment earlier when the
// pointer or the focus reaches the button. A guest, or a family with the assistant off, never loads them.
import { Sparkles } from 'lucide-react';
import { lazy, Suspense, useSyncExternalStore } from 'react';
import { useT } from '~/lib/i18n';
import { AiSetupButton, AiSetupDialog } from './AiSetup';
import { useRunSummary } from './chat-runs';
import { EMPTY_TABS, getTabs, subscribeTabs } from './chat-tabs';
import { openAssistant, useAiStatus, useAssistantMinimized, useAssistantOpen } from './store';
import { useIsPhone } from './useChatWindow';

const loadDrawer = () => import('./AssistantDrawer');
const AssistantDrawer = lazy(() => loadDrawer().then((m) => ({ default: m.AssistantDrawer })));
const ChatDock = lazy(() => import('./ChatDock').then((m) => ({ default: m.ChatDock })));

/** Starts loading the window, so it opens at once when the reader clicks. Safe to call any number of times. */
export function preloadAssistant() {
  loadDrawer().catch(() => {
    // The click loads it again and shows the error there, if there is one.
  });
}

/** Renders the window while it is open, and nothing otherwise. Mount once per family, inside the tree layout. Also the "Set up AI" panel. */
export function AssistantHost({ tree }: { tree: string }) {
  const open = useAssistantOpen();
  const minimized = useAssistantMinimized();
  const phone = useIsPhone();
  const status = useAiStatus(tree);
  return (
    <>
      <AiSetupDialog tree={tree} />
      <Suspense fallback={null}>
        {open && status?.features.assistant ? <AssistantDrawer tree={tree} /> : null}
        {minimized && !phone && status?.features.assistant ? <ChatDock tree={tree} /> : null}
      </Suspense>
    </>
  );
}

/**
 * The "Ask" button. Shown only when the assistant is switched on and configured for this family. A steward of a
 * family with no AI key gets "Set up AI" in its place, which opens the panel that explains it.
 */
export function AssistantButton({ tree, className = '' }: { tree: string; className?: string }) {
  const t = useT();
  const status = useAiStatus(tree);
  const tabs = useSyncExternalStore((l) => subscribeTabs(tree, l), () => getTabs(tree), () => EMPTY_TABS);
  const runs = useRunSummary();
  if (!status?.features.assistant) return <AiSetupButton tree={tree} className={className} />;
  // A reply still running, or one waiting to be read, shows on the button: on a phone it is the only place it can.
  const working = tabs.tabs.some((c) => runs.busy.has(c));
  const waiting = tabs.tabs.some((c) => runs.unread.has(c));
  return (
    <button type="button" className={`btn ai-launch ${className}`} onClick={openAssistant} onPointerEnter={preloadAssistant} onFocus={preloadAssistant} aria-haspopup="dialog">
      <Sparkles size={16} aria-hidden /> {t('ai.askButton')}
      {(working || waiting) && <span className={`ai-run-mark ${working ? 'ai-run-busy' : 'ai-run-unread'}`} role="img" aria-label={t(working ? 'ai.chatRunning' : 'ai.chatUnread')} />}
    </button>
  );
}
