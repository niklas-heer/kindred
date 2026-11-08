// Date rules for a person's life events: how old they were at each, and when a spouse's death is a widowing.
// Pure (no React), so the test runner loads it. Dates are partial ISO strings ("1953", "1953-06", "1953-06-13");
// a leading "~" marks an approximate date.
import { approx, yearOf } from './graph.ts';
import type { GPerson, GUnion } from './types.ts';

interface Parts { y: number; m?: number; d?: number; exact: boolean }

function parse(s?: string): Parts | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.replace(/^~/, '').split('-').map(Number);
  if (!Number.isFinite(y)) return undefined;
  return { y, m, d, exact: !approx(s) && m !== undefined && d !== undefined };
}

export interface Age { years: number; approx: boolean }

/**
 * How old someone was on a date, from their birth date. Exact only when both dates are full days and neither is
 * approximate; otherwise the years apart, marked approximate. Undefined when either date is unknown, or the
 * date is before the birth.
 */
export function ageOn(born?: string, on?: string): Age | undefined {
  const b = parse(born), e = parse(on);
  if (!b || !e) return undefined;
  if (b.exact && e.exact) {
    let years = e.y - b.y;
    if (e.m! < b.m! || (e.m === b.m && e.d! < b.d!)) years--;
    return years < 0 ? undefined : { years, approx: false };
  }
  const years = e.y - b.y;
  // Same year, but the dates order the other way: the event is before the birth.
  if (years < 0 || (years === 0 && compareDates(on!, born!) < 0)) return undefined;
  return { years, approx: true };
}

/**
 * Orders two partial dates: negative when `a` is earlier, positive when later, 0 when they cannot be told apart
 * at the precision both have (the same year, say, when one of them is only a year).
 */
export function compareDates(a: string, b: string): number {
  const pa = parse(a), pb = parse(b);
  if (!pa || !pb) return 0;
  if (pa.y !== pb.y) return pa.y - pb.y;
  if (pa.m === undefined || pb.m === undefined) return 0;
  if (pa.m !== pb.m) return pa.m - pb.m;
  if (pa.d === undefined || pb.d === undefined) return 0;
  return pa.d - pb.d;
}

/**
 * The date on which a spouse's death is a widowing for `person`, or undefined when it is not one. The partner
 * must have died while the person was alive, and while the union still stood: a divorce or separation before
 * then means no. Where the dates cannot be put in order, no widowing is claimed.
 */
export function widowedOn(person: GPerson, partner: GPerson, u: GUnion): string | undefined {
  if (partner.living || !partner.died || !Number.isFinite(yearOf(partner.died))) return undefined;
  const died = partner.died;
  if (!person.living && (!person.died || compareDates(person.died, died) <= 0)) return undefined;
  if (u.start && compareDates(died, u.start) < 0) return undefined;
  if (u.endReason !== 'death' && (u.end || u.endReason)) {
    if (!u.end || compareDates(u.end, died) <= 0) return undefined;
  }
  return died;
}
