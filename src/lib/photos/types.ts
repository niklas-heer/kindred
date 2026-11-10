// The gallery's shapes, shared by the server (src/lib/photos.server.ts) and the screens.

/** A face box, normalised to the picture: 0–1 from its top-left corner. */
export interface Box { x: number; y: number; w: number; h: number }

/** Someone in a photo. `confirmed` false is a suggestion nobody has agreed to yet. */
export interface Tag {
  id: number;
  person: string;
  box: Box;
  confirmed: boolean;
}

export interface MediaItem {
  /** Media key, `gallery/<uuid>.jpg`. The picture is at /api/media/<tree>/<name>. */
  key: string;
  mime: string;
  width: number;
  height: number;
  /** A partial date: "1985", "1985-06" or "1985-06-14". */
  taken: string | null;
  place: string | null;
  caption: string | null;
  album: string | null;
  uploadedBy: string;
  uploadedAt: string;
  tags: Tag[];
  /** The post in the family's feed it was shared with (docs/feed.md), when it was. Members only: a guest gets no picture uploaded for a post. */
  post?: string;
}

export interface Album { id: string; name: string; count: number }

export interface Gallery {
  media: MediaItem[];
  albums: Album[];
}

/**
 * The URL of a gallery picture. The route checks the reader is a member of the family. `thumb` asks for its small copy
 * (about 400 pixels), for tiles, covers and peeks; a photo from before thumbnails is served whole.
 */
export const mediaUrl = (tree: string, key: string, size?: 'thumb') => `/api/media/${tree}/${key.replace(/^gallery\//, '')}${size ? `?size=${size}` : ''}`;

/** A face the AI finder suggested: where, and who. The server keeps the box and the person, not the confidence or reason. */
export interface Face { box: Box; personId: string }
