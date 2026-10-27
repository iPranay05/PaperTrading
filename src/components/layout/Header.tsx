"use client";

import React, { useState, useEffect } from "react";

interface HeaderProps {
  onRefresh?: () => void;
}

export default function Header({ onRefresh }: HeaderProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [regime, setRegime] = useState("ranging");
  const [equity, setEquity] = useState<number>(0);
  const [loadingKill, setLoadingKill] = useState(false);

  async function fetchStatus() {
    try {
      const res = await fetch("/api/agent");
      if (res.ok) {
        const data = await res.json();
        setIsRunning(data.isRunning);
        setKillSwitchActive(data.state?.killSwitch ?? false);
        setRegime(data.state?.currentRegime ?? "ranging");
        setEquity(data.state?.currentEquity ?? 0);
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 4000);
    return () => clearInterval(interval);
  }, []);

  async function handleToggleKillSwitch() {
    const confirmText = killSwitchActive
      ? "Do you want to deactivate the kill switch and allow the agent to trade?"
      : "EMERGENCY: Are you sure you want to trigger the KILL SWITCH? This will immediately halt the agent, cancel all open orders, and close active positions!";

    if (!window.confirm(confirmText)) return;

    setLoadingKill(true);
    try {
      const res = await fetch("/api/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: killSwitchActive ? "deactivate" : "activate" }),
      });
      if (res.ok) {
        const data = await res.json();
        setKillSwitchActive(data.killSwitchActive);
        if (data.killSwitchActive) setIsRunning(false);
        if (onRefresh) onRefresh();
      }
    } catch (err) {
      alert("Error toggling kill switch: " + err);
    } finally {
      setLoadingKill(false);
    }
  }

  return (
    <header className="h-16 bg-zinc-950/80 backdrop-blur border-b border-zinc-800/80 px-6 flex items-center justify-between sticky top-0 z-40">
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 text-white font-bold text-sm">
            AI
          </div>
          <div>
            <span className="font-bold text-zinc-100 tracking-tight text-sm">
              ALPHA-AGENT
            </span>
            <span className="text-[10px] text-zinc-400 block font-mono">
              Autonomous Trader
            </span>
          </div>
        </div>

        {/* Status Pills */}
        <div className="hidden sm:flex items-center space-x-2 pl-4 border-l border-zinc-800">
          <span
            className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-medium font-mono ${
              killSwitchActive
                ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                : isRunning
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                : "bg-zinc-800 text-zinc-300 border border-zinc-700"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                killSwitchActive
                  ? "bg-rose-500 animate-pulse"
                  : isRunning
                  ? "bg-emerald-400 animate-pulse"
                  : "bg-zinc-500"
              }`}
            ></span>
            <span>
              {killSwitchActive
                ? "KILL SWITCH ACTIVE"
                : isRunning
                ? "AGENT RUNNING"
                : "AGENT IDLE"}
            </span>
          </span>

          <span className="bg-zinc-900 border border-zinc-800 text-zinc-300 px-2.5 py-1 rounded-full text-xs font-mono capitalize">
            Regime:{" "}
            <strong className="text-cyan-400">
              {regime.replace("_", " ")}
            </strong>
          </span>
        </div>
      </div>

      <div className="flex items-center space-x-4">
        {/* Equity display */}
        <div className="hidden md:flex flex-col items-end font-mono">
          <span className="text-[11px] text-zinc-400 uppercase tracking-wider">
            Simulated Portfolio
          </span>
          <span className="text-sm font-bold text-zinc-100">
            ₹{equity.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        {/* Emergency Kill Switch */}
        <button
          onClick={handleToggleKillSwitch}
          disabled={loadingKill}
          className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg font-mono text-xs font-semibold tracking-wide transition-all shadow-md active:scale-95 ${
            killSwitchActive
              ? "bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/30 ring-2 ring-amber-400"
              : "bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white shadow-red-600/30 ring-1 ring-red-500/50 hover:shadow-red-600/50"
          }`}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span>{killSwitchActive ? "RESET KILL SWITCH" : "KILL SWITCH"}</span>
        </button>
      </div>
    </header>
  );
}
