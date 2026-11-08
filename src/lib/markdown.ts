// The one Markdown renderer for anything people type (stories, sayings, biographies). It never lets
// raw HTML through — a contributor's memory must not run script in a steward's browser — and only
// allows ordinary link and image addresses. Works the same on the server and in the browser.
import { Marked } from 'marked';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * http(s), mailto and same-site addresses only; everything else (javascript:, data:, vbscript:…) is
 * refused. Browsers strip tabs and newlines from URLs ("java\tscript:" becomes "javascript:"), so any
 * control character or whitespace is refused outright, and the scheme is judged the way the browser
 * will read it: by parsing the address against a placeholder base.
 */
function safeUrl(href: string | null | undefined, kind: 'link' | 'image'): string | null {
  const url = (href ?? '').trim();
  if (!url || /[\u0000-\u0020\u007f-\u009f\u2028\u2029]/.test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url, 'https://same-site.invalid/');
  } catch {
    return null;
  }
  const allowed = kind === 'link' ? ['http:', 'https:', 'mailto:'] : ['http:', 'https:'];
  return allowed.includes(parsed.protocol) ? url : null;
}

const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    // Raw HTML in the source is shown as text, never rendered.
    html: ({ text }) => esc(text),
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const url = safeUrl(href, 'link');
      if (!url) return text;
      const external = /^(https?:)?\/\//i.test(url) || /^mailto:/i.test(url);
      return `<a href="${esc(url)}"${title ? ` title="${esc(title)}"` : ''}${external ? ' target="_blank" rel="noopener noreferrer nofollow"' : ''}>${text}</a>`;
    },
    image({ href, title, text }) {
      const url = safeUrl(href, 'image');
      if (!url) return esc(text);
      return `<img src="${esc(url)}" alt="${esc(text)}"${title ? ` title="${esc(title)}"` : ''} loading="lazy" referrerpolicy="no-referrer">`;
    },
  },
});

/** Safe HTML for user-written Markdown. */
export function renderMarkdown(source: string): string {
  return md.parse(source ?? '', { async: false }) as string;
}
