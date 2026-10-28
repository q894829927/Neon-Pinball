import test from "node:test";
import assert from "node:assert/strict";
import {FEEDBACK,metalImpactProfile,jackpotTier,slotPulseStrength,trailOpacity} from "../public/arcade-feedback.mjs";
test("metal hits derive pitch and amplitude from actual impulse",()=>{
  assert.equal(metalImpactProfile(20),null);
  assert.equal(metalImpactProfile(NaN),null);
  const soft=metalImpactProfile(80,false,.5),hard=metalImpactProfile(920,false,.5);
  assert.ok(hard.frequency>soft.frequency);
  assert.ok(hard.gain>soft.gain);
  assert.ok(hard.duration>soft.duration);
  assert.ok(metalImpactProfile(700,true,.5).duration>metalImpactProfile(700,false,.5).duration);
  const a=metalImpactProfile(300,false,0),b=metalImpactProfile(300,false,1);
  assert.ok(b.frequency>a.frequency,"same strength must vary in timbre");
  assert.ok(FEEDBACK.impactCooldownMs>=40,"voices must be rate limited");
});
test("visual effects bounded, independently derived from result and trajectory",()=>{
  assert.equal(jackpotTier(false,10),null);
  assert.equal(jackpotTier(true,6),null);
  assert.equal(jackpotTier(true,8),"epic");
  assert.equal(jackpotTier(true,10),"legendary");
  assert.equal(slotPulseStrength(0),0);
  assert.ok(slotPulseStrength(1.7)>slotPulseStrength(.1));
  assert.ok(slotPulseStrength(999)>.7);
  assert.equal(trailOpacity(-1,12,900),0);
  assert.ok(trailOpacity(11,12,900)>trailOpacity(1,12,900));
  assert.ok(FEEDBACK.maxTrailPoints<=24&&FEEDBACK.maxParticles<=160);
});
