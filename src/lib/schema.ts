import { parse, type Table } from "./csv";
import { inferDayFirst, toDate, toNumber } from "./coerce";
import { detectCurrency } from "./currency";

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

/** What a column looks like, so the mapping UI can show evidence not just names. */
export type ColumnProfile = {
  header: string;
  /** First non-empty value, for display. */
  sample: string;
  kind: "date" | "number" | "text" | "empty";
};

export type LoadResult = {
  txns: Txn[];
  mapping: Mapping;
  headers: string[];
  /** Rows dropped because they had no usable date or no usable amount. */
  skipped: number;
  total: number;
  /**
   * Which required field is missing, or null. A code rather than a sentence so
   * the UI can render actionable guidance instead of a dead-end string.
   */
  error: "date" | "amount" | null;
  /** Present even on error - it is what lets the user rescue an unmapped file. */
  columns: ColumnProfile[];
  /** True when no column anywhere holds a number: this is not sales data. */
  looksNonFinancial: boolean;
  /** ISO code inferred from the amount column, or null when the file gave no signal. */
  currency: string | null;
};

/**
 * Classify each column from its own values.
 *
 * Header names are a hint; the values are the evidence. Showing a sample beside
 * each column in the mapping UI turns "which of these 30 columns is the amount?"
 * into a question you can answer by looking.
 */
export function profileColumns(table: Table): ColumnProfile[] {
  return table.headers.map((header, i) => {
    const values = table.rows.slice(0, 60).map((r) => (r[i] ?? "").trim()).filter(Boolean);
    const sample = values[0] ?? "";
    if (values.length === 0) return { header, sample: "", kind: "empty" as const };

    const dates = values.filter((v) => toDate(v) !== null).length;
    const numbers = values.filter((v) => toNumber(v) !== null).length;
    // Dates are checked first: "2026" parses as a number too.
    const kind =
      dates / values.length > 0.8 && numbers / values.length < 0.8 ? "date"
      : numbers / values.length > 0.8 ? "number"
      : "text";
    return { header, sample, kind };
  });
}

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

  const columns = profileColumns(table);
  const looksNonFinancial = !columns.some((c) => c.kind === "number");
  const base = {
    txns: [], mapping, headers: table.headers, skipped: 0,
    total: table.rows.length, columns, looksNonFinancial, currency: null,
  };

  if (cols.date === -1) {
    return { ...base, error: "date" };
  }
  if (cols.revenue === -1 && cols.unitPrice === -1) {
    return { ...base, error: "amount" };
  }

  const dayFirst = inferDayFirst(table.rows.map((r) => r[cols.date] ?? ""));
  // Read the symbol from the RAW strings, before toNumber strips it.
  const amountCol = cols.revenue !== -1 ? cols.revenue : cols.unitPrice;
  const currency = detectCurrency(
    table.rows.slice(0, 200).map((r) => r[amountCol] ?? ""),
    table.headers,
  );
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

  return {
    txns, mapping, headers: table.headers, skipped,
    total: table.rows.length, error: null, columns, looksNonFinancial, currency,
  };
}
