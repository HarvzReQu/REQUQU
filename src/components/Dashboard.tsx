"use client";

import { useMemo, useRef, useState } from "react";

import { load, type Txn } from "@/lib/schema";
import { computeMetrics, sliceBy, growth } from "@/lib/metrics";
import { deriveInsights, reconcile, type Tone } from "@/lib/insights";
import { buildSampleCsv } from "@/lib/sample";
import { ColumnChart, LineChart, RankedBars, CohortHeatmap, Sparkline, fmtMoney, fmtPct } from "./charts";

type Dim = "customer" | "product" | "category" | "region" | "channel" | "rep";
const DIMS: { id: Dim; label: string }[] = [
  { id: "customer", label: "Customer" },
  { id: "product", label: "Product" },
  { id: "category", label: "Category" },
  { id: "region", label: "Region" },
  { id: "channel", label: "Channel" },
  { id: "rep", label: "Sales rep" },
];

const TONE_ICON: Record<Tone, string> = {
  critical: "▲", warning: "▲", good: "▼", info: "■",
};

export function Dashboard() {
  const [text, setText] = useState("");
  const [dim, setDim] = useState<Dim>("customer");
  const [showTable, setShowTable] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const result = useMemo(() => (text.trim() ? load(text) : null), [text]);
  const txns: Txn[] = result?.txns ?? [];
  const metrics = useMemo(() => computeMetrics(txns), [txns]);
  const insights = useMemo(() => deriveInsights(txns, metrics), [txns, metrics]);
  const checks = useMemo(() => (txns.length ? reconcile(txns, metrics) : []), [txns, metrics]);
  const slices = useMemo(() => (txns.length ? sliceBy(txns, dim, 8) : []), [txns, dim]);

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const months = metrics.months;
  const last = months[months.length - 1];
  const prev = months[months.length - 2];
  const momRevenue = last && prev ? growth(last.revenue, prev.revenue) : null;
  // Margin moves in percentage POINTS, not percent - a 40%→44% move is +4pts,
  // and reporting it as +10% would be a different (and confusing) claim.
  const momMargin =
    last?.marginPct != null && prev?.marginPct != null ? last.marginPct - prev.marginPct : null;

  return (
    <>
      <section className="card">
        <div className="card-head">
          <div>
            <p className="eyebrow">Step 1</p>
            <h2 className="card-title">Load your data</h2>
            <p className="card-note">
              A CSV of sales or invoice lines. Column names are matched
              automatically — QuickBooks, Xero and Excel exports load as-is.
            </p>
          </div>
        </div>
        <div className="controls">
          <button className="primary" onClick={() => setText(buildSampleCsv())}>
            Load sample business
          </button>
          <button onClick={() => fileInput.current?.click()}>Upload CSV</button>
          <input ref={fileInput} type="file" accept=".csv,.txt,.tsv" hidden
                 onChange={(e) => {
                   const f = e.target.files?.[0];
                   if (f) onFile(f);
                   e.target.value = "";
                 }} />
          <button onClick={() => setText("")} disabled={!text}>Clear</button>
          <span className="spacer" />
          {result && !result.error && (
            <span className="pill">
              {result.txns.length.toLocaleString()} of {result.total.toLocaleString()} rows
              {result.skipped > 0 && ` · ${result.skipped} skipped`}
            </span>
          )}
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
                  placeholder="…or paste CSV here" />
        {result?.error && <p className="err">{result.error}</p>}
      </section>

      {txns.length === 0 && !result?.error && (
        <section className="card">
          <div className="empty">
            <div className="empty-art" aria-hidden>
              {[26, 40, 31, 52, 44, 62, 49].map((h, i) => (
                <i key={i} style={{ height: `${h}px`, animationDelay: `${i * 55}ms` }} />
              ))}
            </div>
            <h3>Nothing loaded yet</h3>
            <p>Load the sample business to see what this produces, or upload your own export.</p>
          </div>
        </section>
      )}

      {txns.length > 0 && (
        <>
          <dl className="tiles">
            <Tile label="Revenue" value={fmtMoney(metrics.headline.revenue)}
                  delta={momRevenue} deltaNote="MoM"
                  spark={months.map((m) => m.revenue)} />
            <Tile label="Gross profit" accent={3}
                  value={metrics.headline.grossProfit === null ? "—" : fmtMoney(metrics.headline.grossProfit)}
                  spark={metrics.hasCost ? months.map((m) => m.profit ?? 0) : undefined}
                  tone="var(--series-3)" />
            <Tile label="Gross margin" accent={2}
                  value={metrics.headline.marginPct === null ? "—" : fmtPct(metrics.headline.marginPct)}
                  delta={momMargin} deltaNote="pts"
                  spark={metrics.hasCost ? months.filter((m) => m.marginPct !== null).map((m) => m.marginPct!) : undefined}
                  tone="var(--series-2)" />
            <Tile label="Orders" value={metrics.headline.orders.toLocaleString()}
                  spark={months.map((m) => m.orders)} />
            <Tile label="Avg order value" value={fmtMoney(metrics.headline.aov)} />
            <Tile label="Customers" value={metrics.headline.customers.toLocaleString()}
                  accent={3} tone="var(--series-3)"
                  spark={months.map((m) => m.customers)} />
            <Tile label="Repeat rate" value={fmtPct(metrics.repeatRate * 100, 0)} />
          </dl>

          {insights.length > 0 && (
            <section className="card">
              <div className="card-head">
                <div>
                  <p className="eyebrow">Findings</p>
                  <h2 className="card-title">What the numbers say</h2>
                  <p className="card-note">Generated from the data, highest concern first.</p>
                </div>
              </div>
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
            <ColumnChart
              title="Monthly revenue"
              note={metrics.span
                ? `${metrics.span.from.toISOString().slice(0, 10)} to ${metrics.span.to.toISOString().slice(0, 10)}`
                : undefined}
              data={months.map((m) => ({ label: m.month, value: m.revenue }))}
            />
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

          <section className="card">
            <div className="controls" style={{ marginBottom: ".9rem" }}>
              <span className="eyebrow" style={{ margin: 0 }}>Break down by</span>
              <select value={dim} onChange={(e) => setDim(e.target.value as Dim)}>
                {DIMS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
              <span className="spacer" />
              <button onClick={() => setShowTable((v) => !v)}>
                {showTable ? "Show chart" : "Show table"}
              </button>
            </div>

            {showTable ? (
              <div className="scroll">
                <table className="data">
                  <thead>
                    <tr>
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
                        <td className="text">{s.key}</td>
                        <td className="num">{fmtMoney(s.revenue)}</td>
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
                note="Ranked, with cumulative share of total on the right."
                data={slices}
              />
            )}
          </section>

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
            <p className="eyebrow">Integrity</p>
            <h2 className="card-title">Reconciliation</h2>
            <p className="card-note">
              Every breakdown is re-summed and compared against the headline total.
              This proves the arithmetic is consistent — not that the source data is right.
            </p>
            <div className="checks">
              {checks.map((c) => (
                <div key={c.label} className="check-row">
                  <span className={`mark ${c.ok ? "ok" : "bad"}`} aria-hidden>{c.ok ? "✓" : "✗"}</span>
                  <span>{c.label}</span>
                  <span className="amount">{fmtMoney(c.actual)}</span>
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
  label: string;
  value: string;
  delta?: number | null;
  deltaNote?: string;
  spark?: number[];
  tone?: string;
  accent?: 2 | 3;
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
            {Math.abs(delta).toFixed(1)}{deltaNote === "pts" ? "pts" : "%"} {deltaNote === "pts" ? "" : deltaNote}
          </span>
        ) : <span />}
        {spark && spark.length > 1 && <Sparkline values={spark} tone={tone} />}
      </div>
    </div>
  );
}
