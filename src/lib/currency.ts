/**
 * Currency detection.
 *
 * Formatting every figure as USD regardless of the file was a real defect: a
 * ₱19,750.50 export rendered as "$19,751", which is the application confidently
 * mislabelling money. The symbol is in the source data, so read it.
 */
export type Currency = { code: string; symbol: string; label: string };

/** Ordered so the ambiguous "$" resolves to USD unless something better matches. */
export const CURRENCIES: Currency[] = [
  { code: "USD", symbol: "$",  label: "US dollar" },
  { code: "EUR", symbol: "€",  label: "Euro" },
  { code: "GBP", symbol: "£",  label: "Pound sterling" },
  { code: "PHP", symbol: "₱",  label: "Philippine peso" },
  { code: "JPY", symbol: "¥",  label: "Japanese yen" },
  { code: "INR", symbol: "₹",  label: "Indian rupee" },
  { code: "AUD", symbol: "A$", label: "Australian dollar" },
  { code: "CAD", symbol: "C$", label: "Canadian dollar" },
  { code: "NZD", symbol: "NZ$",label: "New Zealand dollar" },
  { code: "SGD", symbol: "S$", label: "Singapore dollar" },
  { code: "KRW", symbol: "₩",  label: "South Korean won" },
  { code: "THB", symbol: "฿",  label: "Thai baht" },
  { code: "VND", symbol: "₫",  label: "Vietnamese dong" },
  { code: "BRL", symbol: "R$", label: "Brazilian real" },
  { code: "ZAR", symbol: "R",  label: "South African rand" },
  { code: "CHF", symbol: "CHF",label: "Swiss franc" },
  { code: "CNY", symbol: "CN¥",label: "Chinese yuan" },
  { code: "MXN", symbol: "MX$",label: "Mexican peso" },
  { code: "IDR", symbol: "Rp", label: "Indonesian rupiah" },
  { code: "MYR", symbol: "RM", label: "Malaysian ringgit" },
];

/** Unicode symbols first: they are unambiguous where "$" is not. */
const UNIQUE_SYMBOLS: [string, string][] = [
  ["₱", "PHP"], ["€", "EUR"], ["£", "GBP"], ["₹", "INR"], ["₩", "KRW"],
  ["฿", "THB"], ["₫", "VND"], ["¥", "JPY"],
];

/** Multi-character prefixes, checked before a bare "$" can claim the value. */
const PREFIXES: [string, string][] = [
  ["A$", "AUD"], ["C$", "CAD"], ["NZ$", "NZD"], ["S$", "SGD"], ["R$", "BRL"],
  ["MX$", "MXN"], ["CN¥", "CNY"], ["RM", "MYR"], ["Rp", "IDR"], ["CHF", "CHF"],
];

/**
 * Infer the currency from raw (pre-coercion) amount strings, plus any ISO code
 * appearing in the headers. Returns null when the file carries no signal at all,
 * which is a meaningfully different state from "it is dollars".
 */
export function detectCurrency(samples: string[], headers: string[] = []): string | null {
  const votes = new Map<string, number>();
  const vote = (code: string) => votes.set(code, (votes.get(code) ?? 0) + 1);

  for (const raw of samples) {
    if (!raw) continue;
    const s = raw.trim();

    const unique = UNIQUE_SYMBOLS.find(([sym]) => s.includes(sym));
    if (unique) { vote(unique[1]); continue; }

    const prefix = PREFIXES.find(([p]) => s.toUpperCase().startsWith(p.toUpperCase()));
    if (prefix) { vote(prefix[1]); continue; }

    if (s.includes("$")) vote("USD");
  }

  // An explicit ISO code in a header beats a symbol guess - "Amount (GBP)" is
  // a stronger signal than a "$" that could be any of six dollars.
  const headerText = headers.join(" ").toUpperCase();
  for (const c of CURRENCIES) {
    if (new RegExp(`\\b${c.code}\\b`).test(headerText)) return c.code;
  }

  if (votes.size === 0) return null;
  return [...votes.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

export function currencyOf(code: string): Currency | undefined {
  return CURRENCIES.find((c) => c.code === code);
}

/**
 * Formatters bound to one currency. `null` means the file gave no signal, so
 * amounts render as plain numbers rather than asserting a currency we do not know.
 */
export function makeFormatters(code: string | null) {
  const opts: Intl.NumberFormatOptions = code
    ? { style: "currency", currency: code }
    : { style: "decimal" };

  const money = (n: number) =>
    n.toLocaleString(undefined, { ...opts, maximumFractionDigits: 0 });

  const moneyCompact = (n: number) =>
    n.toLocaleString(undefined, {
      ...opts,
      notation: Math.abs(n) >= 10_000 ? "compact" : "standard",
      maximumFractionDigits: Math.abs(n) >= 1000 ? 1 : 0,
    });

  const moneyExact = (n: number) =>
    n.toLocaleString(undefined, { ...opts, minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return { money, moneyCompact, moneyExact };
}
