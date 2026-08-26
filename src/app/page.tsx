import { Dashboard } from "@/components/Dashboard";

export default function Home() {
  return (
    <main className="wrap">
      <div className="masthead">
        <h1 className="logo">RE<span>QU</span>QU</h1>
        <span className="tagline">sales &amp; revenue analytics</span>
      </div>
      <p className="lede">
        Upload a sales or invoice CSV — QuickBooks, Xero, MYOB and Excel exports
        load without configuration. REQUQU reconciles the totals, charts revenue
        and margin, builds customer cohorts, and writes up what it found.
        Everything runs in your browser; no file is uploaded anywhere.
      </p>
      <Dashboard />
      <footer>
        Every figure is checked against a hand-computed golden dataset —
        run <code>npm test</code> for the full list.
      </footer>
    </main>
  );
}
