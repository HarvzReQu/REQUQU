"use client";

import { useRef, useState } from "react";
import type { Field, LoadResult, Mapping } from "@/lib/schema";

const FIELDS: { id: Field; label: string; required?: boolean }[] = [
  { id: "date", label: "Date", required: true },
  { id: "revenue", label: "Amount / revenue", required: true },
  { id: "customer", label: "Customer" },
  { id: "product", label: "Product" },
  { id: "category", label: "Category" },
  { id: "region", label: "Region" },
  { id: "channel", label: "Channel" },
  { id: "rep", label: "Sales rep" },
  { id: "quantity", label: "Quantity" },
  { id: "unitPrice", label: "Unit price" },
  { id: "cost", label: "Cost" },
  { id: "unitCost", label: "Unit cost" },
];

export function DataLoader({
  text, setText, result, override, setOverride, onSample,
}: {
  text: string;
  setText: (v: string) => void;
  result: LoadResult | null;
  override: Mapping;
  setOverride: (m: Mapping) => void;
  onSample: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [showMapping, setShowMapping] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const read = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => { setOverride({}); setText(String(reader.result ?? "")); };
    reader.readAsText(file);
  };

  return (
    <section className="card">
      <p className="eyebrow">Step 1 · Import</p>
      <h2 className="card-title">Drop a CSV file</h2>
      <p className="card-note">
        Sales, invoice or transaction lines. Column names are matched automatically,
        so most exports work untouched — and anything it gets wrong you can remap below.
      </p>

      <div
        className={`dropzone${dragging ? " over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) read(file);
        }}
        onClick={() => fileInput.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInput.current?.click(); }}
        aria-label="Drop a CSV file here or click to browse"
      >
        <div className="dz-icon" aria-hidden>
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <path d="M12 18v-6" /><path d="m9 15 3-3 3 3" />
          </svg>
        </div>
        <p className="dz-main"><strong>Drop your CSV here</strong> or click to browse</p>
        <p className="dz-sub">.csv · .tsv · .txt — comma, semicolon or tab separated</p>
        <div className="dz-badges">
          {["QuickBooks", "Xero", "MYOB", "Excel", "Google Sheets"].map((s) => (
            <span key={s} className="badge">{s}</span>
          ))}
        </div>
      </div>

      <input ref={fileInput} type="file" accept=".csv,.tsv,.txt,text/csv" hidden
             onChange={(e) => {
               const f = e.target.files?.[0];
               if (f) read(f);
               e.target.value = "";
             }} />

      <div className="controls" style={{ marginTop: ".85rem" }}>
        <button className="primary" onClick={onSample}>Try the sample business</button>
        <button className="ghost" onClick={() => setShowPaste((v) => !v)}>
          {showPaste ? "Hide paste box" : "Paste CSV text"}
        </button>
        {result && !result.error && (
          <button className="ghost" onClick={() => setShowMapping((v) => !v)}>
            {showMapping ? "Hide columns" : "Check columns"}
          </button>
        )}
        <button className="ghost" onClick={() => { setText(""); setOverride({}); }} disabled={!text}>
          Clear
        </button>
        <span className="spacer" />
        {result && !result.error && (
          <span className="pill">
            {result.txns.length.toLocaleString()} of {result.total.toLocaleString()} rows read
            {result.skipped > 0 && ` · ${result.skipped} skipped`}
          </span>
        )}
      </div>

      {showPaste && (
        <textarea value={text} spellCheck={false}
                  onChange={(e) => { setOverride({}); setText(e.target.value); }}
                  placeholder="Paste CSV text here — the first row should be your column headers" />
      )}

      {result?.error && (
        <p className="err">
          {result.error}{" "}
          {result.headers.length > 0 && (
            <>Columns found: {result.headers.slice(0, 8).map((h) => `“${h}”`).join(", ")}
            {result.headers.length > 8 && "…"}</>
          )}
        </p>
      )}

      {showMapping && result && !result.error && (
        <div className="mapping">
          <p className="card-note" style={{ marginBottom: ".7rem" }}>
            This is what each of your columns was read as. Change anything that
            looks wrong — the whole analysis recomputes immediately.
          </p>
          <div className="map-grid">
            {FIELDS.map((f) => (
              <label key={f.id} className="map-row">
                <span className="map-label">
                  {f.label}{f.required && <em title="required"> *</em>}
                </span>
                <select
                  value={result.mapping[f.id] ?? ""}
                  onChange={(e) => setOverride({ ...override, [f.id]: e.target.value || undefined })}
                >
                  <option value="">— not used —</option>
                  {result.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
