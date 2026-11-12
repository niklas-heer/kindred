// Cloudflare Turnstile's widget on the public request forms, when the server has its keys (KINDRED_TURNSTILE_*). It loads
// Cloudflare's script (allowed by the page's Content-Security-Policy only then, src/lib/auth/security-headers.ts) and hands
// the token it gives to the form; the server checks the token with Cloudflare (src/lib/operator/turnstile.server.ts).
import { useEffect, useRef, useState } from 'react';
import { useT } from '~/lib/i18n';
import { TURNSTILE_FAKE_TOKEN } from '~/lib/operator/shared';

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
}
const api = () => (window as unknown as { turnstile?: TurnstileApi }).turnstile;

let loading: Promise<void> | null = null;
function load(): Promise<void> {
  if (api()) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; reject(new Error('turnstile')); };
    document.head.appendChild(s);
  });
  return loading;
}

export function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (token: string | undefined) => void }) {
  // KINDRED_TURNSTILE_FAKE=1 (the browser journeys): a local stand-in, so no test loads Cloudflare's script.
  return siteKey === 'fake' ? <FakeTurnstile onToken={onToken} /> : <CloudflareTurnstile siteKey={siteKey} onToken={onToken} />;
}

function FakeTurnstile({ onToken }: { onToken: (token: string | undefined) => void }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <div className="turnstile">
      <label><input type="checkbox" checked={done} onChange={(e) => { setDone(e.target.checked); onToken(e.target.checked ? TURNSTILE_FAKE_TOKEN : undefined); }} /> {t('signup.turnstile_fake')}</label>
    </div>
  );
}

function CloudflareTurnstile({ siteKey, onToken }: { siteKey: string; onToken: (token: string | undefined) => void }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const token = useRef(onToken);
  token.current = onToken;
  useEffect(() => {
    let id: string | undefined;
    let gone = false;
    void load().then(() => {
      if (gone || !box.current) return;
      id = api()?.render(box.current, {
        sitekey: siteKey, language: t.locale,
        callback: (v: string) => token.current(v),
        'expired-callback': () => token.current(undefined),
        'error-callback': () => token.current(undefined),
      });
    }).catch(() => {});
    return () => { gone = true; if (id) api()?.remove(id); };
  }, [siteKey, t.locale]);
  return <div className="turnstile" ref={box} />;
}
