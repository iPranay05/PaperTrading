import { NextResponse } from "next/server";
import prisma from "@/lib/db";

export async function GET() {
  try {
    // Attempt to pull live broker positions if configured, or fall back to DB
    const dbPositions = await prisma.position.findMany({
      where: { status: "open" },
      orderBy: { createdAt: "desc" },
    });

    const state = await prisma.agentState.findUnique({ where: { id: "singleton" } });
    const equity = state?.currentEquity || 1000000;

    let totalUnrealizedPnl = 0;
    const enriched = dbPositions.map((pos) => {
      const uPnl = (pos.currentPrice - pos.entryPrice) * pos.quantity * (pos.side === "buy" ? 1 : -1);
      totalUnrealizedPnl += uPnl;
      const exposurePct = ((pos.currentPrice * pos.quantity) / equity) * 100;
      return {
        ...pos,
        unrealizedPnl: Number(uPnl.toFixed(2)),
        exposurePct: Number(exposurePct.toFixed(1)),
      };
    });

    return NextResponse.json({
      positions: enriched,
      count: enriched.length,
      totalUnrealizedPnl: Number(totalUnrealizedPnl.toFixed(2)),
      equity,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
