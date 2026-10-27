import { MULTIPLIERS } from "./rules.mjs";

/** Four full left-to-right circuits, then stop on the already-selected multiplier. */
export function buildLampSequence(targetMultiplier, circuits = 4) {
  const target = MULTIPLIERS.indexOf(targetMultiplier);
  if (target < 0 || !Number.isInteger(circuits) || circuits < 1 || circuits > 10) {
    throw new Error("Invalid multiplier lamp animation");
  }
  const steps = circuits * MULTIPLIERS.length + target + 1;
  return Array.from({ length: steps }, (_, step) => step % MULTIPLIERS.length);
}

/** Clock-based easing: the last bulbs take noticeably longer than the first. */
export function lampStepDelay(step, total) {
  if (!Number.isInteger(step) || !Number.isInteger(total) || total < 1 ||
      step < 0 || step >= total) throw new Error("Invalid lamp animation frame");
  const progress = (step + 1) / total;
  return Math.round(60 + 240 * progress * progress * progress);
}

/** The true result stays concealed while the bulbs are running. */
export function displayedMultiplier(revealState, round) {
  return revealState === "revealed" ? (round?.multiplier ?? null) : null;
}

export function lampVisualIndex(revealState, round, movingIndex = -1) {
  if (revealState === "rolling") return movingIndex;
  if (revealState === "revealed" && round) return MULTIPLIERS.indexOf(round.multiplier);
  return -1;
}
