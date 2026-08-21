import type { Bi, Segment } from "./types";

export function buildSegments(bis: Bi[]): Segment[] {
  const segments: Segment[] = [];

  for (let index = 0; index + 2 < bis.length; index += 2) {
    const group = bis.slice(index, index + 3);
    const first = group[0]!;
    const last = group.at(-1)!;
    const start = first.start;
    const end = last.end;
    const direction = end.price >= start.price ? "up" : "down";

    segments.push({
      id: `seg-${start.ts}-${end.ts}`,
      direction,
      start,
      end,
      bis: group,
      high: Math.max(...group.map((item) => item.high)),
      low: Math.min(...group.map((item) => item.low)),
      startTs: start.ts,
      endTs: end.ts,
    });
  }

  return mergeSameDirection(segments);
}

function mergeSameDirection(segments: Segment[]) {
  const merged: Segment[] = [];

  for (const segment of segments) {
    const last = merged.at(-1);
    if (!last || last.direction !== segment.direction) {
      merged.push(segment);
      continue;
    }

    const extendsMove =
      segment.direction === "up" ? segment.high >= last.high : segment.low <= last.low;
    if (extendsMove) {
      merged[merged.length - 1] = {
        ...last,
        id: `seg-${last.startTs}-${segment.endTs}`,
        end: segment.end,
        bis: [...last.bis, ...segment.bis],
        high: Math.max(last.high, segment.high),
        low: Math.min(last.low, segment.low),
        endTs: segment.endTs,
      };
    } else {
      merged.push(segment);
    }
  }

  return merged;
}
