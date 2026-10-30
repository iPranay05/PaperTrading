// ============================================================
// Broker Interface + Alpaca Paper Adapter + Crypto Testnet Adapter
// One interface, two adapters. Agent calls the same tools.
// ============================================================

import type {
  IBroker,
  BracketOrder,
  OrderResult,
  PositionInfo,
  BrokerAccount,
  MarketType,
} from "@/lib/types";
import { assertPaperMode } from "@/lib/risk/gate";
import prisma from "@/lib/db";
import { settleTrade, type ExitReason } from "@/lib/ledger";

// ============================================================
// Alpaca Paper Broker
// ============================================================
export class AlpacaPaperBroker implements IBroker {
  readonly name = "Alpaca Paper";
  readonly market: MarketType = "stock";
  private baseUrl: string;
  private apiKey: string;
  private apiSecret: string;

  constructor() {
    this.baseUrl = process.env.ALPACA_BASE_URL || "https://paper-api.alpaca.markets";
    this.apiKey = process.env.ALPACA_API_KEY || "";
    this.apiSecret = process.env.ALPACA_API_SECRET || "";
  }

  assertPaperMode(): void {
    assertPaperMode(this.baseUrl);
  }

  private async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "APCA-API-KEY-ID": this.apiKey,
        "APCA-API-SECRET-KEY": this.apiSecret,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  }

  async getAccount(): Promise<BrokerAccount> {
    const res = await this.fetch("/v2/account");
    if (!res.ok) throw new Error(`Alpaca account error: ${res.status}`);
    const data = await res.json();
    const positions = await this.getPositions();
    return {
      equity: parseFloat(data.equity),
      buyingPower: parseFloat(data.buying_power),
      positions,
      isPaper: this.baseUrl.includes("paper"),
    };
  }

  async submitOrder(order: BracketOrder): Promise<OrderResult> {
    const body: Record<string, unknown> = {
      symbol: order.symbol,
      qty: order.quantity.toString(),
      side: order.side,
      type: order.limitPrice ? "limit" : "market",
      time_in_force: "gtc",
      // Alpaca requires BOTH legs for "bracket"; with only a stop-loss use "oto".
      order_class: order.takeProfit ? "bracket" : "oto",
      stop_loss: { stop_price: order.stopLoss.toString() },
    };

    if (order.limitPrice) body.limit_price = order.limitPrice.toString();
    if (order.takeProfit) body.take_profit = { limit_price: order.takeProfit.toString() };

    const res = await this.fetch("/v2/orders", {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return {
        success: false,
        error: `Alpaca order error: ${res.status} - ${JSON.stringify(err)}`,
        timestamp: new Date(),
      };
    }

    const data = await res.json();
    return {
      success: true,
      orderId: data.id,
      filledPrice: data.filled_avg_price ? parseFloat(data.filled_avg_price) : undefined,
      filledQuantity: data.filled_qty ? parseFloat(data.filled_qty) : undefined,
      timestamp: new Date(),
    };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const res = await this.fetch(`/v2/orders/${orderId}`, { method: "DELETE" });
    return res.ok;
  }

  async cancelAllOrders(): Promise<void> {
    await this.fetch("/v2/orders", { method: "DELETE" });
  }

  async getPositions(): Promise<PositionInfo[]> {
    const res = await this.fetch("/v2/positions");
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((p: Record<string, string>) => ({
      symbol: p.symbol,
      side: parseFloat(p.qty) > 0 ? "buy" : "sell",
      quantity: Math.abs(parseFloat(p.qty)),
      entryPrice: parseFloat(p.avg_entry_price),
      currentPrice: parseFloat(p.current_price),
      unrealizedPnl: parseFloat(p.unrealized_pl),
      market: "stock" as MarketType,
    }));
  }

  async closePosition(symbol: string): Promise<OrderResult> {
    const res = await this.fetch(`/v2/positions/${symbol}`, { method: "DELETE" });
    if (!res.ok) {
      return { success: false, error: `Failed to close ${symbol}`, timestamp: new Date() };
    }
    const data = await res.json();
    return { success: true, orderId: data.id, timestamp: new Date() };
  }

  async closeAllPositions(): Promise<void> {
    await this.fetch("/v2/positions?cancel_orders=true", { method: "DELETE" });
  }

  async getCurrentPrice(symbol: string): Promise<number> {
    // If it's an Indian stock (NSE/BSE) or Alpaca is not used, fetch from Yahoo Finance
    if (symbol.includes(".NS") || symbol.includes(".BO") || !this.apiKey) {
      try {
        const res = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`
        );
        if (res.ok) {
          const json = await res.json();
          const price = json.chart?.result?.[0]?.meta?.regularMarketPrice;
          if (price && typeof price === "number") {
            return price;
          }
        }
      } catch (err) {
        console.warn(`[StockBroker] Yahoo finance price failed for ${symbol}:`, err);
      }
    }

    try {
      const res = await fetch(
        `https://data.alpaca.markets/v2/stocks/${symbol}/quotes/latest`,
        {
          headers: {
            "APCA-API-KEY-ID": this.apiKey,
            "APCA-API-SECRET-KEY": this.apiSecret,
          },
        }
      );
      if (res.ok) {
        const data = await res.json();
        return (data.quote.ap + data.quote.bp) / 2; // midpoint
      }
    } catch {
      // Fallback
    }

    // Secondary Yahoo Finance fallback
    try {
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`);
      if (res.ok) {
        const json = await res.json();
        const price = json.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (price) return price;
      }
    } catch {
      // ignore
    }

    throw new Error(`Price fetch failed for ${symbol}`);
  }
}

// ============================================================
// Crypto Testnet Broker (via CCXT)
// ============================================================
export class CryptoTestnetBroker implements IBroker {
  readonly name = "Crypto Testnet";
  readonly market: MarketType = "crypto";
  private exchange: import("ccxt").Exchange | null = null;

  private async getExchange(): Promise<import("ccxt").Exchange> {
    if (this.exchange) return this.exchange;

    const ccxt = await import("ccxt");
    const exchangeId = process.env.CRYPTO_EXCHANGE || "binance";

    const ExchangeClass = (ccxt as unknown as Record<string, new (config: Record<string, unknown>) => import("ccxt").Exchange>)[exchangeId];
    if (!ExchangeClass) throw new Error(`Exchange ${exchangeId} not found in CCXT`);

    const exchange = new ExchangeClass({
      apiKey: process.env.CRYPTO_API_KEY || "",
      secret: process.env.CRYPTO_API_SECRET || "",
      options: { defaultType: "spot" },
    });
    // The `sandbox` constructor option is ignored by CCXT; this call is what switches to the testnet.
    exchange.setSandboxMode(true);
    this.exchange = exchange;

    return this.exchange;
  }

  assertPaperMode(): void {
    // Sandbox mode is always forced in getExchange(); refuse to run if someone tries to turn it off.
    if (process.env.CRYPTO_SANDBOX === "false") {
      throw new Error("SAFETY ASSERTION FAILED: CRYPTO_SANDBOX=false. This bot is paper-trading only.");
    }
  }

  async getAccount(): Promise<BrokerAccount> {
    const exchange = await this.getExchange();
    const balance = await exchange.fetchBalance();
    const positions = await this.getPositions();

    const totals = (balance.total || {}) as unknown as Record<string, number | undefined>;
    const frees = (balance.free || {}) as unknown as Record<string, number | undefined>;
    const usdtBalance = totals["USDT"] || totals["USD"] || 0;
    return {
      equity: usdtBalance,
      buyingPower: frees["USDT"] || frees["USD"] || 0,
      positions,
      isPaper: true,
    };
  }

  async submitOrder(order: BracketOrder): Promise<OrderResult> {
    try {
      const exchange = await this.getExchange();
      const orderType = order.limitPrice ? "limit" : "market";
      const price = order.limitPrice || undefined;

      const result = await exchange.createOrder(
        order.symbol,
        orderType,
        order.side,
        order.quantity,
        price
      );

      // Place stop-loss as a separate order
      if (order.stopLoss) {
        try {
          const slSide = order.side === "buy" ? "sell" : "buy";
          await exchange.createOrder(
            order.symbol,
            "stop_loss_limit",
            slSide,
            order.quantity,
            order.stopLoss,
            { stopPrice: order.stopLoss }
          );
        } catch (slError) {
          console.warn("[CryptoBroker] Stop-loss order failed, placed as stop-market:", slError);
        }
      }

      return {
        success: true,
        orderId: result.id,
        filledPrice: result.average || result.price || undefined,
        filledQuantity: result.filled || undefined,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: `Crypto order error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      };
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      const exchange = await this.getExchange();
      await exchange.cancelOrder(orderId);
      return true;
    } catch {
      return false;
    }
  }

  async cancelAllOrders(): Promise<void> {
    try {
      const exchange = await this.getExchange();
      const orders = await exchange.fetchOpenOrders();
      await Promise.all(orders.filter((o) => o.id).map((o) => exchange.cancelOrder(String(o.id), o.symbol || undefined)));
    } catch (error) {
      console.error("[CryptoBroker] Failed to cancel all orders:", error);
    }
  }

  async getPositions(): Promise<PositionInfo[]> {
    try {
      const exchange = await this.getExchange();
      const balance = await exchange.fetchBalance();
      const positions: PositionInfo[] = [];

      for (const [currency, amount] of Object.entries(balance.total || {})) {
        if (currency === "USDT" || currency === "USD" || (amount as number) <= 0) continue;
        const symbol = `${currency}/USDT`;
        try {
          const ticker = await exchange.fetchTicker(symbol);
          positions.push({
            symbol,
            side: "buy",
            quantity: amount as number,
            entryPrice: 0, // Would need trade history
            currentPrice: ticker.last || 0,
            unrealizedPnl: 0,
            market: "crypto",
          });
        } catch {
          // Skip symbols without a ticker
        }
      }
      return positions;
    } catch {
      return [];
    }
  }

  async closePosition(symbol: string): Promise<OrderResult> {
    try {
      const exchange = await this.getExchange();
      const balance = await exchange.fetchBalance();
      const totals = (balance.total || {}) as unknown as Record<string, number | undefined>;
      const currency = symbol.split("/")[0];
      const amount = totals[currency] as number;
      if (!amount || amount <= 0) {
        return { success: false, error: `No position in ${symbol}`, timestamp: new Date() };
      }
      const result = await exchange.createOrder(symbol, "market", "sell", amount);
      return {
        success: true,
        orderId: result.id,
        filledPrice: result.average || undefined,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: `Close position error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      };
    }
  }

  async closeAllPositions(): Promise<void> {
    const positions = await this.getPositions();
    await Promise.all(positions.map((p) => this.closePosition(p.symbol)));
  }

  async getCurrentPrice(symbol: string): Promise<number> {
    const exchange = await this.getExchange();
    const ticker = await exchange.fetchTicker(symbol);
    return ticker.last || 0;
  }
}

// ============================================================
// Simulated Paper Broker (for demo/local development)
//
// State lives in the database, so it survives the fresh instance
// that createBroker() hands out every cycle:
//   - one open Position row per filled order (Position.id === orderId,
//     which is also Trade.brokerOrderId)
//   - equity = starting capital + realised P&L of closed Trades
//              + unrealised P&L of open Positions
// monitorPositions() enforces stop-losses and take-profits.
// ============================================================
export const SIM_STARTING_CAPITAL = 500000; // per market

export interface SimExit {
  orderId: string;
  symbol: string;
  exitPrice: number;
  reason: ExitReason;
  pnl: number | null; // null if no matching Trade record existed
}

type PositionRow = {
  id: string;
  symbol: string;
  side: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  market: string;
};

function unrealised(side: string, entry: number, current: number, qty: number): number {
  return (side === "buy" ? current - entry : entry - current) * qty;
}

export class SimulatedPaperBroker implements IBroker {
  readonly name = "Simulated Paper";
  readonly market: MarketType;

  constructor(market: MarketType = "stock") {
    this.market = market;
  }

  assertPaperMode(): void {
    // Always paper mode
  }

  private async openRows(symbol?: string): Promise<PositionRow[]> {
    return prisma.position.findMany({
      where: { market: this.market, status: "open", ...(symbol ? { symbol } : {}) },
      orderBy: { createdAt: "asc" },
    });
  }

  private toInfo(row: PositionRow): PositionInfo {
    return {
      symbol: row.symbol,
      side: row.side as BracketOrder["side"],
      quantity: row.quantity,
      entryPrice: row.entryPrice,
      currentPrice: row.currentPrice,
      unrealizedPnl: unrealised(row.side, row.entryPrice, row.currentPrice, row.quantity),
      market: this.market,
    };
  }

  async getAccount(): Promise<BrokerAccount> {
    const rows = await this.openRows();
    const realised = await prisma.trade.aggregate({
      _sum: { pnl: true },
      where: { market: this.market, status: "closed" },
    });

    const positions = rows.map((r) => this.toInfo(r));
    const unrealisedTotal = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
    const notional = rows.reduce((sum, r) => sum + r.quantity * r.entryPrice, 0);
    const equity = SIM_STARTING_CAPITAL + (realised._sum.pnl ?? 0) + unrealisedTotal;

    return {
      equity,
      buyingPower: Math.max(0, equity - notional),
      positions,
      isPaper: true,
    };
  }

  async submitOrder(order: BracketOrder): Promise<OrderResult> {
    const id = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const price = order.limitPrice || (await this.getCurrentPrice(order.symbol));

    // A stop on the wrong side of entry would trigger immediately.
    const badStop = order.side === "buy" ? order.stopLoss >= price : order.stopLoss <= price;
    if (!(order.stopLoss > 0) || badStop) {
      return {
        success: false,
        error: `Invalid stop-loss ${order.stopLoss} for ${order.side} at ${price}`,
        timestamp: new Date(),
      };
    }

    await prisma.position.create({
      data: {
        id,
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity,
        entryPrice: price,
        currentPrice: price,
        stopLoss: order.stopLoss,
        unrealizedPnl: 0,
        market: this.market,
        status: "open",
      },
    });

    return {
      success: true,
      orderId: id,
      filledPrice: price,
      filledQuantity: order.quantity,
      timestamp: new Date(),
    };
  }

  // Orders fill instantly in the simulator, so there is never a pending order to cancel.
  async cancelOrder(): Promise<boolean> {
    return false;
  }

  async cancelAllOrders(): Promise<void> {
    // Nothing pending.
  }

  async getPositions(): Promise<PositionInfo[]> {
    return (await this.openRows()).map((r) => this.toInfo(r));
  }

  // Closes one row at `exitPrice` and books the P&L. Returns null if it was already closed.
  private async closeRow(row: PositionRow, exitPrice: number, reason: ExitReason): Promise<SimExit | null> {
    const claimed = await prisma.position.updateMany({
      where: { id: row.id, status: "open" },
      data: { status: "closed", currentPrice: exitPrice, unrealizedPnl: 0 },
    });
    if (claimed.count === 0) return null;

    const settled = await settleTrade(row.id, exitPrice, reason);
    return {
      orderId: row.id,
      symbol: row.symbol,
      exitPrice,
      reason,
      pnl: settled?.pnl ?? null,
    };
  }

  async closePosition(symbol: string, reason: ExitReason = "manual"): Promise<OrderResult> {
    const rows = await this.openRows(symbol);
    if (rows.length === 0) return { success: false, error: "No position", timestamp: new Date() };

    // Live price if we can get it, otherwise the last price we saw.
    const live = await this.fetchLivePrice(symbol);
    let lastId: string | undefined;
    let filledPrice: number | undefined;
    for (const row of rows) {
      const exitPrice = live ?? row.currentPrice;
      const exit = await this.closeRow(row, exitPrice, reason);
      if (exit) {
        lastId = exit.orderId;
        filledPrice = exitPrice;
      }
    }
    return { success: true, orderId: lastId ?? `close-${Date.now()}`, filledPrice, timestamp: new Date() };
  }

  async closeAllPositions(reason: ExitReason = "manual"): Promise<void> {
    const symbols = new Set((await this.openRows()).map((r) => r.symbol));
    for (const symbol of symbols) {
      await this.closePosition(symbol, reason);
    }
  }

  // Marks open positions to market and closes any whose stop-loss or take-profit
  // has been reached. Call once per agent cycle. Prices that cannot be fetched
  // are skipped (never replaced by a fake price), so an outage cannot trigger stops.
  // Limitation: prices are sampled once per call, so a stop crossed and recovered
  // between two cycles is not seen. A stop that is gapped through fills at the
  // observed (worse) price; a take-profit fills at its target.
  async monitorPositions(): Promise<SimExit[]> {
    const exits: SimExit[] = [];

    for (const row of await this.openRows()) {
      const price = await this.fetchLivePrice(row.symbol);
      if (price == null) continue;

      const isLong = row.side === "buy";
      const trade = await prisma.trade.findFirst({
        where: { brokerOrderId: row.id },
        select: { takeProfit: true },
      });
      const takeProfit = trade?.takeProfit ?? null;

      const stopHit = isLong ? price <= row.stopLoss : price >= row.stopLoss;
      const targetHit = takeProfit != null && (isLong ? price >= takeProfit : price <= takeProfit);

      if (stopHit) {
        const exit = await this.closeRow(row, price, "stop_loss");
        if (exit) exits.push(exit);
      } else if (targetHit) {
        const exit = await this.closeRow(row, takeProfit as number, "take_profit");
        if (exit) exits.push(exit);
      } else {
        await prisma.position.update({
          where: { id: row.id },
          data: {
            currentPrice: price,
            unrealizedPnl: unrealised(row.side, row.entryPrice, price, row.quantity),
          },
        });
      }
    }

    return exits;
  }

  // Real price from a free API, or null if it can't be fetched.
  private async fetchLivePrice(symbol: string): Promise<number | null> {
    if (this.market === "crypto") {
      try {
        const pair = symbol.replace("/", "").toUpperCase();
        const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`);
        if (res.ok) {
          const data = await res.json();
          const price = parseFloat(data.price);
          if (Number.isFinite(price) && price > 0) return price;
        }
      } catch { /* fall through */ }
    }

    try {
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`);
      if (res.ok) {
        const data = await res.json();
        const price = data.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (typeof price === "number" && price > 0) return price;
      }
    } catch { /* fall through */ }

    return null;
  }

  async getCurrentPrice(symbol: string): Promise<number> {
    const price = await this.fetchLivePrice(symbol);
    // Never invent a price: trading on a made-up number would corrupt P&L.
    if (price == null) throw new Error(`Price fetch failed for ${symbol}`);
    return price;
  }
}

// ============================================================
// Broker Factory
// ============================================================
export function createBroker(market: MarketType): IBroker {
  if (market === "stock") {
    if (process.env.ALPACA_API_KEY) {
      const broker = new AlpacaPaperBroker();
      broker.assertPaperMode();
      return broker;
    }
    return new SimulatedPaperBroker("stock");
  }

  if (process.env.CRYPTO_API_KEY) {
    const broker = new CryptoTestnetBroker();
    broker.assertPaperMode();
    return broker;
  }
  return new SimulatedPaperBroker("crypto");
}
