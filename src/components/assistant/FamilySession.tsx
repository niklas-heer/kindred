// A family session: someone talks the family through, and the assistant drafts everyone it heard as one card. The
// speaker is chosen first (so "my sister" means the right person, even when a parent is the one talking); the speaker
// can change during the session, and each line keeps who said it. The transcript stays on screen while it grows.
// Finishing sends the whole transcript once, within FAMILY_SESSION_CHARS, with the server's own checks.
import { Mic, MicOff, Plus, Send, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Notice, Select } from '~/components/ui';
import { FAMILY_SESSION_CHARS } from '~/lib/ai/types';
import { useT, type Key } from '~/lib/i18n';
import type { Provider } from '~/lib/ai/types';
import { AttachButton, DropVeil, ImageTray, useImageAttach, type Attached } from './attachments';
import { useDictation } from './dictation';

export interface SessionPerson { id: string; name: string }
interface Line { id: number; speaker: string; text: string }

/** One line of the transcript as the server reads it: who said it, by id, and what they said. */
export function formatTranscript(lines: Line[], people: SessionPerson[]): string {
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? id;
  return lines.map((l) => `[${name(l.speaker)}, ${l.speaker}] ${l.text}`).join('\n');
}

export function FamilySession({ people, initial, busy, onDraft, onLeave, locale, active, provider }: {
  people: SessionPerson[];
  /** The speaker to start with: the reader's own person, when they have chosen one. */
  initial: string | null;
  busy: boolean;
  /** Sends the transcript; resolves true when the draft was made, so the session can clear. */
  onDraft: (text: string, speaker: string, images: Attached[], keepImages: boolean) => Promise<boolean>;
  onLeave: () => void;
  locale: string;
  /** Whether the session is the part of the drawer showing: a pasted picture comes here only then. */
  active: boolean;
  provider: Provider | 'fake' | null | undefined;
}) {
  const t = useT();
  const [speaker, setSpeaker] = useState<string | null>(initial);
  const [lines, setLines] = useState<Line[]>([]);
  const [typed, setTyped] = useState('');
  const [imageError, setImageError] = useState<string | null>(null);
  const [keepImages, setKeepImages] = useState(false);
  const attach = useImageAttach({ active, onError: setImageError });
  const nextId = useRef(1);
  const speakerRef = useRef(speaker);
  speakerRef.current = speaker;

  const add = (text: string) => {
    const clean = text.trim();
    const who = speakerRef.current;
    if (!clean || !who) return;
    setLines((ls) => [...ls, { id: nextId.current++, speaker: who, text: clean }]);
  };
  const dictation = useDictation({ locale, onFinal: add });
  const transcript = formatTranscript(lines, people);
  const over = transcript.length > FAMILY_SESSION_CHARS;
  const ready = (lines.length > 0 || attach.images.length > 0) && !!speaker && !over && !busy && !attach.reading;
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? id;

  function toggleMic() {
    if (dictation.state === 'listening') dictation.stop();
    else dictation.start();
  }

  function leave() {
    dictation.stop();
    onLeave();
  }

  async function finish() {
    if (!ready || !speaker) return;
    dictation.stop();
    const done = await onDraft(transcript, speaker, attach.images, keepImages);
    if (done) {
      setLines([]);
      setTyped('');
      attach.replace([]);
      setKeepImages(false);
    }
  }

  return (
    <section className="ai-session ai-drop-zone" aria-label={t('ai.sessionStart')} {...attach.dropProps}>
      <DropVeil show={attach.dragging} />
      <p className="ai-session-intro subtle">{t('ai.sessionIntro')}</p>
      {dictation.supported && <p className="ai-session-note subtle">{t('ai.micNote')}</p>}

      <div className="ai-session-speaker">
        <span className="ai-fam-label" id="ai-session-speaker-label">{t('ai.sessionSpeaker')}</span>
        <Select
          value={speaker ?? ''}
          onChange={(v) => setSpeaker(v || null)}
          options={people.map((p) => ({ value: p.id, label: p.name }))}
          placeholder={t('ai.sessionNoSpeaker')}
          aria-label={t('ai.sessionSpeaker')}
          size="md"
        />
      </div>

      <div className="ai-session-controls">
        {dictation.supported ? (
          <button
            type="button"
            className={`btn ${dictation.state === 'listening' ? 'primary' : 'ghost'} ai-touch ai-mic`}
            onClick={toggleMic}
            disabled={!speaker || busy}
            aria-pressed={dictation.state === 'listening'}
          >
            {dictation.state === 'listening' ? <MicOff size={16} aria-hidden /> : <Mic size={16} aria-hidden />}
            {dictation.state === 'listening' ? t('ai.micStop') : t('ai.mic')}
          </button>
        ) : (
          <Notice>{t('ai.micUnsupported')}</Notice>
        )}
        {dictation.state === 'listening' && (
          <p className="ai-rec" role="status">
            <span className="ai-rec-dot" aria-hidden /> {t('ai.micRecording')}
          </p>
        )}
      </div>
      {dictation.state === 'denied' && <Notice>{t('ai.micDenied')}</Notice>}
      {dictation.state === 'error' && <Notice>{t('ai.micFailed')}</Notice>}
      {dictation.interim && <p className="ai-interim subtle" aria-live="off">{t('ai.sessionInterim')}: <em>{dictation.interim}</em></p>}

      <ol className="ai-transcript" aria-label={t('ai.sessionStart')}>
        {lines.length === 0 && <li className="subtle">{t('ai.sessionEmpty')}</li>}
        {lines.map((l) => (
          <li key={l.id} className="ai-transcript-line">
            <span className="ai-transcript-who">{nameOf(l.speaker)}</span>
            <span className="ai-transcript-text">{l.text}</span>
            <button
              type="button"
              className="btn ghost ai-touch ai-photo-drop"
              onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}
              aria-label={t('ai.famRemove')}
              title={t('ai.famRemove')}
              disabled={busy}
            >
              <X size={13} aria-hidden />
            </button>
          </li>
        ))}
      </ol>

      <form
        className="ai-session-type"
        onSubmit={(e) => {
          e.preventDefault();
          add(typed);
          setTyped('');
        }}
      >
        <label className="ai-sr" htmlFor="ai-session-typed">{t('ai.sessionTyped')}</label>
        <input id="ai-session-typed" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t('ai.sessionTyped')} disabled={!speaker || busy} />
        <button type="submit" className="btn ghost ai-touch" disabled={!speaker || !typed.trim() || busy}>
          <Plus size={15} aria-hidden /> {t('ai.sessionAdd')}
        </button>
        <AttachButton attach={attach} disabled={busy} />
      </form>
      <ImageTray attach={attach} provider={provider} keep={keepImages} onKeep={setKeepImages} disabled={busy} />
      {imageError && <p className="ai-card-error" role="alert">{t(imageError as Key)}</p>}

      <p className={`ai-session-length ${over ? 'ai-session-over' : 'subtle'}`} aria-live="polite">
        {t('ai.sessionLength', { count: transcript.length.toLocaleString(locale), max: FAMILY_SESSION_CHARS.toLocaleString(locale) })}
      </p>
      {over && <Notice>{t('ai.err_session_long')}</Notice>}

      <div className="ai-card-actions">
        <button type="button" className="btn primary ai-touch" onClick={finish} disabled={!ready}>
          <Send size={15} aria-hidden /> {busy ? t('ai.sending') : t('ai.sessionFinish')}
        </button>
        <button type="button" className="btn ghost ai-touch" onClick={leave} disabled={busy}>
          {t('ai.sessionLeave')}
        </button>
      </div>
    </section>
  );
}
