import { describe, expect, it, vi } from "vitest";
import { fetchPublicMarkPrice, publicMarkPriceUrl } from "./okxPublicMark.js";

describe("OKX public mark price", () => {
  it("builds only the public mark-price URL", () => {
    expect(publicMarkPriceUrl("BTC-USDT-SWAP").toString()).toBe("https://www.okx.com/api/v5/public/mark-price?instType=SWAP&instId=BTC-USDT-SWAP");
    expect(() => publicMarkPriceUrl("../../account/balance")).toThrow("Invalid OKX public instrument ID");
  });

  it("parses a valid public response without authentication headers", async () => {
    const request = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      expect(init?.headers).toEqual({ Accept: "application/json" });
      return new Response(JSON.stringify({ code: "0", data: [{ instId: "BTC-USDT-SWAP", markPx: "69420.5", ts: "1787331000000" }] }), { status: 200 });
    });
    await expect(fetchPublicMarkPrice("BTC-USDT-SWAP", request)).resolves.toEqual({ symbol: "BTC-USDT-SWAP", price: 69420.5, timestamp: 1787331000000 });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects mismatched or invalid market data", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ code: "0", data: [{ instId: "ETH-USDT-SWAP", markPx: "0", ts: "1787331000000" }] }), { status: 200 }));
    await expect(fetchPublicMarkPrice("BTC-USDT-SWAP", request)).rejects.toThrow("response is invalid");
  });
});
