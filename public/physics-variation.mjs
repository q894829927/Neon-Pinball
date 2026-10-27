/**
 * Small, symmetric, bounded mechanical imperfections.
 * They affect the physical trajectory, never the selected winning slot.
 * Sample one launch variation per shot; only add tangential jitter on actual impacts.
 */
const signed = rng => {
  const sample = Number(rng());
  if (!Number.isFinite(sample)) return 0;
  return 2 * Math.min(1, Math.max(0, sample)) - 1;
};

export const VARIATION = Object.freeze({
  laneSpeed: 0.035,    // +/- 3.5% on spring release
  entrySpeed: 0.035,   // +/- 3.5% entering the field
  entryAngle: 0.095,  // +/- 5.4 degrees
  maxPegImpulse: 16,  // px/s, tangential to actual collision
  pegImpulseRatio: 0.05,
});

export function randomLaunch(rng = Math.random) {
  return {
    laneScale: 1 + signed(rng) * VARIATION.laneSpeed,
    entryScale: 1 + signed(rng) * VARIATION.entrySpeed,
    angle: signed(rng) * VARIATION.entryAngle,
    spin: signed(rng) * 2.4,
  };
}

export function varyLaunchVelocity(base, launch) {
  const c = Math.cos(launch.angle), s = Math.sin(launch.angle);
  return {
    laneVy: base.laneVy * launch.laneScale,
    entryVx: (base.entryVx * c - base.entryVy * s) * launch.entryScale,
    entryVy: (base.entryVx * s + base.entryVy * c) * launch.entryScale,
  };
}

/** Applied only on a real incoming collision, never on free-flight frames. */
export function varyPegRebound(vx, vy, normalX, normalY, impactSpeed, rng = Math.random) {
  if (!(impactSpeed > 0)) return {vx, vy};
  const impulse = signed(rng) * Math.min(
    VARIATION.maxPegImpulse,
    impactSpeed * VARIATION.pegImpulseRatio,
  );
  return {
    vx: vx - normalY * impulse,
    vy: vy + normalX * impulse,
  };
}
