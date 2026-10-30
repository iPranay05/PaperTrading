import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { fetchHistoricalData } from "@/lib/backtest/engine";

function sma(values: number[], period: number): (number | null)[] {
  return values.map((_, i) => {
    if (i + 1 < period) return null;
    let sum = 0;
    for (let j = i + 1 - period; j <= i; j++) sum += values[j];
    return sum / period;
  });
}

// GET /api/chart?symbol=RELIANCE.NS&market=stock&days=180
// Real daily OHLCV from Yahoo Finance (stocks) / Binance (crypto), plus SMAs and the agent's own trades.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get("symbol") || "RELIANCE.NS").trim().toUpperCase();
    if (!/^[A-Z0-9.\/:^=_-]{1,20}$/.test(symbol)) {
      return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
    }
    const market = (searchParams.get("market") || (symbol.includes("/") || symbol.endsWith("USDT") ? "crypto" : "stock")) as
      | "stock"
      | "crypto";
    const days = Math.min(1500, Math.max(7, parseInt(searchParams.get("days") || "180", 10) || 180));

    const end = new Date();
    const start = new Date();
    // Fetch extra history so the 50-bar SMA is already warmed up at the left edge of the visible window.
    start.setDate(start.getDate() - Math.ceil(days * 1.5) - 80);
    const all = await fetchHistoricalData(
      symbol,
      market,
      start.toISOString().split("T")[0],
      end.toISOString().split("T")[0]
    );

    if (all.length === 0) {
      return NextResponse.json(
        { error: `No market data returned for ${symbol}. Check the symbol and your internet connection.` },
        { status: 502 }
      );
    }

    const closes = all.map((b) => b.close);
    const s20 = sma(closes, 20);
    const s50 = sma(closes, 50);
    const visibleFrom = Math.max(0, all.length - days);

    const bars = all.slice(visibleFrom).map((b, i) => ({
      date: b.date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      sma20: s20[visibleFrom + i],
      sma50: s50[visibleFrom + i],
    }));

    const trades = await prisma.trade.findMany({
      where: { symbol },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, side: true, quantity: true, entryPrice: true, stopLoss: true, takeProfit: true,
        status: true, exitPrice: true, pnl: true, createdAt: true, closedAt: true,
      },
    });

    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];
    return NextResponse.json({
      symbol,
      market,
      bars,
      trades,
      last: last.close,
      change: prev ? last.close - prev.close : 0,
      changePct: prev ? ((last.close - prev.close) / prev.close) * 100 : 0,
      interval: "1d",
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
