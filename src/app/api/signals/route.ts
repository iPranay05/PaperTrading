import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { scoreHeadline } from "@/lib/llm/wrapper";
import { sanitizeUntrusted } from "@/lib/security/sanitize";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const filter = searchParams.get("filter"); // "all" | "signal" | "noise"
    const limit = parseInt(searchParams.get("limit") || "40", 10);

    const where: { isSignal?: boolean; isNoise?: boolean } = {};
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
    const { source, symbol } = body;
    const rawTitle = typeof body.title === "string" ? body.title : "";

    if (!rawTitle.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    // Persist only the sanitized, single-line form; injection-looking input is rejected inside scoreHeadline
    // before any LLM call.
    const title = sanitizeUntrusted(rawTitle).text;
    const filterResult = await scoreHeadline(rawTitle, symbol || "GLOBAL");

    const newsItem = await prisma.newsItem.create({
      data: {
        source: sanitizeUntrusted(source || "Manual Ingestion", 80).text,
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
        sanitizedTitle: title,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
