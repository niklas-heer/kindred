// Partial dates as the archive writes them: "1953", "1953-08", "1953-08-08", "~1953" for about.
const SHAPE = /^~?(\d{3,4})(?:-(\d\d)(?:-(\d\d))?)?$/;

/** A partial date that also exists on the calendar (no month 13, no 31 June, 29 Feb only in leap years). */
export function validDate(s: string): boolean {
  const m = SHAPE.exec(s);
  if (!m) return false;
  const [, y, mo, d] = m;
  if (mo === undefined) return true;
  const month = Number(mo);
  if (month < 1 || month > 12) return false;
  if (d === undefined) return true;
  const day = Number(d);
  const days = new Date(Date.UTC(Number(y), month, 0)).getUTCDate();
  return day >= 1 && day <= days;
}

export const fullDate = (s: string) => /^\d{4}-\d\d-\d\d$/.test(s) && validDate(s);
