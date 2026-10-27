import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_STAKE,DEPOSIT_STEPS,MULTIPLIERS,SLOT_COUNT,WIN_SLOTS_BY_MULTIPLIER,winningSlotCount,STARTING_MARBLES,
  freshSave,restoreSave,createRound,canAfford,settle,settleFunded,depositMarbles,
  refundDeposit,commitShot,canLaunch,redeem,selectTheme,GIFTS
} from "../public/rules.mjs";

test("game begins with exactly 100 virtual marbles",()=>{
  const save=freshSave();
  assert.equal(save.marbles,STARTING_MARBLES);
  assert.equal(save.cards,0);
  assert.equal(MIN_STAKE,5);
  assert.deepEqual(DEPOSIT_STEPS,[1,5,10]);
  assert.equal(save.pendingStake,0);
  assert.equal(save.pendingRound,null);
  assert.deepEqual(MULTIPLIERS,[2,4,6,8,10]);
  assert.equal(SLOT_COUNT,11);
  assert.deepEqual(MULTIPLIERS.map(winningSlotCount),[4,3,2,1,1]);
});

test("each fresh round chooses valid multiplier-specific red slots",()=>{
  let sample=.001;
  for(let i=0;i<110;i++){
    const round=createRound(()=>{sample=(sample+.173)%1;return sample;});
    assert.ok(MULTIPLIERS.includes(round.multiplier));
    assert.equal(round.lit.length,winningSlotCount(round.multiplier));
    assert.equal(new Set(round.lit).size,winningSlotCount(round.multiplier));
    assert.ok(round.lit.every(x=>x>=0&&x<SLOT_COUNT));
  }
  const zero=createRound(()=>0);
  assert.equal(zero.multiplier,2);
});

test("win: 100 - 10 + 10 * 6 = 150",()=>{
  const save=freshSave();
  const r=settle(save,{multiplier:6,lit:[2,4]},10,4);
  assert.equal(r.hit,true);
  assert.equal(r.reward,60);
  assert.equal(r.save.marbles,150);
  assert.equal(r.save.rounds,1);
  assert.equal(r.save.wins,1);
  assert.equal(r.newCards,1);
  assert.equal(r.save.cards,1);
});

test("lose: 100 - 10 = 90, with no card",()=>{
  const r=settle(freshSave(),{multiplier:6,lit:[2,4]},10,1);
  assert.equal(r.hit,false);
  assert.equal(r.reward,0);
  assert.equal(r.save.marbles,90);
  assert.equal(r.newCards,0);
});

test("card threshold depends on ONE shot winning 50+ marbles",()=>{
  const a=settle(freshSave(),{multiplier:4,lit:[2,4,7]},10,4);
  assert.equal(a.reward,40);
  assert.equal(a.newCards,0);
  const b=settle(a.save,{multiplier:2,lit:[1,2,4,7]},50,4);
  assert.equal(b.reward,100);
  assert.equal(b.newCards,1);
  const c=settle(b.save,{multiplier:10,lit:[4]},50,1);
  assert.equal(c.reward,0);
  assert.equal(c.newCards,0);
  assert.equal(c.save.cards,1);
});

test("invalid stakes, lack of marbles and invalid slot cannot settle",()=>{
  const s=freshSave();
  assert.equal(canAfford(s,10),true);
  assert.equal(canAfford(s,12),true);
  assert.equal(canAfford(s,4),false);
  assert.equal(canAfford(s,0),false);
  assert.equal(canAfford({...s,marbles:9},10),false);
  assert.throws(()=>settle(s,{multiplier:6,lit:[2,4]},4,2));
  assert.throws(()=>settle(s,{multiplier:6,lit:[2,4]},10,-1));
  assert.throws(()=>settle(s,{multiplier:6,lit:[2,2,7]},10,2));
  assert.throws(()=>settle(s,{multiplier:99,lit:[2,4,7]},10,2));
});

test("redeem cards for local, virtual themes only",()=>{
  const winner=settle(freshSave(),{multiplier:6,lit:[2,4]},10,4);
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
  assert.match(html,/11 个奖励槽|十一条落珠槽/);
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
  assert.match(game,/event\.currentTarget\.setPointerCapture\(event\.pointerId\)/);
  assert.match(game,/charge=pullStrength\(dragStartY,pointerPosition\(event\)\.y\)/);
  assert.match(game,/drawPlunger\(p\)/);
  assert.doesNotMatch(game,/el\.shoot|launchBtn/);
  assert.doesNotMatch(html,/id="launchBtn"/);
});


test("mobile first-play layout includes visible stats and stake controls before table",async()=>{
  const {readFileSync}=await import("node:fs");
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  const mobile=readFileSync(new URL("../public/mobile.css",import.meta.url),"utf8");
  const script=readFileSync(new URL("../public/game.js",import.meta.url),"utf8");
  assert.match(html,/\/games\/pinball\/mobile\.css/);
  const bar=html.indexOf('class="mobile-playbar"');
  const cabinet=html.indexOf('class="cabinet"');
  assert.ok(bar>=0&&bar<cabinet,"Mobile betting and balance are above board");
  for(const id of ["mobileBalance","mobileStake","plungerGrip"]){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  for(const amount of [1,5,10]){
    assert.equal((html.match(new RegExp('data-add="'+amount+'"',"g"))||[]).length,2);
  }
  assert.doesNotMatch(html,/data-bet=/);
  assert.match(script,/"mobileBalance"/);
  assert.match(script,/"mobileStake"/);
  assert.doesNotMatch(script,/"mobileMultiplier"|"mobileCards"/);
  assert.match(script,/for\(const surface of \[canvas,plungerGrip\]\)/);
  assert.match(mobile,/min-height:43px/);
  assert.match(mobile,/width:clamp\(44px/);
});

test("portrait, very narrow and short landscape screens do not crop the board",async()=>{
  const {readFileSync}=await import("node:fs");
  const css=readFileSync(new URL("../public/mobile.css",import.meta.url),"utf8");
  assert.match(css,/@media \(max-width:820px\)/);
  assert.match(css,/@media \(max-width:370px\)/);
  assert.match(css,/\(orientation:landscape\) and \(max-height:600px\)/);
  assert.match(css,/calc\(\(100dvh - 214px\)/);
  assert.match(css,/env\(safe-area-inset-bottom\)/);
  assert.match(css,/\.screen-wrap canvas\{width:100%;height:auto;aspect-ratio:420\/710;touch-action:pan-y\}/);
  assert.match(css,/\.plunger-grip\{width:clamp\(44px,14%,58px\);height:19%\}/);
  assert.match(css,/\.screen-wrap \.shoot-overlay\{z-index:5\}/);
  assert.match(css,/\.modal\{/);
});

test("same plunger strength produces bounded, independently varied launches",async()=>{
  const {randomLaunch,varyLaunchVelocity,VARIATION}=await import("../public/physics-variation.mjs");
  const {firingVelocity}=await import("../public/plunger.mjs");
  const base=firingVelocity(.65);
  const first=varyLaunchVelocity(base,randomLaunch(()=>0));
  const center=varyLaunchVelocity(base,randomLaunch(()=>.5));
  const last=varyLaunchVelocity(base,randomLaunch(()=>1));
  assert.deepEqual(center,base,"centered perturbation preserves original physical velocity");
  assert.notDeepEqual(first,last,"identical player force should not lock the launch vector");
  assert.ok(first.laneVy!==last.laneVy);
  assert.ok(first.entryVx!==last.entryVx);
  let seed=1234567;
  const rng=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  const samples=Array.from({length:1000},()=>varyLaunchVelocity(base,randomLaunch(rng)));
  assert.ok(new Set(samples.map(v=>v.entryVx.toFixed(4))).size>950);
  for(const v of samples){
    const laneRatio=Math.abs(v.laneVy/base.laneVy);
    assert.ok(laneRatio>=1-VARIATION.laneSpeed-1e-10&&laneRatio<=1+VARIATION.laneSpeed+1e-10);
    const baseSpeed=Math.hypot(base.entryVx,base.entryVy);
    const ratio=Math.hypot(v.entryVx,v.entryVy)/baseSpeed;
    assert.ok(ratio>=1-VARIATION.entrySpeed-1e-10&&ratio<=1+VARIATION.entrySpeed+1e-10);
  }
});

test("collision variation only modifies velocity tangent to a real impact",async()=>{
  const {varyPegRebound,VARIATION}=await import("../public/physics-variation.mjs");
  const none=varyPegRebound(120,-60,1,0,0,()=>1);
  assert.deepEqual(none,{vx:120,vy:-60});
  const left=varyPegRebound(120,-60,1,0,100,()=>0);
  const right=varyPegRebound(120,-60,1,0,100,()=>1);
  assert.equal(left.vx,120);
  assert.equal(right.vx,120);
  assert.ok(left.vy!==right.vy);
  assert.ok(Math.abs(left.vy+60)<=VARIATION.maxPegImpulse);
  assert.ok(Math.abs(right.vy+60)<=VARIATION.maxPegImpulse);
  const vertical=varyPegRebound(120,-60,0,-1,99999,()=>1);
  assert.equal(vertical.vy,-60);
  assert.ok(Math.abs(vertical.vx-120)<=VARIATION.maxPegImpulse);
});

test("randomness changes real physics but does not preselect payout slots",async()=>{
  const {readFileSync}=await import("node:fs");
  const game=readFileSync(new URL("../public/game.js",import.meta.url),"utf8");
  assert.match(game,/shotVelocity=varyLaunchVelocity\(firingVelocity\(power\),randomLaunch\(\)\)/);
  assert.match(game,/varyPegRebound\(ball\.vx,ball\.vy,nx,ny,-impact\)/);
  assert.match(game,/withVariation&&-impact>35/);
  assert.match(game,/finishShot\(ball\.slot\)/);
  assert.match(game,/for\(let i=1;i<SLOT_COUNT;i\+\+\)bump\(SLOT_LEFT\+i\*SLOT_W,SLOT_TOP-1,4\.2,\.62,false\)/);
});

test("five inserted marbles reveal multiplier once, later deposits retain it",()=>{
  let randomCalls=0;
  const rng=()=>{randomCalls++;return .5;};
  let save=freshSave();
  for(let i=0;i<4;i++){
    save=depositMarbles(save,1,rng);
    assert.equal(save.pendingRound,null);
    assert.equal(save.pendingStake,i+1);
    assert.equal(randomCalls,0,"no early RNG draw");
    assert.equal(canLaunch(save),false);
  }
  save=depositMarbles(save,1,rng);
  assert.equal(save.pendingStake,5);
  assert.equal(save.marbles,95);
  assert.equal(save.pendingRound.multiplier,6);
  assert.equal(save.pendingRound.lit.length,winningSlotCount(6));
  assert.equal(canLaunch(save),true);
  const revealed=JSON.stringify(save.pendingRound);
  const count=randomCalls;
  save=depositMarbles(save,10,()=>{throw Error("must not reroll after reveal");});
  assert.equal(save.pendingStake,15);
  assert.equal(save.marbles,85);
  assert.equal(JSON.stringify(save.pendingRound),revealed);
  assert.equal(randomCalls,count);
  const slot=save.pendingRound.lit[0];
  const round=save.pendingRound;
  const funded=commitShot(save);
  assert.equal(funded.pendingStake,0);
  assert.equal(funded.pendingRound,null);
  assert.equal(funded.marbles,85,"commit must not debit twice");
  const result=settleFunded(funded,round,15,slot);
  assert.equal(result.reward,90);
  assert.equal(result.save.marbles,175);
  assert.equal(result.newCards,1);
});

test("one-click +5 unlocks multiplier; partial deposits survive reload and can be returned",()=>{
  let original=depositMarbles(freshSave(),3,()=>{throw Error("too early");});
  assert.equal(original.pendingRound,null);
  original=restoreSave(JSON.parse(JSON.stringify(original)));
  assert.equal(original.marbles,97);
  assert.equal(original.pendingStake,3);
  original=depositMarbles(original,5,()=>0);
  const fixed=JSON.stringify(original.pendingRound);
  const again=restoreSave(JSON.parse(JSON.stringify(original)));
  assert.equal(JSON.stringify(again.pendingRound),fixed);
  assert.equal(again.pendingStake,8);
  assert.equal(again.marbles,92);
  const refunded=refundDeposit(again);
  assert.equal(refunded.marbles,100);
  assert.equal(refunded.pendingStake,0);
  assert.equal(refunded.pendingRound,null);
  assert.equal(canLaunch(refunded),false);
  const five=depositMarbles(refunded,5,()=>1);
  assert.equal(five.pendingStake,5);
  assert.equal(five.pendingRound.multiplier,10);
  assert.equal(five.marbles,95);
});

test("prepaid losses and minimum 5 stake never subtract twice",()=>{
  let save=depositMarbles(freshSave(),5,()=>0);
  assert.equal(save.marbles,95);
  const funded=commitShot(save);
  const normal=settleFunded(funded,save.pendingRound,5,10);
  assert.equal(normal.hit,false);
  assert.equal(normal.reward,0);
  assert.equal(normal.save.marbles,95);
  assert.equal(normal.save.rounds,1);
  assert.throws(()=>commitShot(funded),/至少5颗/);
  assert.throws(()=>depositMarbles(freshSave(),0));
  assert.throws(()=>depositMarbles(freshSave(),101));
  assert.throws(()=>depositMarbles(freshSave(),-5));
  assert.throws(()=>depositMarbles(freshSave(),1.5));
  assert.equal(canLaunch(depositMarbles(freshSave(),4,()=>0)),false);
  const all=depositMarbles(freshSave(),100,()=>0);
  assert.equal(all.marbles,0);
  assert.equal(canLaunch(all),true);
  assert.equal(settleFunded(commitShot(all),all.pendingRound,100,10).save.marbles,0);
});

test("new UI hides multiplier and slot lights until five marbles are funded",async()=>{
  const {readFileSync}=await import("node:fs");
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  const game=readFileSync(new URL("../public/game.js",import.meta.url),"utf8");
  assert.doesNotMatch(html,/id="multiplier"|id="mobileMultiplier"|class="multiplier-panel"/);
  assert.match(html,/id="machineLamps"/);
  assert.match(html,/id="stakeAmount">0/);
  assert.match(html,/id="mobileStake">0/);
  assert.match(html,/data-refund/);
  assert.match(game,/displayedMultiplier\(revealState,round\)/);
  assert.match(game,/round&&round\.lit\.includes\(i\)/);
  assert.match(game,/depositMarbles\(save,amount\)/);
  assert.match(game,/refundDeposit\(save\)/);
  assert.match(game,/save=commitShot\(save\)/);
  assert.match(game,/settleFunded\(priorSave,round,shotStake,slot\)/);
  assert.doesNotMatch(html,/data-bet=/);
});

test("five cabinet lamps run ordered circuits and stop at exactly the preselected multiplier", async()=>{
  const {buildLampSequence,lampStepDelay,displayedMultiplier,lampVisualIndex}=
    await import("../public/roulette.mjs");
  for(const multiplier of MULTIPLIERS){
    const steps=buildLampSequence(multiplier);
    const targetIndex=MULTIPLIERS.indexOf(multiplier);
    assert.equal(steps.length,21+targetIndex);
    assert.equal(steps.at(-1),targetIndex);
    assert.deepEqual(steps.slice(0,5),[0,1,2,3,4]);
    assert.deepEqual(steps.slice(5,10),[0,1,2,3,4]);
    assert.equal(new Set(steps).size,5);
    const intervals=steps.map((_,index)=>lampStepDelay(index,steps.length));
    assert.ok(intervals[0]<intervals.at(-1),"lamp sequence must slow near the chosen multiplier");
    assert.ok(intervals.every((x,i)=>i===0||x>=intervals[i-1]),"delays cannot speed up again");
    assert.equal(displayedMultiplier("hidden",{multiplier}),null);
    assert.equal(displayedMultiplier("rolling",{multiplier}),null);
    assert.equal(displayedMultiplier("revealed",{multiplier}),multiplier);
    assert.equal(lampVisualIndex("hidden",{multiplier}),-1);
    assert.equal(lampVisualIndex("rolling",{multiplier},2),2);
    assert.equal(lampVisualIndex("revealed",{multiplier}),targetIndex);
  }
  assert.throws(()=>buildLampSequence(3));
  assert.throws(()=>buildLampSequence(2,0));
});

test("inserted marbles animate and running lamps cannot leak the stored multiplier", async()=>{
  const {readFileSync}=await import("node:fs");
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  const game=readFileSync(new URL("../public/game.js",import.meta.url),"utf8");
  const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
  const mobile=readFileSync(new URL("../public/mobile.css",import.meta.url),"utf8");
  const values=[...html.matchAll(/data-mult-lamp="(\d+)"/g)].map(match=>Number(match[1]));
  assert.deepEqual(values,MULTIPLIERS);
  assert.ok(html.indexOf('id="machineLamps"')<html.indexOf('id="board"'));
  assert.match(html,/id="coinFxLayer"/);
  assert.match(html,/id="marbleHopper"/);
  assert.match(html,/id="lampStatus"/);
  assert.match(game,/revealState=round\?"revealed":"hidden"/);
  assert.match(game,/lampRoll\.steps\[lampRoll\.step\]/);
  assert.match(game,/startMultiplierRoll\(\)/);
  assert.match(game,/updateMultiplierRoll\(now\)/);
  assert.match(game,/if\(!wasRevealed&&round\)startMultiplierRoll\(\)/);
  assert.match(game,/if\(phase!=="ready"\|\|charging\|\|revealState==="rolling"\)return/);
  assert.match(game,/revealState!=="revealed"\|\|!canLaunch\(save\)/);
  assert.match(game,/revealState==="revealed"&&round&&round\.lit\.includes\(i\)/);
  assert.match(game,/playMarbleInsertFx\(amount,event\.currentTarget\)/);
  assert.match(game,/marble\.addEventListener\("animationend",\(\)=>marble\.remove\(\),\{once:true\}\)/);
  assert.match(css,/@keyframes coinFlight/);
  assert.match(css,/@keyframes lampFinalPulse/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(mobile,/\.machine-lamps\{/);
});

test("refunding, resetting and next round cancel the old rolling lamp selection",async()=>{
  const {readFileSync}=await import("node:fs");
  const game=readFileSync(new URL("../public/game.js",import.meta.url),"utf8");
  const occurrences=(game.match(/lampRoll=\{steps:\[\],step:-1,nextAt:0\}/g)||[]).length;
  assert.ok(occurrences>=3,"new round, refund and reset must clear the animation");
  assert.match(game,/revealState==="rolling"\?"● 抽取中"/);
  assert.match(game,/const visibleMultiplier=displayedMultiplier\(revealState,round\)/);
});


test("higher payout always has fewer independently selected winning slots",()=>{
  assert.deepEqual(WIN_SLOTS_BY_MULTIPLIER, {2:4,4:3,6:2,8:1,10:1});
  assert.equal(SLOT_COUNT,11);
  for(let i=1;i<MULTIPLIERS.length;i++){
    assert.ok(winningSlotCount(MULTIPLIERS[i])<=winningSlotCount(MULTIPLIERS[i-1]));
    if(MULTIPLIERS[i]<10)assert.ok(winningSlotCount(MULTIPLIERS[i])<winningSlotCount(MULTIPLIERS[i-1]));
  }
  assert.throws(()=>winningSlotCount(12));
  for(const multiplier of MULTIPLIERS){
    let sample=.081;
    const rng=()=>{sample=(sample+.221)%1;return sample;};
    for(let i=0;i<20;i++){
      // Arrange the first RNG draw to pick exactly the intended multiplier.
      let first=true;
      const round=createRound(()=>first?(first=false,(MULTIPLIERS.indexOf(multiplier)+.5)/5):rng());
      assert.equal(round.multiplier,multiplier);
      assert.equal(round.lit.length,winningSlotCount(multiplier));
      assert.equal(new Set(round.lit).size,round.lit.length);
      for(const index of round.lit)assert.ok(index>=0&&index<11);
      assert.equal(settle(freshSave(),round,10,round.lit[0]).reward,10*multiplier);
      const miss=Array.from({length:11},(_,x)=>x).find(slot=>!round.lit.includes(slot));
      assert.equal(settle(freshSave(),round,10,miss).reward,0);
    }
  }
});

test("round validator and pending wagers reject mismatched winning slot count",async()=>{
  const {isValidRound}=await import("../public/rules.mjs");
  for(const multiplier of MULTIPLIERS){
    const target=winningSlotCount(multiplier);
    const round={multiplier,lit:Array.from({length:target},(_,n)=>n)};
    assert.equal(isValidRound(round),true);
    if(target!==3)assert.equal(isValidRound({multiplier,lit:[2,4,7]}),false);
    assert.equal(isValidRound({...round,lit:[0,0,...round.lit.slice(2)]}),false);
  }
  assert.equal(isValidRound({multiplier:12,lit:[1]}),false);
});

test("older three-red-slot pending wagers migrate without rerolling multiplier or losing marbles",()=>{
  for(const multiplier of [2,4,6,8,10]){
    const old={...freshSave(),marbles:72,pendingStake:28,
      pendingRound:{multiplier,lit:[1,4,7]}};
    const restored=restoreSave(old);
    assert.equal(restored.pendingStake,28);
    assert.equal(restored.marbles,72);
    assert.equal(restored.pendingRound.multiplier,multiplier);
    assert.equal(restored.pendingRound.lit.length,winningSlotCount(multiplier));
    assert.equal(new Set(restored.pendingRound.lit).size,restored.pendingRound.lit.length);
    assert.equal(canLaunch(restored),true);
  }
});

test("UI previews match the real winning slots instead of fixed 3 red slots",async()=>{
  const {readFileSync}=await import("node:fs");
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  const game=readFileSync(new URL("../public/game.js",import.meta.url),"utf8");
  const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
  const mobile=readFileSync(new URL("../public/mobile.css",import.meta.url),"utf8");
  for(const [multiplier,count] of [[2,4],[4,3],[6,2],[8,1],[10,1]]){
    assert.match(html,new RegExp('data-mult-lamp="'+multiplier+'"'));
    assert.ok(html.includes('<small>'+count+' 槽</small>'));
  }
  assert.doesNotMatch(html,/id="winSlotCount"|id="mobileWinSlots"|id="slotPreview"/);
  assert.doesNotMatch(game,/visibleRound\.lit\.includes\(index\)/);
  assert.match(game,/round\.lit\.length\+"\/11"/);
  assert.match(game,/revealState==="revealed"&&round&&round\.lit\.includes\(i\)/);
  assert.match(html,/data-mult-lamp="10"/);
  assert.match(css,/\.mult-lamp\.is-final/);
  assert.match(css,/\.mult-lamp b/);
  assert.match(mobile,/\.mobile-odds/);
});


test("bumpers replace exactly three peg grid cells instead of floating among pins",async()=>{
  const {createPegLayout,pegPosition,PEG_GRID,BUMPER_CELLS}=
    await import("../public/board-layout.mjs");
  const {pegs,bumpers}=createPegLayout(368);
  assert.equal(PEG_GRID.rows,10);
  assert.equal(PEG_GRID.columns,8);
  assert.deepEqual(BUMPER_CELLS.map(p=>[p.row,p.col]),[[3,2],[5,5],[7,3]]);
  assert.equal(pegs.length+bumpers.length,80);
  assert.equal(bumpers.length,3);
  assert.equal(pegs.length,77);
  const keyed=new Set();
  for(const p of [...pegs,...bumpers]){
    assert.deepEqual({x:p.x,y:p.y},pegPosition(p.row,p.col));
    const key=p.row+","+p.col;
    assert.ok(!keyed.has(key),"No grid cell can contain both a metal peg and a bumper");
    keyed.add(key);
  }
  for(const bumper of bumpers){
    assert.ok(bumper.r>PEG_GRID.pegRadius);
    for(const peg of pegs){
      assert.ok(Math.hypot(bumper.x-peg.x,bumper.y-peg.y)>bumper.r+peg.r,
        "Large bumper must not overlap any of the remaining metal pegs");
    }
  }
  assert.throws(()=>pegPosition(-1,3));
  assert.throws(()=>pegPosition(1,8));
});

test("drawing and collisions use the identical computed grid, without old detached bumpers",async()=>{
  const {readFileSync}=await import("node:fs");
  const game=readFileSync(new URL("../public/game.js",import.meta.url),"utf8");
  const source=readFileSync(new URL("../public/board-layout.mjs",import.meta.url),"utf8");
  assert.match(game,/const \{pegs,bumpers\}=createPegLayout\(RIGHT\)/);
  assert.match(game,/for\(const p of pegs\)bump\(p\.x,p\.y,p\.r\)/);
  assert.match(game,/for\(const p of bumpers\)if\(bump\(p\.x,p\.y,p\.r,\.92\)/);
  assert.match(game,/for\(const peg of pegs\)/);
  assert.match(game,/for\(const b of bumpers\)/);
  assert.doesNotMatch(game,/x:60,y:348|x:324,y:388|x:203,y:452/);
  assert.match(source,/selected\.has\(row\+"\,"\+col\)/);
});


test("fullscreen layout removes redundant panels, slogan and page footer without losing game controls",async()=>{
  const {readFileSync}=await import("node:fs");
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  const js=readFileSync(new URL("../public/game.js",import.meta.url),"utf8");
  const css=readFileSync(new URL("../public/fullscreen.css",import.meta.url),"utf8");
  assert.match(html,/\/games\/pinball\/fullscreen\.css/);
  assert.match(html,/class="game-version"[^>]*>v0\.7\.0/);
  for(const text of [
    "星运<span>弹珠局","蓄力发射，穿越钉阵，让一颗钢珠决定今天的好运",
    "纯虚拟游戏 · 无现金兑换 · 存档仅在本机",
    "02 / THIS ROUND","命中红灯可得","高倍率 · 少入口 · 高挑战",
    "单局最高奖励","累计赢取","HOW TO PLAY",'id="roundLight"',
  ]) assert.ok(!html.includes(text),"Removed obsolete page content: "+text);
  for(const id of ["balance","stakeAmount","mobileStake","giftBtn","cards",
    "mobileBalance","mobileBetHint","betHint","launchStatus","powerFill",
    "powerPct","board","plungerGrip","helpBtn","soundBtn","shopDialog","infoDialog"]){
    assert.ok(html.includes('id="'+id+'"'),"Essential controls remain: "+id);
  }
  assert.equal((html.match(/data-add=/g)||[]).length,6);
  assert.equal((html.match(/data-refund/g)||[]).length,2);
  assert.match(css,/height:100dvh/);
  assert.match(css,/overflow:hidden!important/);
  assert.match(css,/grid-template-rows:minmax\(0,1fr\)/);
  assert.match(css,/env\(safe-area-inset-bottom\)/);
  assert.match(js,/function fitMachine\(\)/);
  assert.match(js,/cabinet\.getBoundingClientRect\(\)\.height>usableHeight/);
  assert.match(js,/machineSection\.style\.setProperty\("--fitted-cabinet-width"/);
  assert.match(js,/window\.visualViewport\?\.addEventListener\("resize",scheduleMachineFit\)/);
  assert.doesNotMatch(js,/el\.multiplier|el\.payout|el\.rounds|el\.wins|el\.best|el\.earned|el\.themeName/);
});
