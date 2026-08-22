import type { DesktopPosition } from "../shared/types.js";

export type PositionTone = "long" | "short" | "neutral";

export interface PositionDirectionPresentation {
  glyph: "B" | "S" | "—";
  label: "开多" | "开空" | "方向未知";
  tone: PositionTone;
}

export function positionDirection(side: string): PositionDirectionPresentation {
  const normalized = side.trim().toLowerCase();
  if (normalized === "long") return { glyph: "B", label: "开多", tone: "long" };
  if (normalized === "short") return { glyph: "S", label: "开空", tone: "short" };
  return { glyph: "—", label: "方向未知", tone: "neutral" };
}

export function summarizePositions(positions: readonly DesktopPosition[]) {
  return positions.reduce((summary, position) => {
    const direction = positionDirection(position.side);
    const pnl = Number(position.unrealizedPnl);
    summary.unrealizedPnl += Number.isFinite(pnl) ? pnl : 0;
    if (direction.tone === "long") summary.longCount += 1;
    if (direction.tone === "short") summary.shortCount += 1;
    return summary;
  }, { longCount: 0, shortCount: 0, unrealizedPnl: 0 });
}
