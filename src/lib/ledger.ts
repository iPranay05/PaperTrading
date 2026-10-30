// ============================================================
// Ledger — closes trades, records realised P&L, tracks daily P&L
// Deterministic, NO LLM calls. Shared by the simulated broker,
// the kill switch and the agent loop.
// ============================================================

import prisma from "@/lib/db";
import type { OrderSide } from "@/lib/types";

export type ExitReason = "stop_loss" | "take_profit" | "manual" | "kill_switch";

// Realised P&L of a closed trade (long: exit − entry, short: entry − exit).
export function computePnl(
  side: OrderSide | string,
  entryPrice: number,
  exitPrice: number,
  quantity: number
): number {
  const perShare = side === "buy" ? exitPrice - entryPrice : entryPrice - exitPrice;
  return perShare * quantity;
}

function todayUtc(): string {
  return new Date().toISOString().split("T")[0];
}

// Adds realised P&L to AgentState.dailyPnl, rolling the counter over to
// zero first if the stored date is not today.
export async function addDailyPnl(pnl: number): Promise<void> {
  const today = todayUtc();
  const state = await prisma.agentState.findUnique({ where: { id: "singleton" } });

  if (!state) {
    await prisma.agentState.create({
      data: { id: "singleton", dailyPnl: pnl, lastResetDate: today },
    });
    return;
  }

  if (state.lastResetDate !== today) {
    await prisma.agentState.update({
      where: { id: "singleton" },
      data: { dailyPnl: pnl, lastResetDate: today },
    });
    return;
  }

  await prisma.agentState.update({
    where: { id: "singleton" },
    data: { dailyPnl: { increment: pnl } },
  });
}

// Closes the open Trade that was opened by `orderId` (Trade.brokerOrderId):
// sets status/exitPrice/pnl/closedAt, adds the P&L to the daily total and
// appends the outcome to the trade's journal entry.
// Idempotent: returns null if the trade is missing or already closed.
export async function settleTrade(
  orderId: string,
  exitPrice: number,
  reason: ExitReason
): Promise<{ tradeId: string; pnl: number } | null> {
  const trade = await prisma.trade.findFirst({
    where: { brokerOrderId: orderId, status: "filled" },
  });
  if (!trade) return null;

  const pnl = computePnl(trade.side, trade.entryPrice, exitPrice, trade.quantity);

  // Claim the close atomically so two callers can't both book the P&L.
  const claimed = await prisma.trade.updateMany({
    where: { id: trade.id, status: "filled" },
    data: { status: "closed", exitPrice, pnl, closedAt: new Date() },
  });
  if (claimed.count === 0) return null;

  await addDailyPnl(pnl);

  try {
    const journal = await prisma.journalEntry.findUnique({ where: { tradeId: trade.id } });
    if (journal) {
      const line = `CLOSED (${reason}) @ ${exitPrice.toFixed(2)}, P&L ${pnl.toFixed(2)}`;
      await prisma.journalEntry.update({
        where: { id: journal.id },
        data: { outcome: journal.outcome ? `${journal.outcome}\n${line}` : line },
      });
    }
  } catch (error) {
    console.error("[Ledger] Failed to update journal outcome:", error);
  }

  return { tradeId: trade.id, pnl };
}
