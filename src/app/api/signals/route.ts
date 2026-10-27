import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { scoreHeadline } from "@/lib/llm/wrapper";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const filter = searchParams.get("filter"); // "all" | "signal" | "noise"
    const limit = parseInt(searchParams.get("limit") || "40", 10);

    const where: any = {};
    if (filter === "signal") where.isSignal = true;
    if (filter === "noise") where.isNoise = true;

    const items = await prisma.newsItem.findMany({
      where,
      orderBy: { processedAt: "desc" },
      take: limit,
    });

    const signalCount = await prisma.newsItem.count({ where: { isSignal: true } });
    const noiseCount = await prisma.newsItem.count({ where: { isNoise: true } });
    const totalCount = await prisma.newsItem.count();

    return NextResponse.json({
      items,
      stats: {
        total: totalCount,
        signals: signalCount,
        noise: noiseCount,
        signalRatio: totalCount > 0 ? Number(((signalCount / totalCount) * 100).toFixed(1)) : 0,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title, source, symbol } = body;

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    // Run headline through sanitization and LLM scoring
    const filterResult = await scoreHeadline(title, symbol || "GLOBAL");

    const newsItem = await prisma.newsItem.create({
      data: {
        source: source || "Manual Ingestion",
        title,
        symbol: symbol || "GLOBAL",
        sentiment: filterResult.sentiment,
        signalScore: filterResult.score,
        isSignal: filterResult.isSignal,
        isNoise: !filterResult.isSignal,
        noiseReason: !filterResult.isSignal ? filterResult.reason : undefined,
        processedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      newsItem,
      filterResult: {
        ...filterResult,
        signalScore: filterResult.score,
        isNoise: !filterResult.isSignal,
        noiseReason: filterResult.reason,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
