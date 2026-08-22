import { describe, expect, it } from "vitest";
import type { DesktopPosition } from "../shared/types.js";
import { positionDirection, summarizePositions } from "./positionPresentation.js";

const position = (side: string, unrealizedPnl: string): DesktopPosition => ({
  symbol: "BTC-USDT-SWAP",
  strategyId: "aggressive-interval-nesting",
  side,
  quantity: "0.01",
  averagePrice: "69000",
  markPrice: "69100",
  unrealizedPnl,
});

describe("position presentation", () => {
  it("uses B and S for long and short positions", () => {
    expect(positionDirection("long")).toEqual({ glyph: "B", label: "开多", tone: "long" });
    expect(positionDirection("SHORT")).toEqual({ glyph: "S", label: "开空", tone: "short" });
  });

  it("does not mislabel an unknown direction", () => {
    expect(positionDirection("hedged")).toEqual({ glyph: "—", label: "方向未知", tone: "neutral" });
  });

  it("summarizes position counts and ignores invalid PnL values", () => {
    expect(summarizePositions([
      position("long", "8.25"),
      position("short", "-3.5"),
      position("short", "not-a-number"),
    ])).toEqual({ longCount: 1, shortCount: 2, unrealizedPnl: 4.75 });
  });
});
