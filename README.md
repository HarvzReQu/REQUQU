# REQUQU

[![CI](https://github.com/HarvzReQu/REQUQU/actions/workflows/ci.yml/badge.svg)](https://github.com/HarvzReQu/REQUQU/actions/workflows/ci.yml)

**Sales and revenue analytics for a business, in the browser.**

**Drop in a CSV — QuickBooks, Xero, MYOB, Excel and Google Sheets exports load
with no setup.** REQUQU works out what your columns mean, untangles currency
symbols, accounting negatives and date formats, reconciles every total, then
charts revenue, margin and customer retention and writes up what it found.

Nothing is uploaded. Parsing and every calculation run client-side, so financial
data never leaves the machine.

```
CSV  ──▶  delimiter sniff  ──▶  column mapping  ──▶  typed transactions
                                                            ↓
                         revenue · cost · margin · AOV · cohorts · segments
                                                            ↓
                          reconciliation  ·  charts  ·  written findings
```

## Features

| | |
|---|---|
| **Drag-and-drop CSV** | drop a file anywhere on the zone, or browse, or paste raw text |
| **Automatic column mapping** | header synonyms matched across ~90 known names |
| **Manual remapping** | every detected column shown and overridable; the analysis recomputes live |
| **Parsed-row preview** | see exactly what was read out of the file after cleaning |
| **Period filter** | all time, or the last 3 / 6 / 12 months — every figure follows it |
| **Headline KPIs** | revenue, gross profit, margin, orders, AOV, customers, repeat rate, each with an 18-month sparkline |
| **Monthly revenue & margin** | two plots, never one dual-axis chart |
| **Six breakdown dimensions** | customer, product, category, region, channel, sales rep |
| **Biggest movers** | last 3 months vs the 3 before, ranked by absolute swing |
| **Cohort retention** | monthly acquisition cohorts as a heatmap |
| **Written findings** | concentration risk, margin erosion, loss-making lines, refund rate, retention |
| **Reconciliation** | every breakdown re-summed against the headline total |
| **Export** | summary CSV for a spreadsheet, or a written Markdown report |
| **Light / dark / system** | applied before first paint, no flash |

## What it produces

From the bundled sample business (660 invoice lines, 18 months):

| | |
|---|---|
| Revenue | $2,282,745 |
| Gross profit | $1,348,836 |
| Gross margin | 59.1% |
| Orders / customers | 660 / 14 |
| Average order value | $3,459 |

…and findings written the way a report would put them:

> **Top 5 customers are 71.9% of revenue.** $1,642,043 of $2,282,745 comes from
> Northwind Traders, Contoso Manufacturing, Fabrikam, Inc. and two others.
> → *Model the revenue gap if the largest account churns, and weight new-business
> effort toward the long tail.*

## Are the numbers right?

That is the only question that matters in this category, so it is answered three
ways. `npm test` runs all of it — 21 checks.

**A golden dataset.** A five-row file whose every figure was computed by hand:
revenue 900, cost 400, margin 55.56%, AOV 180, one customer who buys 50 and
refunds 50 and must net to exactly zero. Every headline, monthly and cohort
figure is asserted against those numbers.

**Invariants that must hold for any input.** Revenue summed by customer, product,
category, region, channel and rep must each equal the headline total — before and
after the tail is folded into "Other". Cumulative share must end at exactly 100%.
Gross profit must equal revenue minus cost. Cohort retention must start at 100%
and stay in range.

**Reconciliation shown in the product.** The same re-summing runs live and is
displayed, because "do these tie out?" is the first thing a reviewer asks.

### Reconciliation is not proof of correctness

Worth stating plainly, because building this made the point vividly. The sample
generator initially wrote amounts as `$1,898.91` — **unquoted**, with the
thousands separator inside the field. Every conforming CSV reader splits that
into `$1` and `898.91`, shifting every later column by one.

All five reconciliation checks passed anyway. The totals tied out perfectly
because they were consistently derived from consistently wrong data — cost
exceeded revenue and gross margin came out at −93.8%.

What caught it was a **plausibility assertion**, not a reconciliation:

```ts
assert.ok(m.headline.marginPct! > 0 && m.headline.marginPct! < 100, …)
```

There is now also a regression test asserting every row of the generated CSV has
the same width as its header. Reconciliation proves arithmetic; only a sanity
check proves meaning.

## Reading real exports

The parsing layer exists because real files are hostile:

| Input | Handled |
|---|---|
| `"Fabrikam, Inc."` | quoted field containing the delimiter |
| `$1,234.56` | currency symbol + thousands separator |
| `1.234,56` | European decimal convention |
| `(89.00)` | accounting parentheses = negative |
| `03/04/2026` | day-first vs month-first, **inferred from the data** |
| `14-Mar-2026` | named months |
| BOM, CRLF, `;` or tab delimited | Excel and European locale exports |
| `Invoice Date` / `InvoiceDate` / `txn_date` | header synonym matching |

Two of those deserve a note.

**Date ambiguity is resolved by evidence, not assumption.** `03/04/2026` is 3
April in most of the world and 4 March in the US. The loader scans the whole
column for a value whose first component exceeds 12 — one unambiguous row settles
the entire column. Guessing a locale silently mangles up to twelve months of data.

**Line totals beat quantity × price.** Exports frequently carry a discount that
only the total reflects, so the stated amount wins where both exist.

## Charts

Hand-drawn inline SVG, no chart library — four fixed forms need less code than
the configuration a general-purpose library would take, and every colour is a CSS
custom property so light and dark are one token swap.

The palette is the validated reference instance, checked with a six-check
validator (lightness band, chroma floor, colourblind separation, normal-vision
floor, contrast) against **both** surfaces before use. Dark mode is a separately
chosen set of steps for the dark surface, not an inverted light palette.

**There is no dual-axis chart anywhere, deliberately.** Revenue is currency and
margin is a percentage; putting them on one plot with two y-scales invents a
relationship that is not in the data. They are two plots sharing an x-axis. For
the same reason the Pareto view is ranked bars with cumulative share as a text
label, rather than the traditional bars-plus-second-axis.

Colour never encodes rank on a nominal axis either — ranked bars are a single
hue, because position already carries the magnitude. The one sequential encoding
is the cohort heatmap, which uses a single blue ramp and prints the number in
every cell, so colour reinforces rather than carries the value.

## Interface

Depth comes from elevation, spacing rhythm and type hierarchy — never from
heavier data marks. The dataviz rules that shaped the charts also rule out the
usual ways a dashboard is "made to pop": no thickened bars, no darkened
gridlines, no colour ramps standing in for rank.

- **Stat tiles carry sparklines** — an 18-month trend beside each headline
  figure, deliberately low-contrast so it never competes with the number.
- **Deltas are pills with an arrow and a sign**, so direction never rests on
  colour alone. Margin movement is reported in percentage *points*, not percent —
  40% → 44% is +4pts, and calling it +10% would be a different claim.
- **Bars and the margin line carry a shallow gradient** of their own hue. It
  reads as depth without introducing a second colour or implying a second series.
- **Theme toggle** cycles system → light → dark, applied before first paint by an
  inline script so a chosen theme never flashes.
- Reduced-motion is respected; every transition collapses under
  `prefers-reduced-motion`.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 21 correctness checks
npm run typecheck
```

No environment variables, no database, no API keys.

## Layout

```
src/
  lib/
    csv.ts        RFC 4180 reader: quotes, BOM, CRLF, delimiter sniffing
    coerce.ts     currency, accounting negatives, locales, date inference
    schema.ts     header synonym matching → typed transactions
    metrics.ts    revenue, margin, AOV, segments, cohorts, Kahan summation
    insights.ts   written findings + reconciliation checks
    sample.ts     generated 18-month business with real findings in it
  components/
    charts.tsx    column, line, ranked bars, cohort heatmap (inline SVG)
    Dashboard.tsx
tests/
  metrics.test.ts golden dataset, invariants, edge cases
```

## Limitations

- **Gross margin only.** No operating expenses, so this is not a P&L.
- **Cost is all-or-nothing.** Margin is suppressed unless >95% of rows carry a
  cost, because a partially-costed file yields a number that looks precise and
  is wrong.
- **No currency conversion.** A mixed-currency export is summed as if one currency.
- **Accrual vs cash is whatever the export says.** REQUQU reads dates, it does not
  know your revenue recognition policy.
- **No browser-level test.** The calculation layer is covered; the React and chart
  layers are not exercised by an automated browser run.
