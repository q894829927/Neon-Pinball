/** Short, rate-limited synthetic clinks derived only from physical impact speed. */
export const PAYOUT_CLINK_GAP_MS=105;
export function payoutImpactProfile(impact,variation=.5){
  if(!impact||!["bead","basin","platform","wall"].includes(impact.kind)||
    !Number.isFinite(impact.speed)||impact.speed<23)return null;
  const power=Math.max(0,Math.min(1,(impact.speed-23)/365));
  const detune=1+(.5-Math.max(0,Math.min(1,variation)))*.095;
  const base={bead:920,basin:665,platform:510,wall:735}[impact.kind];
  return Object.freeze({
    frequency:Math.round((base+power*(impact.kind==="platform"?260:450))*detune),
    duration:+(.045+power*.07).toFixed(3),
    gain:+(.009+power*.020).toFixed(4),
    kind:impact.kind
  });
}
