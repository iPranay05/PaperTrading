// Run with:  npm run test:backtest   (Node >= 22.18, or add --experimental-strip-types on 22.6–22.17)
import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanBars,
  simulateSignals,
  runBacktest,
  runBuyAndHold,
  evaluateVerdict,
  fetchHistoricalData,
  periodsPerYear,
} from "../src/lib/backtest/engine.ts";

// ---------- helpers ----------
const dateOf = (i) => new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().split("T")[0];
function makeBars(closes, { spread = 0, volume = 1000 } = {}) {
  return closes.map((c, i) => ({
    date: dateOf(i), open: c, high: c + spread, low: c - spread, close: c, volume,
  }));
}
const cfg = (over = {}) => ({
  strategy: "sma_crossover", symbol: "TEST", market: "stock",
  startDate: "2024-01-01", endDate: "2025-01-01",
  initialCapital: 100_000, feeRate: 0, slippageBps: 0, trainTestSplit: 0.7, ...over,
});
const sig = (action, i, price, stopLoss, takeProfit) => ({
  strategy: "sma_crossover", action, confidence: 1, entryPrice: price,
  stopLoss, takeProfit, params: {}, reasoning: "test", barIndex: i,
});
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

// ---------- 1. short cash accounting & equity valuation ----------
test("profitable short: cash and equity move the right way", () => {
  const data = makeBars([100, 100, 95, 90, 90]);
  // short at bar 1 (100), stop 110 => risk 10/unit, 1% of 100k = 1000 => 100 units
  const m = simulateSignals(cfg(), data, [sig("sell", 1, 100, 110)]);
  const t = m.trades[0];
  assert.equal(t.side, "sell");
  assert.equal(t.quantity, 100);
  near(t.pnl, 1000);                       // (100-90)*100
  // marked-to-market: price 95 => +500, price 90 => +1000 (a long-style valuation would give -500/-1000)
  near(m.equityCurve[2].equity, 100_500);
  near(m.equityCurve[3].equity, 101_000);
  near(m.equityCurve.at(-1).equity, 101_000);
  near(m.totalReturn, 0.01);
});

test("losing short stopped out realises a loss", () => {
  const data = makeBars([100, 100, 105, 112, 112], { spread: 1 });
  const m = simulateSignals(cfg(), data, [sig("sell", 1, 100, 110)]);
  const t = m.trades[0];
  assert.equal(t.exitReason, "stop-loss");
  near(t.exitPrice, 110);
  near(t.pnl, -1000);
  near(m.equityCurve.at(-1).equity, 99_000);
});

test("short with fees & slippage: pnl and final equity agree exactly", () => {
  const data = makeBars([100, 100, 90, 90]);
  const c = cfg({ feeRate: 0.001, slippageBps: 10 });
  const m = simulateSignals(c, data, [sig("sell", 1, 100, 110)]);
  const t = m.trades[0];
  near(m.equityCurve.at(-1).equity, c.initialCapital + t.pnl, 1e-6); // every cost reaches equity
  assert.ok(t.fees > 0);
  // entry fee must be part of the trade's net pnl
  const gross = (t.entryPrice - t.exitPrice) * t.quantity;
  near(t.pnl, gross - t.fees, 1e-6);
});

test("long: equity = initial + net pnl, entry fee included", () => {
  const data = makeBars([100, 100, 110, 110]);
  const c = cfg({ feeRate: 0.001, slippageBps: 5 });
  const m = simulateSignals(c, data, [sig("buy", 1, 100, 90)]);
  const t = m.trades[0];
  near(m.equityCurve.at(-1).equity, c.initialCapital + t.pnl, 1e-6);
});

test("position never exceeds available cash (no accidental leverage)", () => {
  const data = makeBars([100, 100, 100, 100]);
  // tiny stop distance would imply a huge size under pure 1% risk sizing
  const m = simulateSignals(cfg(), data, [sig("buy", 1, 100, 99.99)]);
  assert.ok(m.trades[0].quantity * 100 <= 100_000 + 1e-6);
});

// ---------- 2. signal matching ----------
test("duplicate closes: signal fires on its own bar, not the first bar with that close", () => {
  const data = makeBars([100, 100, 100, 100, 100, 100, 100]);
  const m = simulateSignals(cfg(), data, [sig("buy", 4, 100, 90)]);
  assert.equal(m.trades.length, 1);
  assert.equal(m.trades[0].entryDate, dateOf(4));
});

test("signals work when close prices repeat across the whole series (old code found nothing/wrong bar)", () => {
  const closes = [...Array(60).fill(100), ...Array(60).fill(120)];
  const data = makeBars(closes, { spread: 0.5 });
  const m = simulateSignals(cfg(), data, [sig("buy", 100, 120, 110)]);
  assert.equal(m.trades[0].entryDate, dateOf(100));
});

test("backtest over 5000 bars is fast (signal lookup is O(1), ATR computed once)", () => {
  const closes = Array.from({ length: 5000 }, (_, i) => 100 + 10 * Math.sin(i / 15) + i * 0.01);
  const data = makeBars(closes, { spread: 1, volume: 1000 });
  const t0 = performance.now();
  runBacktest(cfg({ strategy: "rsi_reversion" }), data);
  runBacktest(cfg({ strategy: "sma_crossover" }), data);
  runBacktest(cfg({ strategy: "breakout" }), data);
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `took ${ms.toFixed(0)}ms`);
});

test("test segment is warmed up by earlier bars (SMA50 works inside a short test window)", () => {
  // 70 bars falling then 50 rising: death cross early, golden cross around bar ~85
  const closes = [...Array.from({ length: 70 }, (_, i) => 200 - i), ...Array.from({ length: 50 }, (_, i) => 131 + i * 2)];
  const data = makeBars(closes, { spread: 1 });
  const c = cfg();
  const start = 80;
  const warm = runBacktest(c, data, { start, end: data.length });
  const cold = runBacktest(c, data.slice(start)); // old behaviour: indicators restart at the split
  assert.ok(warm.trades.length >= 1, "warmed-up segment should catch the crossover");
  assert.equal(cold.trades.length, 0, "cold-start SMA50 cannot signal inside 40 bars");
});

// ---------- 3. bad data ----------
test("cleanBars drops null/zero/NaN bars instead of turning them into 0", () => {
  const out = cleanBars([
    { date: "2024-01-01", open: 10, high: 11, low: 9, close: 10, volume: 5 },
    { date: "2024-01-02", open: null, high: null, low: null, close: null, volume: null },
    { date: "2024-01-03", open: 0, high: 0, low: 0, close: 0, volume: 0 },
    { date: "2024-01-04", open: 10, high: NaN, low: 9, close: 10.5, volume: undefined },
    { date: "2024-01-05", open: undefined, high: 12, low: 10, close: 11, volume: 3 },
  ]);
  assert.deepEqual(out.map((b) => b.date), ["2024-01-01", "2024-01-04", "2024-01-05"]);
  for (const b of out) {
    for (const k of ["open", "high", "low", "close"]) assert.ok(b[k] > 0, `${k} must be > 0`);
    assert.ok(b.high >= Math.max(b.open, b.close) && b.low <= Math.min(b.open, b.close));
  }
  assert.equal(out[1].volume, 0);
});

test("cleanBars sorts and de-duplicates by date", () => {
  const out = cleanBars([
    { date: "2024-01-03", close: 3 }, { date: "2024-01-01", close: 1 }, { date: "2024-01-01", close: 2 },
  ]);
  assert.deepEqual(out.map((b) => [b.date, b.close]), [["2024-01-01", 2], ["2024-01-03", 3]]);
});

test("Yahoo response with null bars produces no zero prices", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      chart: { result: [{
        timestamp: [1704067200, 1704153600, 1704240000, 1704326400],
        indicators: { quote: [{
          open: [10, null, 11, 12], high: [11, null, 12, 13], low: [9, null, 10, 11],
          close: [10.5, null, 11.5, 12.5], volume: [100, null, 200, 300],
        }] },
      }] },
    }),
  });
  try {
    const bars = await fetchHistoricalData("RELIANCE.NS", "stock", "2024-01-01", "2024-01-10");
    assert.equal(bars.length, 3);
    assert.ok(bars.every((b) => b.close > 0 && b.low > 0));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Binance paging returns the most recent bars, not just the first 1000", async () => {
  const realFetch = globalThis.fetch;
  const DAY = 86_400_000;
  const t0 = Date.UTC(2021, 0, 1);
  const total = 1500;
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    const from = Number(u.searchParams.get("startTime"));
    const rows = [];
    for (let i = 0; i < total && rows.length < 1000; i++) {
      const open = t0 + i * DAY;
      if (open >= from) rows.push([open, "100", "101", "99", String(100 + i), "10"]);
    }
    return { ok: true, json: async () => rows };
  };
  try {
    const bars = await fetchHistoricalData("BTC/USDT", "crypto", "2021-01-01", "2030-01-01");
    assert.equal(bars.length, total);
    assert.equal(bars.at(-1).close, 100 + total - 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------- 4. annualisation ----------
test("crypto annualises with sqrt(365), stocks with sqrt(252)", () => {
  assert.equal(periodsPerYear("crypto"), 365);
  assert.equal(periodsPerYear("stock"), 252);
  const closes = Array.from({ length: 200 }, (_, i) => 100 + i * 0.3 + Math.sin(i) * 2);
  const data = makeBars(closes);
  const s = runBuyAndHold(data, 1_000_000, "stock");
  const c = runBuyAndHold(data, 1_000_000, "crypto");
  near(c.sharpeRatio / s.sharpeRatio, Math.sqrt(365 / 252), 1e-6);
});

test("buy-and-hold on an expensive coin is not sized to zero units", () => {
  const data = makeBars([60_000, 63_000, 66_000]);
  const bh = runBuyAndHold(data, 10_000, "crypto");
  assert.ok(bh.totalReturn > 0.09 && bh.totalReturn < 0.11, `got ${bh.totalReturn}`);
});

test("crypto strategies can size fractional positions", () => {
  const data = makeBars([60_000, 60_000, 63_000, 63_000]);
  const m = simulateSignals(cfg({ market: "crypto", initialCapital: 10_000 }), data, [sig("buy", 1, 60_000, 57_000)]);
  assert.equal(m.trades.length, 1);
  assert.ok(m.trades[0].quantity > 0 && m.trades[0].quantity < 1);
});

test("equity curves are one point per bar and align with buy-and-hold", () => {
  const data = makeBars(Array.from({ length: 50 }, (_, i) => 100 + i));
  const m = simulateSignals(cfg(), data, [], { start: 10, end: 50 });
  const bh = runBuyAndHold(data.slice(10), 100_000);
  assert.equal(m.equityCurve.length, 40);
  assert.equal(bh.equityCurve.length, 40);
  assert.equal(m.equityCurve[0].date, bh.equityCurve[0].date);
});

// ---------- 5. beats-buy-and-hold verdict ----------
const flat = { totalReturn: 0, sharpeRatio: 0, maxDrawdown: 0, winRate: 0, totalTrades: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, equityCurve: [] };
const fallingHold = { ...flat, totalReturn: -0.25, sharpeRatio: -1.4, totalTrades: 1 };

test("never-trading strategy does NOT beat a falling buy-and-hold", () => {
  const v = evaluateVerdict(flat, fallingHold, 300);
  assert.equal(v.beatsHold, false);
  assert.equal(v.status, "insufficient_evidence");
});

test("too-short test window can never pass, however good the numbers", () => {
  const great = { ...flat, totalReturn: 0.5, sharpeRatio: 3, totalTrades: 40 };
  const v = evaluateVerdict(great, fallingHold, 54);
  assert.equal(v.beatsHold, false);
  assert.equal(v.status, "insufficient_evidence");
  assert.match(v.reasons[0], /54 bars/);
});

test("losing less than a falling market is not an edge", () => {
  const losing = { ...flat, totalReturn: -0.05, sharpeRatio: -0.2, totalTrades: 20 };
  const v = evaluateVerdict(losing, fallingHold, 300);
  assert.equal(v.beatsHold, false);
  assert.equal(v.status, "underperforms");
});

test("profitable strategy with enough trades and bars beats buy-and-hold", () => {
  const good = { ...flat, totalReturn: 0.12, sharpeRatio: 1.1, totalTrades: 18 };
  const v = evaluateVerdict(good, fallingHold, 300);
  assert.equal(v.beatsHold, true);
  assert.equal(v.status, "outperforms");
});

test("must beat buy-and-hold on return AND sharpe in a rising market", () => {
  const rising = { ...flat, totalReturn: 0.4, sharpeRatio: 1.5, totalTrades: 1 };
  const ok = { ...flat, totalReturn: 0.1, sharpeRatio: 2.0, totalTrades: 15 }; // better Sharpe, lower return
  assert.equal(evaluateVerdict(ok, rising, 300).beatsHold, false);
});

test("thresholds are configurable", () => {
  const good = { ...flat, totalReturn: 0.12, sharpeRatio: 1.1, totalTrades: 4 };
  assert.equal(evaluateVerdict(good, fallingHold, 300).beatsHold, false);
  assert.equal(evaluateVerdict(good, fallingHold, 300, { minTrades: 3 }).beatsHold, true);
});

// ---------- 6. walk-forward: parameters are really fitted on train only ----------
import { fitParameters, runWalkForward, PARAM_GRIDS } from "../src/lib/backtest/engine.ts";

function wavy(n, seed = 1) {
  let x = seed;
  const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647) - 0.5;
  return Array.from({ length: n }, (_, i) => 100 + 12 * Math.sin(i / 9) + 6 * Math.sin(i / 31) + i * 0.02 + rnd() * 2);
}

test("fitParameters picks from the grid and reports candidates tried", () => {
  const data = makeBars(wavy(600), { spread: 1.5, volume: 1000 });
  const fit = fitParameters(cfg({ strategy: "sma_crossover" }), data, 420, 3);
  assert.equal(fit.fitted, true);
  assert.ok(fit.params.shortPeriod < fit.params.longPeriod);
  assert.ok(fit.candidatesTried >= 6 && fit.candidatesTried <= PARAM_GRIDS.sma_crossover.length);
});

test("fitting never looks at bars after the training cut-off (no look-ahead)", () => {
  const base = wavy(600);
  const tampered = base.map((c, i) => (i >= 420 ? c * 5 + 300 * Math.sin(i) : c)); // wreck the future
  const a = fitParameters(cfg(), makeBars(base, { spread: 1.5 }), 420, 3);
  const b = fitParameters(cfg(), makeBars(tampered, { spread: 1.5 }), 420, 3);
  assert.deepEqual(a.params, b.params);
  near(a.inSample.sharpeRatio, b.inSample.sharpeRatio);
});

test("walk-forward: folds are consecutive, non-overlapping, and each is fitted only on earlier data", () => {
  const data = makeBars(wavy(900, 7), { spread: 1.5, volume: 1000 });
  const r = runWalkForward(cfg({ strategy: "rsi_reversion", walkForwardFolds: 3 }), data);
  assert.equal(r.folds.length, 3);
  for (let i = 0; i < r.folds.length; i++) {
    const f = r.folds[i];
    assert.ok(f.trainEnd < f.testStart, "train must end before test starts");
    if (i > 0) {
      assert.ok(r.folds[i - 1].testEnd < f.testStart, "folds must not overlap");
      assert.ok(f.trainBars > r.folds[i - 1].trainBars, "training window expands");
    }
  }
  const covered = r.folds.reduce((s, f) => s + f.testBars, 0);
  assert.equal(r.test.equityCurve.length, covered);
  assert.equal(r.test.equityCurve.length, r.buyAndHold.equityCurve.length); // chart alignment
});

test("walk-forward: stitched equity is continuous (capital carries across folds)", () => {
  const data = makeBars(wavy(900, 3), { spread: 1.5, volume: 1000 });
  const r = runWalkForward(cfg({ walkForwardFolds: 3 }), data);
  const eq = r.test.equityCurve.map((p) => p.equity);
  const net = r.test.trades.reduce((s, t) => s + t.pnl, 0);
  near(eq.at(-1), 100_000 + net, 1e-4 * 100_000); // chained curve ends where summed trade pnl says
});

test("explicit params disable fitting", () => {
  const data = makeBars(wavy(700, 5), { spread: 1.5 });
  const r = runWalkForward(cfg({ params: { shortPeriod: 8, longPeriod: 40 }, walkForwardFolds: 2 }), data);
  assert.equal(r.paramsFitted, false);
  assert.ok(r.folds.every((f) => f.chosenParams.shortPeriod === 8));
});
