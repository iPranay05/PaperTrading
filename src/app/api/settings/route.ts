import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

export async function GET() {
  try {
    const state = await prisma.agentState.upsert({
      where: { id: "singleton" },
      update: {},
      create: {
        id: "singleton",
        currentEquity: 100000,
        startingEquity: 100000,
        dailyLossLimit: 0.03,
        riskPerTrade: 0.01,
        maxPositions: 5,
        maxExposure: 0.20,
      },
    });

    const envStatus = {
      groqConfigured: !!process.env.GROQ_API_KEY,
      geminiConfigured: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      alpacaConfigured: !!(process.env.ALPACA_API_KEY && process.env.ALPACA_API_SECRET),
      binanceConfigured: !!process.env.BINANCE_API_KEY,
      databaseUrl: "SQLite dev.db",
      mode: "PAPER TRADING ONLY",
    };

    return NextResponse.json({
      settings: state,
      envStatus,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { riskPerTrade, dailyLossLimit, maxPositions, maxExposure, currentEquity } = body;

    const updated = await prisma.agentState.upsert({
      where: { id: "singleton" },
      update: {
        riskPerTrade: riskPerTrade !== undefined ? parseFloat(riskPerTrade) : undefined,
        dailyLossLimit: dailyLossLimit !== undefined ? parseFloat(dailyLossLimit) : undefined,
        maxPositions: maxPositions !== undefined ? parseInt(maxPositions, 10) : undefined,
        maxExposure: maxExposure !== undefined ? parseFloat(maxExposure) : undefined,
        currentEquity: currentEquity !== undefined ? parseFloat(currentEquity) : undefined,
      },
      create: {
        id: "singleton",
        riskPerTrade: riskPerTrade ? parseFloat(riskPerTrade) : 0.01,
        dailyLossLimit: dailyLossLimit ? parseFloat(dailyLossLimit) : 0.03,
        maxPositions: maxPositions ? parseInt(maxPositions, 10) : 5,
        maxExposure: maxExposure ? parseFloat(maxExposure) : 0.20,
        currentEquity: currentEquity ? parseFloat(currentEquity) : 100000,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Risk parameters updated successfully",
      settings: updated,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
