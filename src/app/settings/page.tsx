"use client";

import React, { useState, useEffect } from "react";

export default function SettingsPage() {
  const [riskPerTrade, setRiskPerTrade] = useState("0.01");
  const [dailyLossLimit, setDailyLossLimit] = useState("0.03");
  const [maxPositions, setMaxPositions] = useState("5");
  const [maxExposure, setMaxExposure] = useState("0.20");
  const [currentEquity, setCurrentEquity] = useState("100000");
  const [envStatus, setEnvStatus] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  async function loadSettings() {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          setRiskPerTrade(String(data.settings.riskPerTrade ?? 0.01));
          setDailyLossLimit(String(data.settings.dailyLossLimit ?? 0.03));
          setMaxPositions(String(data.settings.maxPositions ?? 5));
          setMaxExposure(String(data.settings.maxExposure ?? 0.20));
          setCurrentEquity(String(data.settings.currentEquity ?? 100000));
        }
        if (data.envStatus) {
          setEnvStatus(data.envStatus);
        }
      }
    } catch (err) {
      console.error("Error loading settings:", err);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSavedMessage(null);

    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          riskPerTrade: parseFloat(riskPerTrade),
          dailyLossLimit: parseFloat(dailyLossLimit),
          maxPositions: parseInt(maxPositions, 10),
          maxExposure: parseFloat(maxExposure),
          currentEquity: parseFloat(currentEquity),
        }),
      });

      if (res.ok) {
        setSavedMessage("Risk configuration saved successfully.");
        setTimeout(() => setSavedMessage(null), 4000);
      }
    } catch (err: any) {
      alert("Error saving settings: " + err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur">
        <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
          Deterministic Risk Gate & Environment Configuration
          <span className="text-xs px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800/50 font-mono">
            Hard Constraints
          </span>
        </h1>
        <p className="text-xs text-zinc-400 mt-1">
          Trading decisions proposed by LLMs MUST pass these mathematical checks. The LLM cannot override or loosen these parameters.
        </p>
      </div>

      {/* Success Notification */}
      {savedMessage && (
        <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 text-xs font-mono">
          ✓ {savedMessage}
        </div>
      )}

      {/* Risk Parameters Form */}
      <form
        onSubmit={handleSaveSettings}
        className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur space-y-5 text-xs font-mono"
      >
        <h2 className="text-sm font-semibold text-zinc-200 font-sans">
          Deterministic Risk Boundaries
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-zinc-400 mb-1">
              Risk per Trade (Default: 0.01 = 1%)
            </label>
            <input
              type="number"
              step="0.005"
              min="0.001"
              max="0.05"
              value={riskPerTrade}
              onChange={(e) => setRiskPerTrade(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-cyan-500 font-bold"
            />
            <span className="text-[11px] text-zinc-500 mt-1 block">
              Position sizing: size = (equity × {Number(riskPerTrade) * 100}%) / (entry − stop)
            </span>
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">
              Daily Loss Limit (Default: 0.03 = 3%)
            </label>
            <input
              type="number"
              step="0.005"
              min="0.01"
              max="0.10"
              value={dailyLossLimit}
              onChange={(e) => setDailyLossLimit(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-cyan-500 font-bold"
            />
            <span className="text-[11px] text-zinc-500 mt-1 block">
              Trading halts automatically if daily drawdown exceeds this threshold.
            </span>
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">
              Max Open Positions (Default: 5)
            </label>
            <input
              type="number"
              min="1"
              max="15"
              value={maxPositions}
              onChange={(e) => setMaxPositions(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-cyan-500 font-bold"
            />
            <span className="text-[11px] text-zinc-500 mt-1 block">
              Prevents over-diversification and excessive margin utilization.
            </span>
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">
              Max Exposure per Asset (Default: 0.20 = 20%)
            </label>
            <input
              type="number"
              step="0.05"
              min="0.05"
              max="0.50"
              value={maxExposure}
              onChange={(e) => setMaxExposure(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-cyan-500 font-bold"
            />
            <span className="text-[11px] text-zinc-500 mt-1 block">
              Single-asset portfolio concentration cap.
            </span>
          </div>
        </div>

        <div className="pt-2">
          <label className="block text-zinc-400 mb-1">
            Simulated Portfolio Equity ($)
          </label>
          <input
            type="number"
            step="1000"
            value={currentEquity}
            onChange={(e) => setCurrentEquity(e.target.value)}
            className="w-full sm:w-1/2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-cyan-500 font-bold"
          />
        </div>

        <div className="pt-3 border-t border-zinc-800 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold transition active:scale-95 disabled:opacity-50"
          >
            {saving ? "Saving Changes..." : "Save Risk Parameters"}
          </button>
        </div>
      </form>

      {/* Integration & Security Status */}
      <div className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur space-y-4 text-xs font-mono">
        <h2 className="text-sm font-semibold text-zinc-200 font-sans">
          Broker Adapters & Dual-LLM Connectivity Status
        </h2>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-950 border border-zinc-800">
            <div className="flex items-center gap-2.5">
              <span className={`w-2 h-2 rounded-full ${envStatus.groqConfigured ? "bg-emerald-400" : "bg-amber-400"}`} />
              <span className="text-zinc-200 font-semibold">Groq SDK (Llama-3.3-70B-Versatile)</span>
            </div>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${envStatus.groqConfigured ? "text-emerald-300 bg-emerald-950 border border-emerald-800" : "text-amber-300 bg-amber-950 border border-amber-800"}`}>
              {envStatus.groqConfigured ? "API KEY CONFIGURED" : "DEMO / FALLBACK MODE"}
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-950 border border-zinc-800">
            <div className="flex items-center gap-2.5">
              <span className={`w-2 h-2 rounded-full ${envStatus.geminiConfigured ? "bg-emerald-400" : "bg-amber-400"}`} />
              <span className="text-zinc-200 font-semibold">Google Generative AI (Gemini 1.5 Pro)</span>
            </div>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${envStatus.geminiConfigured ? "text-emerald-300 bg-emerald-950 border border-emerald-800" : "text-amber-300 bg-amber-950 border border-amber-800"}`}>
              {envStatus.geminiConfigured ? "API KEY CONFIGURED" : "DEMO / FALLBACK MODE"}
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-950 border border-zinc-800">
            <div className="flex items-center gap-2.5">
              <span className={`w-2 h-2 rounded-full ${envStatus.alpacaConfigured ? "bg-emerald-400" : "bg-cyan-400"}`} />
              <span className="text-zinc-200 font-semibold">Alpaca Paper Trading API (Stocks)</span>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase text-cyan-300 bg-cyan-950 border border-cyan-800">
              PAPER SANDBOX ACTIVE
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-950 border border-zinc-800">
            <div className="flex items-center gap-2.5">
              <span className={`w-2 h-2 rounded-full ${envStatus.binanceConfigured ? "bg-emerald-400" : "bg-cyan-400"}`} />
              <span className="text-zinc-200 font-semibold">Binance Testnet / CCXT Sandbox (Crypto)</span>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase text-cyan-300 bg-cyan-950 border border-cyan-800">
              TESTNET ACTIVE
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-950 border border-zinc-800">
            <div className="flex items-center gap-2.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-zinc-200 font-semibold">Persistent Database</span>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase text-emerald-300 bg-emerald-950 border border-emerald-800">
              SQLITE DEV.DB READY
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
