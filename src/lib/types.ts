// ============================================================
// Shared TypeScript types for the Paper Trading Bot
// ============================================================

// ---- Broker Types ----
export type MarketType = "stock" | "crypto";
export type OrderSide = "buy" | "sell";
export type OrderStatus = "pending" | "filled" | "closed" | "cancelled" | "rejected";

export interface BracketOrder {
  symbol: string;
  side: OrderSide;
  quantity: number;
  limitPrice?: number;
  stopLoss: number;
  takeProfit?: number;
  market: MarketType;
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  filledPrice?: number;
  filledQuantity?: number;
  error?: string;
  timestamp: Date;
}

export interface PositionInfo {
  symbol: string;
  side: OrderSide;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  market: MarketType;
}

export interface BrokerAccount {
  equity: number;
  buyingPower: number;
  positions: PositionInfo[];
  isPaper: boolean;
}

// ---- Broker Interface ----
export interface IBroker {
  readonly name: string;
  readonly market: MarketType;
  assertPaperMode(): void;
  getAccount(): Promise<BrokerAccount>;
  submitOrder(order: BracketOrder): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<boolean>;
  cancelAllOrders(): Promise<void>;
  getPositions(): Promise<PositionInfo[]>;
  closePosition(symbol: string): Promise<OrderResult>;
  closeAllPositions(): Promise<void>;
  getCurrentPrice(symbol: string): Promise<number>;
}

// ---- LLM Types ----
export type LLMProvider = "groq" | "gemini";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  provider: LLMProvider;
  model: string;
  tokensUsed?: number;
  cached: boolean;
}

export interface TradeAnalysis {
  action: "buy" | "sell" | "skip";
  symbol: string;
  confidence: number; // 0-1
  thesis: string;
  invalidation: string; // What would prove the thesis wrong
  strategy: string;
  regime: MarketRegime;
  entryPrice: number;
  stopLoss: number;
  takeProfit?: number;
  reasoning: string;
}

export interface EnsembleResult {
  groqAnalysis: TradeAnalysis;
  geminiAnalysis: TradeAnalysis;
  agreement: number; // 0-1
  finalAction: "proceed" | "shrink" | "skip";
  adjustedConfidence: number;
  disagreementReason?: string;
}

// ---- Risk Types ----
export interface RiskCheckResult {
  approved: boolean;
  adjustedQuantity?: number;
  reasons: string[];
  checks: {
    stopLossPresent: boolean;
    withinRiskPerTrade: boolean;
    withinDailyLimit: boolean;
    withinMaxPositions: boolean;
    withinMaxExposure: boolean;
    killSwitchOff: boolean;
    ensembleAgreed: boolean;
  };
}

export interface PositionSizing {
  quantity: number;
  riskAmount: number;
  riskPercent: number;
  entryPrice: number;
  stopLoss: number;
  positionValue: number;
}

// ---- Strategy Types ----
export type MarketRegime = "trending_up" | "trending_down" | "ranging" | "volatile";
export type StrategyName = "sma_crossover" | "rsi_reversion" | "breakout";

export interface StrategySignal {
  strategy: StrategyName;
  action: "buy" | "sell" | "hold";
  confidence: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit?: number;
  params: Record<string, number>;
  reasoning: string;
}

export interface BacktestConfig {
  strategy: StrategyName;
  symbol: string;
  market: MarketType;
  startDate: string;
  endDate: string;
  initialCapital: number;
  feeRate: number;     // e.g. 0.001 for 0.1%
  slippageBps: number; // basis points of slippage
  trainTestSplit: number; // e.g. 0.7 for 70% train
  params?: Record<string, number>;
}

export interface BacktestMetrics {
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  equityCurve: { date: string; equity: number }[];
}

// ---- News Types ----
export interface NewsArticle {
  id: string;
  source: string;
  title: string;
  summary?: string;
  url?: string;
  symbol?: string;
  publishedAt?: Date;
}

export interface SignalFilterResult {
  article: NewsArticle;
  isSignal: boolean;
  score: number; // 0-1
  reason: string;
  sentiment?: "bullish" | "bearish" | "neutral";
}

// ---- Journal Types ----
export interface JournalEntryData {
  decisionType: "trade" | "skip" | "rejected";
  observation: string;
  strategy: string;
  thesis: string;
  confidence: string;
  riskCalculation: string;
  outcome?: string;
  auditTrail: string;
  signalScore?: number;
  noiseHeadlines: number;
  signalHeadlines: number;
}

// ---- Agent Types ----
export interface AgentContext {
  equity: number;
  positions: PositionInfo[];
  regime: MarketRegime;
  activeStrategy?: StrategyName;
  dailyPnl: number;
  dailyLossLimit: number;
  killSwitch: boolean;
  timestamp: Date;
}

export interface AgentDecision {
  action: "execute_trade" | "skip" | "wait";
  trade?: BracketOrder;
  analysis?: TradeAnalysis;
  ensemble?: EnsembleResult;
  riskCheck?: RiskCheckResult;
  journal: JournalEntryData;
}

// ---- Tool Types (for the agent loop) ----
export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

// ---- Dashboard Types ----
export interface DashboardData {
  equity: number;
  dailyPnl: number;
  dailyPnlPercent: number;
  dailyLossLimit: number;
  positions: PositionInfo[];
  isRunning: boolean;
  killSwitch: boolean;
  regime?: MarketRegime;
  strategy?: StrategyName;
  headlinesRead: number;
  headlinesActedOn: number;
  lastHeartbeat?: Date;
}

export interface CalibrationPoint {
  statedConfidence: number;
  actualWinRate: number;
  tradeCount: number;
  bucket: string; // e.g. "0.6-0.7"
}
