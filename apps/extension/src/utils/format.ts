export function formatPrice(value: number) {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000) return value.toFixed(1);
  if (Math.abs(value) >= 1) return value.toFixed(3);
  return value.toPrecision(4);
}

export function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function uniqueByTs<T extends { ts: number }>(items: T[]) {
  const byTs = new Map<number, T>();
  for (const item of items) byTs.set(item.ts, item);
  return [...byTs.values()].sort((a, b) => a.ts - b.ts);
}
