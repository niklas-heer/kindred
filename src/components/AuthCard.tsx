import { translateMessage, useT } from '~/lib/i18n';
// The frame for /signin, /setup and /invite: one card on the canvas, a crest above it, and a plain
// explanation of passkeys for relatives who have never used one. The language picker sits in the card's corner.
import { AlertCircle, Fingerprint, KeyRound, Smartphone } from 'lucide-react';
import type { ReactNode } from 'react';
import { LanguagePicker } from './LanguagePicker';
import '~/styles/auth.css';

export function AuthCard({ crest, kicker, title, lede, children, wide }: { crest: ReactNode; kicker?: ReactNode; title: ReactNode; lede?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <main className="auth-page">
      <section className={`auth-card ui-card${wide ? ' wide' : ''}`} aria-labelledby="auth-title">
        <div className="auth-lang"><LanguagePicker /></div>
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
  const t = useT();
  return children ? <p className="auth-error" role="alert"><AlertCircle size={18} />{typeof children === 'string' ? translateMessage(children,t.locale) : children}</p> : null;
}

/** "What's a passkey?" in three plain steps. `creating` words it for making one. */
export function PasskeyExplainer({ creating }: { creating?: boolean }) {
  const t = useT();
  return (
    <aside className="auth-explain" aria-labelledby="passkey-what">
      <h2 id="passkey-what">{creating ? t("authcard.what_happens_next") : t("authcard.what_s_a_passkey")}</h2>
      <ul>
        <li>
          <span aria-hidden><KeyRound size={18} /></span>
          <span>
            <b>{t("authcard.no_password_to_remember")}</b> {creating ? t("authcard.your_phone_or_computer_makes_a_key_for_kindred_and_keeps_it_safe") : t("authcard.instead_your_phone_or_computer_keeps_a_key_for_kindred_made_when_you_were_invited")}
          </span>
        </li>
        <li>
          <span aria-hidden><Fingerprint size={18} /></span>
          <span>
            <b>{t("authcard.unlock_it_like_your_phone")}</b> {t("authcard.your_device_asks_for_your_face_your_fingerprint_or_the_pin_you_already_use_that_never_leaves_your_device")} </span>
        </li>
        <li>
          <span aria-hidden><Smartphone size={18} /></span>
          <span>
            <b>{t("authcard.another_device")}</b> {creating ? t("authcard.most_phones_share_passkeys_with_your_other_devices_you_can_also_add_one_later_from_your_name_at_the_top_of_the_page") : t("authcard.on_a_computer_without_your_passkey_choose_use_a_phone_in_the_prompt_and_scan_the_code_with_your_phone")}
          </span>
        </li>
      </ul>
      {!creating && (
        <details>
          <summary>{t("authcard.first_time_here")}</summary>
          <p>{t("authcard.you_need_an_invitation_from_someone_in_the_family_who_looks_after_the_tree_a_steward_open_their_link_on_this_device_and_it_will_set_up_your_passkey_in_a_minute")}</p>
        </details>
      )}
    </aside>
  );
}
