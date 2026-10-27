import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { AlpacaPaperBroker } from "@/lib/broker/adapters";
import { CryptoTestnetBroker } from "@/lib/broker/adapters";

export async function GET() {
  try {
    const state = await prisma.agentState.findUnique({ where: { id: "singleton" } });
    return NextResponse.json({
      killSwitchActive: state?.killSwitch ?? false,
      lastHeartbeat: state?.lastHeartbeat,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { action } = body; // "activate" | "deactivate"

    const shouldActivate = action !== "deactivate";

    // Update state in DB
    const state = await prisma.agentState.upsert({
      where: { id: "singleton" },
      update: {
        killSwitch: shouldActivate,
        isRunning: shouldActivate ? false : undefined,
      },
      create: {
        id: "singleton",
        killSwitch: shouldActivate,
        isRunning: false,
      },
    });

    if (shouldActivate) {
      // Emergency liquidation: Cancel all orders & close positions
      try {
        const alpaca = new AlpacaPaperBroker();
        await alpaca.cancelAllOrders();
        await alpaca.closeAllPositions();
      } catch (err) {
        console.warn("[KillSwitch] Alpaca close error (non-fatal if mock/no key):", err);
      }

      try {
        const crypto = new CryptoTestnetBroker();
        await crypto.cancelAllOrders();
        await crypto.closeAllPositions();
      } catch (err) {
        console.warn("[KillSwitch] Crypto close error:", err);
      }

      // Mark all open positions in DB as closed
      await prisma.position.updateMany({
        where: { status: "open" },
        data: { status: "closed" },
      });

      // Pre-register journal entry for emergency liquidation
      await prisma.journalEntry.create({
        data: {
          decisionType: "rejected",
          observation: "EMERGENCY KILL SWITCH ENGAGED by operator.",
          strategy: "capital_preservation",
          thesis: "Manual override triggered to halt all trading operations and liquidate/cancel open orders.",
          confidence: "1.00",
          riskCalculation: "Zero exposure target. All active risk mitigated.",
          auditTrail: JSON.stringify({ trigger: "manual_kill_switch", timestamp: new Date().toISOString() }),
        },
      });
    }

    return NextResponse.json({
      success: true,
      killSwitchActive: shouldActivate,
      message: shouldActivate ? "Kill switch activated: all trading halted and positions flagged closed." : "Kill switch deactivated. Bot can be restarted.",
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
