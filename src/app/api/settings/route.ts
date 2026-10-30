import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

export async function GET() {
  try {
    const state = await prisma.agentState.upsert({
      where: { id: "singleton" },
      update: {},
      create: {
        id: "singleton",
        currentEquity: 1000000,
        startingEquity: 1000000,
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
      binanceConfigured: !!(process.env.CRYPTO_API_KEY && process.env.CRYPTO_API_SECRET),
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

// Same bounds as the Settings form. The form's min/max are not enforced when the
// API is called directly, and these values now drive the live risk gate.
const BOUNDS = {
  riskPerTrade: { min: 0.001, max: 0.05 },
  dailyLossLimit: { min: 0.01, max: 0.1 },
  maxPositions: { min: 1, max: 15 },
  maxExposure: { min: 0.05, max: 0.5 },
} as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed: Record<string, number | undefined> = {};

    // Missing / null fields are left unchanged.
    for (const field of Object.keys(BOUNDS) as (keyof typeof BOUNDS)[]) {
      const raw = body[field];
      if (raw === undefined || raw === null || raw === "") continue;
      const value = field === "maxPositions" ? Number(raw) : parseFloat(raw);
      const { min, max } = BOUNDS[field];
      if (!Number.isFinite(value) || value < min || value > max || (field === "maxPositions" && !Number.isInteger(value))) {
        return NextResponse.json(
          { error: `${field} must be ${field === "maxPositions" ? "a whole number " : "a number "}between ${min} and ${max}` },
          { status: 400 }
        );
      }
      parsed[field] = value;
    }

    let currentEquity: number | undefined;
    if (body.currentEquity !== undefined && body.currentEquity !== null && body.currentEquity !== "") {
      currentEquity = parseFloat(body.currentEquity);
      if (!Number.isFinite(currentEquity) || currentEquity <= 0) {
        return NextResponse.json({ error: "currentEquity must be a positive number" }, { status: 400 });
      }
    }

    const updated = await prisma.agentState.upsert({
      where: { id: "singleton" },
      update: { ...parsed, currentEquity },
      create: {
        id: "singleton",
        riskPerTrade: parsed.riskPerTrade ?? 0.01,
        dailyLossLimit: parsed.dailyLossLimit ?? 0.03,
        maxPositions: parsed.maxPositions ?? 5,
        maxExposure: parsed.maxExposure ?? 0.2,
        currentEquity: currentEquity ?? 1000000,
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
