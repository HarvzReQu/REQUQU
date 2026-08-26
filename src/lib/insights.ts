import type { Txn } from "./schema";
import { growth, sliceBy, sum, type Metrics } from "./metrics";

/**
 * Findings, not just charts.
 *
 * A dashboard shows numbers; an analyst says what they mean. Each rule below
 * states an observation, the figure behind it, and what to do about it - the
 * same shape a written management report takes.
 */
export type Tone = "critical" | "warning" | "good" | "info";

export type Insight = {
  id: string;
  tone: Tone;
  title: string;
  detail: string;
  action: string;
};

export function deriveInsights(txns: Txn[], m: Metrics): Insight[] {
  const out: Insight[] = [];
  if (txns.length === 0) return out;

  const money = (n: number) =>
    n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const pct = (n: number) => `${n.toFixed(1)}%`;

  // --- Customer concentration ---------------------------------------------
  const customers = sliceBy(txns, "customer");
  if (customers.length >= 5) {
    const top5 = sum(customers.slice(0, 5).map((c) => c.revenue));
    const share = (top5 / m.headline.revenue) * 100;
    if (share > 50) {
      out.push({
        id: "concentration",
        tone: share > 70 ? "critical" : "warning",
        title: `Top 5 customers are ${pct(share)} of revenue`,
        detail:
          `${money(top5)} of ${money(m.headline.revenue)} comes from ${customers.slice(0, 3).map((c) => c.key).join(", ")} ` +
          `and two others. Losing any one materially changes the year.`,
        action: "Model the revenue gap if the largest account churns, and weight new-business effort toward the long tail.",
      });
    }
  }

  // --- Month-on-month movement --------------------------------------------
  const months = m.months;
  if (months.length >= 2) {
    const last = months[months.length - 1]!;
    const prev = months[months.length - 2]!;
    const change = growth(last.revenue, prev.revenue);
    if (change !== null && Math.abs(change) >= 10) {
      const down = change < 0;
      out.push({
        id: "mom",
        tone: down ? (change <= -25 ? "critical" : "warning") : "good",
        title: `Revenue ${down ? "fell" : "rose"} ${pct(Math.abs(change))} in ${last.month}`,
        detail:
          `${money(prev.revenue)} in ${prev.month} to ${money(last.revenue)} in ${last.month}, on ` +
          `${last.orders} orders versus ${prev.orders}.`,
        action: down
          ? "Check whether the drop is order count or order value - they call for completely different responses."
          : "Identify which segment drove the increase and whether it is repeatable or a one-off large order.",
      });
    }
  }

  // --- Margin movement -----------------------------------------------------
  if (m.hasCost && months.length >= 2) {
    const withMargin = months.filter((x) => x.marginPct !== null);
    if (withMargin.length >= 2) {
      const last = withMargin[withMargin.length - 1]!;
      const prev = withMargin[withMargin.length - 2]!;
      const delta = last.marginPct! - prev.marginPct!;
      if (Math.abs(delta) >= 3) {
        out.push({
          id: "margin",
          tone: delta < 0 ? "warning" : "good",
          title: `Gross margin ${delta < 0 ? "fell" : "improved"} ${Math.abs(delta).toFixed(1)} points`,
          detail: `${pct(prev.marginPct!)} in ${prev.month} to ${pct(last.marginPct!)} in ${last.month}.`,
          action: delta < 0
            ? "Separate price erosion from cost inflation and from mix shift toward lower-margin lines."
            : "Confirm the gain is mix or pricing rather than a timing difference in cost recognition.",
        });
      }
    }
  }

  // --- Loss-making lines ---------------------------------------------------
  if (m.hasCost) {
    const losers = sliceBy(txns, "product")
      .filter((p) => p.marginPct !== null && p.marginPct < 0 && p.revenue > 0);
    if (losers.length > 0) {
      const worst = losers[0]!;
      out.push({
        id: "negative-margin",
        tone: "critical",
        title: `${losers.length} product${losers.length === 1 ? "" : "s"} sold below cost`,
        detail: `${worst.key} is the largest: ${money(worst.revenue)} of revenue at ${pct(worst.marginPct!)} margin.`,
        action: "Reprice, renegotiate supply, or discontinue. Volume on a negative-margin line makes the loss bigger, not smaller.",
      });
    }
  }

  // --- Refunds -------------------------------------------------------------
  if (m.headline.refunds > 0) {
    const gross = sum(txns.filter((t) => t.revenue > 0).map((t) => t.revenue));
    const rate = gross === 0 ? 0 : (Math.abs(m.headline.refundValue) / gross) * 100;
    if (rate >= 2) {
      out.push({
        id: "refunds",
        tone: rate >= 8 ? "critical" : "warning",
        title: `Refunds are ${pct(rate)} of gross revenue`,
        detail: `${m.headline.refunds} credit line${m.headline.refunds === 1 ? "" : "s"} totalling ${money(Math.abs(m.headline.refundValue))}.`,
        action: "Trace the refunds to product and customer - a concentrated cluster is a quality or fulfilment problem, not noise.",
      });
    }
  }

  // --- Retention -----------------------------------------------------------
  if (m.cohorts.length >= 2) {
    const rate = m.repeatRate * 100;
    out.push({
      id: "repeat",
      tone: rate < 20 ? "warning" : rate > 45 ? "good" : "info",
      title: `${pct(rate)} of customers bought more than once`,
      detail:
        rate < 20
          ? "Most revenue is coming from customers who never return, so growth depends entirely on new acquisition."
          : "A meaningful share of the base repeats, which makes revenue less dependent on acquisition spend.",
      action: rate < 20
        ? "Compare acquisition cost against first-order value - a one-purchase base only works if the first order pays for itself."
        : "Segment the repeat buyers and look for what the one-time buyers did differently.",
    });
  }

  // --- Where the money actually is ----------------------------------------
  const categories = sliceBy(txns, "category");
  if (categories.length >= 2 && categories[0]!.share > 0.4) {
    out.push({
      id: "category-dominance",
      tone: "info",
      title: `${categories[0]!.key} drives ${pct(categories[0]!.share * 100)} of revenue`,
      detail: `${money(categories[0]!.revenue)} across ${categories[0]!.orders} orders.`,
      action: "Check that operational attention and inventory are weighted the same way the revenue is.",
    });
  }

  const order: Record<Tone, number> = { critical: 0, warning: 1, good: 2, info: 3 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}

/**
 * Reconciliation.
 *
 * The question every finance reviewer asks first is "do these numbers tie out?"
 * These checks answer it in the product instead of leaving it to be discovered.
 * Tolerance is half a cent to absorb float representation, not real error.
 */
export type Check = { label: string; expected: number; actual: number; ok: boolean };

export function reconcile(txns: Txn[], m: Metrics): Check[] {
  const total = m.headline.revenue;
  const tolerance = 0.005;
  const check = (label: string, actual: number): Check => ({
    label, expected: total, actual, ok: Math.abs(actual - total) < tolerance,
  });

  const checks: Check[] = [
    check("Monthly revenue sums to total", sum(m.months.map((x) => x.revenue))),
    check("Revenue by customer sums to total", sum(sliceBy(txns, "customer").map((s) => s.revenue))),
    check("Revenue by product sums to total", sum(sliceBy(txns, "product").map((s) => s.revenue))),
    check("Revenue by region sums to total", sum(sliceBy(txns, "region").map((s) => s.revenue))),
  ];

  if (m.hasCost && m.headline.grossProfit !== null && m.headline.cost !== null) {
    checks.push({
      label: "Gross profit equals revenue minus cost",
      expected: total - m.headline.cost,
      actual: m.headline.grossProfit,
      ok: Math.abs(m.headline.grossProfit - (total - m.headline.cost)) < tolerance,
    });
  }
  return checks;
}
