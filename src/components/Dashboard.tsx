"use client";

import { useMemo, useState } from "react";

import { load, type Mapping, type Txn } from "@/lib/schema";
import {
  computeMetrics, sliceBy, growth, movers, inRange, monthKey,
  yearOverYear, abc, customerDetail,
} from "@/lib/metrics";
import { deriveInsights, reconcile, type Tone } from "@/lib/insights";
import { checkQuality } from "@/lib/quality";
import { forecast as buildForecast } from "@/lib/forecast";
import { makeFormatters, currencyOf, CURRENCIES } from "@/lib/currency";
import { summaryCsv, reportMarkdown, download } from "@/lib/export";
import { buildSampleCsv } from "@/lib/sample";
import { DataLoader } from "./DataLoader";
import {
  ColumnChart, LineChart, RankedBars, CohortHeatmap, Sparkline, fmtPct,
} from "./charts";

type Dim = "customer" | "product" | "category" | "region" | "channel" | "rep";
const DIMS: { id: Dim; label: string }[] = [
  { id: "customer", label: "Customer" },
  { id: "product", label: "Product" },
  { id: "category", label: "Category" },
  { id: "region", label: "Region" },
  { id: "channel", label: "Channel" },
  { id: "rep", label: "Sales rep" },
];

const TONE_ICON: Record<Tone, string> = { critical: "▲", warning: "▲", good: "▼", info: "■" };

export function Dashboard() {
  const [text, setText] = useState("");
  const [override, setOverride] = useState<Mapping>({});
  const [dim, setDim] = useState<Dim>("customer");
  const [showTable, setShowTable] = useState(false);
  const [showRows, setShowRows] = useState(false);
  const [monthsBack, setMonthsBack] = useState(0); // 0 = all time
  const [focus, setFocus] = useState<{ dim: Dim; key: string } | null>(null);
  const [currency, setCurrency] = useState<string | null | undefined>(undefined);
  const [showForecast, setShowForecast] = useState(true);

  const result = useMemo(
    () => (text.trim() ? load(text, override) : null),
    [text, override],
  );
  const all: Txn[] = result?.txns ?? [];

  // Period filter, applied before every calculation so every figure on the page
  // describes the same window.
  const txns = useMemo(() => {
    if (monthsBack === 0 || all.length === 0) return all;
    const latest = all.reduce((max, t) => (t.date > max ? t.date : max), all[0]!.date);
    const from = new Date(Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth() - monthsBack + 1, 1));
    return inRange(all, from, null);
  }, [all, monthsBack]);

  // A click on any segment scopes every figure below to it.
  const scoped = useMemo(
    () => (focus ? txns.filter((t) => t[focus.dim] === focus.key) : txns),
    [txns, focus],
  );

  // undefined = not chosen yet, so fall back to what the file said.
  const activeCurrency = currency === undefined ? (result?.currency ?? null) : currency;
  const fmt = useMemo(() => makeFormatters(activeCurrency), [activeCurrency]);
  const money = (n: number, compact = false) => (compact ? fmt.moneyCompact(n) : fmt.money(n));

  const metrics = useMemo(() => computeMetrics(scoped), [scoped]);
  const insights = useMemo(() => deriveInsights(scoped, metrics), [scoped, metrics]);
  const checks = useMemo(() => (scoped.length ? reconcile(scoped, metrics) : []), [scoped, metrics]);
  const slices = useMemo(
    () => (scoped.length ? abc(sliceBy(scoped, dim, 8)) : []),
    [scoped, dim],
  );
  const movement = useMemo(() => (scoped.length ? movers(scoped, dim, 3) : null), [scoped, dim]);
  // Quality runs on the WHOLE file, not the filtered view - a duplicate is a
  // duplicate whether or not you are currently looking at that customer.
  const quality = useMemo(
    () => (all.length && result ? checkQuality(all, { skipped: result.skipped, total: result.total }) : []),
    [all, result],
  );
  const projection = useMemo(
    () => (showForecast && !focus ? buildForecast(metrics.months, 3) : null),
    [metrics.months, showForecast, focus],
  );
  const yoy = useMemo(() => yearOverYear(metrics.months), [metrics.months]);
  const yoyLatest = yoy[yoy.length - 1] ?? null;
  const customers = useMemo(() => customerDetail(scoped).slice(0, 12), [scoped]);

  const months = metrics.months;
  const last = months[months.length - 1];
  const prev = months[months.length - 2];
  const momRevenue = last && prev ? growth(last.revenue, prev.revenue) : null;
  // Margin moves in percentage POINTS - reporting a 40→44 shift as "+10%" would
  // be a different and misleading claim.
  const momMargin =
    last?.marginPct != null && prev?.marginPct != null ? last.marginPct - prev.marginPct : null;

  const totalMonths = useMemo(
    () => new Set(all.map((t) => monthKey(t.date))).size,
    [all],
  );
  const highIssues = quality.filter((q) => q.severity === "high").length;

  return (
    <>
      <DataLoader
        text={text} setText={setText} result={result}
        override={override} setOverride={setOverride}
        onSample={() => { setOverride({}); setText(buildSampleCsv()); }}
      />

      {scoped.length === 0 && !result?.error && (
        <section className="card">
          <div className="empty">
            <div className="empty-art" aria-hidden>
              {[26, 40, 31, 52, 44, 62, 49].map((h, i) => (
                <i key={i} style={{ height: `${h}px`, animationDelay: `${i * 55}ms` }} />
              ))}
            </div>
            <h3>Nothing loaded yet</h3>
            <p>Drop a CSV above, or try the sample business to see what this produces.</p>
          </div>
        </section>
      )}

      {scoped.length > 0 && (
        <>
          {/* One filter row above the charts, never per-chart controls. */}
          <section className="toolbar">
            <span className="eyebrow" style={{ margin: 0 }}>Period</span>
            {[0, 3, 6, 12].map((n) => (
              <button key={n}
                      className={monthsBack === n ? "chip on" : "chip"}
                      disabled={n !== 0 && n >= totalMonths}
                      onClick={() => setMonthsBack(n)}>
                {n === 0 ? "All time" : `Last ${n}m`}
              </button>
            ))}
            <span className="divider" />
            <span className="eyebrow" style={{ margin: 0 }}>Currency</span>
            <select value={activeCurrency ?? ""} onChange={(e) => setCurrency(e.target.value || null)}
                    title={result?.currency ? `Detected ${result.currency} from your file` : "No symbol found in the file"}>
              <option value="">Plain numbers</option>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>
              ))}
            </select>
            {result?.currency && activeCurrency === result.currency && (
              <span className="pill" title="Read from the amount column in your file">
                auto-detected
              </span>
            )}
            <span className="spacer" />
            <button className="ghost" onClick={() =>
              download("reququ-summary.csv", summaryCsv(scoped, metrics), "text/csv")}>
              ↓ Summary CSV
            </button>
            <button className="ghost" onClick={() =>
              download("reququ-report.md", reportMarkdown(metrics, insights, checks), "text/markdown")}>
              ↓ Written report
            </button>
          </section>

          {focus && (
            <div className="focus-bar">
              <span>
                Showing <strong>{focus.key}</strong> only
                <span className="muted"> · {DIMS.find((d) => d.id === focus.dim)!.label.toLowerCase()}</span>
              </span>
              <button className="ghost" onClick={() => setFocus(null)}>Clear filter ✕</button>
            </div>
          )}

          {quality.length > 0 && (
            <section className={`card quality${highIssues > 0 ? " has-high" : ""}`}>
              <p className="eyebrow">Data quality</p>
              <h2 className="card-title">
                {highIssues > 0
                  ? `${highIssues} issue${highIssues === 1 ? "" : "s"} that would distort these numbers`
                  : `${quality.length} thing${quality.length === 1 ? "" : "s"} worth checking in the source file`}
              </h2>
              <p className="card-note" style={{ marginBottom: ".8rem" }}>
                Checked against the whole file, before any filter. Row numbers refer to
                your original spreadsheet.
              </p>
              {quality.map((q) => (
                <div key={q.id} className={`qissue sev-${q.severity}`}>
                  <span className="qsev">{q.severity}</span>
                  <div>
                    <h4>{q.title}</h4>
                    <p>{q.detail}</p>
                    {(q.rows.length > 0 || q.amount !== undefined) && (
                      <p className="qmeta">
                        {q.amount !== undefined && <>{money(q.amount)} affected</>}
                        {q.amount !== undefined && q.rows.length > 0 && " · "}
                        {q.rows.length > 0 && <>rows {q.rows.join(", ")}{q.count > q.rows.length && " …"}</>}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </section>
          )}

          <dl className="tiles">
            <Tile label="Revenue" value={money(metrics.headline.revenue)}
                  delta={momRevenue} deltaNote="MoM" spark={months.map((m) => m.revenue)} />
            <Tile label="Gross profit" accent={3} tone="var(--series-3)"
                  value={metrics.headline.grossProfit === null ? "—" : money(metrics.headline.grossProfit)}
                  spark={metrics.hasCost ? months.map((m) => m.profit ?? 0) : undefined} />
            <Tile label="Gross margin" accent={2} tone="var(--series-2)"
                  value={metrics.headline.marginPct === null ? "—" : fmtPct(metrics.headline.marginPct)}
                  delta={momMargin} deltaNote="pts"
                  spark={metrics.hasCost ? months.filter((m) => m.marginPct !== null).map((m) => m.marginPct!) : undefined} />
            <Tile label="Orders" value={metrics.headline.orders.toLocaleString()}
                  spark={months.map((m) => m.orders)} />
            <Tile label="Avg order value" value={money(metrics.headline.aov)} />
            <Tile label="Customers" value={metrics.headline.customers.toLocaleString()}
                  accent={3} tone="var(--series-3)" spark={months.map((m) => m.customers)} />
            <Tile label="Repeat rate" value={fmtPct(metrics.repeatRate * 100, 0)} />
            {yoyLatest && (
              <Tile label="Year over year" accent={2} tone="var(--series-2)"
                    value={yoyLatest.changePct === null ? "—" : fmtPct(yoyLatest.changePct)}
                    delta={yoyLatest.changePct} deltaNote="vs same month last year" />
            )}
          </dl>

          {insights.length > 0 && (
            <section className="card">
              <p className="eyebrow">Findings</p>
              <h2 className="card-title">What the numbers say</h2>
              <p className="card-note" style={{ marginBottom: ".9rem" }}>
                Generated from the data, highest concern first.
              </p>
              {insights.map((i) => (
                <div key={i.id} className={`insight tone-${i.tone}`}>
                  {/* Icon + label, never colour alone. */}
                  <span className="icon" aria-hidden>{TONE_ICON[i.tone]}</span>
                  <div>
                    <h4>{i.title}</h4>
                    <p>{i.detail}</p>
                    <p className="action">→ {i.action}</p>
                  </div>
                </div>
              ))}
            </section>
          )}

          <section className="card">
            <div className="controls" style={{ float: "right" }}>
              {buildForecast(metrics.months, 3) && !focus && (
                <button className="ghost" onClick={() => setShowForecast((v) => !v)}>
                  {showForecast ? "Hide projection" : "Show projection"}
                </button>
              )}
            </div>
            <ColumnChart
              title="Monthly revenue"
              money={money}
              note={metrics.span
                ? `${metrics.span.from.toISOString().slice(0, 10)} to ${metrics.span.to.toISOString().slice(0, 10)}`
                  + (projection ? ` · last 3 bars projected, hatched` : "")
                : undefined}
              data={months.map((m) => ({ label: m.month, value: m.revenue }))}
              forecast={projection ? projection.points.map((p) => ({
                label: p.month, value: p.value, low: p.low, high: p.high,
              })) : []}
            />
            {projection && (
              <p className="card-note" style={{ marginTop: ".5rem" }}>
                Projection is a least-squares trend with {projection.seasonal ? "monthly seasonal indices" : "no seasonal adjustment (too little history)"},
                fitted to {months.length} months with a mean absolute error of {projection.mape.toFixed(1)}%.
                The shaded range is the spread of that fit against history — it is not
                a statistical confidence interval, and it assumes nothing changes.
              </p>
            )}
          </section>

          {metrics.hasCost && (
            <section className="card">
              <LineChart
                title="Gross margin trend"
                note="Shown separately from revenue on purpose — currency and percentage are different scales, and putting them on one plot with two y-axes invents a relationship that is not in the data."
                data={months.filter((m) => m.marginPct !== null)
                            .map((m) => ({ label: m.month, value: m.marginPct! }))}
              />
            </section>
          )}

          <div className="grid split">
            <section className="card">
              <div className="controls" style={{ marginBottom: ".9rem" }}>
                <span className="eyebrow" style={{ margin: 0 }}>Break down by</span>
                <select value={dim} onChange={(e) => setDim(e.target.value as Dim)}>
                  {DIMS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
                <span className="spacer" />
                <button className="ghost" onClick={() => setShowTable((v) => !v)}>
                  {showTable ? "Chart" : "Table"}
                </button>
              </div>

              {showTable ? (
                <div className="scroll">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Tier</th>
                        <th>{DIMS.find((d) => d.id === dim)!.label}</th>
                        <th className="num">Revenue</th>
                        <th className="num">Share</th>
                        <th className="num">Cumulative</th>
                        <th className="num">Orders</th>
                        <th className="num">Units</th>
                        <th className="num">Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {slices.map((s) => (
                        <tr key={s.key}>
                          <td><span className={`tier t-${s.tier}`}>{s.tier}</span></td>
                          <td className="text">{s.key}</td>
                          <td className="num">{money(s.revenue)}</td>
                          <td className="num">{fmtPct(s.share * 100)}</td>
                          <td className="num">{fmtPct(s.cumulativeShare * 100)}</td>
                          <td className="num">{s.orders.toLocaleString()}</td>
                          <td className="num">{s.units.toLocaleString()}</td>
                          <td className="num">{s.marginPct === null ? "—" : fmtPct(s.marginPct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <RankedBars
                  title={`Revenue by ${DIMS.find((d) => d.id === dim)!.label.toLowerCase()}`}
                  note="Ranked, with ABC tier and cumulative share. Click any row to filter the whole page to it."
                  data={slices}
                  money={money}
                  selected={focus?.dim === dim ? focus.key : null}
                  onSelect={(key) =>
                    setFocus((f) => (f?.dim === dim && f.key === key ? null : { dim, key }))}
                />
              )}
            </section>

            <section className="card">
              <p className="eyebrow">Movement</p>
              <h3 className="card-title">Biggest movers</h3>
              {movement ? (
                <>
                  <p className="card-note" style={{ marginBottom: ".8rem" }}>
                    Last 3 months ({movement.currentLabel}) against the 3 before
                    ({movement.previousLabel}).
                  </p>
                  {movement.rows.slice(0, 8).map((r) => (
                    <div key={r.key} className="mover">
                      <span className="rank-name" title={r.key}>{r.key}</span>
                      <span className={`delta ${r.change > 0 ? "up" : r.change < 0 ? "down" : "flat"}`}>
                        <span aria-hidden>{r.change > 0 ? "▲" : r.change < 0 ? "▼" : "■"}</span>
                        {r.changePct === null ? "new" : `${Math.abs(r.changePct).toFixed(0)}%`}
                      </span>
                      <span className="rank-val">
                        {r.change > 0 ? "+" : ""}{money(r.change, true)}
                      </span>
                    </div>
                  ))}
                </>
              ) : (
                <p className="card-note">
                  Needs at least six months of data to compare two three-month periods.
                </p>
              )}
            </section>
          </div>

          {customers.length > 1 && (
            <section className="card">
              <p className="eyebrow">Accounts</p>
              <h3 className="card-title">Customer detail</h3>
              <p className="card-note" style={{ marginBottom: ".8rem" }}>
                Top {customers.length} by revenue. <strong>Recency</strong> is days since
                their last order — a large number on a large account is the early warning
                a revenue chart will not give you.
              </p>
              <div className="scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th className="num">Revenue</th><th className="num">Orders</th>
                      <th className="num">AOV</th><th className="num">Margin</th>
                      <th>First</th><th>Last</th>
                      <th className="num">Recency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((c) => (
                      <tr key={c.customer} className="clickable"
                          onClick={() => setFocus({ dim: "customer", key: c.customer })}>
                        <td className="text">{c.customer}</td>
                        <td className="num">{money(c.revenue)}</td>
                        <td className="num">{c.orders}</td>
                        <td className="num">{money(c.aov)}</td>
                        <td className="num">{c.marginPct === null ? "—" : fmtPct(c.marginPct)}</td>
                        <td>{c.first.toISOString().slice(0, 10)}</td>
                        <td>{c.last.toISOString().slice(0, 10)}</td>
                        <td className="num">
                          <span className={c.recencyDays > 90 ? "stale" : undefined}>
                            {c.recencyDays}d
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {metrics.cohorts.length > 1 && (
            <section className="card">
              <CohortHeatmap
                title="Customer retention by acquisition cohort"
                note="Each row is the customers first acquired that month. M0 is always 100% — the cohort is active in the month it was acquired. Numbers are percentages."
                cohorts={metrics.cohorts}
              />
            </section>
          )}

          <section className="card">
            <div className="controls" style={{ marginBottom: ".6rem" }}>
              <div>
                <p className="eyebrow">Source data</p>
                <h3 className="card-title">Parsed transactions</h3>
              </div>
              <span className="spacer" />
              <button className="ghost" onClick={() => setShowRows((v) => !v)}>
                {showRows ? "Hide rows" : `Show ${Math.min(50, scoped.length)} rows`}
              </button>
            </div>
            <p className="card-note">
              What REQUQU actually read out of your file, after currency symbols,
              accounting negatives and date formats were resolved.
            </p>
            {showRows && (
              <div className="scroll" style={{ marginTop: ".8rem", maxHeight: "24rem" }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th className="num">Row</th><th>Date</th><th>Customer</th><th>Product</th>
                      <th className="num">Qty</th><th className="num">Revenue</th><th className="num">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scoped.slice(0, 50).map((t) => (
                      <tr key={`${t.row}-${t.date.getTime()}`}>
                        <td className="num" style={{ color: "var(--muted)" }}>{t.row}</td>
                        <td>{t.date.toISOString().slice(0, 10)}</td>
                        <td className="text">{t.customer}</td>
                        <td className="text">{t.product}</td>
                        <td className="num">{t.quantity}</td>
                        <td className="num">{money(t.revenue)}</td>
                        <td className="num">{t.cost === null ? "—" : money(t.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <p className="eyebrow">Integrity</p>
            <h2 className="card-title">Reconciliation</h2>
            <p className="card-note" style={{ marginBottom: ".7rem" }}>
              Every breakdown is re-summed and compared against the headline total.
              This proves the arithmetic is consistent — not that the source data is right.
            </p>
            <div className="checks">
              {checks.map((c) => (
                <div key={c.label} className="check-row">
                  <span className={`mark ${c.ok ? "ok" : "bad"}`} aria-hidden>{c.ok ? "✓" : "✗"}</span>
                  <span>{c.label}</span>
                  <span className="amount">{money(c.actual)}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}

function Tile({
  label, value, delta, deltaNote, spark, tone, accent,
}: {
  label: string; value: string; delta?: number | null; deltaNote?: string;
  spark?: number[]; tone?: string; accent?: 2 | 3;
}) {
  const dir = delta == null ? "flat" : delta > 0.5 ? "up" : delta < -0.5 ? "down" : "flat";
  return (
    <div className={`tile${accent ? ` accent-${accent}` : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      <div className="tile-foot">
        {delta != null ? (
          <span className={`delta ${dir}`}>
            {/* Arrow + sign, so direction never rests on colour alone. */}
            <span aria-hidden>{dir === "up" ? "▲" : dir === "down" ? "▼" : "■"}</span>
            {Math.abs(delta).toFixed(1)}{deltaNote === "pts" ? "pts" : `% ${deltaNote ?? ""}`}
          </span>
        ) : <span />}
        {spark && spark.length > 1 && <Sparkline values={spark} tone={tone} />}
      </div>
    </div>
  );
}
