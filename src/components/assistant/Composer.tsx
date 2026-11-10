// Where the reader writes: the box, pictures to send with it, dictation and Send, then the notes under it.
import { Mic, MicOff, Send } from 'lucide-react';
import type { FormEvent, KeyboardEvent, Ref } from 'react';
import type { Provider } from '~/lib/ai/types';
import { useT, type Key } from '~/lib/i18n';
import { AttachButton, ImageTray, type useImageAttach } from './attachments';
import type { useDictation } from './dictation';

/**
 * The composer. The box is not a controlled field (see AssistantDrawer): `areaRef` is the box, `text` follows it.
 * `canDraft` shows the picture controls; `canPropose` false adds the viewer's note.
 */
export function Composer({ areaRef, text, busy, conv, canDraft, canPropose, provider, attach, keepImages, onKeepImages, imageError, dictation, onSubmit, onKeyDown, onMic }: {
  areaRef: Ref<HTMLTextAreaElement>; text: string; busy: boolean; conv: string | null; canDraft: boolean; canPropose: boolean;
  provider: Provider | 'fake' | null | undefined; attach: ReturnType<typeof useImageAttach>; keepImages: boolean; onKeepImages: (keep: boolean) => void;
  imageError: string | null; dictation: ReturnType<typeof useDictation>;
  onSubmit: (e?: FormEvent) => void; onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void; onMic: () => void;
}) {
  const t = useT();
  const listening = dictation.state === 'listening';
  return (
    <>
      <form className="ai-composer" onSubmit={onSubmit}>
        <label className="ai-sr" htmlFor="ai-input">{t('ai.placeholder')}</label>
        {canDraft && <ImageTray attach={attach} provider={provider} keep={keepImages} onKeep={onKeepImages} />}
        {listening && (
          <p className="ai-rec" role="status">
            <span className="ai-rec-dot" aria-hidden /> {t('ai.micRecording')}
            {dictation.interim && <em className="subtle"> {dictation.interim}</em>}
          </p>
        )}
        <div className="ai-composer-row">
          {canDraft && <AttachButton attach={attach} />}
          {dictation.supported && (
            <button type="button" className={`btn ghost ai-touch ai-icon ai-mic${listening ? ' ai-mic-on' : ''}`} onClick={onMic} aria-pressed={listening} aria-label={listening ? t('ai.micStop') : t('ai.mic')} title={listening ? t('ai.micStop') : t('ai.mic')}>
              {listening ? <MicOff size={17} aria-hidden /> : <Mic size={17} aria-hidden />}
            </button>
          )}
          <textarea
            id="ai-input"
            ref={areaRef}
            rows={1}
            maxLength={4000}
            placeholder={t('ai.placeholder')}
            onKeyDown={onKeyDown}
          />
          <button type="submit" className="btn primary ai-touch ai-icon ai-send" disabled={busy || !conv || attach.reading || (!text.trim() && !attach.images.length)} aria-label={t('ai.send')} title={busy ? t('ai.waitForReply') : t('ai.send')}>
            <Send size={17} aria-hidden />
          </button>
        </div>
      </form>
      <p className="ai-composer-hint subtle" aria-hidden={text ? true : undefined}>{t(canDraft ? 'ai.composerHintImages' : 'ai.composerHint')}</p>
      {imageError && <p className="ai-foot ai-card-error" role="alert">{t(imageError as Key)}</p>}
      {dictation.state === 'denied' && <p className="ai-foot subtle" role="status">{t('ai.micDenied')}</p>}
      {dictation.state === 'error' && <p className="ai-foot subtle" role="status">{t('ai.micFailed')}</p>}
      {!dictation.supported && <p className="ai-foot subtle">{t('ai.micUnsupported')}</p>}
      {!canPropose && <p className="ai-foot subtle">{t('ai.viewerNote')}</p>}
    </>
  );
}
