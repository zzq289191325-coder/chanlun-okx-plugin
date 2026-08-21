import { describe, expect, it } from "vitest";
import { analyzeChanlun } from "../src/chanlun/engine.js";
import { detectConfirmedFractals } from "../src/chanlun/fractals.js";
import { mergeInclusions } from "../src/chanlun/inclusion.js";
import { buildConfirmedSegments } from "../src/chanlun/segments.js";
import { buildConfirmedStrokes } from "../src/chanlun/strokes.js";
import { buildCentralZones } from "../src/chanlun/zones.js";
import { candlesFromValues, stroke } from "./fixtures.js";

describe("confirmed ChanLun structures", () => {
  const values = [100, 103, 106, 109, 114, 110, 106, 102, 97, 101, 106, 111, 117, 113, 108, 103, 95];

  it("does not confirm a fractal until the right bar closes", () => {
    const candles = candlesFromValues(values);
    const withoutRight = detectConfirmedFractals(mergeInclusions(candles.slice(0, 5)));
    const withRight = detectConfirmedFractals(mergeInclusions(candles.slice(0, 6)));

    expect(withoutRight).toHaveLength(0);
    expect(withRight[0]?.type).toBe("top");
    expect(withRight[0]?.locationTime).toBe(candles[4]?.openTime);
    expect(withRight[0]?.confirmedAt).toBe(candles[5]?.closeTime);
  });

  it("builds strokes only from separated alternating confirmed fractals", () => {
    const candles = candlesFromValues(values);
    const bars = mergeInclusions(candles);
    const fractals = detectConfirmedFractals(bars);
    const strokes = buildConfirmedStrokes(fractals);

    expect(fractals.map((item) => item.type)).toEqual(["top", "bottom", "top"]);
    expect(strokes.map((item) => item.direction)).toEqual(["down", "up"]);
    expect(strokes.every((item) => item.confirmedAt >= item.end.confirmedAt)).toBe(true);
  });

  it("confirms a segment only after a three-stroke directional extension", () => {
    const strokes = [
      stroke("s0", "up", 0, 10, 90, 110),
      stroke("s1", "down", 10, 20, 96, 108),
      stroke("s2", "up", 20, 30, 96, 116),
    ];
    const segments = buildConfirmedSegments(strokes);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.direction).toBe("up");
    expect(segments[0]?.confirmedAt).toBe(strokes[2]?.confirmedAt);
  });

  it("creates and extends a central zone from overlapping confirmed legs", () => {
    const strokes = [
      stroke("s0", "up", 0, 10, 90, 110),
      stroke("s1", "down", 10, 20, 95, 108),
      stroke("s2", "up", 20, 30, 96, 112),
      stroke("s3", "down", 30, 40, 97, 107),
    ];
    const zones = buildCentralZones(strokes, "stroke");
    expect(zones).toHaveLength(1);
    expect(zones[0]?.coreLow).toBe(96);
    expect(zones[0]?.coreHigh).toBe(108);
    expect(zones[0]?.state).toBe("extended");
  });

  it("keeps every returned structure within the snapshot cutoff", () => {
    const snapshot = analyzeChanlun(candlesFromValues(values));
    expect(snapshot.fractals.every((item) => item.confirmedAt <= snapshot.dataCutoff)).toBe(true);
    expect(snapshot.strokes.every((item) => item.confirmedAt <= snapshot.dataCutoff)).toBe(true);
    expect(snapshot.segments.every((item) => item.confirmedAt <= snapshot.dataCutoff)).toBe(true);
    expect(snapshot.zones.every((item) => item.confirmedAt <= snapshot.dataCutoff)).toBe(true);
    expect(snapshot.signals.every((item) => item.confirmedAt <= snapshot.dataCutoff)).toBe(true);
  });
});
