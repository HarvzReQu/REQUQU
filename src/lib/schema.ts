import { parse, type Table } from "./csv";
import { inferDayFirst, toDate, toNumber } from "./coerce";

export type Txn = {
  row: number;
  date: Date;
  customer: string;
  product: string;
  category: string;
  region: string;
  channel: string;
  rep: string;
  quantity: number;
  revenue: number;
  cost: number | null;
};

export type Mapping = Partial<Record<Field, string>>;

export type Field =
  | "date" | "customer" | "product" | "category" | "region" | "channel"
  | "rep" | "quantity" | "revenue" | "unitPrice" | "cost" | "unitCost";

/**
 * Header synonyms, matched loosely.
 *
 * Nobody exports a CSV with the column names your code expects. QuickBooks says
 * "Invoice Date", Xero says "InvoiceDate", a hand-kept sheet says "dt". Matching
 * on a normalized form against a synonym list means the common exports load with
 * zero configuration, which is the difference between a tool someone tries and a
 * tool someone abandons at the mapping screen.
 */
const SYNONYMS: Record<Field, string[]> = {
  date: ["date", "invoicedate", "orderdate", "transactiondate", "txndate", "saledate", "day", "period", "created", "createdat"],
  customer: ["customer", "customername", "client", "account", "accountname", "company", "buyer", "contact"],
  product: ["product", "productname", "item", "itemname", "sku", "description", "service"],
  category: ["category", "productcategory", "type", "itemtype", "class", "segment", "family", "department"],
  region: ["region", "country", "state", "territory", "market", "location", "city", "area"],
  channel: ["channel", "source", "saleschannel", "medium", "platform", "storetype"],
  rep: ["rep", "salesrep", "salesperson", "owner", "agent", "seller", "accountmanager", "employee"],
  quantity: ["quantity", "qty", "units", "unitssold", "count", "volume"],
  revenue: ["revenue", "amount", "total", "sales", "netamount", "linetotal", "totalamount", "grossamount", "value", "subtotal", "extendedprice"],
  unitPrice: ["unitprice", "price", "rate", "priceeach", "unitsaleprice", "sellprice"],
  cost: ["cost", "cogs", "totalcost", "costofgoods", "costamount", "linecost"],
  unitCost: ["unitcost", "costeach", "purchaseprice", "buyprice", "costprice"],
};

const normalize = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

export function inferMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const taken = new Set<string>();

  // Exact synonym matches first, so "cost" never steals the column that "unitcost"
  // would have matched by prefix.
  for (const pass of ["exact", "partial"] as const) {
    for (const field of Object.keys(SYNONYMS) as Field[]) {
      if (mapping[field]) continue;
      const wanted = SYNONYMS[field];
      const found = headers.find((h) => {
        if (taken.has(h)) return false;
        const n = normalize(h);
        return pass === "exact"
          ? wanted.includes(n)
          : wanted.some((w) => n.includes(w) && w.length >= 4);
      });
      if (found) { mapping[field] = found; taken.add(found); }
    }
  }
  return mapping;
}

export type LoadResult = {
  txns: Txn[];
  mapping: Mapping;
  headers: string[];
  /** Rows dropped because they had no usable date or no usable amount. */
  skipped: number;
  total: number;
  /** Populated when the file cannot be interpreted as sales data at all. */
  error: string | null;
};

export function load(text: string, override?: Mapping): LoadResult {
  const table: Table = parse(text);
  const mapping = { ...inferMapping(table.headers), ...override };
  const index = (field: Field): number =>
    mapping[field] ? table.headers.indexOf(mapping[field]!) : -1;

  const cols = {
    date: index("date"), customer: index("customer"), product: index("product"),
    category: index("category"), region: index("region"), channel: index("channel"),
    rep: index("rep"), quantity: index("quantity"), revenue: index("revenue"),
    unitPrice: index("unitPrice"), cost: index("cost"), unitCost: index("unitCost"),
  };

  const base = { txns: [], mapping, headers: table.headers, skipped: 0, total: table.rows.length };
  if (cols.date === -1) {
    return { ...base, error: "No date column found. Expected something like 'Date' or 'Invoice Date'." };
  }
  if (cols.revenue === -1 && cols.unitPrice === -1) {
    return { ...base, error: "No amount column found. Expected 'Amount', 'Revenue', 'Total', or 'Unit Price'." };
  }

  const dayFirst = inferDayFirst(table.rows.map((r) => r[cols.date] ?? ""));
  const txns: Txn[] = [];
  let skipped = 0;

  const text_ = (r: string[], i: number, fallback: string) =>
    i === -1 ? fallback : (r[i] ?? "").trim() || fallback;

  table.rows.forEach((r, i) => {
    const date = toDate(r[cols.date], dayFirst);
    if (!date) { skipped++; return; }

    const quantity = cols.quantity === -1 ? 1 : toNumber(r[cols.quantity]) ?? 1;
    const unitPrice = cols.unitPrice === -1 ? null : toNumber(r[cols.unitPrice]);
    const explicit = cols.revenue === -1 ? null : toNumber(r[cols.revenue]);

    // Prefer the stated line total over quantity x price: exports frequently
    // carry discounts that only the total reflects.
    const revenue = explicit ?? (unitPrice === null ? null : unitPrice * quantity);
    if (revenue === null) { skipped++; return; }

    const unitCost = cols.unitCost === -1 ? null : toNumber(r[cols.unitCost]);
    const explicitCost = cols.cost === -1 ? null : toNumber(r[cols.cost]);
    const cost = explicitCost ?? (unitCost === null ? null : unitCost * quantity);

    txns.push({
      row: i + 2, // +1 for zero-index, +1 for the header row
      date,
      customer: text_(r, cols.customer, "Unknown"),
      product: text_(r, cols.product, "Unknown"),
      category: text_(r, cols.category, "Uncategorized"),
      region: text_(r, cols.region, "Unspecified"),
      channel: text_(r, cols.channel, "Unspecified"),
      rep: text_(r, cols.rep, "Unassigned"),
      quantity,
      revenue,
      cost,
    });
  });

  return { txns, mapping, headers: table.headers, skipped, total: table.rows.length, error: null };
}
