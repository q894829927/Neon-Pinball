import test from "node:test";
import assert from "node:assert/strict";
import {makeTrayBall,stepTrayBalls,isBallInTray,TRAY_RADIUS} from "../public/payout-tray.mjs";
test("every physical payout sprite remains inside the receiving tray in five screen sizes",()=>{
  for(const width of [75,104,140,185,320]){
    const height=36,balls=[];
    for(let frame=0;frame<300;frame++){
      if(frame%5===0&&balls.length<20)
        balls.push(makeTrayBall(balls.length,width,height,TRAY_RADIUS));
      stepTrayBalls(balls,1/60,width,height);
      for(const ball of balls)
        assert.ok(isBallInTray(ball,width,height),
          "ball must never cross tray wall/floor: "+JSON.stringify({width,frame,ball}));
    }
    assert.equal(balls.length,20);
    assert.ok(balls.every(b=>b.y>TRAY_RADIUS),
      "all marbles have entered the basin from the dispenser mouth");
  }
});
test("tray physics is deterministic, bounded and respects bad input",()=>{
  const a=Array.from({length:10},(_,i)=>makeTrayBall(i,130,38));
  const b=Array.from({length:10},(_,i)=>makeTrayBall(i,130,38));
  for(let step=0;step<240;step++){
    stepTrayBalls(a,1/60,130,38);
    stepTrayBalls(b,1/60,130,38);
  }
  assert.deepEqual(a,b);
  assert.throws(()=>makeTrayBall(0,4,20));
  assert.throws(()=>makeTrayBall(-1,100,40));
});
