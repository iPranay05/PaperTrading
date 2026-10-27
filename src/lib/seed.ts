import prisma from "./db";

export async function ensureInitialData() {
  try {
    const existingState = await prisma.agentState.findUnique({
      where: { id: "singleton" },
    });

    if (existingState) return; // already initialized

    console.log("[Init] Initializing clean paper trading environment (₹10,00,000 starting capital)...");

    // Initial Clean Agent State
    await prisma.agentState.create({
      data: {
        id: "singleton",
        isRunning: false,
        killSwitch: false,
        currentEquity: 1000000.0,
        startingEquity: 1000000.0,
        dailyPnl: 0.0,
        dailyLossLimit: 0.03,
        riskPerTrade: 0.01,
        maxPositions: 5,
        maxExposure: 0.20,
        currentRegime: "ranging",
        activeStrategy: "rsi_reversion",
      },
    });

    // Initial clean snapshot for today
    const todayStr = new Date().toISOString().split("T")[0];
    await prisma.dailySnapshot.upsert({
      where: { date: todayStr },
      update: {},
      create: {
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

    console.log("[Init] Fresh clean environment ready.");
  } catch (err) {
    console.warn("[Init] Warning initializing state:", err);
  }
}

