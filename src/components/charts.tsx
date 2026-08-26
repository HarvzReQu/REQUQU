"use client";

/**
 * Hand-drawn SVG charts.
 *
 * Deliberately no chart library: these are four fixed forms, and the code to
 * draw them is smaller than the configuration a general-purpose library would
 * need. It also keeps the bundle tiny and the theming honest - every colour is a
 * CSS custom property, so light and dark are one token swap.
 *
 * Two rules are load-bearing throughout:
 *   - No dual-axis charts. Revenue (currency) and margin (percent) are two
 *     scales, so they are two plots sharing an x-axis, never one plot with a
 *     second y-scale. That single decision is the most common way business
 *     dashboards mislead.
 *   - Colour never encodes rank on a nominal axis. Ranked bars are one hue;
 *     the ordering already carries the magnitude.
 */

export const fmtMoney = (n: number, compact = false): string =>
  n.toLocaleString("en-US", {
    style: "currency", currency: "USD",
    maximumFractionDigits: compact && Math.abs(n) >= 1000 ? 1 : 0,
    notation: compact && Math.abs(n) >= 10000 ? "compact" : "standard",
  });

export const fmtPct = (n: number, dp = 1) => `${n.toFixed(dp)}%`;

const monthLabel = (key: string) => {
  const [y, m] = key.split("-");
  return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m! - 1]} ${y!.slice(2)}`;
};

/** Round a maximum up to a clean axis top so ticks land on readable numbers. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => value <= s * magnitude)! * magnitude;
  return step;
}

// ─────────────────────────────────────────────────────────── column chart ───
export function ColumnChart({
  data, title, note,
}: {
  data: { label: string; value: number }[];
  title: string;
  note?: string;
}) {
  const W = 720, H = 240, L = 56, R = 8, T = 12, B = 30;
  const plotW = W - L - R, plotH = H - T - B;

  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const min = Math.min(0, ...data.map((d) => d.value));
  const floor = min < 0 ? -niceMax(-min) : 0;
  const range = max - floor;

  const y = (v: number) => T + plotH - ((v - floor) / range) * plotH;
  const slot = plotW / Math.max(1, data.length);
  const gap = 2;                       // 2px surface gap between adjacent bars
  const barW = Math.max(3, slot - gap * 2);
  const radius = Math.min(4, barW / 2); // 4px rounded data-end

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => floor + range * f);
  const zeroY = y(0);
  // Label only the extremes and the final bar - a number on every column is noise.
  const peak = data.reduce((b, d, i) => (d.value > data[b]!.value ? i : b), 0);
  const labelled = new Set([peak, data.length - 1]);

  return (
    <figure style={{ margin: 0 }}>
      <h3 className="card-title">{title}</h3>
      {note && <p className="card-note">{note}</p>}
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line className="grid-line" x1={L} y1={y(t)} x2={W - R} y2={y(t)} />
            <text className="tick" x={L - 8} y={y(t) + 3} textAnchor="end">
              {fmtMoney(t, true)}
            </text>
          </g>
        ))}
        <line className="axis-line" x1={L} y1={zeroY} x2={W - R} y2={zeroY} />

        {data.map((d, i) => {
          const x = L + slot * i + gap;
          const top = d.value >= 0 ? y(d.value) : zeroY;
          const h = Math.max(1, Math.abs(y(d.value) - zeroY));
          const r = Math.min(radius, h);
          // Rounded only on the data-end; the baseline end stays square.
          const path = d.value >= 0
            ? `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`
            : `M${x},${top} V${top + h - r} Q${x},${top + h} ${x + r},${top + h} H${x + barW - r} Q${x + barW},${top + h} ${x + barW},${top + h - r} V${top} Z`;
          return (
            <g key={d.label}>
              <path d={path} fill={d.value >= 0 ? "var(--series-1)" : "var(--critical)"} />
              {labelled.has(i) && (
                <text className="mark-label" x={x + barW / 2} y={top - 5} textAnchor="middle">
                  {fmtMoney(d.value, true)}
                </text>
              )}
              {/* Hit target spans the whole slot, not just the bar. */}
              <rect x={L + slot * i} y={T} width={slot} height={plotH} fill="transparent">
                <title>{`${d.label}\n${fmtMoney(d.value)}`}</title>
              </rect>
              {(i % Math.ceil(data.length / 9) === 0 || i === data.length - 1) && (
                <text className="tick" x={x + barW / 2} y={H - 10} textAnchor="middle">
                  {monthLabel(d.label)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

// ───────────────────────────────────────────────────────────── line chart ───
export function LineChart({
  data, title, note, unit = "%",
}: {
  data: { label: string; value: number }[];
  title: string;
  note?: string;
  unit?: string;
}) {
  const W = 720, H = 200, L = 56, R = 8, T = 12, B = 30;
  const plotW = W - L - R, plotH = H - T - B;
  if (data.length === 0) return null;

  const values = data.map((d) => d.value);
  const rawMax = Math.max(...values), rawMin = Math.min(...values);
  const pad = Math.max(2, (rawMax - rawMin) * 0.15);
  const max = rawMax + pad, min = Math.min(rawMin - pad, rawMax - pad);
  const range = max - min || 1;

  const x = (i: number) => L + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v: number) => T + plotH - ((v - min) / range) * plotH;

  const path = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.value)}`).join(" ");
  const ticks = [0, 0.5, 1].map((f) => min + range * f);
  const last = data.length - 1;

  return (
    <figure style={{ margin: 0 }}>
      <h3 className="card-title">{title}</h3>
      {note && <p className="card-note">{note}</p>}
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line className="grid-line" x1={L} y1={y(t)} x2={W - R} y2={y(t)} />
            <text className="tick" x={L - 8} y={y(t) + 3} textAnchor="end">
              {t.toFixed(0)}{unit}
            </text>
          </g>
        ))}
        {/* 2px stroke, single series, so no legend box is needed - the title names it. */}
        <path d={path} fill="none" stroke="var(--series-2)" strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <g key={d.label}>
            {(i === last || i === 0) && (
              <circle cx={x(i)} cy={y(d.value)} r="4" fill="var(--series-2)"
                      stroke="var(--surface)" strokeWidth="2" />
            )}
            <rect x={x(i) - plotW / data.length / 2} y={T}
                  width={plotW / data.length} height={plotH} fill="transparent">
              <title>{`${monthLabel(d.label)}\n${d.value.toFixed(1)}${unit}`}</title>
            </rect>
          </g>
        ))}
        <text className="mark-label" x={x(last)} y={y(data[last]!.value) - 10} textAnchor="end">
          {data[last]!.value.toFixed(1)}{unit}
        </text>
        {[0, last].map((i) => (
          <text key={i} className="tick" x={x(i)} y={H - 10}
                textAnchor={i === 0 ? "start" : "end"}>
            {monthLabel(data[i]!.label)}
          </text>
        ))}
      </svg>
    </figure>
  );
}

// ────────────────────────────────────────────────────────── ranked bars ─────
/**
 * Ranked horizontal bars with cumulative share as text.
 *
 * This is the Pareto view, drawn WITHOUT the traditional second y-axis. A
 * classic Pareto puts currency on the left and cumulative percent on the right,
 * which is precisely the dual-axis pattern that lets two unrelated scales imply
 * a relationship. The cumulative figure is a label instead - it is read, not
 * compared against the bars.
 */
export function RankedBars({
  data, title, note,
}: {
  data: { key: string; revenue: number; share: number; cumulativeShare: number }[];
  title: string;
  note?: string;
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => Math.abs(d.revenue)));
  const rowH = 30;

  return (
    <figure style={{ margin: 0 }}>
      <h3 className="card-title">{title}</h3>
      {note && <p className="card-note">{note}</p>}
      <div>
        {data.map((d) => (
          <div key={d.key}
               style={{ display: "grid", gridTemplateColumns: "minmax(7rem,11rem) 1fr auto auto",
                        gap: ".6rem", alignItems: "center", height: rowH }}>
            <span style={{ fontSize: ".8rem", color: "var(--ink-2)", overflow: "hidden",
                           textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={d.key}>
              {d.key}
            </span>
            <span style={{ background: "var(--grid)", borderRadius: "4px", height: "14px", position: "relative" }}>
              {/* One hue for every bar: rank is already encoded by position. */}
              <span style={{
                position: "absolute", inset: "0 auto 0 0", borderRadius: "4px",
                width: `${Math.max(1, (Math.abs(d.revenue) / max) * 100)}%`,
                background: d.revenue < 0 ? "var(--critical)" : "var(--series-1)",
              }} />
            </span>
            <span className="mark-label" style={{ fontSize: ".78rem", minWidth: "5rem", textAlign: "right" }}>
              {fmtMoney(d.revenue, true)}
            </span>
            <span style={{ fontSize: ".74rem", color: "var(--muted)", minWidth: "3.4rem",
                           textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                  title="cumulative share of revenue">
              {fmtPct(d.cumulativeShare * 100, 0)}
            </span>
          </div>
        ))}
      </div>
    </figure>
  );
}

// ───────────────────────────────────────────────────────── cohort heatmap ───
/**
 * Retention by acquisition cohort. This is the one genuinely sequential
 * encoding in the app - a continuous magnitude - so it uses the single-hue
 * blue ramp, light to dark, never a rainbow. Every cell also carries its
 * number, so the colour is reinforcement rather than the only channel.
 */
export function CohortHeatmap({
  cohorts, title, note, maxCols = 10,
}: {
  cohorts: { month: string; size: number; retention: number[] }[];
  title: string;
  note?: string;
  maxCols?: number;
}) {
  if (cohorts.length === 0) return null;
  const cols = Math.min(maxCols, Math.max(...cohorts.map((c) => c.retention.length)));

  const steps = ["--seq-100","--seq-200","--seq-300","--seq-400","--seq-500","--seq-600","--seq-700"];
  const cell = (v: number) => {
    const i = Math.min(steps.length - 1, Math.floor(v * steps.length));
    return { bg: `var(${steps[i]})`, ink: i >= 3 ? "#ffffff" : "#0b0b0b" };
  };

  return (
    <figure style={{ margin: 0 }}>
      <h3 className="card-title">{title}</h3>
      {note && <p className="card-note">{note}</p>}
      <div className="scroll">
        <table className="heat">
          <thead>
            <tr>
              <th className="row-head">Cohort</th>
              <th>Size</th>
              {Array.from({ length: cols }, (_, i) => <th key={i}>M{i}</th>)}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((c) => (
              <tr key={c.month}>
                <th className="row-head">{monthLabel(c.month)}</th>
                <td style={{ color: "var(--muted)" }}>{c.size}</td>
                {Array.from({ length: cols }, (_, i) => {
                  const v = c.retention[i];
                  if (v === undefined) return <td key={i} />;
                  const { bg, ink } = cell(v);
                  return (
                    <td key={i} style={{ background: bg, color: ink }}
                        title={`${monthLabel(c.month)} cohort, month ${i}: ${fmtPct(v * 100, 0)} of ${c.size}`}>
                      {Math.round(v * 100)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
