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
        <h2>Drop in a CSV. Get the whole picture.</h2>
        <p>
          REQUQU reads sales, invoice and transaction CSVs — <strong>QuickBooks,
          Xero, MYOB, Excel and Google Sheets exports load without any setup</strong>.
          It works out what your columns mean, untangles currency symbols and date
          formats, reconciles every total, then charts revenue, margin and customer
          retention and writes up what it found. Nothing is uploaded; the file is
          read in your browser and never leaves it.
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
