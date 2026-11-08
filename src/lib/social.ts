// Turns what a family typed into a social field (a full URL, an @handle or a bare username) into a link to that
// profile. A link is only ever built to https on the network's own domain, from a handle that passed the network's
// own pattern, so a value such as "javascript:…" or a look-alike domain stays plain text.

export interface SocialLink {
  /** The network's name, as a brand: not translated. */
  network: string;
  /** The profile's address: always https, always on the network's own domain. */
  href: string;
  /** The profile as a reader knows it: "@name". */
  handle: string;
}

interface Network {
  name: string;
  /** Other words a family may have used as the label. */
  aliases?: readonly string[];
  /** The network's own domains; the first is where a profile link is built. */
  hosts: readonly string[];
  /** What a username on this network may look like. */
  handle: RegExp;
  path: (handle: string) => string;
  /** A username's form for showing; "@name" unless said otherwise. */
  show?: (handle: string) => string;
}

const at = (h: string) => `/@${h}`;
const plain = (h: string) => `/${h}`;

const NETWORKS: readonly Network[] = [
  { name: 'Instagram', hosts: ['www.instagram.com', 'instagram.com', 'instagr.am'], handle: /^[A-Za-z0-9._]{1,30}$/, path: plain },
  { name: 'Facebook', hosts: ['www.facebook.com', 'facebook.com', 'm.facebook.com', 'fb.com'], handle: /^[A-Za-z0-9.]{1,50}$/, path: plain, show: (h) => h },
  { name: 'LinkedIn', hosts: ['www.linkedin.com', 'linkedin.com'], handle: /^[\p{L}\p{N}-]{1,100}$/u, path: (h) => `/in/${encodeURIComponent(h)}`, show: (h) => h },
  { name: 'X', aliases: ['twitter'], hosts: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'], handle: /^[A-Za-z0-9_]{1,15}$/, path: plain },
  { name: 'TikTok', hosts: ['www.tiktok.com', 'tiktok.com'], handle: /^[A-Za-z0-9._]{1,24}$/, path: at },
  { name: 'YouTube', hosts: ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'], handle: /^[A-Za-z0-9._-]{1,30}$/, path: at },
  { name: 'Bluesky', hosts: ['bsky.app'], handle: /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/, path: (h) => `/profile/${h.includes('.') ? h : `${h}.bsky.social`}` },
  { name: 'Threads', hosts: ['www.threads.com', 'threads.com', 'www.threads.net', 'threads.net'], handle: /^[A-Za-z0-9._]{1,30}$/, path: at },
  { name: 'Mastodon', hosts: ['mastodon.social'], handle: /^[A-Za-z0-9_]{1,30}$/, path: at },
  { name: 'WhatsApp', hosts: ['wa.me', 'api.whatsapp.com', 'www.whatsapp.com'], handle: /^\+?[\d\s()/-]{6,24}$/, path: (h) => `/${h.replace(/\D/g, '')}`, show: (h) => h },
];

const networkNamed = (label: string) => {
  const l = label.trim().toLowerCase();
  return l ? NETWORKS.find((n) => n.name.toLowerCase() === l || n.aliases?.includes(l)) : undefined;
};
const networkAt = (host: string) => NETWORKS.find((n) => n.hosts.includes(host));

/** The readable end of a profile address: "/in/some-one/" → "some-one". */
function handleOfPath(path: string): string {
  const last = path.split('/').filter(Boolean).at(-1) ?? '';
  try { return decodeURIComponent(last).replace(/^@/, ''); } catch { return last.replace(/^@/, ''); }
}

function fromUrl(text: string): SocialLink | null {
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); } catch { return null; }
  // A login part makes "instagram.com@elsewhere" look like a known site; a port is never a profile.
  if (u.username || u.password || u.port) return null;
  const network = networkAt(u.hostname.toLowerCase());
  if (!network) return null;
  const end = handleOfPath(u.pathname);
  if (!end) return null;
  return { network: network.name, href: `https://${u.hostname.toLowerCase()}${u.pathname}${u.search}`, handle: (network.show ?? ((h) => `@${h}`))(end) };
}

/**
 * The profile a social field points at, or null when it should stay plain text. A full URL says its own network; an
 * @handle or a bare username needs the field's label to say which network it is on.
 */
export function socialLink(value: string | undefined, label: string | undefined): SocialLink | null {
  const text = (value ?? '').trim();
  if (!text || /\s/.test(text.replace(/[\s()/-]+(?=\d)/g, ''))) return null;
  // Any other scheme (javascript:, data:, mailto: …) is never a link, whatever follows it.
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^https?:\/\//i.test(text)) return null;
  if (/^https?:\/\//i.test(text) || /^[^\s/@]+\.[^\s/@]+\//.test(text)) return fromUrl(text);

  const network = networkNamed(label ?? '');
  if (!network) return null;
  let handle = text.replace(/^@/, '');
  // "@name@mastodon.social": the server has to be the one this network links to.
  const server = network.name === 'Mastodon' ? /^([^@]+)@([^@]+)$/.exec(handle) : null;
  if (server) {
    if (!network.hosts.includes(server[2].toLowerCase())) return null;
    handle = server[1];
  }
  if (!network.handle.test(handle)) return null;
  return { network: network.name, href: `https://${network.hosts[0]}${network.path(handle)}`, handle: (network.show ?? ((h) => `@${h}`))(handle) };
}
