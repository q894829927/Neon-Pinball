import test from "node:test";
import assert from "node:assert/strict";
import {PAYOUT_CLINK_GAP_MS,payoutImpactProfile} from "../public/payout-feedback.mjs";
test("payout impacts vary tone/volume with strength and contact surface",()=>{
  assert.equal(payoutImpactProfile(null),null);
  assert.equal(payoutImpactProfile({kind:"platform",speed:15}),null);
  const gentle=payoutImpactProfile({kind:"platform",speed:39});
  const hard=payoutImpactProfile({kind:"platform",speed:310});
  assert.ok(hard.frequency>gentle.frequency);
  assert.ok(hard.gain>gentle.gain);
  assert.ok(hard.duration>gentle.duration);
  const bead=payoutImpactProfile({kind:"bead",speed:310});
  assert.notEqual(bead.frequency,hard.frequency);
  const first=payoutImpactProfile({kind:"basin",speed:200},0);
  const second=payoutImpactProfile({kind:"basin",speed:200},1);
  assert.notEqual(first.frequency,second.frequency);
  assert.ok(PAYOUT_CLINK_GAP_MS>=80);
});
