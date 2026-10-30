import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const market = searchParams.get("market");

    const where: { market?: string } = {};
    if (market && (market === "stock" || market === "crypto")) {
      where.market = market;
    }

    const trades = await prisma.trade.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        journalEntry: true,
      },
    });

    // Compute basic statistics
    const closedTrades = await prisma.trade.findMany({
      where: { status: "closed", pnl: { not: null } },
    });

    const totalClosed = closedTrades.length;
    const winningTrades = closedTrades.filter((t) => (t.pnl ?? 0) > 0);
    const losingTrades = closedTrades.filter((t) => (t.pnl ?? 0) < 0);
    const totalPnl = closedTrades.reduce((acc, t) => acc + (t.pnl ?? 0), 0);
    const winRate = totalClosed > 0 ? (winningTrades.length / totalClosed) * 100 : 0;

    const grossProfit = winningTrades.reduce((acc, t) => acc + (t.pnl ?? 0), 0);
    const grossLoss = Math.abs(losingTrades.reduce((acc, t) => acc + (t.pnl ?? 0), 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

    return NextResponse.json({
      trades,
      stats: {
        totalTrades: totalClosed,
        winningTrades: winningTrades.length,
        losingTrades: losingTrades.length,
        winRate: Number(winRate.toFixed(1)),
        totalPnl: Number(totalPnl.toFixed(2)),
        profitFactor: Number(profitFactor.toFixed(2)),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
