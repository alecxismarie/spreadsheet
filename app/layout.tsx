import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sales Oversight",
  description: "Spreadsheet-based sales oversight for team reporting and decision support."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
