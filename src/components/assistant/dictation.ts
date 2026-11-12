// Speaking to the assistant: the browser's own speech recognition (the Web Speech API, `SpeechRecognition`), in the
// reader's language. Kindred never records or sends the sound; the browser's speech service turns it into text, and the
// text stays in the box until the reader sends it. The microphone is asked for only when the reader presses the button
// (start() is only ever called from a click), and nothing listens after the reader stops.
import { useCallback, useEffect, useRef, useState } from 'react';
import { LANGUAGES, LOCALES } from '~/lib/i18n/languages';

export type DictationState = 'off' | 'listening' | 'denied' | 'error';

interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

/** The browser's speech recognition, or null where it has none (Firefox, some phones). */
export function speechRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** The language tag the recogniser listens in, for each language the app speaks. */
export const SPEECH_LANG: Record<string, string> = Object.fromEntries(LOCALES.map((l) => [l, LANGUAGES[l].speech]));

/**
 * Listens while `state` is 'listening': final phrases go to `onFinal` as they are recognised, and the words still being
 * heard are in `interim`. A recogniser that stops on its own (silence, a browser limit) is restarted until the reader stops it.
 */
export function useDictation(o: { locale: string; onFinal: (text: string) => void }) {
  const [state, setState] = useState<DictationState>('off');
  const [interim, setInterim] = useState('');
  const recRef = useRef<Recognition | null>(null);
  const wantRef = useRef(false);
  const onFinalRef = useRef(o.onFinal);
  onFinalRef.current = o.onFinal;
  const [supported] = useState(() => speechRecognitionCtor() !== null);

  const start = useCallback(() => {
    const Ctor = speechRecognitionCtor();
    if (!Ctor || wantRef.current) return;
    const rec = new Ctor();
    rec.lang = SPEECH_LANG[o.locale] ?? 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let final = '';
      let heard = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else heard += r[0].transcript;
      }
      if (final.trim()) onFinalRef.current(final.trim());
      setInterim(heard.trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wantRef.current = false;
        setState('denied');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        wantRef.current = false;
        setState('error');
      }
    };
    rec.onend = () => {
      if (wantRef.current) {
        try {
          rec.start();
        } catch {
          wantRef.current = false;
          setState('off');
        }
      } else {
        setInterim('');
        setState((s) => (s === 'listening' ? 'off' : s));
      }
    };
    recRef.current = rec;
    wantRef.current = true;
    setState('listening');
    try {
      rec.start();
    } catch {
      wantRef.current = false;
      setState('error');
    }
  }, [o.locale]);

  const stop = useCallback(() => {
    wantRef.current = false;
    recRef.current?.stop();
    setInterim('');
    setState('off');
  }, []);

  // Leaving the page stops listening, whatever the reader was doing.
  useEffect(() => () => {
    wantRef.current = false;
    recRef.current?.abort();
  }, []);

  return { supported, state, interim, start, stop };
}
