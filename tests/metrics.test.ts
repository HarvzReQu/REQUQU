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
import { computeMetrics, sliceBy, sum, growth, monthKey, movers, inRange } from "@/lib/metrics";
import { summaryCsv, reportMarkdown } from "@/lib/export";
import { detectCurrency, makeFormatters } from "@/lib/currency";
import { checkQuality } from "@/lib/quality";
import { forecast } from "@/lib/forecast";
import { yearOverYear, abc, customerDetail } from "@/lib/metrics";
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

// ── 6. Period comparison, filtering and export ──────────────────────────────
{
  const csv = buildSampleCsv();
  const r = load(csv);
  const m = computeMetrics(r.txns);

  const mv = movers(r.txns, "customer", 3)!;
  assert.ok(mv, "sample is long enough for a 3v3 month comparison");
  for (const row of mv.rows) {
    near(row.change, row.current - row.previous, `${row.key} change is current minus previous`);
  }
  // Sorted by absolute movement, so the biggest swing in either direction leads.
  const magnitudes = mv.rows.map((x) => Math.abs(x.change));
  assert.deepEqual(magnitudes, [...magnitudes].sort((a, b) => b - a), "movers sorted by magnitude");
  assert.equal(movers(r.txns, "customer", 99), null, "too short a window returns null, not garbage");
  ok("period movers: arithmetic, ordering, and insufficient-window guard");

  const span = m.span!;
  assert.equal(inRange(r.txns, null, null).length, r.txns.length, "no bounds is a no-op");
  const half = new Date((span.from.getTime() + span.to.getTime()) / 2);
  const early = inRange(r.txns, null, half);
  // Split at the very next millisecond, not the next day: a row dated inside
  // that one-day gap would belong to neither side and the partition would leak.
  const late = inRange(r.txns, new Date(half.getTime() + 1), null);
  assert.equal(early.length + late.length, r.txns.length, "range filter partitions without loss");
  near(sum(early.map((t) => t.revenue)) + sum(late.map((t) => t.revenue)), m.headline.revenue,
       "partitioned revenue still sums to the total");
  ok("date-range filter partitions the data without losing rows or revenue");

  // The export must survive being read back by a CSV reader - a customer name
  // with a comma in it is exactly the case that breaks a naive writer.
  const exported = summaryCsv(r.txns, m);
  const widths = new Set(parse(exported).rows.map((row) => row.length));
  assert.equal(widths.size, 1, `exported CSV is ragged: widths ${[...widths].join(", ")}`);
  assert.equal([...widths][0], 3, "exported CSV has three columns");
  assert.ok(exported.includes('"Fabrikam, Inc."'), "comma-bearing name is quoted on export");
  const revenueRow = parse(exported).rows.find((row) => row[1] === "Revenue")!;
  near(Number(revenueRow[2]), m.headline.revenue, "exported revenue matches the computed figure");
  ok("summary CSV round-trips through a CSV reader with values intact");

  const report = reportMarkdown(m, deriveInsights(r.txns, m), reconcile(r.txns, m));
  assert.ok(report.startsWith("# Sales performance summary"), "report has a heading");
  assert.ok(report.includes("## Findings") && report.includes("## Reconciliation"), "report has both sections");
  ok("markdown report contains headline, findings and reconciliation");
}

// ── 7. Manual column remapping ──────────────────────────────────────────────
{
  // Headers no synonym list could guess - the case the mapping UI exists for.
  const opaque = [
    "col_a,col_b,col_c,col_d",
    '2026-01-10,ACME,"$500.00","$200.00"',
    '2026-01-20,BETA,"$300.00","$120.00"',
  ].join("\n");

  const guessed = load(opaque);
  assert.ok(guessed.error, "opaque headers are reported rather than silently misread");

  const mapped = load(opaque, {
    date: "col_a", customer: "col_b", revenue: "col_c", cost: "col_d",
  });
  assert.equal(mapped.error, null, "explicit mapping rescues the file");
  assert.equal(mapped.txns.length, 2);
  const m = computeMetrics(mapped.txns);
  near(m.headline.revenue, 800, "remapped revenue");
  near(m.headline.cost!, 320, "remapped cost");
  near(m.headline.marginPct!, 60, "remapped margin");
  ok("manual column mapping overrides inference and recomputes correctly");

  // An override must win even when inference already found something.
  const swapped = load(GOLDEN, { revenue: "Unit Price" });
  const sm = computeMetrics(swapped.txns);
  near(sm.headline.revenue, 100 + 50 + 100 + 400 + 50, "override beats the inferred column");
  ok("an explicit override takes precedence over a successful guess");
}

// ── 8. Failure is recoverable ───────────────────────────────────────────────
{
  // The file from the screenshot: a contacts export, no money anywhere.
  const contacts = [
    "Index,User Id,First Name,Last Name,Sex,Email,Phone,Date of birth",
    "1,88F7B3,Shelby,Terrell,Male,elijah57@example.net,001-084-906-7849,1945-10-26",
    "2,f90c65,Phillip,Summers,Female,bethany14@example.com,214.112.6044,1910-03-24",
  ].join("\n");

  const r = load(contacts);
  assert.equal(r.error, "amount", "reports which field is missing, as a code");
  assert.ok(r.looksNonFinancial === false || r.looksNonFinancial === true, "flag is set");
  // The crucial part: a failed load must still hand back everything the user
  // needs to rescue it. Returning an error with no columns is a dead end.
  assert.equal(r.headers.length, 8, "headers survive a failed load");
  assert.equal(r.columns.length, 8, "column profiles survive a failed load");
  assert.ok(r.columns.every((c) => c.header), "every column profiled");
  ok("a failed load still returns headers and column profiles to recover from");

  const byName = Object.fromEntries(r.columns.map((c) => [c.header, c.kind]));
  assert.equal(byName["Date of birth"], "date", "date column detected from values");
  assert.equal(byName["First Name"], "text", "name column is text");
  assert.equal(byName["Index"], "number", "numeric column detected from values");
  ok("column kinds inferred from values, not header names");

  // And the rescue itself works.
  const rescued = load(
    "ref,when,who,how much\n1,2026-02-01,Acme,\"$250.00\"\n2,2026-02-09,Beta,\"$150.00\"",
    { date: "when", customer: "who", revenue: "how much" },
  );
  assert.equal(rescued.error, null, "explicit mapping rescues an unguessable file");
  near(computeMetrics(rescued.txns).headline.revenue, 400, "rescued revenue");
  ok("an unguessable file is fully recoverable through manual mapping");
}

// ── 9. Currency ─────────────────────────────────────────────────────────────
{
  assert.equal(detectCurrency(['"₱12,500.00"', "₱7,250.50"]), "PHP");
  assert.equal(detectCurrency(["£100.00", "£250.00"]), "GBP");
  assert.equal(detectCurrency(["$100.00"]), "USD");
  // Multi-character prefixes must win before a bare "$" claims the value.
  assert.equal(detectCurrency(["A$100.00", "A$50.00"]), "AUD");
  assert.equal(detectCurrency(["R$100,00"]), "BRL");
  // An ISO code in a header is a stronger signal than an ambiguous symbol.
  assert.equal(detectCurrency(["$100"], ["Date", "Amount (GBP)"]), "GBP");
  assert.equal(detectCurrency(["100", "250"]), null, "no signal is null, not a guessed USD");
  ok("currency inferred from symbols, prefixes and header ISO codes");

  const peso = load('Date,Customer,Amount\n2026-01-05,A,"₱12,500.00"\n2026-01-09,B,"₱7,250.50"');
  assert.equal(peso.currency, "PHP", "the defect case: a peso file is no longer called dollars");
  const f = makeFormatters(peso.currency);
  assert.ok(f.money(19750).includes("₱"), `expected a peso symbol, got ${f.money(19750)}`);
  assert.ok(!makeFormatters(null).money(19750).includes("$"), "unknown currency renders as a plain number");
  ok("formatters follow the detected currency, and assert nothing when unknown");
}

// ── 10. Data quality ────────────────────────────────────────────────────────
{
  const dirty = [
    "Date,Customer,Product,Qty,Amount",
    "2026-01-05,Acme,Widget,1,100",
    "2026-01-05,Acme,Widget,1,100",
    "2026-01-05,Acme,Widget,1,100",
    "2026-03-01,Acme,Widget,1,100",
    "2026-03-02,Acme,Widget,1,0",
    "2026-03-03,,Widget,1,100",
  ].join("\n");
  const r = load(dirty);
  const issues = checkQuality(r.txns, { skipped: r.skipped, total: r.total });
  const ids = new Set(issues.map((i) => i.id));

  assert.ok(ids.has("duplicates"), "two extra copies of an identical row are caught");
  assert.equal(issues.find((i) => i.id === "duplicates")!.count, 2);
  assert.ok(ids.has("gaps"), "the missing February is caught");
  assert.equal(issues.find((i) => i.id === "gaps")!.count, 1);
  assert.ok(ids.has("zeros"), "the zero-amount line is caught");
  assert.ok(ids.has("blank-customer"), "the blank customer is caught");
  // Every issue must point at real source rows, or it is not actionable.
  for (const i of issues) {
    assert.ok(i.count > 0, `${i.id} reported with a zero count`);
    for (const row of i.rows) assert.ok(row >= 2, `${i.id} cited header/invalid row ${row}`);
  }
  ok("duplicates, month gaps, zero amounts and blank dimensions all detected");

  // A clean file must stay quiet - a checker that always fires is ignored.
  const clean = load(buildSampleCsv());
  const cleanIssues = checkQuality(clean.txns, { skipped: clean.skipped, total: clean.total })
    .filter((i) => i.severity === "high");
  assert.equal(cleanIssues.length, 0, `clean sample raised: ${cleanIssues.map((i) => i.id).join(", ")}`);
  ok("the generated sample raises no high-severity quality issues");
}

// ── 11. Forecast, YoY, ABC, customer detail ─────────────────────────────────
{
  const r = load(buildSampleCsv());
  const m = computeMetrics(r.txns);

  assert.equal(forecast(m.months.slice(0, 6)), null, "under a year of history refuses to forecast");
  const f = forecast(m.months, 3)!;
  assert.equal(f.points.length, 3);
  for (const p of f.points) {
    assert.ok(p.value >= 0, "forecast is never negative revenue");
    assert.ok(p.low <= p.value && p.value <= p.high, "value sits inside its band");
  }
  // Months must continue the calendar, including across a year boundary.
  const lastMonth = m.months[m.months.length - 1]!.month;
  assert.ok(f.points[0]!.month > lastMonth, "forecast starts after the last actual");
  const widths = f.points.map((p) => p.high - p.low);
  assert.ok(widths[2]! > widths[0]!, "uncertainty widens with horizon");
  ok("forecast: guards short history, stays non-negative, widens with horizon");

  const yoy = yearOverYear(m.months);
  assert.ok(yoy.length > 0, "18 months of sample yields year-over-year pairs");
  for (const p of yoy) {
    const [y, mm] = p.month.split("-");
    assert.ok(m.months.some((x) => x.month === `${Number(y) - 1}-${mm}`), "prior-year month exists");
  }
  ok("year-over-year pairs each month with the same month a year earlier");

  const tiers = abc(sliceBy(r.txns, "customer"));
  assert.equal(tiers.length, sliceBy(r.txns, "customer").length, "tiering loses nobody");
  assert.ok(tiers[0]!.tier === "A", "the largest account is tier A");
  const order = { A: 0, B: 1, C: 2 };
  assert.deepEqual(tiers.map((t) => order[t.tier]), [...tiers.map((t) => order[t.tier])].sort(),
    "tiers never go backwards down a revenue-sorted list");
  ok("ABC tiers assigned by cumulative revenue share, monotonically");

  const detail = customerDetail(r.txns);
  near(sum(detail.map((d) => d.revenue)), m.headline.revenue, "customer detail sums to the total");
  assert.equal(detail.length, m.headline.customers, "one row per customer");
  for (const d of detail) {
    assert.ok(d.last >= d.first, `${d.customer}: last order before first`);
    assert.ok(d.tenureDays >= 0 && d.recencyDays >= 0, `${d.customer}: negative day count`);
    near(d.aov, d.revenue / d.orders, `${d.customer} AOV`);
  }
  ok("customer detail: totals reconcile, dates ordered, AOV consistent");
}

console.log(`\n  ${passed} checks passed\n`);
