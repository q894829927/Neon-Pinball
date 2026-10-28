/** Deterministic, testable arcade feedback parameters. No physics or scoring changes. */
export const FEEDBACK = Object.freeze({
  minAudibleImpact: 42,
  impactCooldownMs: 58,
  maxImpactFlashes: 18,
  maxParticles: 120,
  maxTrailPoints: 18,
  jackpotMultiplier: 8,
});
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

/** Collisions in the physics engine report their actual normal impact speed. */
export function metalImpactProfile(speed,bumper=false,variation=.5){
  if(!Number.isFinite(speed)||speed<FEEDBACK.minAudibleImpact)return null;
  const force=clamp((speed-FEEDBACK.minAudibleImpact)/950,0,1);
  const detune=(clamp(Number.isFinite(variation)?variation:.5,0,1)-.5)*.12;
  const base=(bumper?330:650)+(bumper?380:680)*force;
  return {
    frequency:Math.round(base*(1+detune)),
    duration:+((bumper?.14:.068)+force*(bumper?.12:.07)).toFixed(3),
    gain:+(.014+force*.034+(bumper?.008:0)).toFixed(4),
    brightness:+(.18+force*.82).toFixed(3),
    bumper:Boolean(bumper),
  };
}
export function jackpotTier(hit,multiplier){
  return hit&&Number.isFinite(multiplier)&&multiplier>=FEEDBACK.jackpotMultiplier
    ?(multiplier>=10?"legendary":"epic"):null;
}
/** 0..1, quickly peaks then decays without timers or layout-dependent state. */
export function slotPulseStrength(remaining,total=1.8){
  if(!Number.isFinite(remaining)||!Number.isFinite(total)||total<=0)return 0;
  const t=clamp(remaining/total,0,1);
  return +(Math.pow(t,.8)*(0.77+0.23*Math.sin((1-t)*Math.PI*8)**2)).toFixed(4);
}
export function trailOpacity(index,length,speed=0){
  if(!Number.isInteger(index)||length<=1||index<0||index>=length)return 0;
  const t=index/(length-1);
  const speedGain=clamp((Number.isFinite(speed)?speed:0)/650,.12,1);
  return +(0.06+0.44*t*t*speedGain).toFixed(4);
}
