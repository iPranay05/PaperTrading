import { NextResponse } from "next/server";
import prisma from "@/lib/db";

// POST only, so a link prefetch cannot overwrite your data.
export async function POST() {
  try {
    await prisma.agentState.upsert({
      where: { id: "singleton" },
      update: {
        currentEquity: 1042500,
        startingEquity: 1000000,
        dailyPnl: 8500,
      },
      create: {
        id: "singleton",
        currentEquity: 1042500,
        startingEquity: 1000000,
        dailyPnl: 8500,
      },
    });

    await prisma.position.deleteMany({});
    await prisma.position.createMany({
      data: [
        {
          symbol: "RELIANCE.NS",
          side: "buy",
          quantity: 40,
          entryPrice: 2950.00,
          currentPrice: 2995.50,
          stopLoss: 2880.00,
          unrealizedPnl: 1820.00,
          market: "stock",
          status: "open",
        },
        {
          symbol: "TCS.NS",
          side: "buy",
          quantity: 25,
          entryPrice: 4120.00,
          currentPrice: 4185.00,
          stopLoss: 4020.00,
          unrealizedPnl: 1625.00,
          market: "stock",
          status: "open",
        },
        {
          symbol: "INFY.NS",
          side: "buy",
          quantity: 60,
          entryPrice: 1840.00,
          currentPrice: 1872.00,
          stopLoss: 1790.00,
          unrealizedPnl: 1920.00,
          market: "stock",
          status: "open",
        },
      ],
    });

    return NextResponse.json({ success: true, message: "Updated database to Indian stocks and INR" });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
