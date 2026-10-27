import test from "node:test";
import assert from "node:assert/strict";
import {createPegLayout} from "../public/board-layout.mjs";
import {firingVelocity} from "../public/plunger.mjs";
import {randomLaunch,varyLaunchVelocity,VARIATION} from "../public/physics-variation.mjs";
import {PHYSICS,RAIL_LENGTH,RAIL_POINTS,sampleRail,createPhysicalBall,
        resolveCircle,resolveSegment,stepPhysicalBall} from "../public/physics-engine.mjs";

const layout=createPegLayout(PHYSICS.fieldRight);
const rngFromSeed=seed=>()=>{
  seed=(Math.imul(1664525,seed)+1013904223)>>>0;
  return seed/4294967296;
};
test("real rail path is continuous, leads into the peg grid and has no top teleport",()=>{
  assert.ok(RAIL_LENGTH>520&&RAIL_LENGTH<570);
  assert.ok(RAIL_POINTS.length>100);
  assert.deepEqual([RAIL_POINTS[0].x,RAIL_POINTS[0].y],[393,606]);
  const end=sampleRail(RAIL_LENGTH);
  assert.ok(end.x>340&&end.x<355&&end.y>125&&end.y<145);
  assert.ok(end.tx<-.25&&end.ty>0);
  for(let i=1;i<RAIL_POINTS.length;i++){
    assert.ok(RAIL_POINTS[i].s>RAIL_POINTS[i-1].s);
    assert.ok(Math.hypot(RAIL_POINTS[i].x-RAIL_POINTS[i-1].x,
                         RAIL_POINTS[i].y-RAIL_POINTS[i-1].y)<5);
  }
  const ball=createPhysicalBall(firingVelocity(.4));
  let entered=false,previous={x:ball.x,y:ball.y};
  for(let i=0;i<500;i++){
    const result=stepPhysicalBall(ball,1/180,layout,()=>.5);
    assert.ok(Math.hypot(ball.x-previous.x,ball.y-previous.y)<12,
       "Physical release must not teleport the marble");
    previous={x:ball.x,y:ball.y};
    if(result.entered){entered=true;break;}
  }
  assert.ok(entered,"Marble must leave the continuous firing guide");
  assert.equal(ball.mode,"field");
});
test("sphere impulse uses restitution, Coulomb friction and transfers slip into spin",()=>{
  const ball={x:8,y:0,vx:-100,vy:20,omega:0,r:7,impactCount:0};
  const hit=resolveCircle(ball,{x:0,y:0,r:5},.8,.3,()=>.5);
  assert.ok(hit&&hit.speed>0);
  assert.ok(ball.x>=12);
  assert.ok(ball.vx>0);
  assert.ok(Math.abs(ball.vx-80)<3);
  assert.ok(ball.omega!==0,"Friction must transfer tangential motion into spin");
  const next=resolveCircle(ball,{x:0,y:0,r:5},.8,.3,()=>.5);
  assert.equal(next,null,"Separating bodies cannot get a second impulse");
});
test("slot separators are physical full segments, not painted-only posts",()=>{
  const x=PHYSICS.slotLeft+(PHYSICS.slotRight-PHYSICS.slotLeft)/11*3;
  const b={x:x-5,y:650,vx:75,vy:35,omega:0,r:7.1,impactCount:0};
  const result=resolveSegment(b,{ax:x,ay:619,bx:x,by:681,r:1.15},.3,.4,()=>.5);
  assert.ok(result);
  assert.ok(b.x<x-8);
  assert.ok(b.vx<0);
});
test("mild manufacturing variation is bounded and does not choose prize slots",async()=>{
  assert.ok(VARIATION.laneSpeed<=.015);
  assert.ok(VARIATION.entryAngle<=.02);
  assert.ok(VARIATION.maxPegImpulse<=4);
  const source=(await import("node:fs")).readFileSync(
    new URL("../public/physics-engine.mjs",import.meta.url),"utf8");
  assert.doesNotMatch(source,/multiplier|winningSlot|reward|lit\.includes/);
});
test("all launch powers settle in an actual bin with finite physical state",()=>{
  let shots=0,entered=0;
  for(const power of [.075,.15,.3,.55,.8,1]){
    for(let seed=1;seed<=5;seed++){
      const rng=rngFromSeed(1000*seed+Math.round(power*100));
      const variation=randomLaunch(rng);
      const ball=createPhysicalBall(varyLaunchVelocity(firingVelocity(power),variation),variation);
      let result;
      for(let i=0;i<30*180;i++){
        result=stepPhysicalBall(ball,1/180,layout,rng);
        if(result.entered)entered++;
        for(const value of [ball.x,ball.y,ball.vx,ball.vy,ball.omega,ball.spin])
          assert.ok(Number.isFinite(value),"Physics values must remain finite");
        if(result.settled)break;
      }
      assert.equal(ball.mode,"done","Power "+power+", seed "+seed+" failed to settle");
      assert.ok(Number.isInteger(ball.slot)&&ball.slot>=0&&ball.slot<11);
      assert.ok(ball.y>=PHYSICS.slotBottom-ball.r-.02);
      shots++;
    }
  }
  assert.equal(entered,shots,"Every valid shot must reach the main field");
});
