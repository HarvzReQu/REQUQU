/**
 * A generated sample dataset that behaves like a real export.
 *
 * Deliberately not clean: amounts carry currency symbols and thousands
 * separators, dates are US-style, one customer name contains a comma so the
 * field is quoted, and there are credit lines in accounting parentheses. If the
 * demo data were tidy it would prove nothing about the parser.
 *
 * The business itself is constructed to contain findings worth reporting -
 * revenue concentration, a margin slide, one loss-making line - so the insight
 * engine has something true to say rather than an empty state.
 */
const PRODUCTS = [
  { name: "Atlas CRM — Team",       category: "Software",  price: 1200, cost: 180 },
  { name: "Atlas CRM — Enterprise", category: "Software",  price: 4800, cost: 640 },
  { name: "Onboarding & Migration", category: "Services",  price: 3500, cost: 2400 },
  { name: "Custom Integration",     category: "Services",  price: 6200, cost: 4100 },
  { name: "Support Retainer",       category: "Services",  price: 900,  cost: 520 },
  { name: "Hardware Bundle",        category: "Hardware",  price: 740,  cost: 810 }, // sold below cost
  { name: "Analytics Add-on",       category: "Software",  price: 650,  cost: 95 },
  { name: "Training Workshop",      category: "Services",  price: 2100, cost: 1150 },
];

const ACCOUNTS = [
  { name: "Northwind Traders",        weight: 15 },
  { name: "Contoso Manufacturing",    weight: 12 },
  { name: "Fabrikam, Inc.",           weight: 10 }, // comma forces a quoted field
  { name: "Tailspin Toys",            weight: 6 },
  { name: "Adventure Works",          weight: 6 },
  { name: "Litware Holdings",         weight: 4 },
  { name: "Proseware Group",          weight: 3 },
  { name: "Wide World Importers",     weight: 3 },
  { name: "Blue Yonder Airlines",     weight: 2 },
  { name: "Coho Vineyard",            weight: 2 },
  { name: "Lucerne Publishing",       weight: 2 },
  { name: "Graphic Design Institute", weight: 1 },
  { name: "School of Fine Art",       weight: 1 },
  { name: "Trey Research",            weight: 1 },
];

const REGIONS = ["North America", "EMEA", "APAC"];
const CHANNELS = ["Direct", "Partner", "Online"];
const REPS = ["A. Reyes", "J. Okafor", "M. Lindqvist", "S. Nakamura"];

/** mulberry32 - small, fast, and seeded so the sample never shifts under tests. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildSampleCsv(): string {
  const rand = rng(20260826);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;

  const pool: string[] = [];
  for (const a of ACCOUNTS) for (let i = 0; i < a.weight; i++) pool.push(a.name);

  const rows: string[] = [
    "Invoice Date,Customer,Product,Category,Region,Channel,Sales Rep,Qty,Unit Price,Unit Cost,Amount",
  ];

  const MONTHS = 18;
  const end = new Date(Date.UTC(2026, 6, 1)); // Jul 2026, last full month

  for (let m = MONTHS - 1; m >= 0; m--) {
    const monthStart = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - m, 1));
    const daysInMonth = new Date(
      Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0),
    ).getUTCDate();

    const age = MONTHS - 1 - m;
    const trend = 1 + age * 0.045;                                  // steady growth
    const season = 1 + 0.22 * Math.sin((monthStart.getUTCMonth() / 12) * Math.PI * 2);
    const slump = m <= 1 ? 0.72 : 1;                                // recent downturn
    const orders = Math.max(6, Math.round((26 * trend * season * slump) + rand() * 8 - 4));

    for (let i = 0; i < orders; i++) {
      const product = pick(PRODUCTS);
      const day = 1 + Math.floor(rand() * daysInMonth);
      const qty = product.category === "Software" ? 1 + Math.floor(rand() * 4) : 1;

      // Discounting deepens over time - this is what makes margin slide.
      const discount = rand() < 0.35 ? 1 - (0.05 + rand() * 0.12 + age * 0.004) : 1;
      const unitPrice = product.price * discount;
      // Costs creep up, so the margin story is both price and cost.
      const unitCost = product.cost * (1 + age * 0.006);
      const amount = unitPrice * qty;

      rows.push(
        line(monthStart, day, pick(pool), product, pick(REGIONS), pick(CHANNELS),
             pick(REPS), qty, unitPrice, unitCost, amount, false),
      );

      // Occasional credit note, written the way an accounting export writes it.
      if (rand() < 0.022) {
        rows.push(
          line(monthStart, Math.min(daysInMonth, day + 3), pick(pool), product,
               pick(REGIONS), pick(CHANNELS), pick(REPS), qty, unitPrice, unitCost, amount, true),
        );
      }
    }
  }

  return rows.join("\n");
}

function line(
  monthStart: Date, day: number, customer: string,
  product: { name: string; category: string },
  region: string, channel: string, rep: string,
  qty: number, unitPrice: number, unitCost: number, amount: number, credit: boolean,
): string {
  const d = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day));
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;

  const q = (s: string) => (s.includes(",") ? `"${s}"` : s);
  // Thousands separators put a comma INSIDE the field, so the field must be
  // quoted - exactly as QuickBooks and Xero write it. Emitting $1,898.91
  // unquoted produces a file that every conforming CSV reader mis-splits,
  // shifting every later column by one.
  const money = (n: number) =>
    q(`$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  // Accounting convention: a credit is shown in parentheses, not with a minus.
  const signed = (n: number) =>
    credit
      ? q(`($${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`)
      : money(n);

  return [
    date, q(customer), q(product.name), product.category, region, channel, rep,
    credit ? -qty : qty, money(unitPrice), money(unitCost), signed(amount),
  ].join(",");
}
