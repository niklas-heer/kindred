// The frame for /signin, /setup and /invite: one card on the canvas, a crest above it, and a plain
// explanation of passkeys for relatives who have never used one.
import { AlertCircle, Fingerprint, KeyRound, Smartphone } from 'lucide-react';
import type { ReactNode } from 'react';
import '~/styles/auth.css';

export function AuthCard({ crest, kicker, title, lede, children, wide }: { crest: ReactNode; kicker?: ReactNode; title: ReactNode; lede?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <main className="auth-page">
      <section className={`auth-card ui-card${wide ? ' wide' : ''}`} aria-labelledby="auth-title">
        <div className="auth-crest" aria-hidden>{crest}</div>
        {kicker && <p className="auth-kicker">{kicker}</p>}
        <h1 id="auth-title">{title}</h1>
        {lede && <p className="auth-lede">{lede}</p>}
        {children}
      </section>
    </main>
  );
}

export function AuthError({ children }: { children: ReactNode }) {
  return children ? <p className="auth-error" role="alert"><AlertCircle size={18} />{children}</p> : null;
}

/** "What's a passkey?" in three plain steps. `creating` words it for making one. */
export function PasskeyExplainer({ creating }: { creating?: boolean }) {
  return (
    <aside className="auth-explain" aria-labelledby="passkey-what">
      <h2 id="passkey-what">{creating ? 'What happens next' : 'What’s a passkey?'}</h2>
      <ul>
        <li>
          <span aria-hidden><KeyRound size={18} /></span>
          <span>
            <b>No password to remember.</b> {creating ? 'Your phone or computer makes a key for Kindred and keeps it safe.' : 'Instead, your phone or computer keeps a key for Kindred, made when you were invited.'}
          </span>
        </li>
        <li>
          <span aria-hidden><Fingerprint size={18} /></span>
          <span>
            <b>Unlock it like your phone.</b> Your device asks for your face, your fingerprint or the PIN you already use. That never leaves your device.
          </span>
        </li>
        <li>
          <span aria-hidden><Smartphone size={18} /></span>
          <span>
            <b>Another device?</b> {creating ? 'Most phones share passkeys with your other devices. You can also add one later, from your name at the top of the page.' : 'On a computer without your passkey, choose “use a phone” in the prompt and scan the code with your phone.'}
          </span>
        </li>
      </ul>
      {!creating && (
        <details>
          <summary>First time here?</summary>
          <p>You need an invitation from someone in the family who looks after the tree (a steward). Open their link on this device, and it will set up your passkey in a minute.</p>
        </details>
      )}
    </aside>
  );
}
