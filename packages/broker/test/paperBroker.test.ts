import { describe, expect, it } from "vitest";
import type { ExecutionPermit, OrderIntent } from "../../broker-contracts/src/index.js";
import { PaperBroker } from "../src/paperBroker.js";

function intent(clientOrderId = "paper-1"): OrderIntent {
  return { clientOrderId, accountMode: "PAPER", strategyId: "aggressive", strategyVersion: "1", signalId: "signal-1", symbol: "BTC-USDT-SWAP", side: "sell", positionSide: "short", orderType: "market", quantity: "1", referencePrice: "100", limitPrice: null, reduceOnly: false, candidateLabel: "候选1卖", locationTime: 1, confirmedAt: 2, dataCutoff: 3, createdAt: 4 };
}

describe("PaperBroker", () => {
  it("fills locally with adverse slippage and never calls an external account", async () => {
    const broker = new PaperBroker({ clock: () => 10, slippageBps: 10, feeRate: 0.001 });
    await broker.connect();
    const preview = await broker.previewOrder(intent());
    const permit: ExecutionPermit = { previewId: preview.previewId, accountMode: "PAPER", approvedAt: 10, expiresAt: 20, humanConfirmed: true, nonce: "once" };
    const order = await broker.placeOrder(preview, permit);
    expect(order.status).toBe("filled");
    expect(Number(order.averagePrice)).toBeLessThan(100);
    expect((await broker.getPositions())[0]?.strategyId).toBe("aggressive");
    expect(Number((await broker.getAccountSummary()).available)).toBeLessThan(1_000);
    expect(Number((await broker.getAccountSummary()).equity)).toBeLessThan(1_000);
    expect(Number((await broker.getAccountSummary()).equity)).toBeGreaterThan(999);
  });

  it("is idempotent by clientOrderId", async () => {
    const broker = new PaperBroker({ clock: () => 10 });
    await broker.connect();
    const preview = await broker.previewOrder(intent("same-id"));
    const permit: ExecutionPermit = { previewId: preview.previewId, accountMode: "PAPER", approvedAt: 10, expiresAt: 20, humanConfirmed: true, nonce: "once" };
    const first = await broker.placeOrder(preview, permit);
    const second = await broker.placeOrder(preview, permit);
    expect(second).toBe(first);
    expect((await broker.getPositions())).toHaveLength(1);
  });

  it("updates local unrealized PnL from public mark prices", async () => {
    const broker = new PaperBroker({ clock: () => 10, slippageBps: 0, feeRate: 0 });
    await broker.connect();
    const preview = await broker.previewOrder(intent("marked-short"));
    await broker.placeOrder(preview, { previewId: preview.previewId, accountMode: "PAPER", approvedAt: 10, expiresAt: 20, humanConfirmed: true, nonce: "mark" });
    broker.updateMarkPrices({ "BTC-USDT-SWAP": 90, "ETH-USDT-SWAP": 123 });
    const [position] = await broker.getPositions();
    expect(position?.markPrice).toBe("90.00000000");
    expect(position?.unrealizedPnl).toBe("10.00000000");
  });
});
