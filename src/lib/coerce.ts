/**
 * Turning spreadsheet strings into numbers and dates.
 *
 * This is where most of the wrongness in a naive dashboard comes from: a
 * currency column read with parseFloat silently becomes NaN on "$1,234.56", and
 * an accounting-style "(89.00)" becomes positive 89 instead of a refund.
 */

/** Accounting parentheses mean negative: (89.00) is -89.00. */
export function toNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  let s = raw.trim();
  if (s === "" || s === "-" || s === "–") return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }

  // Drop currency symbols, spaces and non-breaking spaces.
  s = s.replace(/[$€£¥₱\s ]/g, "");
  if (s.startsWith("-")) { negative = true; s = s.slice(1); }

  const percent = s.endsWith("%");
  if (percent) s = s.slice(0, -1);

  s = normalizeGrouping(s);
  if (s === "" || !/^\d*\.?\d+$/.test(s)) return null;

  const value = Number(s);
  if (Number.isNaN(value)) return null;
  return (negative ? -value : value) / (percent ? 100 : 1);
}

/**
 * Resolve thousands separators against decimal separators.
 * "1,234.56" is en-US; "1.234,56" is de-DE; "1,234" is ambiguous and treated as
 * a thousands group, which is the overwhelmingly more common intent in exports.
 */
function normalizeGrouping(s: string): string {
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  if (lastComma === -1 && lastDot === -1) return s;
  if (lastComma > lastDot) {
    // Comma is the decimal mark: strip dots, swap comma for dot.
    return s.replace(/\./g, "").replace(",", ".");
  }
  return s.replace(/,/g, "");
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse a date, preferring ISO. `dayFirst` disambiguates 03/04/2026 - which is
 * 3 April in most of the world and 4 March in the US. Guessed from the data by
 * `inferDayFirst`, never assumed.
 */
export function toDate(raw: string | undefined, dayFirst = false): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return utc(+iso[1]!, +iso[2]! - 1, +iso[3]!);

  const slash = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(s);
  if (slash) {
    const a = +slash[1]!, b = +slash[2]!;
    let year = +slash[3]!;
    if (year < 100) year += year < 70 ? 2000 : 1900;
    // A value above 12 can only be the day, whatever the convention claims.
    const [day, month] = a > 12 ? [a, b] : b > 12 ? [b, a] : dayFirst ? [a, b] : [b, a];
    return utc(year, month - 1, day);
  }

  const named = /^(\d{1,2})[\s-]*([A-Za-z]{3,})[\s-]*(\d{2,4})$/.exec(s)
    ?? /^([A-Za-z]{3,})[\s-]+(\d{1,2}),?[\s-]+(\d{2,4})$/.exec(s);
  if (named) {
    const monthName = /^[A-Za-z]/.test(named[1]!) ? named[1]! : named[2]!;
    const dayPart = /^[A-Za-z]/.test(named[1]!) ? named[2]! : named[1]!;
    const month = MONTHS[monthName.slice(0, 3).toLowerCase()];
    if (month !== undefined) return utc(+named[3]!, month, +dayPart);
  }

  const fallback = new Date(s);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

/**
 * Decide whether a column of ambiguous dates is day-first, by looking for any
 * value whose first component exceeds 12. One unambiguous row settles the whole
 * column - which is far safer than assuming a locale.
 */
export function inferDayFirst(values: string[]): boolean {
  let dayFirstEvidence = 0;
  let monthFirstEvidence = 0;
  for (const v of values) {
    const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.]\d{2,4}/.exec(v.trim());
    if (!m) continue;
    if (+m[1]! > 12) dayFirstEvidence++;
    if (+m[2]! > 12) monthFirstEvidence++;
  }
  return dayFirstEvidence > monthFirstEvidence;
}
