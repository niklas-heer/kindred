// The release this build is, for the account menu. Vite fills these in at build time (vite.config.ts).
declare const __KINDRED_VERSION__: string | undefined;
declare const __KINDRED_COMMIT__: string | undefined;

/** The version from package.json, or null when the build did not set one. */
export const appVersion = (): string | null => (typeof __KINDRED_VERSION__ === 'string' && __KINDRED_VERSION__ ? __KINDRED_VERSION__ : null);

/** The short commit, or null when the build could not tell. */
export const appCommit = (): string | null => {
  const c = typeof __KINDRED_COMMIT__ === 'string' ? __KINDRED_COMMIT__ : '';
  return c && c !== 'unknown' ? c.slice(0, 7) : null;
};

/** Where this version's release notes are. */
export const releaseUrl = (version: string): string => `https://github.com/niklas-heer/kindred/releases/tag/v${version}`;
