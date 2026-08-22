export type MarkerSide = "buy" | "sell";

export function markerGlyph(side: MarkerSide): "B" | "S" {
  return side === "buy" ? "B" : "S";
}

export function markerHorizontalOffset(collisionIndex = 0): number {
  if (collisionIndex <= 0) return 0;
  const distance = Math.ceil(collisionIndex / 2) * 15;
  return collisionIndex % 2 === 1 ? distance : -distance;
}

export function markerPriceOnCandle(price: number, side: MarkerSide, candle: { low: number; high: number }): { displayPrice: number; adjusted: boolean } {
  if (price >= candle.low && price <= candle.high) return { displayPrice: price, adjusted: false };
  return { displayPrice: side === "buy" ? candle.low : candle.high, adjusted: true };
}
