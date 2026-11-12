// Email on the console's Health tab (docs/hosting-many-families.md, "Email"): what went out in the last day, and the latest
// failures with the provider's short reason. Never a message, never an address: the send log keeps neither.
import { store } from '../store/index.ts';
import { activeMailer } from './send.server.ts';
import type { MailHealth } from './shared.ts';

const DAY = 86_400_000;

export async function mailHealth(now = Date.now()): Promise<MailHealth> {
  const accounts = store.accounts();
  const [active, counts, failures] = await Promise.all([
    activeMailer(),
    accounts.all<{ status: string; n: number }>('SELECT status, count(*) AS n FROM email_send WHERE at > ? GROUP BY status', now - DAY),
    accounts.all<{ at: number; category: string; error: string | null }>("SELECT at, category, error FROM email_send WHERE status = 'failed' ORDER BY at DESC LIMIT 10"),
  ]);
  const n = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
  return {
    on: !!active, provider: active?.config.provider ?? 'off',
    day: { sent: n('sent'), failed: n('failed'), skipped: n('skipped') },
    failures: failures.map((f) => ({ at: f.at, category: f.category, error: f.error ?? '' })),
  };
}
