import test from "node:test";
import assert from "node:assert/strict";
import {PAYOUT_RADIUS,createPayoutWorld,spawnPayoutBall,stepPayoutWorld,
 finishPayoutWorld,reflowPayoutWorld,withinPayoutBasin,payoutOverflow}
 from "../public/payout-physics.mjs";

test("reward size never changes metal bead radius",()=>{
  for(const total of [1,10,50,100,500,10000]){
    const state=createPayoutWorld(168,66,total,{left:6,right:162,top:25,bottom:60});
    assert.equal(state.radius,PAYOUT_RADIUS);
    spawnPayoutBall(state);
    assert.equal(state.balls[0].radius,PAYOUT_RADIUS);
  }
});
test("gravity, floor rebound and bead contact are integrated",()=>{
  const w=createPayoutWorld(168,36,50);
  const b=spawnPayoutBall(w);
  const start=b.y;
  for(let i=0;i<90;i++)stepPayoutWorld(w,1/120,1);
  assert.ok(b.y>start+5);
  assert.ok(b.contacts>0);
  finishPayoutWorld(w,140);
  assert.equal(w.balls.length,50);
  assert.ok(w.contacts>0&&w.balls.every(p=>withinPayoutBasin(p,w)));
});
test("real finite rim lets large wins overflow the glass basin",()=>{
  const w=createPayoutWorld(168,67,500,{left:6,right:162,top:29,bottom:62});
  for(let frame=0;frame<650;frame++){
    stepPayoutWorld(w,1/120,Math.floor(500*(frame+1)/650));
    if(frame%40===0)assert.ok(w.balls.every(b=>withinPayoutBasin(b,w)));
  }
  assert.equal(w.balls.length,500);
  finishPayoutWorld(w,160);
  assert.ok(w.contacts>0);
  assert.ok(payoutOverflow(w)>0,"500 fixed-size beads must rise above basin lip or roll over it");
  assert.equal(w.radius,PAYOUT_RADIUS);
});
test("normal and narrow receivers, resize preserving size, deterministic fast-forward",()=>{
  for(const [width,height] of [[135,61],[84,50]]){
    const tray={left:5,right:width-5,top:21,bottom:height-4};
    const a=createPayoutWorld(width,height,150,tray);
    const b=createPayoutWorld(width,height,150,tray);
    stepPayoutWorld(a,.05,13);stepPayoutWorld(b,.05,13);
    assert.deepEqual(a,b);
    finishPayoutWorld(a,200);finishPayoutWorld(b,200);
    assert.deepEqual(a,b);
    const pointer=a.balls[0];
    const moved={left:5,right:width*.85,top:18,bottom:height-6};
    reflowPayoutWorld(a,width*.85,height-3,moved);
    assert.strictEqual(a.balls[0],pointer);
    assert.equal(a.radius,PAYOUT_RADIUS);
    assert.ok(a.balls.every(x=>withinPayoutBasin(x,a)));
  }
  const huge=createPayoutWorld(122,56,10000000,{left:5,right:117,top:22,bottom:52});
  assert.equal(huge.radius,PAYOUT_RADIUS);
  assert.equal(huge.visible,850);
  assert.equal(huge.reward,10000000);
});
