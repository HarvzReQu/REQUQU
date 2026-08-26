import type { MonthPoint } from "./metrics";

/**
 * Trend-plus-seasonality projection.
 *
 * Deliberately simple and deliberately labelled as such in the UI. A least-squares
 * trend with multiplicative monthly indices is defensible arithmetic that an
 * analyst can explain in an interview; an ARIMA nobody can justify is worse than
 * no forecast at all. The band is the historical residual spread, not a
 * statistical confidence interval, and the UI says so.
 */
export type ForecastPoint = {
  month: string;
  value: number;
  low: number;
  high: number;
};

export type Forecast = {
  points: ForecastPoint[];
  /** Mean absolute percentage error of the fit against history. */
  mape: number;
  /** True once at least two observations exist per calendar month. */
  seasonal: boolean;
};

export function forecast(months: MonthPoint[], horizon = 3): Forecast | null {
  // Below a year there is no seasonal signal and barely a trend; refusing is
  // more honest than extrapolating six points into next year.
  if (months.length < 12) return null;

  const y = months.map((m) => m.revenue);
  const n = y.length;

  // Least squares on the month index.
  const meanX = (n - 1) / 2;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (y[i]! - meanY);
    den += (i - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  const trend = (i: number) => intercept + slope * i;

  // Multiplicative seasonal index per calendar month.
  const ratios = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const t = trend(i);
    if (t <= 0) continue;
    const cal = Number(months[i]!.month.split("-")[1]) - 1;
    const list = ratios.get(cal);
    if (list) list.push(y[i]! / t);
    else ratios.set(cal, [y[i]! / t]);
  }
  const seasonal = [...ratios.values()].some((v) => v.length >= 2);
  const index = (cal: number) => {
    const list = ratios.get(cal);
    if (!list || list.length === 0) return 1;
    return list.reduce((a, b) => a + b, 0) / list.length;
  };

  // Fit error, which becomes both the reported accuracy and the band width.
  const residuals: number[] = [];
  let mapeSum = 0, mapeCount = 0;
  for (let i = 0; i < n; i++) {
    const cal = Number(months[i]!.month.split("-")[1]) - 1;
    const fitted = trend(i) * index(cal);
    residuals.push(Math.abs(y[i]! - fitted));
    if (y[i]! !== 0) { mapeSum += Math.abs((y[i]! - fitted) / y[i]!); mapeCount++; }
  }
  const meanResidual = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const mape = mapeCount === 0 ? 0 : (mapeSum / mapeCount) * 100;

  const [lastY, lastM] = months[n - 1]!.month.split("-").map(Number) as [number, number];
  const points: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    let m = lastM + h, yr = lastY;
    while (m > 12) { m -= 12; yr++; }
    const value = Math.max(0, trend(n - 1 + h) * index(m - 1));
    points.push({
      month: `${yr}-${String(m).padStart(2, "0")}`,
      value,
      // Widens with horizon: month three is a worse guess than month one.
      low: Math.max(0, value - meanResidual * (1 + h * 0.35)),
      high: value + meanResidual * (1 + h * 0.35),
    });
  }

  return { points, mape, seasonal };
}
