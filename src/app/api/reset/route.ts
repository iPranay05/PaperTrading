import { NextResponse } from "next/server";
import prisma from "@/lib/db";

// GET & POST /api/reset — wipes all seeded/fake data and resets to clean state
export async function GET() {
  return handleReset();
}

export async function POST() {
  return handleReset();
}

async function handleReset() {
  try {
    // Delete in correct order (foreign keys)
    await prisma.journalEntry.deleteMany({});
    await prisma.trade.deleteMany({});
    await prisma.position.deleteMany({});
    await prisma.dailySnapshot.deleteMany({});
    await prisma.newsItem.deleteMany({});
    await prisma.lLMCache.deleteMany({});

    // Reset agent state to clean ₹10,00,000 starting capital
    await prisma.agentState.upsert({
      where: { id: "singleton" },
      update: {
        currentEquity: 1000000.0,
        startingEquity: 1000000.0,
        dailyPnl: 0,
        isRunning: false,
        killSwitch: false,
        currentRegime: "ranging",
        activeStrategy: "rsi_reversion",
      },
      create: {
        id: "singleton",
        currentEquity: 1000000.0,
        startingEquity: 1000000.0,
        dailyPnl: 0,
        isRunning: false,
        killSwitch: false,
        dailyLossLimit: 0.03,
        riskPerTrade: 0.01,
        maxPositions: 5,
        maxExposure: 0.20,
        currentRegime: "ranging",
        activeStrategy: "rsi_reversion",
      },
    });

    const todayStr = new Date().toISOString().split("T")[0];
    await prisma.dailySnapshot.create({
      data: {
        date: todayStr,
        equity: 1000000.0,
        dailyPnl: 0.0,
        openPositions: 0,
        tradesExecuted: 0,
        tradesSkipped: 0,
        tradesRejected: 0,
        headlinesRead: 0,
        headlinesActedOn: 0,
        calibrationHit: 0.0,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Clean slate activated: ₹10,00,000 starting cash, 0 trades, 0 positions.",
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

