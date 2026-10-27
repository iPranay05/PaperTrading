// ============================================================
// Agent Loop — The autonomous, tool-using trading agent
// Reads market data and news, picks strategy, proposes trades,
// runs ensemble check, passes risk gate, journals everything
// ============================================================

import prisma from "@/lib/db";
import { callLLM, runEnsembleCheck, scoreHeadline } from "@/lib/llm/wrapper";
import { checkRiskGate, calculatePositionSize, isKillSwitchActive } from "@/lib/risk/gate";
import { createBroker } from "@/lib/broker/adapters";
import { runFullBacktest, fetchHistoricalData } from "@/lib/backtest/engine";
import type {
  IBroker,
  MarketType,
  MarketRegime,
  StrategyName,
  AgentDecision,
  AgentTool,
  BracketOrder,
  PositionInfo,
  JournalEntryData,
  SignalFilterResult,
  TradeAnalysis,
  BacktestConfig,
} from "@/lib/types";

// ---- Agent State ----
let agentRunning = false;
let agentInterval: ReturnType<typeof setInterval> | null = null;

// ---- Tool Definitions for the Agent ----
function createAgentTools(stockBroker: IBroker, cryptoBroker: IBroker): AgentTool[] {
  return [
    {
      name: "get_stock_price",
      description: "Get the current price of a stock symbol",
      parameters: { symbol: "string" },
      execute: async (args) => {
        const price = await stockBroker.getCurrentPrice(args.symbol as string);
        return { symbol: args.symbol, price, timestamp: new Date().toISOString() };
      },
    },
    {
      name: "get_crypto_price",
      description: "Get the current price of a crypto trading pair (e.g. BTC/USDT)",
      parameters: { symbol: "string" },
      execute: async (args) => {
        const price = await cryptoBroker.getCurrentPrice(args.symbol as string);
        return { symbol: args.symbol, price, timestamp: new Date().toISOString() };
      },
    },
    {
      name: "get_positions",
      description: "Get all current open positions across stock and crypto",
      parameters: {},
      execute: async () => {
        const [stockPositions, cryptoPositions] = await Promise.all([
          stockBroker.getPositions(),
          cryptoBroker.getPositions(),
        ]);
        return { stock: stockPositions, crypto: cryptoPositions };
      },
    },
    {
      name: "get_account_equity",
      description: "Get current account equity and buying power for a market",
      parameters: { market: "stock | crypto" },
      execute: async (args) => {
        const broker = args.market === "crypto" ? cryptoBroker : stockBroker;
        const account = await broker.getAccount();
        return { equity: account.equity, buyingPower: account.buyingPower, isPaper: account.isPaper };
      },
    },
    {
      name: "get_historical_data",
      description: "Fetch historical OHLCV data for backtesting or analysis",
      parameters: { symbol: "string", market: "stock | crypto", days: "number" },
      execute: async (args) => {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - (args.days as number || 90));
        const data = await fetchHistoricalData(
          args.symbol as string,
          args.market as "stock" | "crypto",
          start.toISOString().split("T")[0],
          end.toISOString().split("T")[0]
        );
        // Return summary, not full data (for LLM context efficiency)
        const last5 = data.slice(-5);
        const first = data[0];
        return {
          symbol: args.symbol,
          dataPoints: data.length,
          dateRange: { from: first?.date, to: last5[last5.length - 1]?.date },
          recentPrices: last5.map((d) => ({ date: d.date, close: d.close, volume: d.volume })),
          periodHigh: Math.max(...data.map((d) => d.high)),
          periodLow: Math.min(...data.map((d) => d.low)),
          priceChangePercent: first ? ((last5[last5.length - 1]?.close || 0) - first.close) / first.close * 100 : 0,
        };
      },
    },
    {
      name: "run_backtest",
      description: "Run a backtest for a strategy on a symbol with train/test split",
      parameters: { strategy: "sma_crossover | rsi_reversion | breakout", symbol: "string", market: "stock | crypto" },
      execute: async (args) => {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 180); // 6 months
        const config: BacktestConfig = {
          strategy: args.strategy as StrategyName,
          symbol: args.symbol as string,
          market: args.market as MarketType,
          startDate: start.toISOString().split("T")[0],
          endDate: end.toISOString().split("T")[0],
          initialCapital: 100000,
          feeRate: 0.001,
          slippageBps: 5,
          trainTestSplit: 0.7,
        };
        const result = await runFullBacktest(config);
        return {
          strategy: args.strategy,
          symbol: args.symbol,
          trainReturn: `${(result.train.totalReturn * 100).toFixed(2)}%`,
          testReturn: `${(result.test.totalReturn * 100).toFixed(2)}%`,
          testSharpe: result.test.sharpeRatio.toFixed(2),
          testMaxDrawdown: `${(result.test.maxDrawdown * 100).toFixed(2)}%`,
          testWinRate: `${(result.test.winRate * 100).toFixed(1)}%`,
          testTrades: result.test.totalTrades,
          buyAndHoldReturn: `${(result.buyAndHold.totalReturn * 100).toFixed(2)}%`,
          beatsHold: result.beatsHold,
        };
      },
    },
    {
      name: "fetch_news",
      description: "Fetch recent news headlines for a symbol or market",
      parameters: { symbol: "string", market: "stock | crypto" },
      execute: async (args) => {
        return await fetchNewsForAgent(args.symbol as string, args.market as MarketType);
      },
    },
    {
      name: "score_headline",
      description: "Score a news headline as signal or noise (0-1 score)",
      parameters: { headline: "string", symbol: "string" },
      execute: async (args) => {
        return await scoreHeadline(args.headline as string, args.symbol as string);
      },
    },
    {
      name: "detect_market_regime",
      description: "Detect the current market regime for a symbol",
      parameters: { symbol: "string", market: "stock | crypto" },
      execute: async (args) => {
        return await detectRegime(args.symbol as string, args.market as MarketType);
      },
    },
    {
      name: "get_fear_greed_index",
      description: "Get the crypto Fear and Greed Index",
      parameters: {},
      execute: async () => {
        try {
          const res = await fetch("https://api.alternative.me/fng/?limit=1");
          if (res.ok) {
            const data = await res.json();
            const fng = data.data?.[0];
            return {
              value: parseInt(fng?.value || "50"),
              classification: fng?.value_classification || "Neutral",
              timestamp: fng?.timestamp,
            };
          }
        } catch { /* fallback */ }
        return { value: 50, classification: "Neutral", timestamp: new Date().toISOString() };
      },
    },
  ];
}

// ---- News Fetcher ----
async function fetchNewsForAgent(symbol: string, market: MarketType): Promise<{ headlines: SignalFilterResult[]; summary: string }> {
  const headlines: SignalFilterResult[] = [];

  if (market === "crypto") {
    // CryptoPanic free tier
    try {
      const res = await fetch(
        `https://cryptopanic.com/api/free/v1/posts/?auth_token=${process.env.CRYPTOPANIC_API_KEY || ""}&currencies=${symbol.split("/")[0]}&kind=news&public=true`
      );
      if (res.ok) {
        const data = await res.json();
        for (const post of (data.results || []).slice(0, 10)) {
          const score = await scoreHeadline(post.title, symbol);
          headlines.push({
            article: {
              id: post.id?.toString() || "",
              source: post.source?.title || "CryptoPanic",
              title: post.title,
              url: post.url,
              symbol,
              publishedAt: new Date(post.published_at),
            },
            ...score,
          });
        }
      }
    } catch {
      // Fallback: no news
    }
  } else {
    // Finnhub free tier for stocks
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/news?category=general&token=${process.env.FINNHUB_API_KEY || ""}`
      );
      if (res.ok) {
        const data = await res.json();
        for (const article of (data || []).slice(0, 10)) {
          const score = await scoreHeadline(article.headline, symbol);
          headlines.push({
            article: {
              id: article.id?.toString() || "",
              source: article.source || "Finnhub",
              title: article.headline,
              summary: article.summary,
              url: article.url,
              symbol,
              publishedAt: new Date(article.datetime * 1000),
            },
            ...score,
          });
        }
      }
    } catch {
      // Fallback: no news
    }
  }

  // Store news items in DB
  for (const h of headlines) {
    try {
      await prisma.newsItem.create({
        data: {
          source: h.article.source,
          title: h.article.title,
          summary: h.article.summary || null,
          url: h.article.url || null,
          symbol: h.article.symbol || null,
          sentiment: h.sentiment || null,
          signalScore: h.score,
          isSignal: h.isSignal,
          isNoise: !h.isSignal,
          noiseReason: h.isSignal ? null : h.reason,
          publishedAt: h.article.publishedAt || null,
        },
      });
    } catch { /* duplicate or DB error */ }
  }

  const signals = headlines.filter((h) => h.isSignal);
  const noise = headlines.filter((h) => !h.isSignal);

  return {
    headlines,
    summary: `${headlines.length} headlines read, ${signals.length} acted on, ${noise.length} ignored`,
  };
}

// ---- Market Regime Detection ----
async function detectRegime(symbol: string, market: MarketType): Promise<{ regime: MarketRegime; confidence: number; reasoning: string }> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 60);

  const data = await fetchHistoricalData(symbol, market, start.toISOString().split("T")[0], end.toISOString().split("T")[0]);

  if (data.length < 20) {
    return { regime: "volatile", confidence: 0.3, reasoning: "Insufficient data" };
  }

  const closes = data.map((d) => d.close);
  const sma20 = closes.slice(-20).reduce((s, c) => s + c, 0) / 20;
  const sma50 = closes.length >= 50 ? closes.slice(-50).reduce((s, c) => s + c, 0) / 50 : sma20;
  const currentPrice = closes[closes.length - 1];

  // Volatility (20-day standard deviation of returns)
  const returns = closes.slice(-21).map((c, i, arr) => i > 0 ? (c - arr[i - 1]) / arr[i - 1] : 0).slice(1);
  const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const volatility = Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / returns.length);

  // Trend direction
  const trendUp = currentPrice > sma20 && sma20 > sma50;
  const trendDown = currentPrice < sma20 && sma20 < sma50;

  let regime: MarketRegime;
  let confidence: number;
  let reasoning: string;

  if (volatility > 0.03) {
    regime = "volatile";
    confidence = 0.7;
    reasoning = `High volatility (${(volatility * 100).toFixed(1)}% daily std). Price: $${currentPrice.toFixed(2)}, SMA20: $${sma20.toFixed(2)}`;
  } else if (trendUp) {
    regime = "trending_up";
    confidence = 0.75;
    reasoning = `Uptrend: price ($${currentPrice.toFixed(2)}) > SMA20 ($${sma20.toFixed(2)}) > SMA50 ($${sma50.toFixed(2)})`;
  } else if (trendDown) {
    regime = "trending_down";
    confidence = 0.75;
    reasoning = `Downtrend: price ($${currentPrice.toFixed(2)}) < SMA20 ($${sma20.toFixed(2)}) < SMA50 ($${sma50.toFixed(2)})`;
  } else {
    regime = "ranging";
    confidence = 0.6;
    reasoning = `Ranging: price ($${currentPrice.toFixed(2)}) between SMA20 ($${sma20.toFixed(2)}) and SMA50 ($${sma50.toFixed(2)})`;
  }

  return { regime, confidence, reasoning };
}

// ---- Strategy Selection Based on Regime ----
function selectStrategy(regime: MarketRegime): StrategyName {
  switch (regime) {
    case "trending_up":
    case "trending_down":
      return "sma_crossover";
    case "ranging":
      return "rsi_reversion";
    case "volatile":
      return "breakout";
    default:
      return "sma_crossover";
  }
}

// ---- The Autonomous Agent System Prompt ----
const AGENT_SYSTEM_PROMPT = `You are an autonomous paper-trading agent. Your job is to analyze markets and make disciplined trading decisions.

CRITICAL RULES:
1. You MUST use the provided tools to gather data. Never invent numbers.
2. You MUST run a backtest before trading any strategy on a symbol. Only trade if it beats buy-and-hold.
3. You MUST score news headlines for signal vs noise. Most headlines are noise.
4. You MUST state a clear thesis AND what would invalidate it BEFORE proposing any trade.
5. You MUST provide confidence as a decimal between 0 and 1.
6. Your risk calculations are VERIFIED by the risk gate — you cannot override position sizing.

WORKFLOW:
1. Check current positions and account equity
2. Detect market regime
3. Fetch and score news (signal vs noise)
4. Select strategy based on regime
5. Run backtest to verify strategy beats buy-and-hold
6. If backtest passes, analyze for trade opportunities
7. For each opportunity: state thesis + invalidation, give confidence
8. The risk gate will enforce position sizing, stop-loss, and limits

OUTPUT FORMAT (JSON):
{
  "tools_used": [{"name": string, "args": object, "result_summary": string}],
  "regime": "trending_up" | "trending_down" | "ranging" | "volatile",
  "strategy": "sma_crossover" | "rsi_reversion" | "breakout",
  "news_summary": {"total": number, "signals": number, "noise": number},
  "decision": {
    "action": "buy" | "sell" | "skip",
    "symbol": string,
    "confidence": number,
    "thesis": string,
    "invalidation": string,
    "entry_price": number,
    "stop_loss": number,
    "take_profit": number | null,
    "reasoning": string
  }
}`;

// ---- Main Agent Cycle ----
async function runAgentCycle(watchlist: { stock: string[]; crypto: string[] }): Promise<AgentDecision[]> {
  const decisions: AgentDecision[] = [];

  // Check kill switch
  if (await isKillSwitchActive()) {
    console.log("[Agent] Kill switch active — skipping cycle");
    return decisions;
  }

  const stockBroker = createBroker("stock");
  const cryptoBroker = createBroker("crypto");
  const tools = createAgentTools(stockBroker, cryptoBroker);

  // Get account state
  const [stockAccount, cryptoAccount] = await Promise.all([
    stockBroker.getAccount().catch(() => ({ equity: 100000, buyingPower: 100000, positions: [], isPaper: true })),
    cryptoBroker.getAccount().catch(() => ({ equity: 100000, buyingPower: 100000, positions: [], isPaper: true })),
  ]);

  const allPositions = [...stockAccount.positions, ...cryptoAccount.positions];

  // Update agent state
  const totalEquity = stockAccount.equity + cryptoAccount.equity;
  await prisma.agentState.upsert({
    where: { id: "singleton" },
    update: {
      currentEquity: totalEquity,
      lastHeartbeat: new Date(),
      isRunning: true,
    },
    create: {
      id: "singleton",
      currentEquity: totalEquity,
      startingEquity: totalEquity,
      isRunning: true,
      lastHeartbeat: new Date(),
    },
  });

  // Process each symbol in the watchlist
  const allSymbols = [
    ...watchlist.stock.map((s) => ({ symbol: s, market: "stock" as MarketType })),
    ...watchlist.crypto.map((s) => ({ symbol: s, market: "crypto" as MarketType })),
  ];

  for (const { symbol, market } of allSymbols) {
    if (await isKillSwitchActive()) break;

    try {
      const decision = await analyzeSymbol(
        symbol,
        market,
        tools,
        market === "stock" ? stockBroker : cryptoBroker,
        market === "stock" ? stockAccount.equity : cryptoAccount.equity,
        allPositions
      );
      decisions.push(decision);
    } catch (error) {
      console.error(`[Agent] Error analyzing ${symbol}:`, error);

      // Journal the error
      const journalData: JournalEntryData = {
        decisionType: "skip",
        observation: `Error analyzing ${symbol}: ${error instanceof Error ? error.message : String(error)}`,
        strategy: "none",
        thesis: "Analysis failed",
        confidence: "N/A",
        riskCalculation: "N/A",
        auditTrail: JSON.stringify({ error: String(error) }),
        noiseHeadlines: 0,
        signalHeadlines: 0,
      };
      await writeJournalEntry(journalData);
      decisions.push({ action: "skip", journal: journalData });
    }
  }

  // Update daily snapshot
  await updateDailySnapshot(totalEquity, decisions);

  return decisions;
}

// ---- Analyze a Single Symbol ----
async function analyzeSymbol(
  symbol: string,
  market: MarketType,
  tools: AgentTool[],
  broker: IBroker,
  equity: number,
  currentPositions: PositionInfo[]
): Promise<AgentDecision> {
  console.log(`[Agent] Analyzing ${symbol} (${market})...`);

  // Step 1: Detect regime
  const regimeTool = tools.find((t) => t.name === "detect_market_regime")!;
  const regimeResult = await regimeTool.execute({ symbol, market }) as { regime: MarketRegime; confidence: number; reasoning: string };

  // Step 2: Select strategy based on regime
  const strategy = selectStrategy(regimeResult.regime);

  // Step 3: Run backtest
  const backtestTool = tools.find((t) => t.name === "run_backtest")!;
  const backtestResult = await backtestTool.execute({ strategy, symbol, market }) as Record<string, unknown>;

  // Step 4: Fetch and score news
  const newsTool = tools.find((t) => t.name === "fetch_news")!;
  const newsResult = await newsTool.execute({ symbol, market }) as { headlines: SignalFilterResult[]; summary: string };

  // Step 5: Get current price and historical data
  const targetToolName = market === "crypto" ? "get_crypto_price" : "get_stock_price";
  const priceTool = tools.find((t) => t.name === targetToolName)!;
  const priceResult = await priceTool.execute({ symbol }) as { price: number };

  const histTool = tools.find((t) => t.name === "get_historical_data")!;
  const histResult = await histTool.execute({ symbol, market, days: 30 }) as Record<string, unknown>;

  // Step 6: Check if backtest beats buy-and-hold
  if (!(backtestResult.beatsHold as boolean)) {
    const journalData: JournalEntryData = {
      decisionType: "skip",
      observation: `${symbol} regime: ${regimeResult.regime}. Price: $${priceResult.price}. ${newsResult.summary}`,
      strategy: `${strategy} — backtest does NOT beat buy-and-hold`,
      thesis: "No trade: strategy underperforms passive holding",
      confidence: `Backtest Sharpe: ${backtestResult.testSharpe}, B&H return: ${backtestResult.buyAndHoldReturn}`,
      riskCalculation: "N/A — trade not proposed",
      auditTrail: JSON.stringify({ regime: regimeResult, backtest: backtestResult }),
      noiseHeadlines: newsResult.headlines.filter((h) => !h.isSignal).length,
      signalHeadlines: newsResult.headlines.filter((h) => h.isSignal).length,
    };
    await writeJournalEntry(journalData);
    return { action: "skip", journal: journalData };
  }

  // Step 7: Run dual-LLM ensemble check
  const marketDataStr = `Symbol: ${symbol}, Price: $${priceResult.price}, Regime: ${regimeResult.regime} (${regimeResult.reasoning}). Historical: ${JSON.stringify(histResult)}`;
  const newsDataStr = newsResult.headlines
    .filter((h) => h.isSignal)
    .map((h) => `[Signal ${h.score.toFixed(2)}] ${h.article.title}`)
    .join("\n") || "No significant news signals";
  const positionsStr = currentPositions.length > 0
    ? currentPositions.map((p) => `${p.symbol}: ${p.side} ${p.quantity} @ $${p.entryPrice}`).join(", ")
    : "No open positions";
  const backtestStr = `Strategy ${strategy}: Test return ${backtestResult.testReturn}, Sharpe ${backtestResult.testSharpe}, Win rate ${backtestResult.testWinRate}, Beats B&H: ${backtestResult.beatsHold}`;

  const ensemble = await runEnsembleCheck(marketDataStr, newsDataStr, positionsStr, backtestStr);

  // Step 8: If ensemble says skip, journal and move on
  if (ensemble.finalAction === "skip") {
    const journalData: JournalEntryData = {
      decisionType: "skip",
      observation: `${symbol}: ${regimeResult.regime}. Price: $${priceResult.price}. ${newsResult.summary}`,
      strategy: `${strategy} — ensemble DISAGREEMENT`,
      thesis: `Groq: "${ensemble.groqAnalysis.thesis}" vs Gemini: "${ensemble.geminiAnalysis.thesis}"`,
      confidence: `Groq: ${ensemble.groqAnalysis.confidence.toFixed(2)}, Gemini: ${ensemble.geminiAnalysis.confidence.toFixed(2)}, Agreement: ${ensemble.agreement.toFixed(2)}`,
      riskCalculation: "Skipped due to ensemble disagreement",
      auditTrail: JSON.stringify({ ensemble, regime: regimeResult, backtest: backtestResult }),
      noiseHeadlines: newsResult.headlines.filter((h) => !h.isSignal).length,
      signalHeadlines: newsResult.headlines.filter((h) => h.isSignal).length,
    };
    await writeJournalEntry(journalData);
    return { action: "skip", analysis: ensemble.groqAnalysis, ensemble, journal: journalData };
  }

  // Step 9: Use the ensemble-agreed analysis to propose a trade
  const analysis = ensemble.groqAnalysis.action !== "skip" ? ensemble.groqAnalysis : ensemble.geminiAnalysis;

  if (analysis.action === "skip") {
    const journalData: JournalEntryData = {
      decisionType: "skip",
      observation: `${symbol}: ${regimeResult.regime}. Price: $${priceResult.price}. ${newsResult.summary}`,
      strategy: `${strategy} — both models recommend skip`,
      thesis: analysis.thesis,
      confidence: `${ensemble.adjustedConfidence.toFixed(2)} (ensemble-adjusted)`,
      riskCalculation: "No trade proposed",
      auditTrail: JSON.stringify({ ensemble, regime: regimeResult }),
      noiseHeadlines: newsResult.headlines.filter((h) => !h.isSignal).length,
      signalHeadlines: newsResult.headlines.filter((h) => h.isSignal).length,
    };
    await writeJournalEntry(journalData);
    return { action: "skip", analysis, ensemble, journal: journalData };
  }

  // Step 10: Calculate position size
  const sizing = calculatePositionSize(equity, analysis.entryPrice, analysis.stopLoss);

  // Shrink if ensemble partially disagrees
  const finalQuantity = ensemble.finalAction === "shrink"
    ? Math.max(1, Math.floor(sizing.quantity * 0.5))
    : sizing.quantity;

  if (finalQuantity <= 0) {
    const journalData: JournalEntryData = {
      decisionType: "rejected",
      observation: `${symbol}: ${regimeResult.regime}. Price: $${priceResult.price}`,
      strategy,
      thesis: analysis.thesis,
      confidence: `${ensemble.adjustedConfidence.toFixed(2)}`,
      riskCalculation: `Position size calculated to 0 shares. Entry: $${analysis.entryPrice}, Stop: $${analysis.stopLoss}`,
      auditTrail: JSON.stringify({ sizing, ensemble }),
      noiseHeadlines: newsResult.headlines.filter((h) => !h.isSignal).length,
      signalHeadlines: newsResult.headlines.filter((h) => h.isSignal).length,
    };
    await writeJournalEntry(journalData);
    return { action: "skip", analysis, ensemble, journal: journalData };
  }

  // Step 11: Build order and run through risk gate
  const order: BracketOrder = {
    symbol,
    side: analysis.action as "buy" | "sell",
    quantity: finalQuantity,
    limitPrice: analysis.entryPrice,
    stopLoss: analysis.stopLoss,
    takeProfit: analysis.takeProfit,
    market,
  };

  const state = await prisma.agentState.findUnique({ where: { id: "singleton" } });
  const riskCheck = await checkRiskGate(order, equity, currentPositions, state?.dailyPnl || 0, ensemble);

  // Step 12: Execute or reject based on risk gate
  if (!riskCheck.approved) {
    const journalData: JournalEntryData = {
      decisionType: "rejected",
      observation: `${symbol}: ${regimeResult.regime}. Price: $${priceResult.price}. ${newsResult.summary}`,
      strategy,
      thesis: `${analysis.thesis}\nInvalidation: ${analysis.invalidation}`,
      confidence: `Groq: ${ensemble.groqAnalysis.confidence.toFixed(2)}, Gemini: ${ensemble.geminiAnalysis.confidence.toFixed(2)}, Ensemble: ${ensemble.adjustedConfidence.toFixed(2)}`,
      riskCalculation: `REJECTED by risk gate:\n${riskCheck.reasons.join("\n")}`,
      auditTrail: JSON.stringify({ order, riskCheck, ensemble, regime: regimeResult }),
      noiseHeadlines: newsResult.headlines.filter((h) => !h.isSignal).length,
      signalHeadlines: newsResult.headlines.filter((h) => h.isSignal).length,
    };
    await writeJournalEntry(journalData);
    return { action: "skip", trade: order, analysis, ensemble, riskCheck, journal: journalData };
  }

  // Adjust quantity if risk gate suggests it
  if (riskCheck.adjustedQuantity) {
    order.quantity = riskCheck.adjustedQuantity;
  }

  // Step 13: Submit the order
  const result = await broker.submitOrder(order);

  // Step 14: Record trade in DB
  if (result.success) {
    await prisma.trade.create({
      data: {
        symbol,
        side: order.side,
        quantity: order.quantity,
        entryPrice: result.filledPrice || order.limitPrice || 0,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit || null,
        status: "filled",
        strategy,
        market,
        brokerOrderId: result.orderId || null,
        confidence: ensemble.adjustedConfidence,
        groqConfidence: ensemble.groqAnalysis.confidence,
        geminiConfidence: ensemble.geminiAnalysis.confidence,
        ensembleAction: ensemble.finalAction,
        thesis: analysis.thesis,
        invalidation: analysis.invalidation,
      },
    });
  }

  // Step 15: Write complete journal entry
  const journalData: JournalEntryData = {
    decisionType: "trade",
    observation: `${symbol}: ${regimeResult.regime}. Price: $${priceResult.price}. ${newsResult.summary}`,
    strategy: `${strategy} (backtest: ${backtestResult.testReturn} return, Sharpe ${backtestResult.testSharpe})`,
    thesis: `THESIS: ${analysis.thesis}\nINVALIDATION: ${analysis.invalidation}`,
    confidence: `Groq: ${ensemble.groqAnalysis.confidence.toFixed(2)}, Gemini: ${ensemble.geminiAnalysis.confidence.toFixed(2)}, Ensemble: ${ensemble.adjustedConfidence.toFixed(2)}, Agreement: ${ensemble.agreement.toFixed(2)}`,
    riskCalculation: `${order.side.toUpperCase()} ${order.quantity} ${symbol} @ $${order.limitPrice?.toFixed(2)}. Stop: $${order.stopLoss.toFixed(2)}. Risk: $${sizing.riskAmount.toFixed(2)} (${(sizing.riskPercent * 100).toFixed(1)}%). ${riskCheck.reasons.join(". ")}`,
    outcome: result.success
      ? `Order filled: ${result.orderId}, price: $${result.filledPrice?.toFixed(2) || "pending"}`
      : `Order FAILED: ${result.error}`,
    auditTrail: JSON.stringify({
      order,
      result,
      riskCheck,
      ensemble: { agreement: ensemble.agreement, finalAction: ensemble.finalAction },
      regime: regimeResult,
      backtest: backtestResult,
    }),
    noiseHeadlines: newsResult.headlines.filter((h) => !h.isSignal).length,
    signalHeadlines: newsResult.headlines.filter((h) => h.isSignal).length,
  };
  await writeJournalEntry(journalData);

  return { action: "execute_trade", trade: order, analysis, ensemble, riskCheck, journal: journalData };
}

// ---- Journal Writer ----
async function writeJournalEntry(data: JournalEntryData): Promise<void> {
  try {
    await prisma.journalEntry.create({
      data: {
        decisionType: data.decisionType,
        observation: data.observation,
        strategy: data.strategy,
        thesis: data.thesis,
        confidence: data.confidence,
        riskCalculation: data.riskCalculation,
        outcome: data.outcome || null,
        auditTrail: data.auditTrail,
        signalScore: data.signalScore || null,
        noiseHeadlines: data.noiseHeadlines,
        signalHeadlines: data.signalHeadlines,
      },
    });
  } catch (error) {
    console.error("[Journal] Failed to write entry:", error);
  }
}

// ---- Daily Snapshot ----
async function updateDailySnapshot(equity: number, decisions: AgentDecision[]): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const state = await prisma.agentState.findUnique({ where: { id: "singleton" } });

  const trades = decisions.filter((d) => d.action === "execute_trade").length;
  const skips = decisions.filter((d) => d.action === "skip").length;
  const rejected = decisions.filter((d) => d.journal.decisionType === "rejected").length;
  const totalHeadlines = decisions.reduce((s, d) => s + d.journal.noiseHeadlines + d.journal.signalHeadlines, 0);
  const signalHeadlines = decisions.reduce((s, d) => s + d.journal.signalHeadlines, 0);

  try {
    await prisma.dailySnapshot.upsert({
      where: { date: today },
      update: {
        equity,
        dailyPnl: state?.dailyPnl || 0,
        tradesExecuted: { increment: trades },
        tradesSkipped: { increment: skips },
        tradesRejected: { increment: rejected },
        headlinesRead: { increment: totalHeadlines },
        headlinesActedOn: { increment: signalHeadlines },
      },
      create: {
        date: today,
        equity,
        dailyPnl: state?.dailyPnl || 0,
        openPositions: state ? await prisma.position.count({ where: { status: "open" } }) : 0,
        tradesExecuted: trades,
        tradesSkipped: skips,
        tradesRejected: rejected,
        headlinesRead: totalHeadlines,
        headlinesActedOn: signalHeadlines,
      },
    });
  } catch (error) {
    console.error("[Agent] Failed to update daily snapshot:", error);
  }
}

// ---- Agent Lifecycle ----
const DEFAULT_WATCHLIST = {
  stock: ["AAPL", "MSFT", "GOOGL", "TSLA", "NVDA"],
  crypto: ["BTC/USDT", "ETH/USDT", "SOL/USDT"],
};

export async function startAgent(watchlist = DEFAULT_WATCHLIST, intervalMs = 5 * 60 * 1000): Promise<void> {
  if (agentRunning) {
    console.log("[Agent] Already running");
    return;
  }

  console.log("[Agent] Starting autonomous agent loop...");
  agentRunning = true;

  await prisma.agentState.upsert({
    where: { id: "singleton" },
    update: { isRunning: true, killSwitch: false, lastHeartbeat: new Date() },
    create: { id: "singleton", isRunning: true, killSwitch: false, lastHeartbeat: new Date() },
  });

  // Run immediately, then on interval
  try {
    await runAgentCycle(watchlist);
  } catch (error) {
    console.error("[Agent] Initial cycle error:", error);
  }

  agentInterval = setInterval(async () => {
    if (!agentRunning) {
      if (agentInterval) clearInterval(agentInterval);
      return;
    }
    try {
      await runAgentCycle(watchlist);
    } catch (error) {
      console.error("[Agent] Cycle error:", error);
    }
  }, intervalMs);
}

export async function stopAgent(): Promise<void> {
  console.log("[Agent] Stopping agent loop...");
  agentRunning = false;

  if (agentInterval) {
    clearInterval(agentInterval);
    agentInterval = null;
  }

  await prisma.agentState.update({
    where: { id: "singleton" },
    data: { isRunning: false, lastHeartbeat: new Date() },
  });
}

export function isAgentRunning(): boolean {
  return agentRunning;
}

export { runAgentCycle, DEFAULT_WATCHLIST };
