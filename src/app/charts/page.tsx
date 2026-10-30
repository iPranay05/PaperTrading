"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ComposedChart,
  Line,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
} from "recharts";

interface Bar_ {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sma20: number | null;
  sma50: number | null;
}
interface TradeRow {
  id: string;
  side: string;
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number | null;
  status: string;
  exitPrice: number | null;
  pnl: number | null;
  createdAt: string;
  closedAt: string | null;
}
interface ChartResponse {
  symbol: string;
  market: "stock" | "crypto";
  bars: Bar_[];
  trades: TradeRow[];
  last: number;
  change: number;
  changePct: number;
}

const PRESETS = ["RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS", "TATAMOTORS.NS", "AAPL", "NVDA", "BTC/USDT", "ETH/USDT", "SOL/USDT"];
const RANGES = [
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "2Y", days: 730 },
];
const UP = "#10b981";
const DOWN = "#f43f5e";

interface CandleProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: Bar_;
}

// Candlestick drawn on a [low, high] bar: the bar's box is the wick range, the body is placed inside it.
function Candle({ x = 0, y = 0, width = 0, height = 0, payload }: CandleProps) {
  if (!payload) return null;
  const { open, close, high, low } = payload;
  const color = close >= open ? UP : DOWN;
  const range = high - low;
  const scale = range > 0 ? height / range : 0;
  const bodyTop = y + (high - Math.max(open, close)) * scale;
  const bodyH = Math.max(1, Math.abs(close - open) * scale);
  const cx = x + width / 2;
  return (
    <g>
      <line x1={cx} x2={cx} y1={y} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={x + width * 0.15} y={bodyTop} width={Math.max(1, width * 0.7)} height={bodyH} fill={color} />
    </g>
  );
}

function fmt(n: number, market: string) {
  const d = n >= 1000 ? 0 : n >= 1 ? 2 : 4;
  return (market === "crypto" ? "$" : "") + n.toLocaleString(undefined, { maximumFractionDigits: d });
}

export default function ChartsPage() {
  const [symbol, setSymbol] = useState("RELIANCE.NS");
  const [input, setInput] = useState("RELIANCE.NS");
  const [days, setDays] = useState(180);
  const [showSma, setShowSma] = useState(true);
  const [showTrades, setShowTrades] = useState(true);
  const [data, setData] = useState<ChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}&days=${days}`, { signal: controller.signal });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load chart");
        setData(json);
      } catch (err) {
        if (controller.signal.aborted) return;
        setData(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 0);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [symbol, days]);

  const chartData = useMemo(
    () => (data?.bars ?? []).map((b) => ({ ...b, wick: [b.low, b.high] as [number, number] })),
    [data]
  );

  const [yMin, yMax] = useMemo(() => {
    if (!data || data.bars.length === 0) return [0, 1];
    const lo = Math.min(...data.bars.map((b) => b.low));
    const hi = Math.max(...data.bars.map((b) => b.high));
    const pad = (hi - lo) * 0.05 || hi * 0.01;
    return [lo - pad, hi + pad];
  }, [data]);

  // Snap each trade to the bar of its entry date; ignore trades outside the visible window.
  const markers = useMemo(() => {
    if (!data) return [];
    const dates = new Set(data.bars.map((b) => b.date));
    return data.trades
      .map((t) => ({ ...t, date: t.createdAt.split("T")[0] }))
      .filter((t) => dates.has(t.date));
  }, [data]);

  const openTrades = data?.trades.filter((t) => t.status === "filled") ?? [];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const s = input.trim().toUpperCase();
    if (s) setSymbol(s);
  }

  const up = (data?.change ?? 0) >= 0;
  const tooltipStyle = { backgroundColor: "#09090b", borderColor: "#27272a", borderRadius: "8px", fontSize: "12px", color: "#f4f4f5" };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Price Charts</h1>
            <p className="text-xs text-zinc-400 mt-1">
              Real daily candles (Yahoo Finance for stocks, Binance for crypto) with SMA 20/50, volume and the agent&apos;s own entries.
            </p>
          </div>
          <form onSubmit={submit} className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. TCS.NS, AAPL, BTC/USDT"
              className="px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-700 text-sm text-white font-mono w-52 focus:outline-none focus:border-cyan-500"
            />
            <button type="submit" className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold">
              Load
            </button>
          </form>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => {
                setInput(p);
                setSymbol(p);
              }}
              className={`px-2.5 py-1 rounded-md text-[11px] font-mono border transition ${
                symbol === p ? "bg-cyan-950 border-cyan-700 text-cyan-300" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-300">
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r.label}
                onClick={() => setDays(r.days)}
                className={`px-2.5 py-1 rounded-md font-mono border ${
                  days === r.days ? "bg-zinc-700 border-zinc-600 text-white" : "bg-zinc-900 border-zinc-800 text-zinc-400"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showSma} onChange={(e) => setShowSma(e.target.checked)} /> SMA 20 / 50
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showTrades} onChange={(e) => setShowTrades(e.target.checked)} /> Agent trades
          </label>
        </div>
      </div>

      {error && <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-900/50 text-rose-300 text-sm">{error}</div>}
      {loading && !data && <div className="p-8 text-center text-zinc-500 text-sm font-mono">Loading {symbol}…</div>}

      {data && (
        <div className={`p-5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur space-y-3 ${loading ? "opacity-60" : ""}`}>
          <div className="flex items-baseline gap-3">
            <span className="text-lg font-bold text-white font-mono">{data.symbol}</span>
            <span className="text-2xl font-bold text-white font-mono">{fmt(data.last, data.market)}</span>
            <span className={`text-sm font-mono ${up ? "text-emerald-400" : "text-rose-400"}`}>
              {up ? "+" : ""}
              {data.change.toFixed(2)} ({up ? "+" : ""}
              {data.changePct.toFixed(2)}%)
            </span>
            <span className="text-[11px] text-zinc-500 font-mono">daily · {data.bars.length} bars</span>
          </div>

          <div className="h-[380px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} syncId="px" margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="date" stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} minTickGap={50} />
                <YAxis
                  orientation="right"
                  domain={[yMin, yMax]}
                  stroke="#71717a"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: v >= 100 ? 0 : 2 })}
                  allowDataOverflow
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  content={({ active, payload }) => {
                    const b = payload?.[0]?.payload as Bar_ | undefined;
                    if (!active || !b) return null;
                    return (
                      <div style={tooltipStyle} className="p-2 border font-mono space-y-0.5">
                        <div className="text-zinc-400">{b.date}</div>
                        <div>O {fmt(b.open, data.market)} H {fmt(b.high, data.market)}</div>
                        <div>L {fmt(b.low, data.market)} C {fmt(b.close, data.market)}</div>
                        {b.sma20 != null && <div className="text-amber-400">SMA20 {fmt(b.sma20, data.market)}</div>}
                        {b.sma50 != null && <div className="text-violet-400">SMA50 {fmt(b.sma50, data.market)}</div>}
                      </div>
                    );
                  }}
                />
                <Bar dataKey="wick" shape={<Candle />} isAnimationActive={false} />
                {showSma && <Line type="monotone" dataKey="sma20" stroke="#f59e0b" dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />}
                {showSma && <Line type="monotone" dataKey="sma50" stroke="#8b5cf6" dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />}
                {showTrades &&
                  markers.map((t) => (
                    <ReferenceDot
                      key={t.id}
                      x={t.date}
                      y={t.entryPrice}
                      r={6}
                      fill={t.side === "buy" ? UP : DOWN}
                      stroke="#fff"
                      strokeWidth={1.5}
                      ifOverflow="extendDomain"
                    />
                  ))}
                {showTrades &&
                  openTrades.map((t) => (
                    <ReferenceLine key={`sl-${t.id}`} y={t.stopLoss} stroke={DOWN} strokeDasharray="4 4" label={{ value: "SL", fill: DOWN, fontSize: 10, position: "left" }} />
                  ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="h-[90px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} syncId="px" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                <XAxis dataKey="date" hide />
                <YAxis orientation="right" stroke="#71717a" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v))} />
                <Bar dataKey="volume" isAnimationActive={false}>
                  {chartData.map((b, i) => (
                    <Cell key={i} fill={b.close >= b.open ? UP : DOWN} fillOpacity={0.5} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-wrap gap-4 text-[11px] text-zinc-400 font-mono">
            <span><span className="text-amber-400">━</span> SMA 20</span>
            <span><span className="text-violet-400">━</span> SMA 50</span>
            <span><span className="text-emerald-400">●</span> agent buy</span>
            <span><span className="text-rose-400">●</span> agent sell</span>
            <span><span className="text-rose-400">╌</span> stop-loss of open trade</span>
            {data.trades.length === 0 && <span className="text-zinc-500">No agent trades for this symbol yet.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
