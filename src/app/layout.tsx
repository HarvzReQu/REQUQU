import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "REQUQU — sales & revenue analytics",
  description:
    "Upload a sales CSV and get revenue, margin, cohorts and written findings. Runs entirely in your browser.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
