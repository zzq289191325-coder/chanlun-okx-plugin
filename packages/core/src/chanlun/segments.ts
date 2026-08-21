import type { Segment, Stroke } from "./types.js";

function confirmsDirectionalSegment(first: Stroke, second: Stroke, third: Stroke): boolean {
  if (first.direction !== third.direction || first.direction === second.direction) return false;
  if (first.direction === "up") {
    return third.high > first.high && second.low > first.low;
  }
  return third.low < first.low && second.high < first.high;
}

export function buildConfirmedSegments(strokes: readonly Stroke[]): Segment[] {
  const segments: Segment[] = [];
  for (let index = 0; index + 2 < strokes.length; index += 2) {
    const first = strokes[index];
    const second = strokes[index + 1];
    const third = strokes[index + 2];
    if (!first || !second || !third || !confirmsDirectionalSegment(first, second, third)) continue;

    const next: Segment = {
      id: `segment:${first.direction}:${first.startTime}:${third.endTime}`,
      direction: first.direction,
      startTime: first.startTime,
      endTime: third.endTime,
      confirmedAt: third.confirmedAt,
      high: Math.max(first.high, second.high, third.high),
      low: Math.min(first.low, second.low, third.low),
      strokeIds: [first.id, second.id, third.id],
      ruleVersion: "confirmed-three-stroke-v1",
    };

    const previous = segments.at(-1);
    if (previous?.direction === next.direction && next.startTime <= previous.endTime) {
      segments[segments.length - 1] = {
        ...previous,
        id: `segment:${previous.direction}:${previous.startTime}:${next.endTime}`,
        endTime: next.endTime,
        confirmedAt: next.confirmedAt,
        high: Math.max(previous.high, next.high),
        low: Math.min(previous.low, next.low),
        strokeIds: [...new Set([...previous.strokeIds, ...next.strokeIds])],
      };
    } else {
      segments.push(next);
    }
  }
  return segments;
}
