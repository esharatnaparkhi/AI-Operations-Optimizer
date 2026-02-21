import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LLM Monitor — Efficiency Dashboard",
  description: "Monitor and optimize your LLM costs and latency",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
