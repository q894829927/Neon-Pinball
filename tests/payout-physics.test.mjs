import test from "node:test";
import assert from "node:assert/strict";
import {createPayoutWorld,spawnPayoutBall,stepPayoutWorld,
  finishPayoutWorld,reflowPayoutWorld,withinPayoutBasin} from "../public/payout-physics.mjs";

test("steel marbles really fall, rebound on basin floor and collide with other marbles",()=>{
  const world=createPayoutWorld(168,36,50);
  const first=spawnPayoutBall(world);
  const initial={x:first.x,y:first.y};
  assert.equal(world.balls.length,1);
  for(let i=0;i<80;i++)stepPayoutWorld(world,1/120,1);
  assert.ok(first.y>initial.y+5,"Gravity must move the real position");
  assert.ok(first.contacts>0,"Floor must physically bounce/contact");
  for(let i=0;i<150;i++)stepPayoutWorld(world,1/120,Math.min(50,Math.floor(i*.35)+1));
  assert.equal(world.balls.length,50);
  assert.ok(world.contacts>0&&world.wallHits>=0);
  assert.ok(world.balls.every(b=>withinPayoutBasin(b,world)));
  assert.ok(world.balls.some(b=>b.contacts>1));
});
test("100/500 earned marbles are individual simulated objects and remain inside the bowl",()=>{
  for(const [width,height,total] of [[168,36,100],[122,30,500]]){
    const state=createPayoutWorld(width,height,total);
    const payoutFrames=500;
    for(let frame=0;frame<payoutFrames;frame++){
      stepPayoutWorld(state,1/120,Math.floor(total*(frame+1)/payoutFrames));
      if(frame%20===0){
        assert.ok(state.balls.every(b=>withinPayoutBasin(b,state)),
          "A credit must not penetrate the bowl walls: "+frame);
      }
    }
    assert.equal(state.balls.length,total);
    finishPayoutWorld(state,90);
    assert.ok(state.balls.every(b=>withinPayoutBasin(b,state)));
    const locations=new Set(state.balls.map(b=>b.x.toFixed(2)+"/"+b.y.toFixed(2)));
    assert.ok(locations.size>=.92*state.balls.length,"No static grid/proxy tokens");
    const heights=new Set(state.balls.slice(0,40).map(b=>b.y.toFixed(1)));
    assert.ok(heights.size>=3,"Natural layered contacts rather than one bottom row");
  }
});
test("skip, reduced motion, deterministic reflow and huge reward limits",()=>{
  const a=createPayoutWorld(150,32,150),b=createPayoutWorld(150,32,150);
  stepPayoutWorld(a,.05,13);stepPayoutWorld(b,.05,13);
  assert.deepEqual(a,b);
  finishPayoutWorld(a,200);finishPayoutWorld(b,200);
  assert.deepEqual(a,b);
  assert.equal(a.balls.length,150);
  const firstRef=a.balls[0];
  reflowPayoutWorld(a,120,28);
  assert.strictEqual(a.balls[0],firstRef,"Resize cannot reset to a different fake pile");
  assert.ok(a.balls.every(x=>withinPayoutBasin(x,a)));
  const huge=createPayoutWorld(122,30,10_000_000);
  assert.ok(huge.visible>=500&&huge.visible<=850);
  assert.equal(huge.reward,10_000_000);
  assert.throws(()=>createPayoutWorld(100,30,-2));
});
