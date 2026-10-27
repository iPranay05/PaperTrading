"use client";

import React, { useState, useEffect } from "react";

interface JournalItem {
  id: string;
  decisionType: string;
  observation: string;
  strategy: string;
  thesis: string;
  confidence: string;
  riskCalculation: string;
  outcome?: string;
  auditTrail: string;
  signalScore?: number;
  noiseHeadlines: number;
  signalHeadlines: number;
  createdAt: string;
  trade?: {
    symbol: string;
    side: string;
    entryPrice: number;
    stopLoss: number;
    exitPrice?: number;
    pnl?: number;
    status: string;
    groqConfidence?: number;
    geminiConfidence?: number;
    ensembleAction?: string;
    invalidation?: string;
  };
}

export default function JournalPage() {
  const [entries, setEntries] = useState<JournalItem[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ all: 0, trades: 0, skips: 0, rejected: 0 });

  async function fetchJournal(type: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/journal?filter=${type}&limit=40`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
        if (data.counts) setCounts(data.counts);
      }
    } catch (err) {
      console.error("Journal fetch error:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchJournal(filter);
  }, [filter]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            Autonomous Agent Journal & Pre-Registered Theses
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Every trade decision pre-registers explicit market observations, dual-LLM ensemble consensus, deterministic risk sizing, and falsifiable invalidation conditions.
          </p>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800 text-xs font-mono">
          {[
            { id: "all", label: `All (${counts.all})` },
            { id: "trade", label: `Executed (${counts.trades})` },
            { id: "skip", label: `Skips (${counts.skips})` },
            { id: "rejected", label: `Risk Rejected (${counts.rejected})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`px-3 py-1.5 rounded-md transition ${
                filter === tab.id
                  ? "bg-zinc-800 text-cyan-300 font-semibold shadow-sm border border-zinc-700/60"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Entries List */}
      {loading ? (
        <div className="py-20 text-center text-zinc-500 font-mono text-xs">
          Loading agent journal entries...
        </div>
      ) : entries.length === 0 ? (
        <div className="py-20 text-center text-zinc-500 font-mono text-xs">
          No journal entries found for selected filter.
        </div>
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => {
            const isTrade = entry.decisionType === "trade";
            const isRejected = entry.decisionType === "rejected";

            return (
              <div
                key={entry.id}
                className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur space-y-4"
              >
                {/* Entry Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-zinc-800/80">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`px-2.5 py-1 rounded text-xs font-mono font-bold uppercase tracking-wider ${
                        isTrade
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : isRejected
                          ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                          : "bg-zinc-800 text-zinc-300 border border-zinc-700"
                      }`}
                    >
                      {entry.decisionType}
                    </span>
                    {entry.trade?.symbol && (
                      <span className="font-bold text-white text-sm font-mono">
                        {entry.trade.symbol} ({entry.trade.side.toUpperCase()})
                      </span>
                    )}
                    <span className="text-xs text-zinc-400 bg-zinc-800/60 px-2 py-0.5 rounded font-mono">
                      Strategy: {entry.strategy}
                    </span>
                  </div>

                  <span className="text-xs font-mono text-zinc-500">
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                </div>

                {/* Main Thesis Content */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  {/* Left Column: Observation & Thesis */}
                  <div className="space-y-3">
                    <div className="bg-zinc-950/60 p-3 rounded-lg border border-zinc-800/60">
                      <span className="text-[10px] font-mono text-zinc-500 uppercase font-semibold block mb-1">
                        1. Observation & Technical Evidence
                      </span>
                      <p className="text-zinc-200 leading-relaxed">
                        {entry.observation}
                      </p>
                    </div>

                    <div className="bg-zinc-950/60 p-3 rounded-lg border border-zinc-800/60">
                      <span className="text-[10px] font-mono text-cyan-400 uppercase font-semibold block mb-1">
                        2. Pre-Registered Trade Thesis
                      </span>
                      <p className="text-zinc-100 font-medium leading-relaxed">
                        {entry.thesis}
                      </p>
                    </div>

                    {entry.trade?.invalidation && (
                      <div className="bg-rose-950/20 p-3 rounded-lg border border-rose-800/30">
                        <span className="text-[10px] font-mono text-rose-400 uppercase font-semibold block mb-1">
                          3. Invalidation Condition (Stop Reason)
                        </span>
                        <p className="text-rose-200/90 leading-relaxed">
                          {entry.trade.invalidation}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Right Column: LLM Ensemble & Deterministic Risk */}
                  <div className="space-y-3">
                    <div className="bg-zinc-950/60 p-3 rounded-lg border border-zinc-800/60">
                      <span className="text-[10px] font-mono text-indigo-400 uppercase font-semibold block mb-1">
                        Dual-LLM Consensus & Confidence
                      </span>
                      <p className="text-zinc-300 font-mono text-[11px] leading-relaxed">
                        {entry.confidence}
                      </p>
                    </div>

                    <div className="bg-zinc-950/60 p-3 rounded-lg border border-zinc-800/60">
                      <span className="text-[10px] font-mono text-amber-400 uppercase font-semibold block mb-1">
                        Deterministic Risk Sizing Gate
                      </span>
                      <p className="text-zinc-300 font-mono text-[11px] leading-relaxed">
                        {entry.riskCalculation}
                      </p>
                    </div>

                    {entry.outcome && (
                      <div className="bg-emerald-950/20 p-3 rounded-lg border border-emerald-800/30">
                        <span className="text-[10px] font-mono text-emerald-400 uppercase font-semibold block mb-1">
                          Trade Execution Outcome & P&L
                        </span>
                        <p className="text-emerald-200 font-mono font-medium">
                          {entry.outcome}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Audit Trail Accordion Footer */}
                <details className="text-[11px] font-mono text-zinc-500 pt-2 border-t border-zinc-800/50">
                  <summary className="cursor-pointer hover:text-zinc-400 select-none">
                    View Deterministic Audit Trail & Metadata
                  </summary>
                  <pre className="mt-2 p-2.5 rounded bg-black/60 border border-zinc-800 text-[10px] text-zinc-400 overflow-x-auto whitespace-pre-wrap">
                    {entry.auditTrail}
                  </pre>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
