import { NextResponse } from "next/server";
import prisma from "@/lib/db";

interface ConfidenceBucket {
  range: string;
  min: number;
  max: number;
  totalPredictions: number;
  successfulTrades: number;
  actualWinRate: number;
  expectedWinRate: number;
  brierScoreContribution: number;
}

export async function GET() {
  try {
    const closedTrades = await prisma.trade.findMany({
      where: {
        status: "closed",
        confidence: { not: null },
        pnl: { not: null },
      },
      orderBy: { closedAt: "desc" },
    });

    const buckets: ConfidenceBucket[] = [
      { range: "50% - 60%", min: 0.5, max: 0.6, totalPredictions: 0, successfulTrades: 0, actualWinRate: 0, expectedWinRate: 55, brierScoreContribution: 0 },
      { range: "60% - 70%", min: 0.6, max: 0.7, totalPredictions: 0, successfulTrades: 0, actualWinRate: 0, expectedWinRate: 65, brierScoreContribution: 0 },
      { range: "70% - 80%", min: 0.7, max: 0.8, totalPredictions: 0, successfulTrades: 0, actualWinRate: 0, expectedWinRate: 75, brierScoreContribution: 0 },
      { range: "80% - 90%", min: 0.8, max: 0.9, totalPredictions: 0, successfulTrades: 0, actualWinRate: 0, expectedWinRate: 85, brierScoreContribution: 0 },
      { range: "90% - 100%", min: 0.9, max: 1.01, totalPredictions: 0, successfulTrades: 0, actualWinRate: 0, expectedWinRate: 95, brierScoreContribution: 0 },
    ];

    let totalBrierSquaredError = 0;
    const evaluatedTrades = closedTrades.map((t) => {
      const conf = t.confidence ?? 0.5;
      const isWin = (t.pnl ?? 0) > 0;
      const outcome = isWin ? 1 : 0;
      const squaredError = Math.pow(conf - outcome, 2);
      totalBrierSquaredError += squaredError;

      // Assign to bucket
      for (const b of buckets) {
        if (conf >= b.min && conf < b.max) {
          b.totalPredictions++;
          if (isWin) b.successfulTrades++;
          b.brierScoreContribution += squaredError;
          break;
        }
      }

      return {
        id: t.id,
        symbol: t.symbol,
        confidence: conf,
        groqConfidence: t.groqConfidence,
        geminiConfidence: t.geminiConfidence,
        ensembleAction: t.ensembleAction,
        isWin,
        pnl: t.pnl,
        closedAt: t.closedAt,
      };
    });

    // Compute actual win rates
    buckets.forEach((b) => {
      b.actualWinRate = b.totalPredictions > 0
        ? Number(((b.successfulTrades / b.totalPredictions) * 100).toFixed(1))
        : 0;
    });

    const brierScore = evaluatedTrades.length > 0
      ? Number((totalBrierSquaredError / evaluatedTrades.length).toFixed(4))
      : 0.25; // baseline uninformative score

    return NextResponse.json({
      totalTradesEvaluated: evaluatedTrades.length,
      brierScore,
      interpretation:
        brierScore < 0.15
          ? "Excellent calibration — model confidence closely mirrors probability of winning."
          : brierScore < 0.25
          ? "Moderate calibration — slight overconfidence or underconfidence detected."
          : "Poor calibration — model requires shrinkage or re-prompting.",
      buckets,
      recentEvaluated: evaluatedTrades.slice(0, 15),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
