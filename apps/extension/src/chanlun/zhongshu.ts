import type { Bi, Segment, Zhongshu } from "./types";

function detectFromRanges(
  ranges: Array<{ id: string; high: number; low: number; startTs: number; endTs: number }>,
  level: "bi" | "segment",
) {
  const zones: Zhongshu[] = [];

  for (let index = 0; index + 2 < ranges.length; index += 1) {
    const group = ranges.slice(index, index + 3);
    const low = Math.max(...group.map((item) => item.low));
    const high = Math.min(...group.map((item) => item.high));
    if (low >= high) continue;

    const first = group[0]!;
    const last = group.at(-1)!;
    const prev = ranges[index - 1];
    const next = ranges[index + 3];
    const direction =
      next && next.low > high ? "up" : prev && prev.high < low ? "down" : "range";

    zones.push({
      id: `zs-${level}-${first.startTs}-${last.endTs}`,
      startTs: first.startTs,
      endTs: last.endTs,
      low,
      high,
      level,
      direction,
    });
  }

  return mergeZones(zones);
}

function mergeZones(zones: Zhongshu[]) {
  const merged: Zhongshu[] = [];
  for (const zone of zones) {
    const last = merged.at(-1);
    if (!last || zone.low > last.high || zone.high < last.low) {
      merged.push(zone);
      continue;
    }

    merged[merged.length - 1] = {
      ...last,
      id: `zs-${last.level}-${last.startTs}-${zone.endTs}`,
      endTs: zone.endTs,
      low: Math.max(last.low, zone.low),
      high: Math.min(last.high, zone.high),
      direction: zone.direction,
    };
  }
  return merged;
}

export function detectZhongshu(bis: Bi[], segments: Segment[] = []): Zhongshu[] {
  const biZones = detectFromRanges(bis, "bi");
  const segmentZones = detectFromRanges(segments, "segment");
  return [...biZones, ...segmentZones].sort((a, b) => a.startTs - b.startTs);
}
