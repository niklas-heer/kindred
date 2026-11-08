// Cloudflare Access: when the app runs behind Access, Access signs each request with a JWT in the
// `Cf-Access-Jwt-Assertion` header. We trust only a token that verifies against the team's public
// keys (RS256), names our application (aud) and team (iss), and hasn't expired. A plain email header
// (`Cf-Access-Authenticated-User-Email`) is never trusted: anyone who reaches the server directly can set it.
//
// Configure with CF_ACCESS_TEAM_DOMAIN (e.g. `myfamily.cloudflareaccess.com`) and CF_ACCESS_AUD (the
// application's Audience tag). Without both, Access is ignored and passkeys are the only way in.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface AccessConfig { team: string; aud: string }

/** The team's origin from CF_ACCESS_TEAM_DOMAIN, accepting `team.cloudflareaccess.com` or a full URL. */
export function accessConfig(env: Record<string, string | undefined> = process.env): AccessConfig | undefined {
  const team = env.CF_ACCESS_TEAM_DOMAIN?.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const aud = env.CF_ACCESS_AUD?.trim();
  if (!team || !aud) return undefined;
  if (!/^[a-z0-9.-]+$/i.test(team)) throw new Error('CF_ACCESS_TEAM_DOMAIN must be a host name like myfamily.cloudflareaccess.com');
  return { team: `https://${team.toLowerCase()}`, aud };
}

// jose caches the key set and refetches it when a token names a key it hasn't seen (key rotation),
// at most every 30 s; keys are kept for 10 minutes.
const keySets = new Map<string, JWTVerifyGetKey>();
function teamKeys(team: string): JWTVerifyGetKey {
  let k = keySets.get(team);
  if (!k) {
    k = createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`), { cacheMaxAge: 10 * 60_000, cooldownDuration: 30_000, timeoutDuration: 5_000 });
    keySets.set(team, k);
  }
  return k;
}

/**
 * The verified email in an Access token, or undefined when the token is missing or doesn't verify.
 * `keys` is for tests; the server always uses the team's published keys.
 */
export async function verifyAccessToken(token: string | null | undefined, config: AccessConfig, keys: JWTVerifyGetKey = teamKeys(config.team)): Promise<string | undefined> {
  if (!token || token.length > 8192) return undefined;
  try {
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ['RS256'],
      audience: config.aud,
      issuer: config.team,
      requiredClaims: ['exp', 'iat'],
      clockTolerance: 30,
    });
    // Service tokens carry no email: they are machines, not relatives.
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    return /^[^\s@]+@[^\s@]+$/.test(email) ? email : undefined;
  } catch {
    return undefined;
  }
}

/** The verified Access email for a request, when Access is configured. */
export async function accessEmail(request: Request): Promise<string | undefined> {
  const config = accessConfig();
  if (!config) return undefined;
  return verifyAccessToken(request.headers.get('cf-access-jwt-assertion'), config);
}

/** Where to send someone to sign out of Access too. */
export const accessLogoutUrl = () => (accessConfig() ? '/cdn-cgi/access/logout' : undefined);
