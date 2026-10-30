"use client";

import React from "react";

export default function PaperModeBanner() {
  return (
    <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 text-xs font-mono text-amber-300 flex items-center justify-between shadow-sm z-50">
      <div className="flex items-center space-x-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
        </span>
        <span className="font-bold tracking-wider uppercase text-amber-200">
          Paper Trading Simulation Mode
        </span>
        <span className="hidden sm:inline text-amber-400/80">
          — Real money execution is strictly disabled. All orders routed to Alpaca Paper & Binance Testnet.
        </span>
      </div>
      <div className="flex items-center space-x-3 text-[11px]">
        <span className="bg-amber-950/60 border border-amber-600/40 text-amber-300 px-2 py-0.5 rounded font-semibold">
          ZERO CAPITAL RISK
        </span>
        <span className="hidden md:inline text-zinc-400">
          Deterministic Gate Active
        </span>
      </div>
    </div>
  );
}
