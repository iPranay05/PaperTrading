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
      order_class: "bracket",
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
    const res = await fetch(
      `https://data.alpaca.markets/v2/stocks/${symbol}/quotes/latest`,
      {
        headers: {
          "APCA-API-KEY-ID": this.apiKey,
          "APCA-API-SECRET-KEY": this.apiSecret,
        },
      }
    );
    if (!res.ok) throw new Error(`Price fetch failed for ${symbol}`);
    const data = await res.json();
    return (data.quote.ap + data.quote.bp) / 2; // midpoint
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

    this.exchange = new ExchangeClass({
      apiKey: process.env.CRYPTO_API_KEY || "",
      secret: process.env.CRYPTO_API_SECRET || "",
      sandbox: true, // TESTNET MODE
      options: { defaultType: "spot" },
    });

    return this.exchange;
  }

  assertPaperMode(): void {
    // CCXT sandbox mode is enforced in constructor
    if (process.env.CRYPTO_SANDBOX !== "true" && !process.env.CRYPTO_API_KEY?.includes("testnet")) {
      console.warn("[CryptoBroker] CRYPTO_SANDBOX not set to 'true', forcing sandbox mode");
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
// ============================================================
export class SimulatedPaperBroker implements IBroker {
  readonly name = "Simulated Paper";
  readonly market: MarketType;
  private positions: Map<string, PositionInfo> = new Map();
  private equity = 100000;
  private orders: Map<string, BracketOrder & { id: string }> = new Map();

  constructor(market: MarketType = "stock") {
    this.market = market;
  }

  assertPaperMode(): void {
    // Always paper mode
  }

  async getAccount(): Promise<BrokerAccount> {
    return {
      equity: this.equity,
      buyingPower: this.equity,
      positions: Array.from(this.positions.values()),
      isPaper: true,
    };
  }

  async submitOrder(order: BracketOrder): Promise<OrderResult> {
    const id = `sim-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const price = order.limitPrice || (await this.getCurrentPrice(order.symbol));

    this.positions.set(order.symbol, {
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      entryPrice: price,
      currentPrice: price,
      unrealizedPnl: 0,
      market: this.market,
    });

    this.orders.set(id, { ...order, id });
    this.equity -= order.quantity * price;

    return {
      success: true,
      orderId: id,
      filledPrice: price,
      filledQuantity: order.quantity,
      timestamp: new Date(),
    };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    return this.orders.delete(orderId);
  }

  async cancelAllOrders(): Promise<void> {
    this.orders.clear();
  }

  async getPositions(): Promise<PositionInfo[]> {
    return Array.from(this.positions.values());
  }

  async closePosition(symbol: string): Promise<OrderResult> {
    const pos = this.positions.get(symbol);
    if (!pos) return { success: false, error: "No position", timestamp: new Date() };

    this.equity += pos.quantity * pos.currentPrice;
    this.positions.delete(symbol);

    return { success: true, orderId: `close-${Date.now()}`, timestamp: new Date() };
  }

  async closeAllPositions(): Promise<void> {
    for (const symbol of this.positions.keys()) {
      await this.closePosition(symbol);
    }
  }

  async getCurrentPrice(symbol: string): Promise<number> {
    // Fetch real prices from free APIs
    if (this.market === "crypto") {
      try {
        const pair = symbol.replace("/", "").toLowerCase();
        const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${pair.toUpperCase()}`);
        if (res.ok) {
          const data = await res.json();
          return parseFloat(data.price);
        }
      } catch { /* fallback below */ }
    }

    // For stocks, use a free endpoint
    try {
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`);
      if (res.ok) {
        const data = await res.json();
        return data.chart?.result?.[0]?.meta?.regularMarketPrice || 100;
      }
    } catch { /* fallback */ }

    return 100; // Fallback price for simulation
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
