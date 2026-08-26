import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "REQUQU — sales & revenue analytics",
  description:
    "Upload a sales CSV and get revenue, margin, cohorts and written findings. Runs entirely in your browser.",
};

/**
 * Applies the saved theme before first paint. Without this the page renders in
 * the system theme and then snaps to the chosen one - a visible flash on every
 * load for anyone who picked a theme.
 */
const noFlash = `try{var m=localStorage.getItem("reququ-theme");if(m&&m!=="system")document.documentElement.setAttribute("data-theme",m)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: noFlash }} /></head>
      <body>{children}</body>
    </html>
  );
}
