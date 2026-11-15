// The key a ballot is stored under, on its own so plain Node can load it: the export and data-request code (and the scripts
// that run them) import it, and votes.server.ts' extensionless imports are only for Vite.
import { serverHmac } from '../auth/seal.server.ts';
import { b64url } from '../webpush.ts';

/**
 * The key a ballot is stored under: the account id or guest key itself in an open vote, else an HMAC of the vote and it
 * under the server's secret, which is not in the family's database, so a backup cannot join a ballot to its voter.
 */
export async function voterKey(vote: string, secret: boolean, voterId: string): Promise<string> {
  if (!secret) return voterId;
  return b64url(await serverHmac('vote-voter', new TextEncoder().encode(`${vote}:${voterId}`)));
}
