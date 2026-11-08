// The photos a portrait can be painted from.

/** The photos a portrait can be painted from: the profile photo first, then the gallery pictures, each once. */
export function paintSources(profileKey: string | null | undefined, photos: { key: string; caption: string | null }[]): { key: string; caption: string | null }[] {
  const seen = new Set<string>();
  const out: { key: string; caption: string | null }[] = [];
  for (const m of [...(profileKey ? [{ key: profileKey, caption: null }] : []), ...photos]) {
    if (seen.has(m.key)) continue;
    seen.add(m.key);
    out.push({ key: m.key, caption: m.caption });
  }
  return out;
}
