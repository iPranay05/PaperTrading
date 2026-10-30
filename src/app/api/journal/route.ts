import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const filter = searchParams.get("filter"); // "all" | "trade" | "skip" | "rejected"
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const where: { decisionType?: string } = {};
    if (filter && filter !== "all") {
      where.decisionType = filter;
    }

    const entries = await prisma.journalEntry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        trade: true,
      },
    });

    const counts = {
      all: await prisma.journalEntry.count(),
      trades: await prisma.journalEntry.count({ where: { decisionType: "trade" } }),
      skips: await prisma.journalEntry.count({ where: { decisionType: "skip" } }),
      rejected: await prisma.journalEntry.count({ where: { decisionType: "rejected" } }),
    };

    return NextResponse.json({
      entries,
      counts,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
