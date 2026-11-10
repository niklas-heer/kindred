import { Sparkles, Users } from 'lucide-react';
import { useT } from '~/lib/i18n';
import type { ChatExample } from './examples';

/** An empty chat: a welcome and example prompts, four of them until the reader asks for more (`more`). */
export function ChatWelcome({ examples, more, onMore, onPick }: { examples: ChatExample[]; more: boolean; onMore: () => void; onPick: (ex: ChatExample) => void }) {
  const t = useT();
  return (
    <div className="ai-empty">
      <div className="ai-welcome">
        <span className="ai-mark" aria-hidden><Sparkles size={16} /></span>
        <p className="ai-welcome-text">{t('ai.empty')}</p>
      </div>
      <p className="ai-examples-title">{t('ai.examplesTitle')}</p>
      <div className="ai-examples">
        {(more ? examples : examples.slice(0, 4)).map((ex) => (
          <button
            key={ex.key}
            type="button"
            className={`ai-example${ex.open ? ' ai-example-primary' : ''}`}
            onClick={() => onPick(ex)}
          >
            {ex.open && <Users size={14} aria-hidden />}
            {t(ex.key, { name: ex.name ?? '' })}
          </button>
        ))}
        {!more && examples.length > 4 && (
          <button type="button" className="btn ghost ai-touch ai-examples-more" onClick={onMore}>{t('shell.more')}</button>
        )}
      </div>
    </div>
  );
}
