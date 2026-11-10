import { MessageSquarePlus, PanelLeft, Sparkles, Users, X } from 'lucide-react';
import { useT } from '~/lib/i18n';
import { ChatTabs } from './ChatList';
import { WindowControls, type ChatWindow } from './useChatWindow';

/**
 * The window's head: the list of chats, the title (on a phone, the chat's name), a family session and a new chat, the
 * window's own controls and Close, then the open chats as tabs. During a family session only the title and the window
 * controls stay. `elsewhere`: a reply came in another open chat.
 */
export function DrawerHeader({ win, session, listOpen, elsewhere, title, canDraft, busy, tabs, active, tabName, onToggleList, onSession, onNew, onClose, onSwitch, onCloseTab }: {
  win: ChatWindow; session: boolean; listOpen: boolean; elsewhere: boolean; title: string; canDraft: boolean; busy: boolean;
  tabs: string[]; active: string | null; tabName: (conv: string) => string;
  onToggleList: () => void; onSession: () => void; onNew: () => void; onClose: () => void; onSwitch: (conv: string) => void; onCloseTab: (conv: string) => void;
}) {
  const t = useT();
  return (
    <header className="ai-drawer-head" onPointerDown={win.onHeaderPointerDown}>
      <div className="ai-drawer-bar">
        {!session && (
          <button type="button" className="btn ghost ai-touch ai-icon ai-chats-toggle" onClick={onToggleList} aria-expanded={listOpen} aria-label={t(listOpen ? 'ai.chatsClose' : 'ai.chatsOpen')} title={t(listOpen ? 'ai.chatsClose' : 'ai.chatsOpen')}>
            <PanelLeft size={16} aria-hidden />
            {elsewhere && <span className="ai-run-mark ai-run-unread ai-chats-toggle-mark" aria-hidden />}
          </button>
        )}
        <h2 className="ai-drawer-title"><Sparkles size={16} aria-hidden /> <span>{title}</span></h2>
        <div className="ai-drawer-tools">
          {canDraft && !session && (
            <button type="button" className="btn ghost ai-touch ai-icon ai-tool" onClick={onSession} disabled={busy} aria-label={t('ai.sessionStart')} title={t('ai.sessionStart')}>
              <Users size={16} aria-hidden />
            </button>
          )}
          {!session && (
            <button type="button" className="btn ghost ai-touch ai-icon ai-tool ai-tool-new" onClick={onNew} aria-label={t('ai.chatNew')} title={t('ai.chatNew')}>
              <MessageSquarePlus size={16} aria-hidden />
            </button>
          )}
        </div>
        <WindowControls win={win} />
        <button type="button" className="btn ghost ai-touch ai-icon ai-drawer-close" onClick={onClose} aria-label={t('ai.close')} title={t('ai.close')}>
          <X size={17} aria-hidden />
        </button>
      </div>
      {!session && !win.phone && tabs.length > 0 && (
        <ChatTabs tabs={tabs} active={active} names={tabName} onSwitch={onSwitch} onClose={onCloseTab} onNew={onNew} />
      )}
    </header>
  );
}
