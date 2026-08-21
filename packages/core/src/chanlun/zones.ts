import type { CentralZone, PriceLeg, Segment, Stroke } from "./types.js";

function overlap(legs: readonly PriceLeg[]): { low: number; high: number } | null {
  const low = Math.max(...legs.map((leg) => leg.low));
  const high = Math.min(...legs.map((leg) => leg.high));
  return low < high ? { low, high } : null;
}

function asPriceLegs(legs: readonly Stroke[] | readonly Segment[]): PriceLeg[] {
  return legs.map((leg) => ({
    id: leg.id,
    direction: leg.direction,
    startTime: leg.startTime,
    endTime: leg.endTime,
    confirmedAt: leg.confirmedAt,
    high: leg.high,
    low: leg.low,
  }));
}

export function buildCentralZones(
  input: readonly Stroke[] | readonly Segment[],
  level: CentralZone["level"],
): CentralZone[] {
  const legs = asPriceLegs(input);
  const zones: CentralZone[] = [];
  let index = 0;
  while (index + 2 < legs.length) {
    const seed = legs.slice(index, index + 3);
    const seedOverlap = overlap(seed);
    if (!seedOverlap) {
      index += 1;
      continue;
    }

    const first = seed[0];
    const third = seed[2];
    if (!first || !third) break;
    const members = [...seed];
    let cursor = index + 3;
    while (cursor < legs.length) {
      const candidate = legs[cursor];
      if (!candidate || candidate.high < seedOverlap.low || candidate.low > seedOverlap.high) break;
      members.push(candidate);
      cursor += 1;
    }

    const exit = legs[cursor];
    const state: CentralZone["state"] = exit
      ? exit.low > seedOverlap.high
        ? "left_up"
        : exit.high < seedOverlap.low
          ? "left_down"
          : members.length > 3
            ? "extended"
            : "forming"
      : members.length > 3
        ? "extended"
        : "forming";
    const last = members.at(-1) ?? third;
    zones.push({
      id: `zone:${level}:${first.startTime}:${last.endTime}`,
      level,
      startTime: first.startTime,
      endTime: last.endTime,
      confirmedAt: Math.max(...members.map((leg) => leg.confirmedAt)),
      coreLow: seedOverlap.low,
      coreHigh: seedOverlap.high,
      rangeLow: Math.min(...members.map((leg) => leg.low)),
      rangeHigh: Math.max(...members.map((leg) => leg.high)),
      legIds: members.map((leg) => leg.id),
      state,
    });
    index = Math.max(index + 1, cursor - 1);
  }
  return zones;
}
