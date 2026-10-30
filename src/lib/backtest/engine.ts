// ============================================================
// Backtest Engine — SMA Crossover, RSI Mean-Reversion, Breakout
// Includes fees, slippage, train/test split, buy-and-hold comparison
//
// Design notes
//  * Bars are cleaned once (cleanBars) so no bar ever has a 0/NaN price.
//  * Signals carry the index of the bar that produced them (barIndex);
//    the simulator never searches for a bar by price.
//  * Indicators are computed on the FULL series and trading is restricted
//    to a [start, end) range. Train/test segments therefore get properly
//    warmed-up indicators without leaking future data (all indicators are
//    causal).
//  * Cash accounting: longs spend cash on entry, shorts receive proceeds.
//    Equity = cash + qty * close (long) or cash - qty * close (short).
// ============================================================

import type {
  BacktestConfig,
  BacktestMetrics,
  BacktestTrade,
  BacktestVerdict,
  MarketType,
  StrategyName,
  StrategySignal,
  WalkForwardFold,
} from "@/lib/types";

export interface OHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** A bar as delivered by a data vendor: any numeric field may be missing. */
export interface RawBar {
  date: string;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  volume?: number | null;
}

export interface BacktestRange {
  /** First bar index to trade (inclusive). */
  start: number;
  /** Last bar index to trade (exclusive). */
  end: number;
}

// ---- Constants ----
const RISK_PER_TRADE = 0.01; // risk 1% of equity per trade
export const DEFAULT_MIN_TEST_BARS = 100;
export const DEFAULT_MIN_TRADES = 10;

/** Crypto trades every day of the year; equities ~252 sessions. */
export function periodsPerYear(market: MarketType): number {
  return market === "crypto" ? 365 : 252;
}

// ---- Data hygiene ----
const isPrice = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * Turn raw vendor bars into clean OHLCV bars:
 *  - bars without a valid positive close are DROPPED (never turned into 0)
 *  - missing open/high/low fall back to the close
 *  - high/low are widened to contain open and close
 *  - missing/invalid volume becomes 0
 *  - bars are sorted by date and de-duplicated (last one wins)
 */
export function cleanBars(raw: RawBar[]): OHLCV[] {
  const byDate = new Map<string, OHLCV>();
  for (const r of raw) {
    if (!r || !r.date || !isPrice(r.close)) continue;
    const close = r.close;
    const open = isPrice(r.open) ? r.open : close;
    const high = Math.max(isPrice(r.high) ? r.high : close, open, close);
    const low = Math.min(isPrice(r.low) ? r.low : close, open, close);
    const volume =
      typeof r.volume === "number" && Number.isFinite(r.volume) && r.volume >= 0 ? r.volume : 0;
    byDate.set(r.date, { date: r.date, open, high, low, close, volume });
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ---- Technical Indicators (all causal: value at i uses only bars <= i) ----
function sma(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (i >= period) sum -= data[i - period];
    result.push(i < period - 1 ? null : sum / period);
  }
  return result;
}

function rsi(data: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      result.push(null);
      continue;
    }

    const change = data[i] - data[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);

    if (i < period) {
      result.push(null);
      continue;
    }

    const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;

    if (avgLoss === 0) {
      result.push(100);
    } else {
      const rs = avgGain / avgLoss;
      result.push(100 - 100 / (1 + rs));
    }
  }
  return result;
}

function atr(data: OHLCV[], period = 14): (number | null)[] {
  const result: (number | null)[] = [];
  const trueRanges: number[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      trueRanges.push(data[i].high - data[i].low);
      result.push(null);
      continue;
    }

    const tr = Math.max(
      data[i].high - data[i].low,
      Math.abs(data[i].high - data[i - 1].close),
      Math.abs(data[i].low - data[i - 1].close)
    );
    trueRanges.push(tr);

    if (i < period) {
      result.push(null);
    } else {
      result.push(trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period);
    }
  }
  return result;
}

/** ATR at bar i, falling back to 2% of price when ATR is unavailable or zero. */
function atrAt(atrValues: (number | null)[], data: OHLCV[], i: number): number {
  const v = atrValues[i];
  return v != null && v > 0 ? v : data[i].close * 0.02;
}

// ---- Strategy Implementations ----
// Every signal is stamped with barIndex so the simulator can place it exactly.

function smaCrossoverSignals(
  data: OHLCV[],
  atrValues: (number | null)[],
  shortPeriod = 10,
  longPeriod = 50
): StrategySignal[] {
  const closes = data.map((d) => d.close);
  const shortSMA = sma(closes, shortPeriod);
  const longSMA = sma(closes, longPeriod);
  const signals: StrategySignal[] = [];

  for (let i = 1; i < data.length; i++) {
    const prevShort = shortSMA[i - 1];
    const prevLong = longSMA[i - 1];
    const currShort = shortSMA[i];
    const currLong = longSMA[i];

    if (prevShort == null || prevLong == null || currShort == null || currLong == null) continue;

    // Golden cross — buy
    if (prevShort <= prevLong && currShort > currLong) {
      const currentAtr = atrAt(atrValues, data, i);
      signals.push({
        strategy: "sma_crossover",
        action: "buy",
        confidence: 0.6,
        entryPrice: data[i].close,
        stopLoss: data[i].close - 2 * currentAtr,
        takeProfit: data[i].close + 3 * currentAtr,
        params: { shortPeriod, longPeriod },
        reasoning: `SMA${shortPeriod} crossed above SMA${longPeriod} (golden cross)`,
        barIndex: i,
      });
    }

    // Death cross — sell
    if (prevShort >= prevLong && currShort < currLong) {
      signals.push({
        strategy: "sma_crossover",
        action: "sell",
        confidence: 0.6,
        entryPrice: data[i].close,
        stopLoss: data[i].close * 1.02,
        params: { shortPeriod, longPeriod },
        reasoning: `SMA${shortPeriod} crossed below SMA${longPeriod} (death cross)`,
        barIndex: i,
      });
    }
  }

  return signals;
}

function rsiReversionSignals(
  data: OHLCV[],
  atrValues: (number | null)[],
  period = 14,
  oversold = 30,
  overbought = 70
): StrategySignal[] {
  const closes = data.map((d) => d.close);
  const rsiValues = rsi(closes, period);
  const signals: StrategySignal[] = [];

  for (let i = 1; i < data.length; i++) {
    const prevRSI = rsiValues[i - 1];
    const currRSI = rsiValues[i];
    if (prevRSI == null || currRSI == null) continue;

    const currentAtr = atrAt(atrValues, data, i);

    // Oversold bounce — buy
    if (prevRSI <= oversold && currRSI > oversold) {
      signals.push({
        strategy: "rsi_reversion",
        action: "buy",
        confidence: 0.55,
        entryPrice: data[i].close,
        stopLoss: data[i].close - 1.5 * currentAtr,
        takeProfit: data[i].close + 2 * currentAtr,
        params: { period, oversold, overbought },
        reasoning: `RSI(${period}) bounced from oversold (${prevRSI.toFixed(1)} → ${currRSI.toFixed(1)})`,
        barIndex: i,
      });
    }

    // Overbought rejection — sell
    if (prevRSI >= overbought && currRSI < overbought) {
      signals.push({
        strategy: "rsi_reversion",
        action: "sell",
        confidence: 0.55,
        entryPrice: data[i].close,
        stopLoss: data[i].close + 1.5 * currentAtr,
        params: { period, oversold, overbought },
        reasoning: `RSI(${period}) rejected from overbought (${prevRSI.toFixed(1)} → ${currRSI.toFixed(1)})`,
        barIndex: i,
      });
    }
  }

  return signals;
}

function breakoutSignals(
  data: OHLCV[],
  atrValues: (number | null)[],
  lookback = 20,
  volumeMultiple = 1.5
): StrategySignal[] {
  const signals: StrategySignal[] = [];

  for (let i = lookback; i < data.length; i++) {
    let highestHigh = -Infinity;
    let lowestLow = Infinity;
    let volSum = 0;
    for (let j = i - lookback; j < i; j++) {
      if (data[j].high > highestHigh) highestHigh = data[j].high;
      if (data[j].low < lowestLow) lowestLow = data[j].low;
      volSum += data[j].volume;
    }
    const avgVolume = volSum / lookback;
    const currentAtr = atrAt(atrValues, data, i);
    const volRatio = avgVolume > 0 ? data[i].volume / avgVolume : 0;
    const volumeOk = data[i].volume > avgVolume * volumeMultiple;

    // Bullish breakout
    if (data[i].close > highestHigh && volumeOk) {
      signals.push({
        strategy: "breakout",
        action: "buy",
        confidence: 0.65,
        entryPrice: data[i].close,
        stopLoss: data[i].close - 2 * currentAtr,
        takeProfit: data[i].close + 3 * currentAtr,
        params: { lookback, volumeMultiple },
        reasoning: `Price broke above ${lookback}-day high ($${highestHigh.toFixed(2)}) on ${volRatio.toFixed(1)}x avg volume`,
        barIndex: i,
      });
    }

    // Bearish breakdown
    if (data[i].close < lowestLow && volumeOk) {
      signals.push({
        strategy: "breakout",
        action: "sell",
        confidence: 0.65,
        entryPrice: data[i].close,
        stopLoss: data[i].close + 2 * currentAtr,
        params: { lookback, volumeMultiple },
        reasoning: `Price broke below ${lookback}-day low ($${lowestLow.toFixed(2)}) on ${volRatio.toFixed(1)}x avg volume`,
        barIndex: i,
      });
    }
  }

  return signals;
}

// ---- Strategy Factory ----
export function getStrategySignals(
  name: StrategyName,
  data: OHLCV[],
  params?: Record<string, number>
): StrategySignal[] {
  const atrValues = atr(data); // computed once, not once per bar
  switch (name) {
    case "sma_crossover":
      return smaCrossoverSignals(data, atrValues, params?.shortPeriod, params?.longPeriod);
    case "rsi_reversion":
      return rsiReversionSignals(data, atrValues, params?.period, params?.oversold, params?.overbought);
    case "breakout":
      return breakoutSignals(data, atrValues, params?.lookback, params?.volumeMultiple);
    default:
      return [];
  }
}

// ---- Shared metric helpers ----
function roundQuantity(qty: number, market: MarketType): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  // Equities trade in whole shares; crypto is divisible (floor to 1e-6 so we never overspend).
  return market === "crypto" ? Math.floor(qty * 1e6) / 1e6 : Math.floor(qty);
}

function equityStats(
  curve: { date: string; equity: number }[],
  initialCapital: number,
  market: MarketType
): { totalReturn: number; sharpeRatio: number; maxDrawdown: number } {
  const finalEquity = curve.length > 0 ? curve[curve.length - 1].equity : initialCapital;
  const totalReturn = initialCapital > 0 ? (finalEquity - initialCapital) / initialCapital : 0;

  // Per-bar returns, the first measured against starting capital.
  const returns: number[] = [];
  let prev = initialCapital;
  for (const p of curve) {
    returns.push(prev > 0 ? (p.equity - prev) / prev : 0);
    prev = p.equity;
  }

  let sharpeRatio = 0;
  if (returns.length >= 2) {
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    const std = Math.sqrt(variance);
    sharpeRatio = std > 1e-12 ? (mean / std) * Math.sqrt(periodsPerYear(market)) : 0;
  }

  let peak = initialCapital;
  let maxDrawdown = 0;
  for (const point of curve) {
    if (point.equity > peak) peak = point.equity;
    const dd = peak > 0 ? (peak - point.equity) / peak : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return { totalReturn, sharpeRatio, maxDrawdown };
}

// ---- Simulator ----
interface OpenPosition {
  side: "buy" | "sell";
  entryPrice: number;
  quantity: number;
  entryDate: string;
  entryFee: number;
  stopLoss: number;
  takeProfit?: number;
}

/**
 * Simulate a list of signals over bars [range.start, range.end).
 * Signals are matched to bars by barIndex. Positions open flat at range.start and
 * are force-closed at the last bar of the range.
 */
export function simulateSignals(
  config: BacktestConfig,
  data: OHLCV[],
  signals: StrategySignal[],
  range?: BacktestRange
): BacktestMetrics {
  const start = Math.max(0, range?.start ?? 0);
  const end = Math.min(data.length, range?.end ?? data.length);
  const slip = config.slippageBps / 10000;

  // O(1) lookup of "which signal fires on bar i" (first one wins).
  const signalByBar = new Map<number, StrategySignal>();
  for (const s of signals) {
    if (s.barIndex == null || signalByBar.has(s.barIndex)) continue;
    signalByBar.set(s.barIndex, s);
  }

  let cash = config.initialCapital;
  const equityCurve: { date: string; equity: number }[] = [];
  const trades: BacktestTrade[] = [];
  let position: OpenPosition | null = null;

  /** Close the open position at rawPrice (before slippage) and settle cash. */
  const closePosition = (rawPrice: number, date: string, reason: BacktestTrade["exitReason"]) => {
    if (!position) return;
    const isLong = position.side === "buy";
    // Exiting a long means selling (worse = lower); exiting a short means buying back (worse = higher).
    const exitPrice = isLong ? rawPrice * (1 - slip) : rawPrice * (1 + slip);
    const exitFee = exitPrice * position.quantity * config.feeRate;

    if (isLong) {
      cash += position.quantity * exitPrice - exitFee;
    } else {
      cash -= position.quantity * exitPrice + exitFee;
    }

    const gross = (isLong ? exitPrice - position.entryPrice : position.entryPrice - exitPrice) * position.quantity;
    trades.push({
      entryDate: position.entryDate,
      exitDate: date,
      side: position.side,
      entryPrice: position.entryPrice,
      exitPrice,
      quantity: position.quantity,
      pnl: gross - position.entryFee - exitFee,
      fees: position.entryFee + exitFee,
      exitReason: reason,
    });
    position = null;
  };

  for (let i = start; i < end; i++) {
    const bar = data[i];

    // 1) Stop-loss / take-profit on the open position (stop wins if both are touched).
    if (position) {
      let exitPrice: number | null = null;
      let reason: BacktestTrade["exitReason"] = "stop-loss";

      if (position.side === "buy") {
        if (bar.low <= position.stopLoss) {
          exitPrice = position.stopLoss;
        } else if (position.takeProfit !== undefined && bar.high >= position.takeProfit) {
          exitPrice = position.takeProfit;
          reason = "take-profit";
        }
      } else {
        if (bar.high >= position.stopLoss) {
          exitPrice = position.stopLoss;
        } else if (position.takeProfit !== undefined && bar.low <= position.takeProfit) {
          exitPrice = position.takeProfit;
          reason = "take-profit";
        }
      }

      if (exitPrice !== null) closePosition(exitPrice, bar.date, reason);
    }

    // 2) New entry (only when flat; a position never opens and exits on the same bar).
    if (!position) {
      const signal = signalByBar.get(i);
      if (signal && (signal.action === "buy" || signal.action === "sell")) {
        const isLong = signal.action === "buy";
        const entryPrice = isLong ? signal.entryPrice * (1 + slip) : signal.entryPrice * (1 - slip);
        const stopOnCorrectSide = isLong ? signal.stopLoss < entryPrice : signal.stopLoss > entryPrice;

        if (stopOnCorrectSide && entryPrice > 0) {
          // Risk 1% of equity (flat => equity == cash), capped so notional never exceeds equity (no leverage).
          const riskPerUnit = Math.abs(entryPrice - signal.stopLoss);
          const byRisk = (cash * RISK_PER_TRADE) / riskPerUnit;
          const byCash = cash / (entryPrice * (1 + config.feeRate));
          const quantity = roundQuantity(Math.min(byRisk, byCash), config.market);

          if (quantity > 0) {
            const entryFee = entryPrice * quantity * config.feeRate;
            if (isLong) {
              cash -= quantity * entryPrice + entryFee;
            } else {
              cash += quantity * entryPrice - entryFee; // short sale proceeds
            }
            position = {
              side: signal.action as "buy" | "sell",
              entryPrice,
              quantity,
              entryDate: bar.date,
              entryFee,
              stopLoss: signal.stopLoss,
              takeProfit: signal.takeProfit,
            };
          }
        }
      }
    }

    // 3) Mark to market. A short is a liability: equity = cash - qty * close.
    let equity = cash;
    if (position) {
      const p: OpenPosition = position;
      equity += (p.side === "buy" ? 1 : -1) * p.quantity * bar.close;
    }
    equityCurve.push({ date: bar.date, equity });
  }

  // Force-close anything still open at the end of the range, with the same friction as any exit,
  // and make the last equity point reflect the realised (post-cost) result.
  if (position && end > start) {
    closePosition(data[end - 1].close, data[end - 1].date, "end-of-period");
    equityCurve[equityCurve.length - 1] = { date: data[end - 1].date, equity: cash };
  }

  return buildMetrics(config.initialCapital, config.market, equityCurve, trades);
}

/** Aggregate an equity curve and trade list into the standard metric set. */
export function buildMetrics(
  initialCapital: number,
  market: MarketType,
  equityCurve: { date: string; equity: number }[],
  trades: BacktestTrade[]
): BacktestMetrics {
  const { totalReturn, sharpeRatio, maxDrawdown } = equityStats(equityCurve, initialCapital, market);

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  return {
    totalReturn,
    sharpeRatio,
    maxDrawdown,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    totalTrades: trades.length,
    avgWin: wins.length > 0 ? grossProfit / wins.length : 0,
    avgLoss: losses.length > 0 ? grossLoss / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    equityCurve,
    trades,
  };
}

// ---- Backtest Runner ----
/**
 * Run a strategy over `data` (must already be clean — see cleanBars).
 * `range` limits trading to [start, end); indicators still see earlier bars as warm-up.
 */
export function runBacktest(config: BacktestConfig, data: OHLCV[], range?: BacktestRange): BacktestMetrics {
  const signals = getStrategySignals(config.strategy, data, config.params);
  return simulateSignals(config, data, signals, range);
}

// ---- Parameter fitting (the "train" half of walk-forward) ----
export const PARAM_GRIDS: Record<StrategyName, Record<string, number>[]> = {
  sma_crossover: [5, 10, 20].flatMap((shortPeriod) =>
    [30, 50, 100].map((longPeriod) => ({ shortPeriod, longPeriod }))
  ),
  rsi_reversion: [7, 14, 21].flatMap((period) =>
    [
      { oversold: 30, overbought: 70 },
      { oversold: 25, overbought: 75 },
      { oversold: 20, overbought: 80 },
    ].map((band) => ({ period, ...band }))
  ),
  breakout: [10, 20, 40].flatMap((lookback) =>
    [1.0, 1.5, 2.0].map((volumeMultiple) => ({ lookback, volumeMultiple }))
  ),
} as Record<StrategyName, Record<string, number>[]>;

export interface FitResult {
  params: Record<string, number>;
  fitted: boolean;
  candidatesTried: number;
  inSample: BacktestMetrics;
}

/**
 * Choose strategy parameters using ONLY bars [0, trainEnd). Each candidate is simulated in-sample;
 * the winner has the highest in-sample Sharpe among candidates with enough trades (ties: higher return).
 * Nothing at or after trainEnd is looked at when choosing.
 */
export function fitParameters(
  config: BacktestConfig,
  data: OHLCV[],
  trainEnd: number,
  minTrainTrades = 5
): FitResult {
  const grid = (PARAM_GRIDS[config.strategy] ?? []).filter(
    (p) => !(p.shortPeriod != null && p.longPeriod != null && p.shortPeriod >= p.longPeriod)
  );
  // Only hand the strategy bars it is allowed to see: the training window.
  const trainData = data.slice(0, trainEnd);

  let best: { params: Record<string, number>; m: BacktestMetrics } | null = null;
  for (const params of grid) {
    const m = runBacktest({ ...config, params }, trainData);
    if (m.totalTrades < minTrainTrades) continue;
    if (
      !best ||
      m.sharpeRatio > best.m.sharpeRatio ||
      (m.sharpeRatio === best.m.sharpeRatio && m.totalReturn > best.m.totalReturn)
    ) {
      best = { params, m };
    }
  }

  if (best) return { params: best.params, fitted: true, candidatesTried: grid.length, inSample: best.m };
  const fallback = config.params ?? {};
  return {
    params: fallback,
    fitted: false,
    candidatesTried: grid.length,
    inSample: runBacktest({ ...config, params: fallback }, trainData),
  };
}

// ---- Buy-and-Hold Benchmark ----
export function runBuyAndHold(
  data: OHLCV[],
  initialCapital: number,
  market: MarketType = "stock"
): BacktestMetrics {
  if (data.length < 2) {
    return {
      totalReturn: 0, sharpeRatio: 0, maxDrawdown: 0, winRate: 0,
      totalTrades: 1, avgWin: 0, avgLoss: 0, profitFactor: 0,
      equityCurve: data.length === 1 ? [{ date: data[0].date, equity: initialCapital }] : [],
    };
  }

  const entryPrice = data[0].close;
  // Whole shares for stocks, fractional units for crypto (otherwise BTC would size to 0 units).
  const quantity = roundQuantity(initialCapital / entryPrice, market);
  const leftoverCash = initialCapital - quantity * entryPrice;
  const equityCurve = data.map((d) => ({ date: d.date, equity: quantity * d.close + leftoverCash }));

  const { totalReturn, sharpeRatio, maxDrawdown } = equityStats(equityCurve, initialCapital, market);

  return {
    totalReturn,
    sharpeRatio,
    maxDrawdown,
    winRate: totalReturn > 0 ? 1 : 0,
    totalTrades: 1,
    avgWin: totalReturn > 0 ? totalReturn * initialCapital : 0,
    avgLoss: totalReturn <= 0 ? Math.abs(totalReturn * initialCapital) : 0,
    profitFactor: totalReturn > 0 ? Infinity : 0,
    equityCurve,
  };
}

// ---- Market Data Fetcher for backtests ----
const DAY_MS = 86_400_000;

async function fetchBinanceDaily(symbol: string, startDate: string, endDate: string): Promise<RawBar[] | null> {
  const pair = symbol.replace("/", "").toUpperCase();
  const end = new Date(endDate).getTime();
  let cursor = new Date(startDate).getTime();
  const out: RawBar[] = [];

  // Binance returns at most 1000 candles per call and always the EARLIEST ones from startTime,
  // so longer windows must be paged or the most recent bars would be silently cut off.
  for (let page = 0; page < 20 && cursor <= end; page++) {
    const res = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1d&startTime=${cursor}&endTime=${end}&limit=1000`
    );
    if (!res.ok) return null; // any failed page => treat the whole fetch as failed rather than return a truncated series
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const k of rows as (string | number)[][]) {
      out.push({
        date: new Date(Number(k[0])).toISOString().split("T")[0],
        open: parseFloat(String(k[1])),
        high: parseFloat(String(k[2])),
        low: parseFloat(String(k[3])),
        close: parseFloat(String(k[4])),
        volume: parseFloat(String(k[5])),
      });
    }

    if (rows.length < 1000) break;
    cursor = Number(rows[rows.length - 1][0]) + DAY_MS;
  }
  return out;
}

export async function fetchHistoricalData(
  symbol: string,
  market: "stock" | "crypto",
  startDate: string,
  endDate: string
): Promise<OHLCV[]> {
  if (market === "crypto") {
    try {
      const bars = await fetchBinanceDaily(symbol, startDate, endDate);
      if (bars && bars.length > 0) return cleanBars(bars);
    } catch {
      console.warn(`[Backtest] Failed to fetch crypto data for ${symbol}`);
    }
  }

  // For stocks — use Yahoo Finance
  try {
    const period1 = Math.floor(new Date(startDate).getTime() / 1000);
    const period2 = Math.floor(new Date(endDate).getTime() / 1000);
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`
    );
    if (res.ok) {
      const json = await res.json();
      const result = json.chart?.result?.[0];
      if (result) {
        const timestamps: number[] = result.timestamp || [];
        const quotes = result.indicators?.quote?.[0] || {};
        // Yahoo uses null for halted/holiday bars. Keep them as null and let cleanBars drop them —
        // converting to 0 would create fake -100% crashes and divide-by-zero in the indicators.
        return cleanBars(
          timestamps.map((ts, i) => ({
            date: new Date(ts * 1000).toISOString().split("T")[0],
            open: quotes.open?.[i],
            high: quotes.high?.[i],
            low: quotes.low?.[i],
            close: quotes.close?.[i],
            volume: quotes.volume?.[i],
          }))
        );
      }
    }
  } catch {
    console.warn(`[Backtest] Failed to fetch stock data for ${symbol}`);
  }

  return [];
}

// ---- Verdict: does the strategy genuinely beat buy-and-hold? ----
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

/**
 * "Beats buy-and-hold" used to mean test.sharpe > buyAndHold.sharpe, which a strategy that never
 * trades passes in any falling market (Sharpe 0 > negative). A strategy must now:
 *   1. be judged on enough bars and enough trades to mean something,
 *   2. make money after costs (losing less than a falling market is not an edge),
 *   3. beat buy-and-hold on total return, and
 *   4. beat buy-and-hold on Sharpe.
 * If (1) fails the verdict is "insufficient_evidence", never a pass.
 */
export function evaluateVerdict(
  test: BacktestMetrics,
  buyAndHold: BacktestMetrics,
  testBars: number,
  opts: { minTestBars?: number; minTrades?: number } = {}
): BacktestVerdict {
  const minTestBars = opts.minTestBars ?? DEFAULT_MIN_TEST_BARS;
  const minTrades = opts.minTrades ?? DEFAULT_MIN_TRADES;
  const base = { testBars, minTestBars, minTrades };

  const insufficient: string[] = [];
  if (testBars < minTestBars) {
    insufficient.push(`Out-of-sample window is only ${testBars} bars (need at least ${minTestBars}).`);
  }
  if (test.totalTrades < minTrades) {
    insufficient.push(`Only ${test.totalTrades} out-of-sample trades (need at least ${minTrades}).`);
  }
  if (insufficient.length > 0) {
    return { ...base, status: "insufficient_evidence", beatsHold: false, reasons: insufficient };
  }

  const failures: string[] = [];
  if (!(test.totalReturn > 0)) {
    failures.push(`Strategy does not make money after costs (${pct(test.totalReturn)}).`);
  }
  if (!(test.totalReturn > buyAndHold.totalReturn)) {
    failures.push(`Return ${pct(test.totalReturn)} does not beat buy-and-hold ${pct(buyAndHold.totalReturn)}.`);
  }
  if (!(test.sharpeRatio > buyAndHold.sharpeRatio)) {
    failures.push(
      `Sharpe ${test.sharpeRatio.toFixed(2)} does not beat buy-and-hold ${buyAndHold.sharpeRatio.toFixed(2)}.`
    );
  }

  if (failures.length > 0) {
    return { ...base, status: "underperforms", beatsHold: false, reasons: failures };
  }
  return {
    ...base,
    status: "outperforms",
    beatsHold: true,
    reasons: [
      `Return ${pct(test.totalReturn)} vs buy-and-hold ${pct(buyAndHold.totalReturn)}; ` +
        `Sharpe ${test.sharpeRatio.toFixed(2)} vs ${buyAndHold.sharpeRatio.toFixed(2)}; ${test.totalTrades} trades.`,
    ],
  };
}

// ---- Walk-forward backtest ----
export interface FullBacktestResult {
  /** In-sample result of the FIRST fold's fitted parameters (what the optimiser saw). */
  train: BacktestMetrics;
  /** Stitched out-of-sample result across all folds (each fold traded with parameters fitted before it). */
  test: BacktestMetrics;
  buyAndHold: BacktestMetrics;
  beatsHold: boolean;
  verdict: BacktestVerdict;
  folds: WalkForwardFold[];
  /** Parameters chosen for the most recent fold: the ones to deploy going forward. */
  chosenParams: Record<string, number>;
  /** True when parameters were optimised on training data (false = user-fixed params or no eligible candidate). */
  paramsFitted: boolean;
}

/**
 * Anchored (expanding-window) walk-forward:
 *   the first `trainTestSplit` of the data is the initial training window; the remainder is cut into
 *   `walkForwardFolds` consecutive out-of-sample folds. For each fold, parameters are fitted on ALL bars
 *   before the fold, then frozen and traded on the fold. Fold equity curves are chained so capital carries over.
 * If the caller passes explicit `params`, fitting is skipped and those fixed params are used in every fold.
 */
export async function runFullBacktest(config: BacktestConfig): Promise<FullBacktestResult> {
  const data = cleanBars(
    await fetchHistoricalData(config.symbol, config.market, config.startDate, config.endDate)
  );
  return runWalkForward(config, data);
}

export function runWalkForward(config: BacktestConfig, data: OHLCV[]): FullBacktestResult {
  const minTestBars = config.minTestBars ?? DEFAULT_MIN_TEST_BARS;
  const minTrades = config.minTrades ?? DEFAULT_MIN_TRADES;
  const minTrainTrades = config.minTrainTrades ?? 5;

  if (data.length < 20) {
    console.warn(`[Backtest] Insufficient data for ${config.symbol}: got ${data.length} usable bars — returning zero result`);
    const zeroMetrics: BacktestMetrics = {
      totalReturn: 0, sharpeRatio: 0, maxDrawdown: 0,
      winRate: 0, totalTrades: 0, profitFactor: 0,
      avgWin: 0, avgLoss: 0, equityCurve: [],
    };
    const verdict: BacktestVerdict = {
      status: "insufficient_evidence",
      beatsHold: false,
      testBars: 0,
      minTestBars,
      minTrades,
      reasons: [`Only ${data.length} usable bars were returned for ${config.symbol}.`],
    };
    return {
      train: zeroMetrics, test: zeroMetrics, buyAndHold: zeroMetrics, beatsHold: false, verdict,
      folds: [], chosenParams: config.params ?? {}, paramsFitted: false,
    };
  }

  const split = Number.isFinite(config.trainTestSplit) ? config.trainTestSplit : 0.7;
  const firstTestIdx = Math.min(data.length - 1, Math.max(1, Math.floor(data.length * split)));
  const testSpan = data.length - firstTestIdx;
  const foldCount = Math.max(1, Math.min(Math.floor(config.walkForwardFolds ?? 3), Math.floor(testSpan / 20) || 1));
  const userFixedParams = !!config.params && Object.keys(config.params).length > 0;

  // Signals are computed per (params) from the whole series; every indicator is causal so a signal at
  // bar i never uses bars after i, and fitting only ever scores bars before the fold.
  const stitched: { date: string; equity: number }[] = [];
  const allTrades: BacktestTrade[] = [];
  const folds: WalkForwardFold[] = [];
  let carry = config.initialCapital;
  let firstTrain: BacktestMetrics | null = null;
  let lastParams: Record<string, number> = config.params ?? {};
  let anyFitted = false;

  for (let k = 0; k < foldCount; k++) {
    const testStart = firstTestIdx + Math.floor((testSpan * k) / foldCount);
    const testEnd = k === foldCount - 1 ? data.length : firstTestIdx + Math.floor((testSpan * (k + 1)) / foldCount);
    if (testEnd <= testStart) continue;

    const fit: FitResult = userFixedParams
      ? {
          params: config.params!,
          fitted: false,
          candidatesTried: 1,
          inSample: runBacktest({ ...config, params: config.params }, data.slice(0, testStart)),
        }
      : fitParameters(config, data, testStart, minTrainTrades);
    if (!firstTrain) firstTrain = fit.inSample;
    if (fit.fitted) anyFitted = true;
    lastParams = fit.params;

    const foldConfig = { ...config, params: fit.params };
    const signals = getStrategySignals(config.strategy, data, fit.params);
    const m = simulateSignals(foldConfig, data, signals, { start: testStart, end: testEnd });

    // Chain capital: this fold starts with the equity the previous fold ended on.
    const scale = carry / config.initialCapital;
    for (const p of m.equityCurve) stitched.push({ date: p.date, equity: p.equity * scale });
    for (const t of m.trades ?? []) allTrades.push({ ...t, pnl: t.pnl * scale, fees: t.fees * scale });
    if (m.equityCurve.length > 0) carry = stitched[stitched.length - 1].equity;

    folds.push({
      fold: k + 1,
      trainBars: testStart,
      testBars: testEnd - testStart,
      trainStart: data[0].date,
      trainEnd: data[testStart - 1].date,
      testStart: data[testStart].date,
      testEnd: data[testEnd - 1].date,
      chosenParams: fit.params,
      fitted: fit.fitted,
      candidatesTried: fit.candidatesTried,
      inSample: { sharpeRatio: fit.inSample.sharpeRatio, totalReturn: fit.inSample.totalReturn, totalTrades: fit.inSample.totalTrades },
      outOfSample: { sharpeRatio: m.sharpeRatio, totalReturn: m.totalReturn, totalTrades: m.totalTrades },
    });
  }

  const test = buildMetrics(config.initialCapital, config.market, stitched, allTrades);
  const buyAndHold = runBuyAndHold(data.slice(firstTestIdx), config.initialCapital, config.market);
  const verdict = evaluateVerdict(test, buyAndHold, data.length - firstTestIdx, { minTestBars, minTrades });

  if (!userFixedParams && !anyFitted) {
    verdict.reasons.push("No parameter set had enough in-sample trades to be fitted; default parameters were used.");
  }

  return {
    train: firstTrain ?? test,
    test,
    buyAndHold,
    beatsHold: verdict.beatsHold,
    verdict,
    folds,
    chosenParams: lastParams,
    paramsFitted: anyFitted,
  };
}
