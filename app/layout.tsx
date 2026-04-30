import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sales Oversight",
  description: "Spreadsheet-based sales oversight for team reporting and decision support.",
  icons: {
    icon: [{ url: "/spacefavi.png", type: "image/png", sizes: "512x512" }],
    shortcut: "/spacefavi.png",
    apple: [{ url: "/spacefavi.png", type: "image/png", sizes: "512x512" }]
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
