import { beforeEach, describe, expect, it } from "vitest";
import {
  extractOkxInstIdsFromPage,
  normalizeInstId,
  normalizeInstIdList,
  resolveOkxInstId,
} from "./symbolResolver";

describe("OKX symbol resolver", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("normalizes common manual input shapes", () => {
    expect(normalizeInstId(" btc/usdt_swap ")).toBe("BTC-USDT-SWAP");
    expect(normalizeInstId("eth_usdt_swap")).toBe("ETH-USDT-SWAP");
    expect(normalizeInstId("sol-usdc")).toBe("SOL-USDC-SWAP");
    expect(normalizeInstId("dogeusdt")).toBe("DOGE-USDT-SWAP");
    expect(normalizeInstId("google")).toBe("GOOGL-USDT-SWAP");
    expect(normalizeInstId("GOOG-USDT-SWAP")).toBe("GOOGL-USDT-SWAP");
    expect(normalizeInstId("intel")).toBe("INTC-USDT-SWAP");
    expect(normalizeInstId("INTC")).toBe("INTC-USDT-SWAP");
    expect(normalizeInstId("英特尔")).toBe("INTC-USDT-SWAP");
    expect(normalizeInstId("micron")).toBe("MU-USDT-SWAP");
    expect(normalizeInstId("MU")).toBe("MU-USDT-SWAP");
    expect(normalizeInstId("美光")).toBe("MU-USDT-SWAP");
    expect(normalizeInstId("谷歌")).toBe("GOOGL-USDT-SWAP");
  });

  it("normalizes watchlist input and drops unsupported values", () => {
    expect(normalizeInstIdList("btc-usdt-swap, eth/usdc, bad, solusdt, google, intel, micron")).toEqual([
      "BTC-USDT-SWAP",
      "ETH-USDC-SWAP",
      "SOL-USDT-SWAP",
      "GOOGL-USDT-SWAP",
      "INTC-USDT-SWAP",
      "MU-USDT-SWAP",
    ]);
  });

  it("resolves swap instruments from URL or title", () => {
    expect(resolveOkxInstId("https://www.okx.com/trade-swap/btc-usdt-swap", "")).toBe(
      "BTC-USDT-SWAP",
    );
    expect(resolveOkxInstId("https://www.okx.com/trade", "ETH-USDT-SWAP | OKX")).toBe(
      "ETH-USDT-SWAP",
    );
  });

  it("falls back from spot-style pair text to swap instrument", () => {
    expect(resolveOkxInstId("https://www.okx.com/trade-spot/sol-usdt", "")).toBe(
      "SOL-USDT-SWAP",
    );
    expect(resolveOkxInstId("https://www.okx.com/trade-spot/eth-usdc", "")).toBe(
      "ETH-USDC-SWAP",
    );
  });

  it("can inspect visible page text when URL is not explicit", () => {
    document.body.innerHTML = "<main>Current instrument: DOGE-USDT-SWAP</main>";

    expect(resolveOkxInstId("https://www.okx.com/trade", "")).toBe("DOGE-USDT-SWAP");
  });

  it("resolves compact OKX contract headers such as GOOGLUSDT", () => {
    expect(resolveOkxInstId("https://www.okx.com/trade-swap", "GOOGLUSDT 永续 - OKX")).toBe(
      "GOOGL-USDT-SWAP",
    );

    document.body.innerHTML = "<main>GOOGLUSDT 永续 指数价格</main>";
    expect(resolveOkxInstId("https://www.okx.com/trade-swap", "")).toBe("GOOGL-USDT-SWAP");
  });

  it("resolves compact OKX contract headers such as INTCUSDT", () => {
    expect(resolveOkxInstId("https://www.okx.com/trade-swap", "INTCUSDT 永续 - OKX")).toBe(
      "INTC-USDT-SWAP",
    );

    document.body.innerHTML = "<main>INTCUSDT 永续 指数价格</main>";
    expect(resolveOkxInstId("https://www.okx.com/trade-swap", "")).toBe("INTC-USDT-SWAP");
  });

  it("resolves compact OKX contract headers such as MUUSDT", () => {
    expect(resolveOkxInstId("https://www.okx.com/trade-swap", "MUUSDT 永续 - OKX")).toBe(
      "MU-USDT-SWAP",
    );

    document.body.innerHTML = "<main>MUUSDT 永续 指数价格</main>";
    expect(resolveOkxInstId("https://www.okx.com/trade-swap", "")).toBe("MU-USDT-SWAP");
  });

  it("updates to the active instrument instead of assuming a fixed saved symbol", () => {
    expect(resolveOkxInstId("https://www.okx.com/trade-swap/xrp-usdt-swap", "GOOGL-USDT-SWAP")).toBe(
      "XRP-USDT-SWAP",
    );
  });

  it("extracts multiple watchlist instruments from visible page text", () => {
    const list = extractOkxInstIdsFromPage(
      "https://www.okx.com/trade-swap/btc-usdt-swap",
      "BTC-USDT-SWAP",
      "自选 BTC-USDT ETH-USDT-SWAP SOLUSDT DOGE/USDC",
    );

    expect(list).toEqual([
      "BTC-USDT-SWAP",
      "ETH-USDT-SWAP",
      "DOGE-USDC-SWAP",
      "SOL-USDT-SWAP",
    ]);
  });
});
