// The operator's test sign-in for a single sign-on provider (src/lib/auth/oidc.server.ts, purpose `test`): the console opens
// /operator/sso-test in a window of its own, which runs the real flow and shows the result; the window tells the console over a
// BroadcastChannel, so the console reads the provider again (its `testedAt` and `lastError`) without a reload.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

const CHANNEL = 'kindred-sso-test';

/**
 * The test page for a provider; `popup` marks the window the console opened, which offers to close itself afterwards (the
 * page cannot tell from `window.opener`: the site's Cross-Origin-Opener-Policy cuts it on the way through the provider).
 */
export const testPath = (provider: string, popup = false) => `/operator/sso-test?provider=${encodeURIComponent(provider)}${popup ? '&popup=yes' : ''}`;

/** Opens the test in a new window; when the browser blocks it, the test runs in this one and comes back with a link. */
export function openTest(provider: string): void {
  const w = window.open(testPath(provider, true), CHANNEL, 'popup,width=560,height=760');
  if (!w) window.location.assign(testPath(provider));
}

/** The test window says it finished. */
export function announceTest(provider: string): void {
  try {
    const c = new BroadcastChannel(CHANNEL);
    c.postMessage({ provider });
    c.close();
  } catch {}
}

/** Reads the providers again when a test window finishes, and when the console's window gets the focus back. */
export function useTestResults(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const again = () => void qc.invalidateQueries({ queryKey: ['operator', 'signin'] });
    let c: BroadcastChannel | null = null;
    try {
      c = new BroadcastChannel(CHANNEL);
      c.onmessage = again;
    } catch {}
    window.addEventListener('focus', again);
    return () => {
      c?.close();
      window.removeEventListener('focus', again);
    };
  }, [qc]);
}
