import type { Txn } from "./schema";

export const monthKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export type Headline = {
  revenue: number;
  cost: number | null;
  grossProfit: number | null;
  marginPct: number | null;
  orders: number;
  units: number;
  customers: number;
  /** Average order value. */
  aov: number;
  refunds: number;
  refundValue: number;
};

export type MonthPoint = {
  month: string;
  revenue: number;
  cost: number | null;
  profit: number | null;
  marginPct: number | null;
  orders: number;
  customers: number;
  newCustomers: number;
};

export type Slice = {
  key: string;
  revenue: number;
  profit: number | null;
  marginPct: number | null;
  orders: number;
  units: number;
  share: number;
  /** Running share once sorted by revenue - the Pareto curve. */
  cumulativeShare: number;
};

export type Cohort = {
  month: string;
  size: number;
  /** retention[i] = share of the cohort active i months after acquisition. */
  retention: number[];
};

export type Metrics = {
  headline: Headline;
  months: MonthPoint[];
  cohorts: Cohort[];
  repeatRate: number;
  hasCost: boolean;
  span: { from: Date; to: Date } | null;
};

export function computeMetrics(txns: Txn[]): Metrics {
  const revenue = sum(txns.map((t) => t.revenue));
  const withCost = txns.filter((t) => t.cost !== null);
  // Cost is only meaningful if essentially every row carries one - deriving
  // margin from a partially-costed file produces a number that looks precise
  // and is wrong.
  const hasCost = txns.length > 0 && withCost.length / txns.length > 0.95;
  const cost = hasCost ? sum(withCost.map((t) => t.cost!)) : null;

  const refunds = txns.filter((t) => t.revenue < 0);
  const customers = new Set(txns.map((t) => t.customer));

  const headline: Headline = {
    revenue,
    cost,
    grossProfit: cost === null ? null : revenue - cost,
    marginPct: cost === null || revenue === 0 ? null : ((revenue - cost) / revenue) * 100,
    orders: txns.length,
    units: sum(txns.map((t) => t.quantity)),
    customers: customers.size,
    aov: txns.length === 0 ? 0 : revenue / txns.length,
    refunds: refunds.length,
    refundValue: sum(refunds.map((t) => t.revenue)),
  };

  return {
    headline,
    months: monthly(txns, hasCost),
    cohorts: cohorts(txns),
    repeatRate: repeatRate(txns),
    hasCost,
    span: span(txns),
  };
}

function monthly(txns: Txn[], hasCost: boolean): MonthPoint[] {
  const buckets = new Map<string, Txn[]>();
  for (const t of txns) push(buckets, monthKey(t.date), t);

  const firstSeen = firstPurchaseMonth(txns);

  return [...buckets.keys()].sort().map((month) => {
    const rows = buckets.get(month)!;
    const rev = sum(rows.map((t) => t.revenue));
    const c = hasCost ? sum(rows.map((t) => t.cost ?? 0)) : null;
    const names = new Set(rows.map((t) => t.customer));

    return {
      month,
      revenue: rev,
      cost: c,
      profit: c === null ? null : rev - c,
      marginPct: c === null || rev === 0 ? null : ((rev - c) / rev) * 100,
      orders: rows.length,
      customers: names.size,
      newCustomers: [...names].filter((n) => firstSeen.get(n) === month).length,
    };
  });
}

/**
 * Aggregate by any text dimension, sorted by revenue with a running share.
 * `limit` folds the tail into "Other" rather than emitting a 40-slice chart -
 * and the fold is done here so every consumer gets the same treatment.
 */
export function sliceBy(
  txns: Txn[],
  field: "customer" | "product" | "category" | "region" | "channel" | "rep",
  limit = 0,
): Slice[] {
  const buckets = new Map<string, Txn[]>();
  for (const t of txns) push(buckets, t[field], t);

  const total = sum(txns.map((t) => t.revenue));
  const rows = [...buckets.entries()]
    .map(([key, list]) => {
      const rev = sum(list.map((t) => t.revenue));
      const costed = list.filter((t) => t.cost !== null);
      const c = costed.length === list.length && list.length > 0
        ? sum(costed.map((t) => t.cost!)) : null;
      return {
        key,
        revenue: rev,
        profit: c === null ? null : rev - c,
        marginPct: c === null || rev === 0 ? null : ((rev - c) / rev) * 100,
        orders: list.length,
        units: sum(list.map((t) => t.quantity)),
        share: total === 0 ? 0 : rev / total,
        cumulativeShare: 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const kept = limit > 0 && rows.length > limit ? fold(rows, limit, total) : rows;

  let running = 0;
  for (const r of kept) { running += r.share; r.cumulativeShare = running; }
  return kept;
}

function fold(rows: Slice[], limit: number, total: number): Slice[] {
  const head = rows.slice(0, limit);
  const tail = rows.slice(limit);
  if (tail.length === 0) return head;

  const rev = sum(tail.map((r) => r.revenue));
  const anyMissing = tail.some((r) => r.profit === null);
  const profit = anyMissing ? null : sum(tail.map((r) => r.profit!));

  head.push({
    key: `Other (${tail.length})`,
    revenue: rev,
    profit,
    marginPct: profit === null || rev === 0 ? null : (profit / rev) * 100,
    orders: sum(tail.map((r) => r.orders)),
    units: sum(tail.map((r) => r.units)),
    share: total === 0 ? 0 : rev / total,
    cumulativeShare: 0,
  });
  return head;
}

function firstPurchaseMonth(txns: Txn[]): Map<string, string> {
  const first = new Map<string, string>();
  for (const t of txns) {
    const m = monthKey(t.date);
    const seen = first.get(t.customer);
    if (!seen || m < seen) first.set(t.customer, m);
  }
  return first;
}

/**
 * Monthly acquisition cohorts. retention[0] is always 1 by definition - the
 * cohort is active in the month it was acquired.
 */
function cohorts(txns: Txn[]): Cohort[] {
  if (txns.length === 0) return [];

  const first = firstPurchaseMonth(txns);
  const active = new Map<string, Set<string>>(); // month -> customers
  for (const t of txns) {
    const m = monthKey(t.date);
    const set = active.get(m);
    if (set) set.add(t.customer);
    else active.set(m, new Set([t.customer]));
  }

  const timeline = [...active.keys()].sort();
  const byCohort = new Map<string, string[]>();
  for (const [customer, month] of first) push(byCohort, month, customer);

  return [...byCohort.keys()].sort().map((month) => {
    const members = byCohort.get(month)!;
    const start = timeline.indexOf(month);
    const retention = timeline.slice(start).map((m) => {
      const live = active.get(m)!;
      return members.filter((c) => live.has(c)).length / members.length;
    });
    return { month, size: members.length, retention };
  });
}

function repeatRate(txns: Txn[]): number {
  const counts = new Map<string, number>();
  for (const t of txns) counts.set(t.customer, (counts.get(t.customer) ?? 0) + 1);
  if (counts.size === 0) return 0;
  return [...counts.values()].filter((n) => n > 1).length / counts.size;
}

function span(txns: Txn[]): { from: Date; to: Date } | null {
  if (txns.length === 0) return null;
  let from = txns[0]!.date, to = txns[0]!.date;
  for (const t of txns) {
    if (t.date < from) from = t.date;
    if (t.date > to) to = t.date;
  }
  return { from, to };
}

/**
 * Kahan-compensated sum. Naive floating-point addition over tens of thousands of
 * currency values accumulates enough error to make a reconciliation check fail
 * on numbers that are actually correct.
 */
export function sum(values: number[]): number {
  let total = 0;
  let compensation = 0;
  for (const v of values) {
    const y = v - compensation;
    const t = total + y;
    compensation = t - total - y;
    total = t;
  }
  return total;
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Percentage change, guarding the divide-by-zero and sign-flip cases. */
export function growth(current: number, previous: number): number | null {
  if (previous === 0) return null;
  if (previous < 0) return null; // growth off a negative base is meaningless
  return ((current - previous) / previous) * 100;
}
