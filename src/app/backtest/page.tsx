"use client";

import React, { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

export default function BacktestPage() {
  const [strategy, setStrategy] = useState("sma_crossover");
  const [symbol, setSymbol] = useState("AAPL");
  const [initialCapital, setInitialCapital] = useState(10000);
  const [trainTestSplit, setTrainTestSplit] = useState(0.7);
  const [feeRate, setFeeRate] = useState(0.001);
  const [slippageBps, setSlippageBps] = useState(5);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRunBacktest(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy,
          symbol,
          initialCapital,
          trainTestSplit,
          feeRate,
          slippageBps,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to execute backtest");
      }
      setResult(data);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  // Prepare chart data if result exists
  const chartData =
    result?.test?.equityCurve?.map((pt: any, i: number) => {
      const bhPt = result?.buyAndHold?.equityCurve?.[i];
      return {
        date: pt.date || `Bar ${i + 1}`,
        strategyEquity: pt.equity,
        buyAndHoldEquity: bhPt?.equity || initialCapital,
      };
    }) || [];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur">
        <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
          Strategy Backtest Engine
          <span className="text-xs px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/50 font-mono">
            Out-of-Sample Validated
          </span>
        </h1>
        <p className="text-xs text-zinc-400 mt-1">
          Rigorous walk-forward backtesting incorporating realistic trading fees, slippage modeling, and comparison against a passive Buy-and-Hold benchmark.
        </p>
      </div>

      {/* Configuration Form */}
      <form
        onSubmit={handleRunBacktest}
        className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur space-y-4 text-xs font-mono"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-zinc-400 mb-1">Strategy</label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="sma_crossover">SMA Crossover (Fast/Slow)</option>
              <option value="rsi_reversion">RSI Mean-Reversion</option>
              <option value="breakout">20-Day Donchian Breakout</option>
            </select>
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">Symbol</label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="AAPL or BTC/USDT"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-cyan-500 font-bold"
            />
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">Initial Capital ($)</label>
            <input
              type="number"
              value={initialCapital}
              onChange={(e) => setInitialCapital(Number(e.target.value))}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">
              Train / Test Split ({(trainTestSplit * 100).toFixed(0)}% / {((1 - trainTestSplit) * 100).toFixed(0)}%)
            </label>
            <input
              type="range"
              min="0.5"
              max="0.8"
              step="0.05"
              value={trainTestSplit}
              onChange={(e) => setTrainTestSplit(parseFloat(e.target.value))}
              className="w-full accent-cyan-500 cursor-pointer mt-2"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between pt-3 border-t border-zinc-800 gap-4">
          <div className="flex items-center gap-4 text-zinc-400 text-[11px]">
            <span>Fee: <strong>{(feeRate * 100).toFixed(1)}%</strong></span>
            <span>Slippage: <strong>{slippageBps} bps</strong></span>
            <span className="text-emerald-400">✓ Friction Modeled</span>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2 rounded-lg bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-semibold shadow-lg shadow-cyan-600/20 transition active:scale-95 disabled:opacity-50 flex items-center gap-2"
          >
            {loading && (
              <svg className="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
            <span>{loading ? "Simulating Historical Bars..." : "Run Backtest"}</span>
          </button>
        </div>
      </form>

      {/* Error display */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs font-mono">
          ⚠️ Backtest Error: {error}
        </div>
      )}

      {/* Backtest Results */}
      {result && (
        <div className="space-y-6">
          {/* Out-of-Sample Scorecards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur">
              <span className="text-[11px] text-zinc-400 uppercase font-mono">
                Out-of-Sample Return
              </span>
              <div
                className={`text-2xl font-bold mt-1 font-mono ${
                  result.test.totalReturn >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {result.test.totalReturn >= 0 ? "+" : ""}
                {result.test.totalReturn.toFixed(2)}%
              </div>
              <span className="text-[11px] text-zinc-500 font-mono">
                vs Buy & Hold: {result.buyAndHold.totalReturn.toFixed(2)}%
              </span>
            </div>

            <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur">
              <span className="text-[11px] text-zinc-400 uppercase font-mono">
                Sharpe Ratio
              </span>
              <div className="text-2xl font-bold text-cyan-400 mt-1 font-mono">
                {result.test.sharpeRatio.toFixed(2)}
              </div>
              <span className="text-[11px] text-zinc-500 font-mono">
                Risk-adjusted score
              </span>
            </div>

            <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur">
              <span className="text-[11px] text-zinc-400 uppercase font-mono">
                Max Drawdown
              </span>
              <div className="text-2xl font-bold text-rose-400 mt-1 font-mono">
                -{Math.abs(result.test.maxDrawdown).toFixed(2)}%
              </div>
              <span className="text-[11px] text-zinc-500 font-mono">
                Peak to trough
              </span>
            </div>

            <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur">
              <span className="text-[11px] text-zinc-400 uppercase font-mono">
                Win Rate / Trades
              </span>
              <div className="text-2xl font-bold text-indigo-400 mt-1 font-mono">
                {result.test.winRate.toFixed(1)}%
              </div>
              <span className="text-[11px] text-zinc-500 font-mono">
                {result.test.totalTrades} total executions
              </span>
            </div>
          </div>

          {/* Verdict Banner */}
          <div
            className={`p-4 rounded-xl flex items-center justify-between border ${
              result.beatsHold
                ? "bg-emerald-950/30 border-emerald-800/50 text-emerald-300"
                : "bg-amber-950/30 border-amber-800/50 text-amber-300"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">{result.beatsHold ? "🏆" : "⚠️"}</span>
              <span className="text-xs font-mono font-semibold">
                {result.beatsHold
                  ? "STRATEGY OUTPERFORMS: Strategy generated superior risk-adjusted return compared to Buy & Hold on out-of-sample data."
                  : "BUY & HOLD OUTPERFORMS: Buy and hold benchmark exceeded strategy Sharpe ratio. Adjust parameters or wait for regime shift."}
              </span>
            </div>
            <span className="text-[11px] px-2 py-0.5 rounded font-mono font-bold bg-zinc-900 border border-zinc-700">
              {result.beatsHold ? "ALPHA GENERATED" : "NEEDS TUNING"}
            </span>
          </div>

          {/* Equity Chart Comparison */}
          {chartData.length > 0 && (
            <div className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-200">
                  Out-of-Sample Equity Trajectory vs Buy & Hold
                </h2>
                <div className="flex items-center gap-4 text-xs font-mono">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
                    <span className="text-cyan-300">Strategy</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                    <span className="text-amber-300">Buy & Hold</span>
                  </div>
                </div>
              </div>

              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis
                      dataKey="date"
                      stroke="#71717a"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="#71717a"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      domain={["auto", "auto"]}
                      tickFormatter={(val) => `$${Number(val).toLocaleString()}`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#09090b",
                        borderColor: "#27272a",
                        borderRadius: "8px",
                        fontSize: "12px",
                        color: "#f4f4f5",
                      }}
                      formatter={(val: any) => [`$${Number(val).toFixed(2)}`, ""]}
                    />
                    <Line
                      type="monotone"
                      dataKey="strategyEquity"
                      stroke="#06b6d4"
                      strokeWidth={2}
                      dot={false}
                      name="Strategy"
                    />
                    <Line
                      type="monotone"
                      dataKey="buyAndHoldEquity"
                      stroke="#f59e0b"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      dot={false}
                      name="Buy & Hold"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
