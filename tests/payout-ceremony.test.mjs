import test from "node:test";
import assert from "node:assert/strict";
import {payoutPlan,payoutAct,payoutProgress,PAYOUT_TIMELINE} from "../public/payout-ceremony.mjs";
test("winning ceremony has physical count capped for performance but displays actual reward",()=>{
  assert.equal(payoutPlan({hit:false,reward:0,newCards:0,slot:0,multiplier:10}),null);
  const plan=payoutPlan({hit:true,reward:500,newCards:10,slot:10,multiplier:10});
  assert.equal(plan.coinSprites,20);
  assert.equal(plan.cardSprites,3);
  assert.equal(plan.newCards,10);
  assert.equal(plan.reward,500);
  assert.equal(payoutAct(plan,0),"impact");
  assert.equal(payoutAct(plan,500),"marbles");
  assert.equal(payoutAct(plan,1800),"tickets");
  assert.equal(payoutAct(plan,2900),"done");
  assert.deepEqual(payoutProgress(plan,0),{marbles:0,cards:0});
  assert.deepEqual(payoutProgress(plan,2900),{marbles:500,cards:10});
  assert.ok(payoutProgress(plan,1000).marbles>0);
  assert.ok(payoutProgress(plan,2100).cards>0);
});
test("no-ticket win ends after marble collection and invalid outcomes reject",()=>{
  const plan=payoutPlan({hit:true,reward:40,newCards:0,slot:3,multiplier:2});
  assert.equal(plan.duration,PAYOUT_TIMELINE.noCardFinish);
  assert.equal(payoutAct(plan,1750),"marbles");
  assert.equal(payoutAct(plan,1950),"done");
  assert.throws(()=>payoutPlan({hit:true,reward:0,newCards:0,slot:0,multiplier:2}));
});
