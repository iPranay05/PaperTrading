import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import PaperModeBanner from "@/components/layout/PaperModeBanner";
import Header from "@/components/layout/Header";
import Sidebar from "@/components/layout/Sidebar";

export const metadata: Metadata = {
  title: "ALPHA-AGENT | Autonomous Paper Trading Platform",
  description: "Agentic AI paper-trading platform powered by dual-LLM ensemble and deterministic risk controls",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
        {/* Sticky Paper Mode Alert Banner */}
        <PaperModeBanner />

        {/* Top Header */}
        <Header />

        {/* App Body with Sidebar & Content */}
        <div className="flex flex-1 overflow-hidden min-h-[calc(100vh-6.5rem)]">
          <Sidebar />
          <main className="flex-1 overflow-y-auto p-6 bg-zinc-950/60">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
