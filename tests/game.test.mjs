import test from "node:test";
import assert from "node:assert/strict";
import {
  BETS,MULTIPLIERS,SLOT_COUNT,LIT_COUNT,STARTING_MARBLES,
  freshSave,restoreSave,createRound,canAfford,settle,redeem,selectTheme,GIFTS
} from "../public/rules.mjs";

test("game begins with exactly 100 virtual marbles",()=>{
  const save=freshSave();
  assert.equal(save.marbles,STARTING_MARBLES);
  assert.equal(save.cards,0);
  assert.deepEqual(BETS,[10,20,50]);
  assert.deepEqual(MULTIPLIERS,[2,4,6,8,10]);
  assert.equal(SLOT_COUNT,11);
  assert.equal(LIT_COUNT,3);
});

test("each fresh round chooses a valid multiplier and 3 unique red slots",()=>{
  let sample=.001;
  for(let i=0;i<110;i++){
    const round=createRound(()=>{sample=(sample+.173)%1;return sample;});
    assert.ok(MULTIPLIERS.includes(round.multiplier));
    assert.equal(round.lit.length,3);
    assert.equal(new Set(round.lit).size,3);
    assert.ok(round.lit.every(x=>x>=0&&x<SLOT_COUNT));
  }
  const zero=createRound(()=>0);
  assert.equal(zero.multiplier,2);
});

test("win: 100 - 10 + 10 * 6 = 150",()=>{
  const save=freshSave();
  const r=settle(save,{multiplier:6,lit:[2,4,7]},10,4);
  assert.equal(r.hit,true);
  assert.equal(r.reward,60);
  assert.equal(r.save.marbles,150);
  assert.equal(r.save.rounds,1);
  assert.equal(r.save.wins,1);
  assert.equal(r.newCards,1);
  assert.equal(r.save.cards,1);
});

test("lose: 100 - 10 = 90, with no card",()=>{
  const r=settle(freshSave(),{multiplier:6,lit:[2,4,7]},10,1);
  assert.equal(r.hit,false);
  assert.equal(r.reward,0);
  assert.equal(r.save.marbles,90);
  assert.equal(r.newCards,0);
});

test("card threshold depends on ONE shot winning 50+ marbles",()=>{
  const a=settle(freshSave(),{multiplier:4,lit:[2,4,7]},10,4);
  assert.equal(a.reward,40);
  assert.equal(a.newCards,0);
  const b=settle(a.save,{multiplier:2,lit:[2,4,7]},50,4);
  assert.equal(b.reward,100);
  assert.equal(b.newCards,1);
  const c=settle(b.save,{multiplier:10,lit:[2,4,7]},50,1);
  assert.equal(c.reward,0);
  assert.equal(c.newCards,0);
  assert.equal(c.save.cards,1);
});

test("invalid stakes, lack of marbles and invalid slot cannot settle",()=>{
  const s=freshSave();
  assert.equal(canAfford(s,10),true);
  assert.equal(canAfford(s,12),false);
  assert.equal(canAfford({...s,marbles:9},10),false);
  assert.throws(()=>settle(s,{multiplier:6,lit:[2,4,7]},12,2));
  assert.throws(()=>settle(s,{multiplier:6,lit:[2,4,7]},10,-1));
  assert.throws(()=>settle(s,{multiplier:6,lit:[2,2,7]},10,2));
  assert.throws(()=>settle(s,{multiplier:99,lit:[2,4,7]},10,2));
});

test("redeem cards for local, virtual themes only",()=>{
  const winner=settle(freshSave(),{multiplier:6,lit:[2,4,7]},10,4);
  const next=redeem(winner.save,"sunset");
  assert.equal(next.cards,0);
  assert.ok(next.redeemed.includes("sunset"));
  assert.equal(next.theme,"sunset");
  assert.throws(()=>redeem(next,"sunset"));
  assert.throws(()=>redeem(next,"mint"));
  assert.throws(()=>redeem(next,"real-prize"));
  assert.equal(selectTheme(next,"classic").theme,"classic");
  assert.throws(()=>selectTheme(next,"violet"));
  assert.equal(GIFTS.length,3);
});

test("malformed or tampered local save is normalized",()=>{
  assert.equal(restoreSave(null).marbles,100);
  const s=restoreSave({marbles:-900,cards:1.5,theme:"violet",
    redeemed:["bogus","mint","mint"],best:10});
  assert.equal(s.marbles,0);
  assert.equal(s.cards,0);
  assert.equal(s.theme,"classic");
  assert.deepEqual(s.redeemed,["mint"]);
});

test("deployment has actual pinball UI rather than old flipper controls",async()=>{
  const {readFileSync}=await import("node:fs");
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  const js=readFileSync(new URL("../public/game.js",import.meta.url),"utf8");
  assert.match(html,/\/games\/pinball\/style\.css/);
  assert.match(html,/\/games\/pinball\/game\.js/);
  assert.match(html,/十一条落珠槽/);
  assert.match(html,/下拉拉杆|机械拉杆/);
  assert.doesNotMatch(html,/id="launchBtn"|class="launch-button"|长按发射按钮/);
  assert.match(js,/bump\(p\.x,p\.y,p\.r\)/);
  assert.match(js,/finishShot\(ball\.slot\)/);
  assert.match(js,/if\(settled\|\|!priorSave\)return/);
  assert.doesNotMatch(html,/左右挡板|Paddle/);
});

test("plunger drag is based on distance, not hold time; taps do not bet",async()=>{
  const {PLUNGER,boardPoint,isPlungerHit,pullStrength,canFire,firingVelocity}=
    await import("../public/plunger.mjs");
  assert.equal(pullStrength(PLUNGER.restY,PLUNGER.restY),0);
  assert.equal(pullStrength(PLUNGER.restY,PLUNGER.restY+21),.5);
  assert.equal(pullStrength(PLUNGER.restY,PLUNGER.restY+100),1);
  assert.equal(pullStrength(PLUNGER.restY,PLUNGER.restY-30),0);
  assert.equal(canFire(pullStrength(650,650)),false);
  assert.equal(canFire(pullStrength(650,690)),true);
  assert.equal(isPlungerHit(391,646),true);
  assert.equal(isPlungerHit(260,646),false);
  const scaled=boardPoint(200,355,{left:0,top:0,width:400,height:710},420,710);
  assert.equal(scaled.x,210);assert.equal(scaled.y,355);
  assert.ok(Math.abs(firingVelocity(.8).laneVy)>Math.abs(firingVelocity(.2).laneVy));
  assert.ok(Math.abs(firingVelocity(.8).entryVx)>Math.abs(firingVelocity(.2).entryVx));
});

test("DPR canvas and physical pointer drag are wired without an HTML launch button",async()=>{
  const {readFileSync}=await import("node:fs");
  const game=readFileSync(new URL("../public/game.js",import.meta.url),"utf8");
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  assert.match(game,/window\.devicePixelRatio/);
  assert.match(game,/ResizeObserver\(resizeCanvas\)/);
  assert.match(game,/canvas\.setPointerCapture\(event\.pointerId\)/);
  assert.match(game,/charge=pullStrength\(dragStartY,pointerPosition\(event\)\.y\)/);
  assert.match(game,/drawPlunger\(p\)/);
  assert.doesNotMatch(game,/el\.shoot|launchBtn/);
  assert.doesNotMatch(html,/id="launchBtn"/);
});
