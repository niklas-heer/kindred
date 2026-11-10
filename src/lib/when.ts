// When something was written, as the Chronicle and the feed say it: "3 hours ago" beside an entry, and the day it falls
// under ("Today", "Yesterday", "Earlier this week", then the month). All of it depends on the reader's clock, so a page
// writes it only once it runs in the browser (see src/lib/clock.ts): the server's HTML carries no time of its own.
import { locales, type Locale, type Translator } from '~/lib/i18n';

/** "3 hours ago", in the reader's language. */
export function ago(at: string, now: number, tr: Translator): string {
  const rtf = new Intl.RelativeTimeFormat(locales[tr.locale], { numeric: 'auto' });
  const s = (new Date(at).getTime() - now) / 1000;
  const a = Math.abs(s);
  if (a < 60) return tr('chronicle.just_now');
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86_400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 86_400 * 7) return rtf.format(Math.round(s / 86_400), 'day');
  if (a < 86_400 * 30) return rtf.format(Math.round(s / (86_400 * 7)), 'week');
  if (a < 86_400 * 365) return rtf.format(Math.round(s / (86_400 * 30)), 'month');
  return rtf.format(Math.round(s / (86_400 * 365)), 'year');
}

/** The heading an entry falls under: today, yesterday, this week, this month, then its month (and year, when not this one). */
export function dayLabel(at: string, now: Date, tr: Translator): string {
  const d = new Date(at);
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  if (days <= 0) return tr('chronicle.today');
  if (days === 1) return tr('chronicle.yesterday');
  if (days < 7) return tr('chronicle.earlier_week');
  if (days < 30) return tr('chronicle.earlier_month');
  return d.toLocaleDateString(locales[tr.locale], { month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

/** The exact moment, for a time's tooltip. */
export const exact = (at: string, locale: Locale) => new Date(at).toLocaleString(locales[locale], { dateStyle: 'long', timeStyle: 'short' });
