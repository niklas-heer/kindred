// The browser's side of "Ask to join": makes the passkey for a request and sends it (./join.functions.ts, ./join.server.ts).
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { joinOptions, sendJoinRequest } from './join.functions';

export interface JoinForm { tree: string; name: string; person: string | null; message: string }

/** The browser's own time zone and language: shown to the guest before sending, and sent with the request. */
export function browserContext(): { timeZone: string; language: string } {
  let timeZone = '';
  try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''; } catch {}
  let language = '';
  try { language = navigator.language ?? ''; } catch {}
  return { timeZone, language };
}

/** Why the device made no passkey, as a key the form translates. */
function friendly(e: unknown): Error {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'AbortError') return new Error('join.err_cancelled');
  if (name === 'InvalidStateError') return new Error('join.err_device_has');
  if (name === 'SecurityError') return new Error('join.err_insecure');
  return new Error('join.err_device');
}

/** Makes the passkey and sends the request. Throws an Error whose message is a key or a server sentence. */
export async function askToJoin(form: JoinForm): Promise<void> {
  const { startRegistration } = await import('@simplewebauthn/browser');
  const { options, challengeId } = await joinOptions({ data: { ...form, ...browserContext() } });
  let response;
  try {
    response = await startRegistration({ optionsJSON: JSON.parse(options) as PublicKeyCredentialCreationOptionsJSON });
  } catch (e) {
    throw friendly(e);
  }
  await sendJoinRequest({ data: { challengeId, response: response as unknown as Record<string, unknown> } });
}

// The dialog is opened from the invitation card and from the guest chip.
const listeners = new Set<() => void>();
export const onOpenJoin = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const openJoin = () => { for (const fn of listeners) fn(); };
