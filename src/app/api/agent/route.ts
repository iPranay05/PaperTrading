// Agent Control API — Start, Stop, Trigger Cycle, Status
import { NextRequest, NextResponse } from "next/server";
import { startAgent, stopAgent, isAgentRunning, runAgentCycle, DEFAULT_WATCHLIST } from "@/lib/agent/loop";
import prisma from "@/lib/db";

export async function GET() {
  try {
    const state = await prisma.agentState.findUnique({ where: { id: "singleton" } });
    const recentJournal = await prisma.journalEntry.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { trade: true },
    });
    const today = new Date().toISOString().split("T")[0];
    const todayTrades = await prisma.trade.count({
      where: {
        createdAt: { gte: new Date(today) },
      },
    });

    const snapshots = await prisma.dailySnapshot.findMany({
      orderBy: { date: "asc" },
      take: 30,
    });

    return NextResponse.json({
      isRunning: isAgentRunning(),
      state: state || {
        currentEquity: 100000,
        startingEquity: 100000,
        killSwitch: false,
        dailyPnl: 0,
        currentRegime: "ranging",
        activeStrategy: "rsi_reversion",
      },
      recentDecisions: recentJournal,
      todayTrades,
      snapshots,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { action, watchlist, intervalMinutes } = body;

    if (action === "start") {
      const wl = watchlist || DEFAULT_WATCHLIST;
      const interval = (intervalMinutes || 5) * 60 * 1000;
      await startAgent(wl, interval);
      return NextResponse.json({ success: true, message: "Agent started successfully", watchlist: wl });
    }

    if (action === "stop") {
      await stopAgent();
      return NextResponse.json({ success: true, message: "Agent stopped successfully" });
    }

    if (action === "cycle") {
      // Execute a single cycle immediately
      const wl = watchlist || DEFAULT_WATCHLIST;
      const decision = await runAgentCycle(wl);
      return NextResponse.json({ success: true, message: "Manual agent cycle executed", decision });
    }

    return NextResponse.json({ error: "Invalid action. Use 'start', 'stop', or 'cycle'" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
