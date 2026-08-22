import { randomUUID } from "node:crypto";
import type {
  AccountSummary,
  Balance,
  BrokerAdapter,
  BrokerHealth,
  BrokerOrder,
  BrokerPosition,
  ExecutionPermit,
  MarginMode,
  OrderIntent,
  OrderPreview,
  ReconciliationReport,
} from "../../broker-contracts/src/index.js";

export interface PaperPositionState {
  symbol: string;
  strategyId: string;
  side: "long" | "short";
  quantity: number;
  averagePrice: number;
  markPrice: number;
}

export interface PaperBrokerOptions {
  initialCapital?: number;
  feeRate?: number;
  slippageBps?: number;
  clock?: () => number;
  state?: PaperBrokerState;
}

export interface PaperBrokerState {
  initialCapital: number;
  cash: number;
  positions: readonly PaperPositionState[];
}

export class PaperBroker implements BrokerAdapter {
  readonly #initialCapital: number;
  readonly #feeRate: number;
  readonly #slippageBps: number;
  readonly #clock: () => number;
  readonly #orders = new Map<string, BrokerOrder>();
  readonly #positions = new Map<string, PaperPositionState>();
  #cash: number;
  #connected = false;

  constructor(options: PaperBrokerOptions = {}) {
    this.#initialCapital = options.state?.initialCapital ?? options.initialCapital ?? 1_000;
    this.#cash = options.state?.cash ?? this.#initialCapital;
    this.#feeRate = options.feeRate ?? 0.0005;
    this.#slippageBps = options.slippageBps ?? 5;
    this.#clock = options.clock ?? Date.now;
    for (const position of options.state?.positions ?? []) this.#positions.set(`${position.strategyId}:${position.symbol}`, { ...position });
  }

  exportState(): PaperBrokerState {
    return { initialCapital: this.#initialCapital, cash: this.#cash, positions: [...this.#positions.values()].map((item) => ({ ...item })) };
  }

  async connect(): Promise<void> { this.#connected = true; }
  async disconnect(): Promise<void> { this.#connected = false; }
  getMode(): "PAPER" { return "PAPER"; }

  async getAccountSummary(): Promise<AccountSummary> {
    const unrealized = [...this.#positions.values()].reduce((sum, item) => {
      const direction = item.side === "long" ? 1 : -1;
      return sum + (item.markPrice - item.averagePrice) * item.quantity * direction;
    }, 0);
    const reservedMargin = [...this.#positions.values()].reduce((sum, item) => sum + item.averagePrice * item.quantity, 0);
    return { equity: (this.#cash + reservedMargin + unrealized).toFixed(8), available: this.#cash.toFixed(8), currency: "USDT", updatedAt: this.#clock() };
  }

  async getBalances(): Promise<readonly Balance[]> {
    const summary = await this.getAccountSummary();
    return [{ currency: "USDT", available: summary.available, frozen: "0", equity: summary.equity }];
  }

  async getPositions(): Promise<readonly BrokerPosition[]> {
    return [...this.#positions.values()].map((item) => ({
      symbol: item.symbol,
      strategyId: item.strategyId,
      side: item.side,
      quantity: item.quantity.toFixed(8),
      averagePrice: item.averagePrice.toFixed(8),
      markPrice: item.markPrice.toFixed(8),
      unrealizedPnl: (((item.markPrice - item.averagePrice) * item.quantity) * (item.side === "long" ? 1 : -1)).toFixed(8),
      leverage: "1",
    }));
  }

  updateMarkPrices(prices: Readonly<Record<string, number>>): void {
    for (const position of this.#positions.values()) {
      const next = prices[position.symbol];
      if (Number.isFinite(next) && next != null && next > 0) position.markPrice = next;
    }
  }

  async getOpenOrders(): Promise<readonly BrokerOrder[]> {
    return [...this.#orders.values()].filter((item) => item.status === "pending" || item.status === "partially_filled");
  }

  async previewOrder(intent: OrderIntent): Promise<OrderPreview> {
    const quantity = Number(intent.quantity);
    const price = Number(intent.limitPrice ?? intent.referencePrice);
    const estimatedNotional = quantity * price;
    const numeric = Number.isFinite(estimatedNotional) && quantity > 0 && price > 0;
    const now = this.#clock();
    return {
      previewId: randomUUID(),
      intent,
      estimatedNotional: estimatedNotional.toFixed(8),
      estimatedFee: (estimatedNotional * this.#feeRate).toFixed(8),
      estimatedSlippage: (estimatedNotional * this.#slippageBps / 10_000).toFixed(8),
      allowed: intent.accountMode === "PAPER" && numeric,
      checks: [
        { rule: "paper_only", allowed: intent.accountMode === "PAPER", message: "PaperBroker 仅接受 PAPER 订单" },
        { rule: "numeric_order", allowed: numeric, message: "价格和数量必须为正数" },
      ],
      expiresAt: now + 30_000,
    };
  }

  async placeOrder(preview: OrderPreview, permit: ExecutionPermit): Promise<BrokerOrder> {
    if (!this.#connected) throw new Error("PaperBroker is disconnected");
    if (!preview.allowed || permit.previewId !== preview.previewId || permit.accountMode !== "PAPER" || permit.expiresAt < this.#clock()) {
      throw new Error("Paper order permit is invalid or expired");
    }
    const existing = this.#orders.get(preview.intent.clientOrderId);
    if (existing) return existing;
    const intent = preview.intent;
    const quantity = Number(intent.quantity);
    const reference = Number(intent.limitPrice ?? intent.referencePrice);
    const adverse = intent.side === "buy" ? 1 : -1;
    const fillPrice = reference * (1 + adverse * this.#slippageBps / 10_000);
    const fee = fillPrice * quantity * this.#feeRate;
    const key = `${intent.strategyId}:${intent.symbol}`;
    const current = this.#positions.get(key);
    const openingSide = intent.positionSide === "short" ? "short" : "long";
    if (intent.reduceOnly) {
      if (!current) throw new Error("No strategy-owned PAPER position to reduce");
      const closeQuantity = Math.min(quantity, current.quantity);
      const direction = current.side === "long" ? 1 : -1;
      const pnl = (fillPrice - current.averagePrice) * closeQuantity * direction;
      this.#cash += current.averagePrice * closeQuantity + pnl - fee;
      current.quantity -= closeQuantity;
      current.markPrice = fillPrice;
      if (current.quantity <= 1e-12) this.#positions.delete(key);
    } else {
      const required = fillPrice * quantity + fee;
      if (required > this.#cash) throw new Error("PAPER account has insufficient available capital");
      if (current && current.side !== openingSide) throw new Error("Cross-strategy or opposite PAPER position must be closed first");
      this.#cash -= required;
      if (current) {
        const combined = current.quantity + quantity;
        current.averagePrice = (current.averagePrice * current.quantity + fillPrice * quantity) / combined;
        current.quantity = combined;
        current.markPrice = fillPrice;
      } else {
        this.#positions.set(key, { symbol: intent.symbol, strategyId: intent.strategyId, side: openingSide, quantity, averagePrice: fillPrice, markPrice: fillPrice });
      }
    }
    const now = this.#clock();
    const order: BrokerOrder = {
      clientOrderId: intent.clientOrderId,
      exchangeOrderId: `paper-${intent.clientOrderId}`,
      symbol: intent.symbol,
      side: intent.side,
      positionSide: intent.positionSide,
      quantity: intent.quantity,
      filledQuantity: intent.quantity,
      averagePrice: fillPrice.toFixed(8),
      status: "filled",
      accountMode: "PAPER",
      strategyId: intent.strategyId,
      createdAt: intent.createdAt,
      updatedAt: now,
    };
    this.#orders.set(intent.clientOrderId, order);
    return order;
  }

  async cancelOrder(clientOrderId: string): Promise<BrokerOrder> {
    const order = this.#orders.get(clientOrderId);
    if (!order) throw new Error("PAPER order was not found");
    if (order.status === "pending" || order.status === "partially_filled") order.status = "cancelled";
    return order;
  }

  async cancelAllOrders(symbol?: string): Promise<readonly BrokerOrder[]> {
    const cancelled: BrokerOrder[] = [];
    for (const order of await this.getOpenOrders()) {
      if (!symbol || order.symbol === symbol) cancelled.push(await this.cancelOrder(order.clientOrderId));
    }
    return cancelled;
  }

  async closePosition(symbol: string, strategyId: string): Promise<BrokerOrder> {
    const position = this.#positions.get(`${strategyId}:${symbol}`);
    if (!position) throw new Error("PAPER position was not found");
    const now = this.#clock();
    const intent: OrderIntent = {
      clientOrderId: `paper-close-${randomUUID()}`,
      accountMode: "PAPER",
      strategyId,
      strategyVersion: "manual-paper-close-v1",
      signalId: null,
      symbol,
      side: position.side === "long" ? "sell" : "buy",
      positionSide: position.side,
      orderType: "market",
      quantity: String(position.quantity),
      referencePrice: String(position.markPrice),
      limitPrice: null,
      reduceOnly: true,
      candidateLabel: null,
      locationTime: null,
      confirmedAt: null,
      dataCutoff: now,
      createdAt: now,
    };
    const preview = await this.previewOrder(intent);
    return this.placeOrder(preview, { previewId: preview.previewId, accountMode: "PAPER", approvedAt: now, expiresAt: preview.expiresAt, humanConfirmed: true, nonce: randomUUID() });
  }

  async setLeverage(_symbol: string, leverage: string, _marginMode: MarginMode): Promise<void> {
    if (leverage !== "1") throw new Error("PAPER safety profile allows leverage 1 only");
  }
  async setMarginMode(_symbol: string, marginMode: MarginMode): Promise<void> {
    if (marginMode !== "cash" && marginMode !== "isolated") throw new Error("PAPER cross margin is disabled");
  }
  async healthCheck(): Promise<BrokerHealth> {
    return { connected: this.#connected, accountMode: "PAPER", readOnly: false, websocketConnected: true, dataAgeMs: 0, databaseHealthy: true, strategyVersionMatches: true, dataHashMatches: true, message: this.#connected ? "本地 PAPER 账户正常" : "本地 PAPER 账户未连接" };
  }
  async reconcile(): Promise<ReconciliationReport> {
    return { status: "consistent", localOpenOrders: (await this.getOpenOrders()).length, remoteOpenOrders: 0, discrepancies: [], checkedAt: this.#clock() };
  }
}
