// A chat's turns as the assistant window shows them: the reader's messages with their pictures, and the assistant's replies
// with their proposals, questions, widgets and sources.
// In the order the window imported them before, so their styles keep their place in the cascade.
import { ProposalGroup } from './widgets/ProposalGroup';
import { Widget } from './widgets/Widget';
import { QuestionCard } from './widgets/QuestionCard';
import { chipsFor } from './widgets/chips';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { aiChatImageQuery } from '~/lib/ai.functions';
import { hostOf, webUrl } from '~/lib/ai/chat-turns';
import { nextStronger, type ModelChoices } from '~/lib/ai/model-choice';
import type { ChatItem, Provider } from '~/lib/ai/types';
import { useT } from '~/lib/i18n';
import { renderMarkdown } from '~/lib/markdown';
import type { Attached } from './attachments';
import { linkMentions } from './mentions';
import { modelName, RetryModelMenu, type PickedModel } from './ModelPicker';
import type { OnDecided } from './ProposalCard';

/** The reader's turn: their words in a bubble. A family session's transcript is a summary that opens to the full text. */
export function UserTurn({ tree, item }: { tree: string; item: ChatItem }) {
  const t = useT();
  if (item.session && item.text.trim()) {
    return (
      <details className="ai-turn ai-turn-user ai-msg-session">
        <summary>{t('ai.sessionMessage', { count: item.text.split('\n').length })}</summary>
        <pre className="ai-session-text">{item.text}</pre>
        <SentImages tree={tree} images={item.images} />
      </details>
    );
  }
  return (
    <div className="ai-turn ai-turn-user">
      <SentImages tree={tree} images={item.images} />
      {item.text && <div className="ai-bubble">{item.text}</div>}
    </div>
  );
}

/** The pictures on a message that has not been stored yet. */
export function AttachedThumbs({ images }: { images: Attached[] }) {
  const t = useT();
  if (!images.length) return null;
  return (
    <ul className="ai-thumbs ai-thumbs-sent">
      {images.map((img, i) => <li key={img.id} className="ai-thumb"><img src={img.url} alt={t('ai.attachAlt', { n: i + 1 })} /></li>)}
    </ul>
  );
}

/** The pictures on a stored message: the ones its writer kept, and how many there were. */
function SentImages({ tree, images }: { tree: string; images: ChatItem['images'] }) {
  const t = useT();
  if (!images) return null;
  const dropped = images.count - images.kept.length;
  return (
    <div className="ai-sent-images">
      {images.kept.length > 0 && <ul className="ai-thumbs ai-thumbs-sent">{images.kept.map((id, i) => <KeptImage key={id} tree={tree} id={id} n={i + 1} />)}</ul>}
      {dropped > 0 && <p className="ai-sent-note subtle">{t('ai.imagesNotKept', { count: dropped })}</p>}
    </div>
  );
}

function KeptImage({ tree, id, n }: { tree: string; id: string; n: number }) {
  const t = useT();
  const img = useQuery(aiChatImageQuery(tree, id)).data;
  return <li className="ai-thumb">{img ? <img src={`data:${img.mime};base64,${img.base64}`} alt={t('ai.attachAlt', { n })} /> : null}</li>;
}

/** The assistant's turn: its text as Markdown, names and places as links, its proposals as cards, and the pages it drew on. */
export function AssistantTurn({ tree, conv, item, people, places, onDecided, steward, models, canRetry, onRetry, last, busy, onSay, pagePerson }: {
  tree: string; conv: string; item: ChatItem; people: { id: string; name: string }[]; places: string[]; onDecided: OnDecided;
  /** The newest turn: only it can take an answer, and only it offers quick replies. */
  last: boolean; busy: boolean; onSay: (text: string) => void; pagePerson: { id: string; given: string } | undefined;
  steward: boolean; models: ModelChoices | undefined; canRetry: boolean; onRetry: (itemId: string, model: PickedModel) => void;
}) {
  const t = useT();
  const stronger = steward && item.model && models ? nextStronger(item.model as { provider: Provider | 'fake'; model: string }, models.models) : null;
  const sources = (item.sources ?? []).filter((s) => webUrl(s.url));
  const chips = last && !busy ? chipsFor(item, pagePerson, (id) => people.find((p) => p.id === id)?.name) : [];
  return (
    <div className={`ai-turn ai-turn-assistant${item.alternateOf ? ' ai-turn-alternate' : ''}${last ? ' ai-turn-last' : ''}`}>
      <span className="ai-mark" aria-hidden><Sparkles size={13} /></span>
      <div className="ai-turn-body">
        {item.alternateOf && <p className="ai-answer-tag">{t('ai.answerAlternate')}</p>}
        {/* The model's text: an image in it shows its alt text only, so nothing loads from an address the model chose. */}
        {item.text && (
          <div className="ai-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(linkMentions(item.text, { tree, people, places }), { images: 'text' }) }} />
        )}
        {item.blocks?.map((b) => (b.type === 'widget' ? <Widget key={b.id} tree={tree} conv={conv} itemId={item.id} block={b} /> : null))}
        {item.proposals?.length ? <ProposalGroup tree={tree} conv={conv} itemId={item.id} proposals={item.proposals} onDecided={onDecided} /> : null}
        {item.blocks?.map((b) => (b.type === 'question' ? <QuestionCard key={b.id} tree={tree} conv={conv} itemId={item.id} block={b} last={last} busy={busy} onSend={onSay} /> : null))}
        {sources.length > 0 && (
          <div className="ai-sources">
            <p className="ai-sources-title">{t('ai.sourcesTitle')}</p>
            <ul>
              {sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">{s.title || hostOf(s.url)}</a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {steward && item.model && (
          <div className="ai-answer-foot">
            <span className="ai-answer-model">{t('ai.modelWrote', { model: modelName(models, item.model.model) })}</span>
            {canRetry && models && (
              <RetryModelMenu
                choices={models}
                onPick={(m) => onRetry(item.id, m)}
                label={t('ai.retryAnother')}
                stronger={stronger ? { label: t('ai.retryStronger'), name: stronger.name, onPick: () => onRetry(item.id, { provider: stronger.provider, model: stronger.id }) } : undefined}
              />
            )}
          </div>
        )}
        {chips.length > 0 && (
          <div className="aw-chips" role="group" aria-label={t('ai.examplesTitle')}>
            {chips.map((chip) => {
              const words = t(chip.key, { name: chip.name ?? '' });
              return <button key={chip.key} type="button" className="btn aw-chip" onClick={() => onSay(words)}>{words}</button>;
            })}
          </div>
        )}
      </div>
    </div>
  );
}
