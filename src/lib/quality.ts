import type { Txn } from "./schema";
import { monthKey } from "./metrics";

/**
 * Data quality checks.
 *
 * Cleaning is the actual day job, and a tool that reports totals without ever
 * questioning the rows behind them is telling you a confident lie. Every issue
 * carries the source row numbers, so the finding is actionable in the original
 * spreadsheet rather than just alarming.
 */
export type QualityIssue = {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  count: number;
  /** Source spreadsheet row numbers, capped for display. */
  rows: number[];
  /** Revenue implicated, where the issue affects a total. */
  amount?: number;
};

const SAMPLE = 12;

export function checkQuality(
  txns: Txn[],
  parse: { skipped: number; total: number },
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  if (txns.length === 0) return issues;

  // ── rows the parser could not read ──────────────────────────────────────
  if (parse.skipped > 0) {
    issues.push({
      id: "unparsed",
      severity: parse.skipped / parse.total > 0.05 ? "high" : "medium",
      title: `${parse.skipped} row${parse.skipped === 1 ? "" : "s"} could not be read`,
      detail:
        "These had no usable date or no usable amount and are excluded from every " +
        "figure on this page. Check for subtotal lines, blank separators, or a second header row.",
      count: parse.skipped,
      rows: [],
    });
  }

  // ── exact duplicates ────────────────────────────────────────────────────
  const seen = new Map<string, Txn[]>();
  for (const t of txns) {
    const key = [t.date.getTime(), t.customer, t.product, t.revenue, t.quantity].join("|");
    const list = seen.get(key);
    if (list) list.push(t);
    else seen.set(key, [t]);
  }
  const dupeGroups = [...seen.values()].filter((g) => g.length > 1);
  if (dupeGroups.length > 0) {
    const extra = dupeGroups.reduce((n, g) => n + g.length - 1, 0);
    const value = dupeGroups.reduce((v, g) => v + g[0]!.revenue * (g.length - 1), 0);
    const share = extra / txns.length;

    // Severity scales with prevalence, because a couple of identical lines is
    // genuinely ambiguous - a customer really can place the same order twice in
    // a day. A double import looks different: it duplicates a large fraction of
    // the file at once. Calling every coincidence "high" trains people to
    // ignore the panel, which costs more than the occasional missed duplicate.
    const severity = share > 0.02 ? "high" : extra >= 3 ? "medium" : "low";

    issues.push({
      id: "duplicates",
      severity,
      title: `${extra} row${extra === 1 ? "" : "s"} identical to another`,
      detail:
        `${dupeGroups.length} transaction${dupeGroups.length === 1 ? " appears" : "s appear"} more than once ` +
        "with the same date, customer, product, quantity and amount " +
        `(${(share * 100).toFixed(1)}% of rows). ` +
        (severity === "high"
          ? "At this proportion it is almost certainly a double export or a re-imported batch, and the totals are overstated."
          : "That can be a genuine repeat order, or a double-entered line — worth confirming against the source before trusting the total."),
      count: extra,
      rows: dupeGroups.flatMap((g) => g.slice(1).map((t) => t.row)).slice(0, SAMPLE),
      amount: value,
    });
  }

  // ── gaps in the monthly series ──────────────────────────────────────────
  const present = new Set(txns.map((t) => monthKey(t.date)));
  const sorted = [...present].sort();
  const gaps: string[] = [];
  if (sorted.length > 1) {
    const [startY, startM] = sorted[0]!.split("-").map(Number) as [number, number];
    const [endY, endM] = sorted[sorted.length - 1]!.split("-").map(Number) as [number, number];
    for (let y = startY, m = startM; y < endY || (y === endY && m <= endM); ) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      if (!present.has(key)) gaps.push(key);
      m++; if (m > 12) { m = 1; y++; }
    }
  }
  if (gaps.length > 0) {
    issues.push({
      id: "gaps",
      severity: "medium",
      title: `${gaps.length} month${gaps.length === 1 ? "" : "s"} with no transactions`,
      detail:
        `Nothing recorded for ${gaps.slice(0, 6).join(", ")}${gaps.length > 6 ? "…" : ""}. ` +
        "Either the business genuinely stopped, or the export is missing a period — " +
        "which would make every trend on this page wrong.",
      count: gaps.length,
      rows: [],
    });
  }

  // ── amount outliers ─────────────────────────────────────────────────────
  const positives = txns.filter((t) => t.revenue > 0).sort((a, b) => a.revenue - b.revenue);
  if (positives.length >= 12) {
    const q = (p: number) => positives[Math.floor(positives.length * p)]!.revenue;
    const q1 = q(0.25), q3 = q(0.75);
    const iqr = q3 - q1;
    // Tukey's far-out fence. Conservative on purpose: a large genuine order is
    // normal, and crying wolf on every big deal makes the panel worthless.
    const fence = q3 + 3 * iqr;
    const outliers = positives.filter((t) => t.revenue > fence);
    if (outliers.length > 0 && iqr > 0) {
      const share = outliers.reduce((s, t) => s + t.revenue, 0);
      issues.push({
        id: "outliers",
        // Large orders are normal in most businesses; only flag loudly when
        // they are numerous enough to distort the averages.
        severity: outliers.length / txns.length > 0.05 ? "medium" : "low",
        title: `${outliers.length} unusually large transaction${outliers.length === 1 ? "" : "s"}`,
        detail:
          `Above ${Math.round(fence).toLocaleString()} — three interquartile ranges past the upper quartile. ` +
          "Genuine large orders look like this, and so does a misplaced decimal point. Worth confirming which.",
        count: outliers.length,
        rows: outliers.slice(-SAMPLE).map((t) => t.row),
        amount: share,
      });
    }
  }

  // ── unattributed dimensions ─────────────────────────────────────────────
  for (const [field, label, placeholder] of [
    ["customer", "customer", "Unknown"],
    ["product", "product", "Unknown"],
  ] as const) {
    const blank = txns.filter((t) => t[field] === placeholder);
    if (blank.length > 0 && blank.length < txns.length) {
      const value = blank.reduce((s, t) => s + t.revenue, 0);
      issues.push({
        id: `blank-${field}`,
        severity: "low",
        title: `${blank.length} row${blank.length === 1 ? "" : "s"} with no ${label}`,
        detail:
          `These are grouped under "Unknown" in every ${label} breakdown, which makes that ` +
          "bucket look like a real account. Fill them in at source if the split matters.",
        count: blank.length,
        rows: blank.slice(0, SAMPLE).map((t) => t.row),
        amount: value,
      });
    }
  }

  // ── zero-value lines ────────────────────────────────────────────────────
  const zeros = txns.filter((t) => t.revenue === 0);
  if (zeros.length > 0) {
    issues.push({
      id: "zeros",
      severity: "low",
      title: `${zeros.length} row${zeros.length === 1 ? "" : "s"} with a zero amount`,
      detail:
        "Counted as orders but contributing no revenue, which drags the average order value down. " +
        "Often free samples, comped lines, or a failed export of the amount column.",
      count: zeros.length,
      rows: zeros.slice(0, SAMPLE).map((t) => t.row),
    });
  }

  // ── dates in the future ─────────────────────────────────────────────────
  const now = new Date();
  const future = txns.filter((t) => t.date.getTime() > now.getTime() + 86_400_000);
  if (future.length > 0) {
    issues.push({
      id: "future",
      severity: "medium",
      title: `${future.length} row${future.length === 1 ? "" : "s"} dated in the future`,
      detail:
        "Either forward-dated invoices, or a day/month swap that the parser could not disambiguate. " +
        "The second case would scramble your monthly trend.",
      count: future.length,
      rows: future.slice(0, SAMPLE).map((t) => t.row),
    });
  }

  // ── sign disagreement between quantity and amount ───────────────────────
  const mismatched = txns.filter(
    (t) => (t.quantity < 0 && t.revenue > 0) || (t.quantity > 0 && t.revenue < 0),
  );
  if (mismatched.length > 0) {
    issues.push({
      id: "sign",
      severity: "low",
      title: `${mismatched.length} row${mismatched.length === 1 ? "" : "s"} where quantity and amount disagree in sign`,
      detail:
        "A credit normally carries a negative quantity and a negative amount. One without the other " +
        "usually means the return was only half-recorded.",
      count: mismatched.length,
      rows: mismatched.slice(0, SAMPLE).map((t) => t.row),
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}
