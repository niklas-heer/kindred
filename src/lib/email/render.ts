// An email's body, in plain text and in simple, accessible HTML (docs/hosting-many-families.md, "Email"). Every piece arrives
// as plain text (a translation with its variables filled in) and is escaped here as a whole, so no name, family or notice can
// add markup. No image, no pixel, no style sheet from elsewhere, and no link but to this server: a link that does not start
// with the server's own origin is refused. Plain code: the tests load it directly.
import { LANGUAGES, type Locale } from '../i18n/languages.ts';

export interface MailContent {
  locale: Locale;
  subject: string;
  greeting: string;
  /** Plain-text paragraphs. */
  paragraphs: string[];
  /** Text quoted as it was written (an operator's notice), shown set apart. */
  quote?: string;
  /** A one-time code, shown large. */
  code?: string;
  /** The one button: a link to this server. */
  action?: { label: string; url: string };
  /** Small print at the end. */
  footer: string[];
  /** The unsubscribe link (non-security emails): the question and the link's words. */
  unsubscribe?: { question: string; label: string; url: string };
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** A link of this server, or an error: an email links nowhere else. */
export function ownLink(url: string, origin: string): string {
  const o = new URL(origin).origin;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('email link is not a URL');
  }
  if (u.origin !== o || (u.protocol !== 'https:' && u.protocol !== 'http:')) throw new Error('email links only to this server');
  return u.href;
}

const C = { ink: '#2b2118', soft: '#5b5045', paper: '#f7f3ea', card: '#ffffff', line: '#ddd3c2', button: '#5a2e1a', buttonInk: '#ffffff' };

const para = (s: string, style = '') => `<p style="margin:0 0 16px;line-height:1.55;${style}">${escapeHtml(s).replace(/\n/g, '<br>')}</p>`;

export function renderMail(c: MailContent, origin: string): { subject: string; text: string; html: string } {
  const action = c.action ? { ...c.action, url: ownLink(c.action.url, origin) } : undefined;
  const unsubscribe = c.unsubscribe ? { ...c.unsubscribe, url: ownLink(c.unsubscribe.url, origin) } : undefined;

  const text = [
    c.greeting,
    ...c.paragraphs,
    ...(c.quote ? [c.quote.split('\n').map((l) => `> ${l}`).join('\n')] : []),
    ...(c.code ? [c.code] : []),
    ...(action ? [`${action.label}: ${action.url}`] : []),
    '--',
    ...c.footer,
    ...(unsubscribe ? [`${unsubscribe.question} ${unsubscribe.label}: ${unsubscribe.url}`] : []),
  ].join('\n\n') + '\n';

  const html = `<!doctype html>
<html lang="${escapeHtml(LANGUAGES[c.locale]?.intl ?? c.locale)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(c.subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:${C.paper};color:${C.ink};font-family:Georgia,'Times New Roman',serif;font-size:17px">
<div role="article" aria-label="${escapeHtml(c.subject)}" style="max-width:560px;margin:0 auto;background:${C.card};border:1px solid ${C.line};border-radius:10px;padding:28px 24px">
${para(c.greeting)}
${c.paragraphs.map((p) => para(p)).join('\n')}
${c.quote ? `<blockquote style="margin:0 0 16px;padding:8px 16px;border-left:4px solid ${C.line};color:${C.ink}">${para(c.quote, 'margin:0')}</blockquote>` : ''}
${c.code ? `<p style="margin:8px 0 20px;font-family:'Courier New',monospace;font-size:30px;letter-spacing:6px;font-weight:bold">${escapeHtml(c.code)}</p>` : ''}
${action ? `<p style="margin:8px 0 24px"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:${C.button};color:${C.buttonInk};text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold">${escapeHtml(action.label)}</a></p>
${para(action.url, `font-size:14px;color:${C.soft};word-break:break-all`)}` : ''}
<hr style="border:0;border-top:1px solid ${C.line};margin:20px 0">
${c.footer.map((f) => para(f, `font-size:14px;color:${C.soft}`)).join('\n')}
${unsubscribe ? `<p style="margin:0;font-size:14px;color:${C.soft};line-height:1.55">${escapeHtml(unsubscribe.question)} <a href="${escapeHtml(unsubscribe.url)}" style="color:${C.soft}">${escapeHtml(unsubscribe.label)}</a></p>` : ''}
</div>
</body>
</html>
`;
  return { subject: c.subject, text, html };
}
