/**
 * Minimal RFC 4180 CSV reader.
 *
 * Written by hand rather than pulled in as a dependency because the tricky part
 * is not the grammar - it is that real exports from QuickBooks, Xero and Excel
 * arrive with a UTF-8 BOM, CRLF endings, semicolon delimiters from European
 * locales, and quoted fields containing the delimiter. All four are handled here;
 * a naive `line.split(",")` silently corrupts every one of them.
 */
export type Table = { headers: string[]; rows: string[][] };

/** Pick the delimiter that yields the most consistent column count. */
export function sniffDelimiter(text: string): string {
  const sample = text.split("\n").slice(0, 20).join("\n");
  let best = ",";
  let bestScore = -1;

  for (const delimiter of [",", ";", "\t", "|"]) {
    const counts = parse(sample, delimiter).rows.map((r) => r.length);
    if (counts.length === 0) continue;
    const modal = counts[0]!;
    if (modal < 2) continue;
    // Reward both width and consistency: a delimiter that splits every row the
    // same way is the real one.
    const consistent = counts.filter((c) => c === modal).length / counts.length;
    const score = modal * consistent;
    if (score > bestScore) { bestScore = score; best = delimiter; }
  }
  return best;
}

export function parse(text: string, delimiter?: string): Table {
  // Strip the BOM Excel writes; left in place it becomes part of the first
  // header name and every column lookup for that field misses.
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const d = delimiter ?? sniffDelimiter(clean);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;

    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }  // escaped quote
        else quoted = false;
      } else field += ch;
      continue;
    }

    if (ch === '"') { quoted = true; continue; }
    if (ch === d) { row.push(field); field = ""; continue; }
    if (ch === "\n") {
      row.push(field); field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }

  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);

  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { headers, rows };
}
