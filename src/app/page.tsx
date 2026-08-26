import { Dashboard } from "@/components/Dashboard";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function Home() {
  return (
    <div className="wrap">
      <header className="topbar">
        <span className="logo-dot" aria-hidden />
        <h1 className="logo">RE<span>QU</span>QU</h1>
        <span className="tagline">sales &amp; revenue analytics</span>
        <span className="spacer" />
        <ThemeToggle />
      </header>

      <section className="hero">
        <h2>Turn a sales export into an answer.</h2>
        <p>
          Upload an invoice or sales CSV — QuickBooks, Xero, MYOB and Excel load
          without configuration. REQUQU reconciles the totals, charts revenue,
          margin and customer cohorts, and writes up what it found. Everything runs
          in your browser; no file is uploaded anywhere.
        </p>
      </section>

      <main>
        <Dashboard />
      </main>

      <footer>
        Every figure is checked against a hand-computed golden dataset —
        run <code>npm test</code> for the full list.
      </footer>
    </div>
  );
}
