// Geometry and input rules for the arcade-style spring plunger.
// Coordinates are in the 420 x 710 logical playfield, independent of device DPR.
export const PLUNGER = Object.freeze({
  centerX: 391,
  restY: 646,
  travel: 42,
  hitLeft: 372,
  hitRight: 419,
  hitTop: 613,
  hitBottom: 701,
  minPull: 0.075,
});

export function boardPoint(clientX, clientY, bounds, width = 420, height = 710) {
  if (!bounds.width || !bounds.height) return { x: -Infinity, y: -Infinity };
  return {
    x: (clientX - bounds.left) * width / bounds.width,
    y: (clientY - bounds.top) * height / bounds.height,
  };
}

export function isPlungerHit(x, y) {
  return x >= PLUNGER.hitLeft && x <= PLUNGER.hitRight &&
    y >= PLUNGER.hitTop && y <= PLUNGER.hitBottom;
}

export function pullStrength(startY, currentY) {
  const delta = (currentY - startY) / PLUNGER.travel;
  return Math.max(0, Math.min(1, Number.isFinite(delta) ? delta : 0));
}

export function canFire(pull) {
  return Number.isFinite(pull) && pull >= PLUNGER.minPull;
}

export function firingVelocity(pull) {
  const power = Math.max(0, Math.min(1, pull));
  return {
    laneVy: -(840 + 580 * power),
    entryVx: -(105 + 190 * power),
    entryVy: -(70 + 110 * power),
  };
}
