import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { runFullBacktest } from "@/lib/backtest/engine";
import type { BacktestConfig, StrategyName, MarketType } from "@/lib/types";

export async function GET() {
  try {
    const results = await prisma.backtestResult.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const strategy = (body.strategy || "sma_crossover") as StrategyName;
    const symbol = (body.symbol || "AAPL").toUpperCase();
    const market = (body.market || (symbol.includes("USDT") || symbol.includes("BTC") ? "crypto" : "stock")) as MarketType;
    
    // Dates defaulting to the last 3 years — a 1-year window leaves only ~75 out-of-sample bars
    const end = new Date();
    const start = new Date();
    start.setFullYear(start.getFullYear() - 3);

    const config: BacktestConfig = {
      strategy,
      symbol,
      market,
      startDate: body.startDate || start.toISOString().split("T")[0],
      endDate: body.endDate || end.toISOString().split("T")[0],
      initialCapital: body.initialCapital || 10000,
      feeRate: body.feeRate !== undefined ? body.feeRate : 0.001, // 0.1%
      slippageBps: body.slippageBps !== undefined ? body.slippageBps : 5, // 5 bps
      trainTestSplit: body.trainTestSplit || 0.7,
      params: body.params || {},
      minTestBars: body.minTestBars,
      minTrades: body.minTrades,
      walkForwardFolds: body.walkForwardFolds,
    };

    const backtestResult = await runFullBacktest(config);

    // Save to database
    const saved = await prisma.backtestResult.create({
      data: {
        strategy: config.strategy,
        symbol: config.symbol,
        market: config.market,
        startDate: config.startDate,
        endDate: config.endDate,
        totalReturn: backtestResult.test.totalReturn,
        sharpeRatio: backtestResult.test.sharpeRatio,
        maxDrawdown: backtestResult.test.maxDrawdown,
        winRate: backtestResult.test.winRate,
        totalTrades: backtestResult.test.totalTrades,
        buyAndHoldReturn: backtestResult.buyAndHold.totalReturn,
        feesIncluded: true,
        slippageIncluded: true,
        outOfSample: true,
        equityCurve: JSON.stringify(backtestResult.test.equityCurve),
        // Parameters actually used going forward (fitted on training data), not the empty request params.
        parameters: JSON.stringify(backtestResult.chosenParams || {}),
      },
    });

    return NextResponse.json({
      id: saved.id,
      config,
      train: backtestResult.train,
      test: backtestResult.test,
      buyAndHold: backtestResult.buyAndHold,
      beatsHold: backtestResult.beatsHold,
      verdict: backtestResult.verdict,
      folds: backtestResult.folds,
      chosenParams: backtestResult.chosenParams,
      paramsFitted: backtestResult.paramsFitted,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
