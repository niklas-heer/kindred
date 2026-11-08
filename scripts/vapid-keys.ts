// Makes a VAPID key pair (RFC 8292) for Web Push reminders, and prints the three settings the server reads:
//   node scripts/vapid-keys.ts [mailto:you@example.org]     (or: mise run vapid-keys)
// Print once and keep the private key out of the repository: it signs every reminder. Reusing a pair you already have
// (for example from another deployment) is fine; then only the three settings need copying, not new keys on devices.
import { b64url } from '../src/lib/webpush.ts';

const subject = process.argv[2] ?? 'mailto:you@example.org';
if (!subject.startsWith('mailto:') && !subject.startsWith('https://')) {
  console.error('The contact must be a mailto: or https: address, for example mailto:family@example.org');
  process.exit(1);
}

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicKey = b64url(await crypto.subtle.exportKey('raw', pair.publicKey));
const privateJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));

console.log('# Web Push reminders (docs/self-host.md, "Reminders"). The private key is secret: keep it out of the repository.');
console.log(`KINDRED_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`KINDRED_VAPID_PRIVATE_JWK='${privateJwk}'`);
console.log(`KINDRED_VAPID_SUBJECT=${subject}`);
