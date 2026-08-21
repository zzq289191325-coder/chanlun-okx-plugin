import { describe, expect, it } from "vitest";
import { detectCandidateSignals } from "../src/chanlun/signals.js";
import type { CentralZone } from "../src/chanlun/types.js";
import { divergence, stroke } from "./fixtures.js";

describe("candidate structure points", () => {
  it("requires reversal confirmation for candidate 1 and continuation for candidate 2", () => {
    const strokes = [
      stroke("down-0", "down", 0, 10, 80, 100),
      stroke("up-1", "up", 10, 20, 80, 96),
      stroke("down-2", "down", 20, 30, 84, 96),
      stroke("up-3", "up", 30, 40, 84, 102),
    ];
    const signals = detectCandidateSignals(strokes, [], [divergence("d0", "bottom", "down-0", 10, 80)]);

    expect(signals.map((item) => item.label)).toEqual(["候选1买", "候选2买"]);
    expect(signals[0]?.confirmedAt).toBe(strokes[1]?.confirmedAt);
    expect(signals[1]?.confirmedAt).toBe(strokes[3]?.confirmedAt);
  });

  it("detects a candidate 3 only after exit, no-reentry retest, and confirmation", () => {
    const zone: CentralZone = {
      id: "z0",
      level: "stroke",
      startTime: 0,
      endTime: 30,
      confirmedAt: 31,
      coreLow: 100,
      coreHigh: 110,
      rangeLow: 95,
      rangeHigh: 112,
      legIds: ["a", "b", "c"],
      state: "left_up",
    };
    const strokes = [
      stroke("exit", "up", 30, 40, 106, 120),
      stroke("retest", "down", 40, 50, 112, 120),
      stroke("confirm", "up", 50, 60, 112, 123),
    ];
    const signals = detectCandidateSignals(strokes, [zone], []);

    expect(signals).toHaveLength(1);
    expect(signals[0]?.label).toBe("候选3买");
    expect(signals[0]?.confirmedAt).toBe(strokes[2]?.confirmedAt);
  });
});
