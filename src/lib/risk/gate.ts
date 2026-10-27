// ============================================================
// Risk Gate — Deterministic, NO LLM calls
// "The LLM proposes and deterministic code disposes"
// ============================================================

import prisma from "@/lib/db";
import type {
  BracketOrder,
  RiskCheckResult,
  PositionSizing,
  PositionInfo,
  EnsembleResult,
} from "@/lib/types";

export interface RiskConfig {
  riskPerTrade: number;      // Default 0.01 (1%)
  dailyLossLimit: number;    // Default 0.03 (3%)
  maxPositions: number;      // Default 5
  maxExposurePerSymbol: number; // Default 0.20 (20%)
  ensembleDisagreementThreshold: number; // Default 0.5
}

const DEFAULT_CONFIG: RiskConfig = {
  riskPerTrade: 0.01,
  dailyLossLimit: 0.03,
  maxPositions: 5,
  maxExposurePerSymbol: 0.20,
  ensembleDisagreementThreshold: 0.5,
};

// ---- Position Sizing ----
// Size = (equity × riskPercent) / (entry − stop)
export function calculatePositionSize(
  equity: number,
  entryPrice: number,
  stopLoss: number,
  riskPercent: number = 0.01
): PositionSizing {
  const riskPerShare = Math.abs(entryPrice - stopLoss);
  if (riskPerShare <= 0) {
    throw new Error("Stop loss must be different from entry price");
  }

  const riskAmount = equity * riskPercent;
  const quantity = Math.floor(riskAmount / riskPerShare);
  const positionValue = quantity * entryPrice;

  return {
    quantity: Math.max(quantity, 0),
    riskAmount,
    riskPercent,
    entryPrice,
    stopLoss,
    positionValue,
  };
}

// ---- Main Risk Gate ----
export async function checkRiskGate(
  order: BracketOrder,
  equity: number,
  currentPositions: PositionInfo[],
  dailyPnl: number,
  ensemble?: EnsembleResult,
  config: RiskConfig = DEFAULT_CONFIG
): Promise<RiskCheckResult> {
  const reasons: string[] = [];
  const checks = {
    stopLossPresent: false,
    withinRiskPerTrade: false,
    withinDailyLimit: false,
    withinMaxPositions: false,
    withinMaxExposure: false,
    killSwitchOff: false,
    ensembleAgreed: false,
  };

  // 1. Check kill switch
  const state = await prisma.agentState.findUnique({ where: { id: "singleton" } });
  checks.killSwitchOff = !(state?.killSwitch ?? false);
  if (!checks.killSwitchOff) {
    reasons.push("KILL SWITCH IS ACTIVE — all orders blocked");
    return { approved: false, reasons, checks };
  }

  // 2. Mandatory stop-loss
  checks.stopLossPresent = order.stopLoss > 0;
  if (!checks.stopLossPresent) {
    reasons.push("Order rejected: no stop-loss provided (mandatory)");
  }

  // 3. Risk per trade
  const riskPerShare = Math.abs(order.limitPrice || 0 - order.stopLoss);
  const tradeRisk = riskPerShare * order.quantity;
  const maxTradeRisk = equity * config.riskPerTrade;
  checks.withinRiskPerTrade = tradeRisk <= maxTradeRisk * 1.01; // 1% tolerance
  if (!checks.withinRiskPerTrade) {
    reasons.push(
      `Trade risk $${tradeRisk.toFixed(2)} exceeds ${(config.riskPerTrade * 100).toFixed(1)}% limit of $${maxTradeRisk.toFixed(2)}`
    );
  }

  // 4. Daily loss limit
  const dailyLossLimitAmount = equity * config.dailyLossLimit;
  const worstCase = dailyPnl - tradeRisk;
  checks.withinDailyLimit = Math.abs(dailyPnl) < dailyLossLimitAmount;
  if (!checks.withinDailyLimit) {
    reasons.push(
      `Daily loss $${Math.abs(dailyPnl).toFixed(2)} already at/beyond ${(config.dailyLossLimit * 100).toFixed(1)}% limit of $${dailyLossLimitAmount.toFixed(2)}. Trading halted until next day.`
    );
  }

  // 5. Max open positions
  const openPositionCount = currentPositions.filter((p) => p.quantity > 0).length;
  checks.withinMaxPositions = openPositionCount < config.maxPositions;
  if (!checks.withinMaxPositions) {
    reasons.push(
      `${openPositionCount} positions open, max is ${config.maxPositions}. Extra proposals rejected.`
    );
  }

  // 6. Max exposure per symbol
  const existingExposure = currentPositions
    .filter((p) => p.symbol === order.symbol)
    .reduce((sum, p) => sum + p.quantity * p.currentPrice, 0);
  const newExposure = existingExposure + order.quantity * (order.limitPrice || 0);
  const maxExposure = equity * config.maxExposurePerSymbol;
  checks.withinMaxExposure = newExposure <= maxExposure;
  if (!checks.withinMaxExposure) {
    reasons.push(
      `Exposure to ${order.symbol} would be $${newExposure.toFixed(2)} (${((newExposure / equity) * 100).toFixed(1)}%), exceeding ${(config.maxExposurePerSymbol * 100).toFixed(1)}% limit of $${maxExposure.toFixed(2)}`
    );
  }

  // 7. Ensemble agreement
  if (ensemble) {
    checks.ensembleAgreed = ensemble.finalAction !== "skip";
    if (!checks.ensembleAgreed) {
      reasons.push(
        `Ensemble disagreement: ${ensemble.disagreementReason || "Models disagree on trade direction"}`
      );
    }
  } else {
    checks.ensembleAgreed = true; // No ensemble check required
  }

  // Determine approval
  const approved = Object.values(checks).every((v) => v === true);

  // Calculate adjusted quantity if exposure too high
  let adjustedQuantity: number | undefined;
  if (!checks.withinMaxExposure && checks.stopLossPresent && checks.withinDailyLimit) {
    const availableExposure = maxExposure - existingExposure;
    if (availableExposure > 0 && order.limitPrice) {
      adjustedQuantity = Math.floor(availableExposure / order.limitPrice);
    }
  }

  if (approved) {
    reasons.push("All risk checks passed ✓");
  }

  return { approved, adjustedQuantity, reasons, checks };
}

// ---- Kill Switch ----
export async function activateKillSwitch(): Promise<void> {
  await prisma.agentState.upsert({
    where: { id: "singleton" },
    update: { killSwitch: true, isRunning: false },
    create: { id: "singleton", killSwitch: true, isRunning: false },
  });
}

export async function deactivateKillSwitch(): Promise<void> {
  await prisma.agentState.update({
    where: { id: "singleton" },
    data: { killSwitch: false },
  });
}

export async function isKillSwitchActive(): Promise<boolean> {
  const state = await prisma.agentState.findUnique({ where: { id: "singleton" } });
  return state?.killSwitch ?? false;
}

// ---- Daily Loss Limit Tracker ----
export async function checkAndResetDailyLimit(): Promise<{ dailyPnl: number; limitReached: boolean }> {
  const state = await prisma.agentState.findUnique({ where: { id: "singleton" } });
  if (!state) return { dailyPnl: 0, limitReached: false };

  const today = new Date().toISOString().split("T")[0];

  // Reset if new day
  if (state.lastResetDate !== today) {
    await prisma.agentState.update({
      where: { id: "singleton" },
      data: { dailyPnl: 0, lastResetDate: today },
    });
    return { dailyPnl: 0, limitReached: false };
  }

  const limitAmount = state.currentEquity * state.dailyLossLimit;
  return {
    dailyPnl: state.dailyPnl,
    limitReached: Math.abs(state.dailyPnl) >= limitAmount,
  };
}

// ---- Paper-Only Assertion ----
export function assertPaperMode(brokerUrl: string): void {
  const paperPatterns = [
    "paper-api.alpaca.markets",
    "testnet",
    "sandbox",
    "paper",
    "demo",
    "localhost",
    "127.0.0.1",
  ];

  const isPaper = paperPatterns.some((p) => brokerUrl.toLowerCase().includes(p));
  if (!isPaper) {
    throw new Error(
      `SAFETY ASSERTION FAILED: Broker URL "${brokerUrl}" does not appear to be a paper/sandbox endpoint. ` +
      `This bot is designed for paper trading ONLY. Refusing to start.`
    );
  }
}
