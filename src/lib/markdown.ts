// The one Markdown renderer for anything people type (stories, sayings, biographies). It never lets
// raw HTML through — a contributor's memory must not run script in a steward's browser — and only
// allows ordinary link and image addresses. Works the same on the server and in the browser.
import { Marked } from 'marked';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** http(s), mailto and same-site addresses only; everything else (javascript:, data:, vbscript:…) is refused. */
function safeUrl(href: string | null | undefined, kind: 'link' | 'image'): string | null {
  const url = (href ?? '').trim();
  if (!url) return null;
  if (/^(https?:)?\/\//i.test(url)) return url;
  if (kind === 'link' && /^mailto:/i.test(url)) return url;
  // Relative to this site: "/x", "./x", "x", "#x" — anything without a scheme.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  return null;
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
