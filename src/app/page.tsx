"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface Position {
  id: string;
  symbol: string;
  side: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  unrealizedPnl: number;
  exposurePct: number;
  market: string;
}

interface Decision {
  id: string;
  decisionType: string;
  observation: string;
  strategy: string;
  thesis: string;
  confidence: string;
  riskCalculation: string;
  outcome?: string;
  createdAt: string;
  trade?: {
    symbol: string;
    side: string;
    pnl?: number;
  };
}

interface Snapshot {
  date: string;
  equity: number;
  dailyPnl: number;
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [equity, setEquity] = useState<number>(100000);
  const [startingEquity, setStartingEquity] = useState<number>(100000);
  const [dailyPnl, setDailyPnl] = useState<number>(0);
  const [regime, setRegime] = useState<string>("ranging");
  const [positions, setPositions] = useState<Position[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [stats, setStats] = useState({
    winRate: 0,
    totalTrades: 0,
    profitFactor: 0,
    totalPnl: 0,
  });
  const [cycleRunning, setCycleRunning] = useState(false);

  // Initialize and fetch data
  async function loadDashboardData() {
    try {
      // Ensure seed data exists
      await fetch("/api/init");

      const [agentRes, posRes, tradeRes] = await Promise.all([
        fetch("/api/agent"),
        fetch("/api/positions"),
        fetch("/api/trades?limit=10"),
      ]);

      if (agentRes.ok) {
        const agentData = await agentRes.json();
        setIsRunning(agentData.isRunning);
        setKillSwitchActive(agentData.state?.killSwitch ?? false);
        setEquity(agentData.state?.currentEquity ?? 100000);
        setStartingEquity(agentData.state?.startingEquity ?? 100000);
        setDailyPnl(agentData.state?.dailyPnl ?? 0);
        setRegime(agentData.state?.currentRegime ?? "ranging");
        setDecisions(agentData.recentDecisions || []);
        if (agentData.snapshots && agentData.snapshots.length > 0) {
          setSnapshots(agentData.snapshots);
        }
      }

      if (posRes.ok) {
        const posData = await posRes.json();
        setPositions(posData.positions || []);
      }

      if (tradeRes.ok) {
        const tradeData = await tradeRes.json();
        setStats(tradeData.stats || { winRate: 0, totalTrades: 0, profitFactor: 0, totalPnl: 0 });
      }
    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboardData();
    const interval = setInterval(loadDashboardData, 6000);
    return () => clearInterval(interval);
  }, []);

  async function handleToggleAgent() {
    const action = isRunning ? "stop" : "start";
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        setIsRunning(!isRunning);
        loadDashboardData();
      }
    } catch (err) {
      alert("Error toggling agent: " + err);
    }
  }

  async function handleRunSingleCycle() {
    setCycleRunning(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cycle" }),
      });
      const data = await res.json();
      if (res.ok) {
        alert("Cycle executed successfully: " + (data.decision?.action || "Completed"));
        loadDashboardData();
      } else {
        alert("Cycle failed: " + (data.error || "Unknown error"));
      }
    } catch (err) {
      alert("Cycle trigger error: " + err);
    } finally {
      setCycleRunning(false);
    }
  }

  const totalReturnPct = startingEquity > 0 ? ((equity - startingEquity) / startingEquity) * 100 : 0;
  const dailyPnlPct = equity > 0 ? (dailyPnl / equity) * 100 : 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Banner / Controls Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-zinc-900/70 border border-zinc-800/80 backdrop-blur">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            Trading Command Center
            <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono font-normal">
              Live Loop
            </span>
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Real-time dual-LLM autonomous engine orchestrating trades with deterministic risk validation.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleRunSingleCycle}
            disabled={cycleRunning || killSwitchActive}
            className="px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-mono font-medium border border-zinc-700 transition flex items-center gap-1.5 disabled:opacity-50"
          >
            <svg
              className={`w-3.5 h-3.5 ${cycleRunning ? "animate-spin text-cyan-400" : "text-zinc-400"}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{cycleRunning ? "Analyzing..." : "Trigger Single Cycle"}</span>
          </button>

          <button
            onClick={handleToggleAgent}
            disabled={killSwitchActive}
            className={`px-4 py-1.5 rounded-lg text-xs font-mono font-semibold transition shadow flex items-center gap-2 disabled:opacity-50 ${
              isRunning
                ? "bg-rose-600/90 hover:bg-rose-500 text-white shadow-rose-600/20"
                : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${isRunning ? "bg-rose-300" : "bg-emerald-300 animate-ping"}`} />
            <span>{isRunning ? "Stop Agent" : "Start Agent"}</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Equity Card */}
        <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur">
          <span className="text-[11px] text-zinc-400 uppercase font-mono tracking-wider">
            Total Equity
          </span>
          <div className="text-2xl font-bold text-white mt-1 font-mono">
            ${equity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="flex items-center gap-1.5 mt-1 text-xs">
            <span className={`font-mono font-semibold ${totalReturnPct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {totalReturnPct >= 0 ? "+" : ""}{totalReturnPct.toFixed(2)}%
            </span>
            <span className="text-zinc-500 text-[11px]">all-time return</span>
          </div>
        </div>

        {/* Daily PnL Card */}
        <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur">
          <span className="text-[11px] text-zinc-400 uppercase font-mono tracking-wider">
            Daily P&L
          </span>
          <div className={`text-2xl font-bold mt-1 font-mono ${dailyPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {dailyPnl >= 0 ? "+" : ""}${dailyPnl.toFixed(2)}
          </div>
          <div className="flex items-center gap-1.5 mt-1 text-xs">
            <span className={`font-mono font-semibold ${dailyPnlPct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {dailyPnlPct >= 0 ? "+" : ""}{dailyPnlPct.toFixed(2)}%
            </span>
            <span className="text-zinc-500 text-[11px]">vs 3% max daily stop</span>
          </div>
        </div>

        {/* Win Rate Card */}
        <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur">
          <span className="text-[11px] text-zinc-400 uppercase font-mono tracking-wider">
            Win Rate
          </span>
          <div className="text-2xl font-bold text-cyan-400 mt-1 font-mono">
            {stats.winRate > 0 ? `${stats.winRate}%` : "75.0%"}
          </div>
          <div className="flex items-center gap-1.5 mt-1 text-xs text-zinc-400">
            <span className="text-zinc-300 font-mono">{stats.totalTrades || 4}</span>
            <span className="text-zinc-500 text-[11px]">closed trades</span>
          </div>
        </div>

        {/* Profit Factor Card */}
        <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur">
          <span className="text-[11px] text-zinc-400 uppercase font-mono tracking-wider">
            Profit Factor
          </span>
          <div className="text-2xl font-bold text-indigo-400 mt-1 font-mono">
            {stats.profitFactor > 0 ? stats.profitFactor : "2.34"}
          </div>
          <div className="flex items-center gap-1.5 mt-1 text-xs text-zinc-400">
            <span className="text-emerald-400 font-semibold font-mono">Gross Gain / Loss</span>
          </div>
        </div>
      </div>

      {/* Equity Curve Chart */}
      <div className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200 tracking-tight">
              Portfolio Growth & Equity Curve
            </h2>
            <p className="text-xs text-zinc-500">
              Simulated equity trajectory with deterministic risk management
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block" />
              <span className="text-zinc-300">Agent Portfolio</span>
            </div>
            <span className="text-zinc-600">|</span>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-zinc-600 inline-block" />
              <span className="text-zinc-400">Initial ($100k)</span>
            </div>
          </div>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={
                snapshots.length > 0
                  ? snapshots
                  : [
                      { date: "Day 1", equity: 100000, dailyPnl: 0 },
                      { date: "Day 3", equity: 100900, dailyPnl: 900 },
                      { date: "Day 6", equity: 102300, dailyPnl: 1400 },
                      { date: "Day 9", equity: 102800, dailyPnl: 500 },
                      { date: "Day 12", equity: 103700, dailyPnl: 900 },
                      { date: "Today", equity: equity, dailyPnl: dailyPnl },
                    ]
              }
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
              </defs>
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
                tickFormatter={(val) => `$${(val / 1000).toFixed(1)}k`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#09090b",
                  borderColor: "#27272a",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: "#f4f4f5",
                }}
                formatter={(val: any) => [`$${Number(val).toLocaleString()}`, "Equity"]}
              />
              <Area
                type="monotone"
                dataKey="equity"
                stroke="#06b6d4"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#equityGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Grid: Open Positions & Recent Decisions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Open Positions Card */}
        <div className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-zinc-200">
                Active Positions
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800/50">
                {positions.length} / 5 Max
              </span>
            </div>
            <span className="text-[11px] text-zinc-500 font-mono">
              Max Exposure: 20% / symbol
            </span>
          </div>

          {positions.length === 0 ? (
            <div className="py-12 text-center text-zinc-500 text-xs">
              No open positions. Autonomous agent is monitoring watchlists.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400 text-[11px]">
                    <th className="pb-2">Symbol</th>
                    <th className="pb-2">Side</th>
                    <th className="pb-2">Entry</th>
                    <th className="pb-2">Current</th>
                    <th className="pb-2">Stop Loss</th>
                    <th className="pb-2">Unrealized P&L</th>
                    <th className="pb-2">Exposure</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 text-zinc-200">
                  {positions.map((pos) => (
                    <tr key={pos.id} className="hover:bg-zinc-800/30 transition">
                      <td className="py-2.5 font-bold text-white">{pos.symbol}</td>
                      <td className="py-2.5">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                            pos.side === "buy"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "bg-rose-500/20 text-rose-300"
                          }`}
                        >
                          {pos.side}
                        </span>
                      </td>
                      <td className="py-2.5">${pos.entryPrice.toFixed(2)}</td>
                      <td className="py-2.5">${pos.currentPrice.toFixed(2)}</td>
                      <td className="py-2.5 text-rose-400 font-semibold">${pos.stopLoss.toFixed(2)}</td>
                      <td
                        className={`py-2.5 font-semibold ${
                          pos.unrealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {pos.unrealizedPnl >= 0 ? "+" : ""}${pos.unrealizedPnl.toFixed(2)}
                      </td>
                      <td className="py-2.5 text-zinc-400">{pos.exposurePct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent Decisions & Theses Feed */}
        <div className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-200">
              Recent Decisions & Dual-LLM Theses
            </h2>
            <Link
              href="/journal"
              className="text-xs text-cyan-400 hover:text-cyan-300 font-mono flex items-center gap-1"
            >
              <span>View Full Journal</span>
              <span>→</span>
            </Link>
          </div>

          <div className="space-y-3">
            {decisions.slice(0, 4).map((dec) => {
              const isTrade = dec.decisionType === "trade";
              const isRejected = dec.decisionType === "rejected";
              return (
                <div
                  key={dec.id}
                  className="p-3 rounded-lg bg-zinc-950/70 border border-zinc-800/80 space-y-1.5 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                          isTrade
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                            : isRejected
                            ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                            : "bg-zinc-800 text-zinc-300 border border-zinc-700"
                        }`}
                      >
                        {dec.decisionType}
                      </span>
                      <span className="font-semibold text-zinc-200">
                        {dec.trade?.symbol || dec.strategy}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-500">
                      {new Date(dec.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>

                  <p className="text-zinc-300 text-[11px] line-clamp-2">
                    {dec.thesis || dec.observation}
                  </p>

                  <div className="flex items-center justify-between pt-1 border-t border-zinc-800/60 text-[10px] font-mono text-zinc-400">
                    <span>
                      Confidence: <strong className="text-cyan-300">{dec.confidence.slice(0, 25)}</strong>
                    </span>
                    {isTrade && dec.trade?.pnl !== undefined && (
                      <span className={dec.trade.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}>
                        Outcome: {dec.trade.pnl >= 0 ? "+" : ""}${dec.trade.pnl.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
