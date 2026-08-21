import type { CandidateSignal, CentralZone, Divergence, Stroke } from "./types.js";

function score(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function candidateOne(strokes: readonly Stroke[], divergences: readonly Divergence[]): CandidateSignal[] {
  const signals: CandidateSignal[] = [];
  for (const divergence of divergences.filter((item) => item.level === "stroke")) {
    const index = strokes.findIndex((stroke) => stroke.id === divergence.legId);
    const reversal = strokes[index + 1];
    if (index < 0 || !reversal) continue;

    if (divergence.side === "bottom" && reversal.direction === "up") {
      signals.push({
        id: `signal:candidate_1_buy:${divergence.locationTime}`,
        kind: "candidate_1_buy",
        label: "候选1买",
        side: "long",
        locationTime: divergence.locationTime,
        confirmedAt: reversal.confirmedAt,
        price: divergence.price,
        score: score((divergence.score + 68) / 2),
        evidenceIds: [divergence.id, reversal.id],
        reason: "底背驰结构完成，并由后续向上笔确认；仅为候选结构点。",
      });
    } else if (divergence.side === "top" && reversal.direction === "down") {
      signals.push({
        id: `signal:candidate_1_sell:${divergence.locationTime}`,
        kind: "candidate_1_sell",
        label: "候选1卖",
        side: "short",
        locationTime: divergence.locationTime,
        confirmedAt: reversal.confirmedAt,
        price: divergence.price,
        score: score((divergence.score + 68) / 2),
        evidenceIds: [divergence.id, reversal.id],
        reason: "顶背驰结构完成，并由后续向下笔确认；仅为候选结构点。",
      });
    }
  }
  return signals;
}

function candidateTwo(strokes: readonly Stroke[], firstSignals: readonly CandidateSignal[]): CandidateSignal[] {
  const signals: CandidateSignal[] = [];
  for (const first of firstSignals) {
    const originIndex = strokes.findIndex((stroke) => stroke.endTime === first.locationTime);
    const pullback = strokes[originIndex + 2];
    const confirmation = strokes[originIndex + 3];
    if (originIndex < 0 || !pullback || !confirmation) continue;

    if (
      first.side === "long" &&
      pullback.direction === "down" &&
      confirmation.direction === "up" &&
      pullback.low > first.price &&
      confirmation.high > pullback.high
    ) {
      signals.push({
        id: `signal:candidate_2_buy:${pullback.endTime}`,
        kind: "candidate_2_buy",
        label: "候选2买",
        side: "long",
        locationTime: pullback.endTime,
        confirmedAt: confirmation.confirmedAt,
        price: pullback.low,
        score: score(first.score + 5),
        evidenceIds: [first.id, pullback.id, confirmation.id],
        reason: "候选1买后的回落未创新低，并由新的向上笔突破确认；仅为候选结构点。",
      });
    } else if (
      first.side === "short" &&
      pullback.direction === "up" &&
      confirmation.direction === "down" &&
      pullback.high < first.price &&
      confirmation.low < pullback.low
    ) {
      signals.push({
        id: `signal:candidate_2_sell:${pullback.endTime}`,
        kind: "candidate_2_sell",
        label: "候选2卖",
        side: "short",
        locationTime: pullback.endTime,
        confirmedAt: confirmation.confirmedAt,
        price: pullback.high,
        score: score(first.score + 5),
        evidenceIds: [first.id, pullback.id, confirmation.id],
        reason: "候选1卖后的反弹未创新高，并由新的向下笔跌破确认；仅为候选结构点。",
      });
    }
  }
  return signals;
}

function candidateThree(strokes: readonly Stroke[], zones: readonly CentralZone[]): CandidateSignal[] {
  const signals: CandidateSignal[] = [];
  for (const zone of zones.filter((item) => item.level === "stroke")) {
    const afterZone = strokes.findIndex((stroke) => stroke.startTime >= zone.endTime);
    if (afterZone < 0) continue;

    for (let index = afterZone; index + 2 < strokes.length; index += 1) {
      const exit = strokes[index];
      const retest = strokes[index + 1];
      const confirmation = strokes[index + 2];
      if (!exit || !retest || !confirmation) continue;

      if (
        exit.direction === "up" &&
        exit.high > zone.coreHigh &&
        retest.direction === "down" &&
        retest.low > zone.coreHigh &&
        confirmation.direction === "up" &&
        confirmation.high > retest.high
      ) {
        signals.push({
          id: `signal:candidate_3_buy:${retest.endTime}`,
          kind: "candidate_3_buy",
          label: "候选3买",
          side: "long",
          locationTime: retest.endTime,
          confirmedAt: confirmation.confirmedAt,
          price: retest.low,
          score: 76,
          evidenceIds: [zone.id, exit.id, retest.id, confirmation.id],
          reason: "向上离开中枢后的回踩未进入中枢，并由后续向上笔确认；仅为候选结构点。",
        });
        break;
      }

      if (
        exit.direction === "down" &&
        exit.low < zone.coreLow &&
        retest.direction === "up" &&
        retest.high < zone.coreLow &&
        confirmation.direction === "down" &&
        confirmation.low < retest.low
      ) {
        signals.push({
          id: `signal:candidate_3_sell:${retest.endTime}`,
          kind: "candidate_3_sell",
          label: "候选3卖",
          side: "short",
          locationTime: retest.endTime,
          confirmedAt: confirmation.confirmedAt,
          price: retest.high,
          score: 76,
          evidenceIds: [zone.id, exit.id, retest.id, confirmation.id],
          reason: "向下离开中枢后的反抽未进入中枢，并由后续向下笔确认；仅为候选结构点。",
        });
        break;
      }
    }
  }
  return signals;
}

export function detectCandidateSignals(
  strokes: readonly Stroke[],
  zones: readonly CentralZone[],
  divergences: readonly Divergence[],
): CandidateSignal[] {
  const first = candidateOne(strokes, divergences);
  return [...first, ...candidateTwo(strokes, first), ...candidateThree(strokes, zones)].sort(
    (left, right) => left.confirmedAt - right.confirmedAt || left.locationTime - right.locationTime,
  );
}
