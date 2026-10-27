// ============================================================
// Backtest Engine — SMA Crossover, RSI Mean-Reversion, Breakout
// Includes fees, slippage, train/test split, buy-and-hold comparison
// ============================================================

import type { BacktestConfig, BacktestMetrics, StrategyName, StrategySignal } from "@/lib/types";

interface OHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface BacktestTrade {
  entryDate: string;
  exitDate: string;
  side: "buy" | "sell";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  fees: number;
}

// ---- Technical Indicators ----
function sma(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    }
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

// ---- Strategy Implementations ----

function smaCrossoverSignals(
  data: OHLCV[],
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

    if (!prevShort || !prevLong || !currShort || !currLong) continue;

    // Golden cross — buy
    if (prevShort <= prevLong && currShort > currLong) {
      const atrValues = atr(data.slice(0, i + 1));
      const currentAtr = atrValues[atrValues.length - 1] || data[i].close * 0.02;
      signals.push({
        strategy: "sma_crossover",
        action: "buy",
        confidence: 0.6,
        entryPrice: data[i].close,
        stopLoss: data[i].close - 2 * currentAtr,
        takeProfit: data[i].close + 3 * currentAtr,
        params: { shortPeriod, longPeriod },
        reasoning: `SMA${shortPeriod} crossed above SMA${longPeriod} (golden cross)`,
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
      });
    }
  }

  return signals;
}

function rsiReversionSignals(
  data: OHLCV[],
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
    if (!prevRSI || !currRSI) continue;

    const atrValues = atr(data.slice(0, i + 1));
    const currentAtr = atrValues[atrValues.length - 1] || data[i].close * 0.02;

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
      });
    }
  }

  return signals;
}

function breakoutSignals(
  data: OHLCV[],
  lookback = 20,
  volumeMultiple = 1.5
): StrategySignal[] {
  const signals: StrategySignal[] = [];

  for (let i = lookback; i < data.length; i++) {
    const window = data.slice(i - lookback, i);
    const highestHigh = Math.max(...window.map((d) => d.high));
    const lowestLow = Math.min(...window.map((d) => d.low));
    const avgVolume = window.reduce((s, d) => s + d.volume, 0) / lookback;

    const atrValues = atr(data.slice(0, i + 1));
    const currentAtr = atrValues[atrValues.length - 1] || data[i].close * 0.02;

    // Bullish breakout
    if (data[i].close > highestHigh && data[i].volume > avgVolume * volumeMultiple) {
      signals.push({
        strategy: "breakout",
        action: "buy",
        confidence: 0.65,
        entryPrice: data[i].close,
        stopLoss: data[i].close - 2 * currentAtr,
        takeProfit: data[i].close + 3 * currentAtr,
        params: { lookback, volumeMultiple },
        reasoning: `Price broke above ${lookback}-day high ($${highestHigh.toFixed(2)}) on ${(data[i].volume / avgVolume).toFixed(1)}x avg volume`,
      });
    }

    // Bearish breakdown
    if (data[i].close < lowestLow && data[i].volume > avgVolume * volumeMultiple) {
      signals.push({
        strategy: "breakout",
        action: "sell",
        confidence: 0.65,
        entryPrice: data[i].close,
        stopLoss: data[i].close + 2 * currentAtr,
        params: { lookback, volumeMultiple },
        reasoning: `Price broke below ${lookback}-day low ($${lowestLow.toFixed(2)}) on ${(data[i].volume / avgVolume).toFixed(1)}x avg volume`,
      });
    }
  }

  return signals;
}

// ---- Strategy Factory ----
function getStrategySignals(name: StrategyName, data: OHLCV[], params?: Record<string, number>): StrategySignal[] {
  switch (name) {
    case "sma_crossover":
      return smaCrossoverSignals(data, params?.shortPeriod, params?.longPeriod);
    case "rsi_reversion":
      return rsiReversionSignals(data, params?.period, params?.oversold, params?.overbought);
    case "breakout":
      return breakoutSignals(data, params?.lookback, params?.volumeMultiple);
    default:
      return [];
  }
}

// ---- Backtest Runner ----
export function runBacktest(config: BacktestConfig, data: OHLCV[]): BacktestMetrics {
  const signals = getStrategySignals(config.strategy, data, config.params);
  let capital = config.initialCapital;
  const equityCurve: { date: string; equity: number }[] = [{ date: data[0]?.date || "", equity: capital }];
  const trades: BacktestTrade[] = [];

  let position: { side: "buy" | "sell"; entryPrice: number; quantity: number; entryDate: string; stopLoss: number; takeProfit?: number } | null = null;

  for (let i = 0; i < data.length; i++) {
    const bar = data[i];

    // Check stop-loss / take-profit on open positions
    if (position) {
      let exitPrice: number | null = null;
      let exitReason = "";

      if (position.side === "buy") {
        if (bar.low <= position.stopLoss) {
          exitPrice = position.stopLoss;
          exitReason = "stop-loss";
        } else if (position.takeProfit && bar.high >= position.takeProfit) {
          exitPrice = position.takeProfit;
          exitReason = "take-profit";
        }
      } else {
        if (bar.high >= position.stopLoss) {
          exitPrice = position.stopLoss;
          exitReason = "stop-loss";
        } else if (position.takeProfit && bar.low <= position.takeProfit) {
          exitPrice = position.takeProfit;
          exitReason = "take-profit";
        }
      }

      if (exitPrice) {
        // Apply slippage
        const slippage = exitPrice * (config.slippageBps / 10000);
        exitPrice = position.side === "buy" ? exitPrice - slippage : exitPrice + slippage;

        const fee = exitPrice * position.quantity * config.feeRate;
        const rawPnl =
          position.side === "buy"
            ? (exitPrice - position.entryPrice) * position.quantity
            : (position.entryPrice - exitPrice) * position.quantity;
        const pnl = rawPnl - fee;

        capital += position.quantity * exitPrice - fee;
        trades.push({
          entryDate: position.entryDate,
          exitDate: bar.date,
          side: position.side,
          entryPrice: position.entryPrice,
          exitPrice,
          quantity: position.quantity,
          pnl,
          fees: fee,
        });
        position = null;
      }
    }

    // Check for new signals
    if (!position) {
      const signal = signals.find((s) => {
        const signalIdx = data.findIndex((d) => d.close === s.entryPrice);
        return signalIdx === i;
      });

      if (signal && (signal.action === "buy" || signal.action === "sell")) {
        // Apply slippage to entry
        const slippage = signal.entryPrice * (config.slippageBps / 10000);
        const entryPrice = signal.action === "buy" ? signal.entryPrice + slippage : signal.entryPrice - slippage;

        // Size position: risk 1% of capital per trade
        const riskPerShare = Math.abs(entryPrice - signal.stopLoss);
        const riskAmount = capital * 0.01;
        const quantity = riskPerShare > 0 ? Math.floor(riskAmount / riskPerShare) : 0;

        if (quantity > 0) {
          const fee = entryPrice * quantity * config.feeRate;
          capital -= quantity * entryPrice + fee;

          position = {
            side: signal.action,
            entryPrice,
            quantity,
            entryDate: bar.date,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
          };
        }
      }
    }

    // Update equity curve
    const positionValue = position ? position.quantity * bar.close : 0;
    equityCurve.push({ date: bar.date, equity: capital + positionValue });
  }

  // Close any remaining position at last bar
  if (position) {
    const lastBar = data[data.length - 1];
    const fee = lastBar.close * position.quantity * config.feeRate;
    const rawPnl =
      position.side === "buy"
        ? (lastBar.close - position.entryPrice) * position.quantity
        : (position.entryPrice - lastBar.close) * position.quantity;
    capital += position.quantity * lastBar.close - fee;
    trades.push({
      entryDate: position.entryDate,
      exitDate: lastBar.date,
      side: position.side,
      entryPrice: position.entryPrice,
      exitPrice: lastBar.close,
      quantity: position.quantity,
      pnl: rawPnl - fee,
      fees: fee,
    });
  }

  // Calculate metrics
  const finalEquity = equityCurve[equityCurve.length - 1]?.equity || config.initialCapital;
  const totalReturn = (finalEquity - config.initialCapital) / config.initialCapital;

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const winRate = trades.length > 0 ? wins.length / trades.length : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;
  const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : Infinity;

  // Sharpe Ratio (annualized, assuming 252 trading days)
  const returns = equityCurve.slice(1).map((e, i) => (e.equity - equityCurve[i].equity) / equityCurve[i].equity);
  const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const stdReturn = Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / returns.length);
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

  // Max Drawdown
  let peak = config.initialCapital;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    if (point.equity > peak) peak = point.equity;
    const dd = (peak - point.equity) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return {
    totalReturn,
    sharpeRatio,
    maxDrawdown,
    winRate,
    totalTrades: trades.length,
    avgWin,
    avgLoss,
    profitFactor,
    equityCurve,
  };
}

// ---- Buy-and-Hold Benchmark ----
export function runBuyAndHold(data: OHLCV[], initialCapital: number): BacktestMetrics {
  if (data.length < 2) {
    return {
      totalReturn: 0, sharpeRatio: 0, maxDrawdown: 0, winRate: 0,
      totalTrades: 1, avgWin: 0, avgLoss: 0, profitFactor: 0,
      equityCurve: [{ date: data[0]?.date || "", equity: initialCapital }],
    };
  }

  const entryPrice = data[0].close;
  const quantity = Math.floor(initialCapital / entryPrice);
  const equityCurve = data.map((d) => ({
    date: d.date,
    equity: quantity * d.close + (initialCapital - quantity * entryPrice),
  }));

  const finalEquity = equityCurve[equityCurve.length - 1].equity;
  const totalReturn = (finalEquity - initialCapital) / initialCapital;

  const returns = equityCurve.slice(1).map((e, i) => (e.equity - equityCurve[i].equity) / equityCurve[i].equity);
  const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const stdReturn = Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / returns.length);
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

  let peak = initialCapital;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    if (point.equity > peak) peak = point.equity;
    const dd = (peak - point.equity) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

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
export async function fetchHistoricalData(
  symbol: string,
  market: "stock" | "crypto",
  startDate: string,
  endDate: string
): Promise<OHLCV[]> {
  if (market === "crypto") {
    try {
      const pair = symbol.replace("/", "").toUpperCase();
      const start = new Date(startDate).getTime();
      const end = new Date(endDate).getTime();
      const res = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1d&startTime=${start}&endTime=${end}&limit=1000`
      );
      if (res.ok) {
        const data = await res.json();
        return data.map((k: number[]) => ({
          date: new Date(k[0]).toISOString().split("T")[0],
          open: parseFloat(String(k[1])),
          high: parseFloat(String(k[2])),
          low: parseFloat(String(k[3])),
          close: parseFloat(String(k[4])),
          volume: parseFloat(String(k[5])),
        }));
      }
    } catch {
      console.warn(`[Backtest] Failed to fetch crypto data for ${symbol}`);
    }
  }

  // For stocks — use Yahoo Finance
  try {
    const period1 = Math.floor(new Date(startDate).getTime() / 1000);
    const period2 = Math.floor(new Date(endDate).getTime() / 1000);
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1d`
    );
    if (res.ok) {
      const json = await res.json();
      const result = json.chart?.result?.[0];
      if (result) {
        const timestamps = result.timestamp || [];
        const quotes = result.indicators?.quote?.[0] || {};
        return timestamps.map((ts: number, i: number) => ({
          date: new Date(ts * 1000).toISOString().split("T")[0],
          open: quotes.open?.[i] || 0,
          high: quotes.high?.[i] || 0,
          low: quotes.low?.[i] || 0,
          close: quotes.close?.[i] || 0,
          volume: quotes.volume?.[i] || 0,
        }));
      }
    }
  } catch {
    console.warn(`[Backtest] Failed to fetch stock data for ${symbol}`);
  }

  return [];
}

// ---- Full Backtest with Train/Test Split ----
export async function runFullBacktest(config: BacktestConfig): Promise<{
  train: BacktestMetrics;
  test: BacktestMetrics;
  buyAndHold: BacktestMetrics;
  beatsHold: boolean;
}> {
  const data = await fetchHistoricalData(config.symbol, config.market, config.startDate, config.endDate);

  if (data.length < 20) {
    console.warn(`[Backtest] Insufficient data for ${config.symbol}: got ${data.length} bars — returning zero result`);
    const zeroMetrics: BacktestMetrics = {
      totalReturn: 0, sharpeRatio: 0, maxDrawdown: 0,
      winRate: 0, totalTrades: 0, profitFactor: 0,
      avgWin: 0, avgLoss: 0, equityCurve: [],
    };
    return { train: zeroMetrics, test: zeroMetrics, buyAndHold: zeroMetrics, beatsHold: false };
  }

  const splitIdx = Math.floor(data.length * config.trainTestSplit);
  const trainData = data.slice(0, splitIdx);
  const testData = data.slice(splitIdx);

  const train = runBacktest({ ...config }, trainData);
  const test = runBacktest({ ...config }, testData);
  const buyAndHold = runBuyAndHold(testData, config.initialCapital);

  // Strategy must beat buy-and-hold on risk-adjusted basis (Sharpe)
  const beatsHold = test.sharpeRatio > buyAndHold.sharpeRatio;

  return { train, test, buyAndHold, beatsHold };
}
