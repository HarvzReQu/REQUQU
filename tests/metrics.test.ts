/**
 * The numbers have to be right, and "right" has to be checkable.
 *
 * Three layers:
 *  1. unit  - parsing and coercion against known-awkward inputs
 *  2. golden - a tiny dataset whose every figure was computed by hand
 *  3. invariant - properties that must hold for ANY input, checked on the sample
 *
 * Layer 3 exists because reconciliation alone is not proof: totals that tie out
 * can still be consistently wrong (see the well-formedness test below).
 */
import assert from "node:assert/strict";

import { parse, sniffDelimiter } from "@/lib/csv";
import { toDate, toNumber, inferDayFirst } from "@/lib/coerce";
import { load } from "@/lib/schema";
import { computeMetrics, sliceBy, sum, growth, monthKey } from "@/lib/metrics";
import { reconcile, deriveInsights } from "@/lib/insights";
import { buildSampleCsv } from "@/lib/sample";

let passed = 0;
const ok = (label: string) => { passed++; console.log(`  ✓ ${label}`); };
const near = (a: number, b: number, msg: string, eps = 0.005) =>
  assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} != ${b}`);

// ── 1. CSV ──────────────────────────────────────────────────────────────────
{
  const t = parse('a,b,c\n1,"two, with comma",3\n4,"say ""hi""",6');
  assert.deepEqual(t.headers, ["a", "b", "c"]);
  assert.deepEqual(t.rows[0], ["1", "two, with comma", "3"]);
  assert.deepEqual(t.rows[1], ["4", 'say "hi"', "6"]);
  ok("quoted fields with commas and escaped quotes");

  assert.deepEqual(parse("﻿a,b\r\n1,2").headers, ["a", "b"]);
  ok("UTF-8 BOM stripped and CRLF handled");

  assert.equal(sniffDelimiter("a;b;c\n1;2;3\n4;5;6"), ";");
  assert.equal(sniffDelimiter("a\tb\tc\n1\t2\t3"), "\t");
  ok("delimiter sniffing (semicolon, tab)");
}

// ── 2. Coercion ─────────────────────────────────────────────────────────────
{
  near(toNumber("$1,234.56")!, 1234.56, "en-US currency");
  near(toNumber("1.234,56")!, 1234.56, "de-DE currency");
  near(toNumber("(89.00)")!, -89, "accounting parentheses");
  near(toNumber("-$40")!, -40, "leading minus with symbol");
  near(toNumber("12.5%")!, 0.125, "percent");
  assert.equal(toNumber(""), null);
  assert.equal(toNumber("n/a"), null);
  ok("currency, accounting negatives, locales, percent");

  assert.equal(toDate("2026-03-14")!.toISOString().slice(0, 10), "2026-03-14");
  assert.equal(toDate("03/14/2026")!.toISOString().slice(0, 10), "2026-03-14");
  assert.equal(toDate("14/03/2026", true)!.toISOString().slice(0, 10), "2026-03-14");
  assert.equal(toDate("14-Mar-2026")!.toISOString().slice(0, 10), "2026-03-14");
  ok("date formats: ISO, US, day-first, named month");

  // 13 can only be a day, and that one row settles the whole column.
  assert.equal(inferDayFirst(["01/02/2026", "13/02/2026"]), true);
  assert.equal(inferDayFirst(["01/02/2026", "02/13/2026"]), false);
  ok("day-first inferred from data, not assumed");
}

// ── 3. Golden dataset ───────────────────────────────────────────────────────
const GOLDEN = [
  "Date,Customer,Product,Category,Qty,Unit Price,Unit Cost,Amount",
  '2026-01-05,Acme,Widget,Hardware,2,"$100.00","$60.00","$200.00"',
  '2026-01-20,Beta,Gadget,Hardware,1,"$50.00","$20.00","$50.00"',
  '2026-02-10,Acme,Widget,Hardware,3,"$100.00","$60.00","$300.00"',
  '2026-02-15,Gamma,Service,Services,1,"$400.00","$100.00","$400.00"',
  '2026-03-01,Beta,Gadget,Hardware,-1,"$50.00","$20.00","($50.00)"',
].join("\n");

{
  const r = load(GOLDEN);
  assert.equal(r.error, null);
  assert.equal(r.txns.length, 5);
  assert.equal(r.skipped, 0);

  const m = computeMetrics(r.txns);
  // Hand-computed: 200 + 50 + 300 + 400 - 50
  near(m.headline.revenue, 900, "revenue");
  // 120 + 20 + 180 + 100 - 20
  near(m.headline.cost!, 400, "cost");
  near(m.headline.grossProfit!, 500, "gross profit");
  near(m.headline.marginPct!, 55.5556, "margin %", 0.01);
  assert.equal(m.headline.orders, 5);
  near(m.headline.units, 6, "units");          // 2+1+3+1-1
  assert.equal(m.headline.customers, 3);
  near(m.headline.aov, 180, "AOV");
  assert.equal(m.headline.refunds, 1);
  near(m.headline.refundValue, -50, "refund value");
  ok("golden headline figures match hand calculation");

  assert.deepEqual(m.months.map((x) => x.month), ["2026-01", "2026-02", "2026-03"]);
  near(m.months[0]!.revenue, 250, "Jan revenue");
  near(m.months[1]!.revenue, 700, "Feb revenue");
  near(m.months[2]!.revenue, -50, "Mar revenue (credit only)");
  near(m.months[1]!.marginPct!, 60, "Feb margin %");
  assert.equal(m.months[0]!.newCustomers, 2);
  assert.equal(m.months[1]!.newCustomers, 1);
  ok("golden monthly series matches hand calculation");

  const byCustomer = sliceBy(r.txns, "customer");
  near(byCustomer.find((s) => s.key === "Acme")!.revenue, 500, "Acme");
  near(byCustomer.find((s) => s.key === "Gamma")!.revenue, 400, "Gamma");
  // Beta bought 50 and refunded 50 - a real customer with zero net revenue.
  near(byCustomer.find((s) => s.key === "Beta")!.revenue, 0, "Beta nets to zero");
  ok("golden segmentation, including a net-zero customer");

  near(m.repeatRate, 2 / 3, "repeat rate", 0.001);
  const jan = m.cohorts.find((c) => c.month === "2026-01")!;
  assert.equal(jan.size, 2);
  near(jan.retention[0]!, 1, "cohort month 0 is 1 by definition");
  near(jan.retention[1]!, 0.5, "Jan cohort month 1");
  near(jan.retention[2]!, 0.5, "Jan cohort month 2");
  ok("golden cohorts and repeat rate");
}

// ── 4. Edge cases ───────────────────────────────────────────────────────────
{
  assert.equal(growth(110, 100), 10);
  assert.equal(growth(50, 0), null, "growth off zero is undefined, not Infinity");
  assert.equal(growth(50, -100), null, "growth off a negative base is meaningless");
  ok("growth guards divide-by-zero and negative bases");

  // Kahan summation: naive addition drifts on long currency runs.
  const cents = Array.from({ length: 100_000 }, () => 0.01);
  near(sum(cents), 1000, "100k x 0.01 sums to exactly 1000", 1e-9);
  ok("compensated summation holds over 100k values");

  const noAmount = load("Date,Customer\n2026-01-01,Acme");
  assert.ok(noAmount.error?.includes("amount"), "missing amount column is reported");
  const noDate = load("Customer,Amount\nAcme,100");
  assert.ok(noDate.error?.includes("date"), "missing date column is reported");
  ok("unusable files fail with an explanation, not a crash");

  const m0 = computeMetrics([]);
  assert.equal(m0.headline.revenue, 0);
  assert.equal(m0.headline.aov, 0, "AOV of nothing is 0, not NaN");
  assert.deepEqual(deriveInsights([], m0), []);
  ok("empty input produces zeros, not NaN");
}

// ── 5. Sample invariants ────────────────────────────────────────────────────
{
  const csv = buildSampleCsv();

  // Regression guard. A field containing a thousands separator MUST be quoted;
  // unquoted, every conforming reader mis-splits the row and shifts every later
  // column. This bug produced a dataset whose reconciliation checks all passed
  // while cost exceeded revenue - proof that tying out is not the same as being
  // correct.
  const widths = new Set(parse(csv).rows.map((r) => r.length));
  assert.equal(widths.size, 1, `ragged CSV: row widths ${[...widths].join(", ")}`);
  assert.equal([...widths][0], parse(csv).headers.length, "rows match header width");
  ok("sample CSV is well-formed (every row the same width)");

  const r = load(csv);
  assert.equal(r.error, null);
  assert.equal(r.skipped, 0, `${r.skipped} sample rows failed to parse`);
  assert.ok(r.txns.length > 400, "sample has enough volume to be interesting");

  const m = computeMetrics(r.txns);
  for (const c of reconcile(r.txns, m)) {
    assert.ok(c.ok, `reconciliation failed: ${c.label} (${c.actual} vs ${c.expected})`);
  }
  ok("every reconciliation check passes on the sample");

  // Properties that must hold for any dataset, not just this one.
  for (const dim of ["customer", "product", "category", "region", "channel", "rep"] as const) {
    near(sum(sliceBy(r.txns, dim).map((s) => s.revenue)), m.headline.revenue, `${dim} sums to total`);
    const folded = sliceBy(r.txns, dim, 5);
    near(sum(folded.map((s) => s.revenue)), m.headline.revenue, `${dim} folded to Other still sums`);
    const last = folded[folded.length - 1]!;
    near(last.cumulativeShare, 1, `${dim} cumulative share ends at 100%`, 1e-9);
  }
  ok("every dimension sums to the headline total, folded or not");

  near(m.headline.grossProfit!, m.headline.revenue - m.headline.cost!, "profit identity");
  near(m.headline.marginPct!, (m.headline.grossProfit! / m.headline.revenue) * 100, "margin identity");
  assert.ok(m.headline.marginPct! > 0 && m.headline.marginPct! < 100, `implausible margin ${m.headline.marginPct}`);
  ok("profit and margin identities hold; margin is plausible");

  for (const c of m.cohorts) {
    near(c.retention[0]!, 1, `cohort ${c.month} starts at 100%`);
    assert.ok(c.retention.every((v) => v >= 0 && v <= 1), `cohort ${c.month} retention out of range`);
  }
  assert.ok(m.cohorts.length > 0, "sample produces cohorts");
  ok("cohort retention starts at 100% and stays within range");

  assert.ok(m.months.every((x, i, a) => i === 0 || x.month > a[i - 1]!.month), "months ascend");
  assert.equal(m.months.length, 18, "sample spans 18 months");
  assert.ok(deriveInsights(r.txns, m).length >= 4, "sample produces insights to report");
  ok("monthly series ordered, 18 months, insights present");

  assert.equal(monthKey(new Date(Date.UTC(2026, 0, 9))), "2026-01");
  ok("month keys zero-pad so string sorting is chronological");
}

console.log(`\n  ${passed} checks passed\n`);
