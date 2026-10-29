import { MIN_STAKE, MAX_STAKE, SLOT_COUNT, GIFTS, STORAGE_KEY,
  freshSave, restoreSave, depositMarbles, refundDeposit, canLaunch,
  commitShot, settleFunded, redeem, selectTheme
} from "./rules.mjs?v=0.10.6";
import {PLUNGER, boardPoint, isPlungerHit, pullStrength, canFire, firingVelocity} from "./plunger.mjs?v=0.10.6";
import {randomLaunch, varyLaunchVelocity} from "./physics-variation.mjs?v=0.10.6";
import {buildLampSequence, lampStepDelay, displayedMultiplier, lampVisualIndex} from "./roulette.mjs?v=0.10.6";
import {createPegLayout} from "./board-layout.mjs?v=0.10.6";
import {PHYSICS,RAIL_POINTS,createPhysicalBall,stepPhysicalBall} from "./physics-engine.mjs?v=0.10.6";
import {FEEDBACK,metalImpactProfile,jackpotTier,slotPulseStrength,trailOpacity} from "./arcade-feedback.mjs?v=0.10.6";
import {payoutPlan,payoutAct,payoutProgress} from "./payout-ceremony.mjs?v=0.10.6";
import {createPayoutWorld,stepPayoutWorld,finishPayoutWorld,reflowPayoutWorld} from "./payout-physics.mjs?v=0.10.6";

const W=420,H=710,LEFT=25,RIGHT=368,LANE=393,TOP=126;
const SLOT_LEFT=28,SLOT_RIGHT=365,SLOT_TOP=619,SLOT_BOTTOM=681;
const SLOT_W=(SLOT_RIGHT-SLOT_LEFT)/SLOT_COUNT;
const R=PHYSICS.radius,STEP=1/180;
const $=id=>document.getElementById(id);
// Some desktop Chromium/Edge GPU drivers can leave 2D Canvas surfaces black
// even while JavaScript and the UI remain healthy. Prefer a CPU-backed 2D
// surface for mouse/keyboard desktops; touch devices retain the normal path.
const desktopPointer=window.matchMedia?.("(hover: hover) and (pointer: fine)").matches??false;
const canvas=$("board"),ctx=canvas.getContext("2d",{
  alpha:false,
  willReadFrequently:desktopPointer,
});
if(!ctx)throw new Error("无法创建弹珠台 Canvas 2D 画布");
const plungerGrip=$("plungerGrip");
const multiplierLamps=[...document.querySelectorAll("[data-mult-lamp]")];
const coinFxLayer=$("coinFxLayer"), marbleHopper=$("marbleHopper");
const reduceMotion=window.matchMedia?.("(prefers-reduced-motion: reduce)").matches??false;
const el={balance:$("balance"),cards:$("cards"),status:$("launchStatus"),
  power:$("powerPct"),bar:$("powerFill"),
  resultPanel:$("inlineResult"),resultTitle:$("resultTitle"),
  resultStamp:$("resultStamp"),resultNumber:$("resultNumber"),
  resultDetail:$("resultDetail"),cardEarned:$("cardEarned"),
  next:$("nextBtn"),message:$("floatMessage"),shop:$("shopDialog"),
  payoutStage:$("payoutStage"),payoutActLabel:$("payoutActLabel"),
  payoutCounter:$("payoutCounter"),payoutEarnings:$("payoutEarnings"),
  payoutSkip:$("payoutSkip"),
  payoutBasin:$("payoutBasin"),payoutCoins:$("payoutCoins"),
  payoutReceiver:$("payoutReceiver"),
  payoutInventory:$("payoutInventory"),
  ticketDispenser:$("ticketDispenser"),
  payoutTickets:$("payoutTickets"),payoutCardCount:$("payoutCardCount"),
  giftList:$("giftList"),shopCards:$("shopCards"),info:$("infoDialog")};
const palette={
  classic:{gold:"#ffd083",red:"#ff586d",sky:"#81ddec",floor:"#17223e"},
  sunset:{gold:"#ffd18a",red:"#ff7a69",sky:"#f2ba7b",floor:"#412238"},
  mint:{gold:"#b9ffe0",red:"#ff6580",sky:"#77fbd0",floor:"#12333d"},
  violet:{gold:"#edbcff",red:"#ff8fbf",sky:"#b6a1ff",floor:"#2e2046"}
};
// Bumpers replace original peg cells in the SAME authoritative layout.
const {pegs,bumpers}=createPegLayout(RIGHT);
let save;
try{save=restoreSave(JSON.parse(localStorage.getItem(STORAGE_KEY)||"null"));}
catch{save=freshSave();}
let round=save.pendingRound,stake=save.pendingStake,phase="ready";
let revealState=round?"revealed":"hidden";
let lampRoll={steps:[],step:-1,nextAt:0};
let ball=null,trail=[],lastTime=0,accumulator=0,elapsed=0;
let charging=false,charge=0,chargeStarted=0,chargeMode=null,dragPointerId=null,dragStartY=0;
let shotStake=0,priorSave=null,settled=false,shotVelocity=null;
let soundEnabled=false,audioContext=null,floatingUntil=0,particles=[],screenShake=0;
let collisionNoise=null,lastImpactSoundAt=-Infinity,impactFlashes=[],slotPulse=null;
let payoutFx=null; // The real reward is committed before the ceremony begins.
let payoutDisplayState=null; // Stable fallen-marble coordinates across the full payout sequence.
function persist(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(save));}catch{}}
function beep(f=520,d=.08,type="sine",volume=.05,delay=0){
  if(!soundEnabled)return;
  try{
    if(!audioContext)audioContext=new(window.AudioContext||window.webkitAudioContext)();
    if(audioContext.state==="suspended")audioContext.resume();
    const o=audioContext.createOscillator(),gain=audioContext.createGain();
    const start=audioContext.currentTime+delay;
    o.type=type;o.frequency.setValueAtTime(f,start);
    o.frequency.exponentialRampToValueAtTime(Math.max(60,f*.65),start+d);
    gain.gain.setValueAtTime(Math.max(.0001,volume),start);
    gain.gain.exponentialRampToValueAtTime(.0001,start+d);
    o.connect(gain).connect(audioContext.destination);o.start(start);o.stop(start+d);
  }catch{}
}
/** Two slightly inharmonic partials plus brief filtered noise create a steel strike.
 * All pitch randomness is cosmetic; it never shares the physics RNG. */
function metallicHit(impact){
  if(!soundEnabled)return;
  const profile=metalImpactProfile(impact.speed,impact.bumper,Math.random());
  if(!profile)return;
  const now=performance.now();
  if(now-lastImpactSoundAt<FEEDBACK.impactCooldownMs)return;
  lastImpactSoundAt=now;
  try{
    if(!audioContext)audioContext=new(window.AudioContext||window.webkitAudioContext)();
    if(audioContext.state==="suspended")void audioContext.resume();
    const ac=audioContext,start=ac.currentTime;
    const envelope=ac.createGain();
    envelope.gain.setValueAtTime(profile.gain,start);
    envelope.gain.exponentialRampToValueAtTime(.0001,start+profile.duration);
    envelope.connect(ac.destination);
    for(const [ratio,type] of [[1,"sine"],[2.73,"triangle"]]){
      const oscillator=ac.createOscillator();
      oscillator.type=type;
      oscillator.frequency.setValueAtTime(profile.frequency*ratio,start);
      oscillator.frequency.exponentialRampToValueAtTime(profile.frequency*ratio*.88,start+profile.duration);
      oscillator.connect(envelope);
      oscillator.start(start);oscillator.stop(start+profile.duration+.002);
    }
    // Small reusable noise buffer gives a realistic click without fetching audio.
    if(!collisionNoise){
      collisionNoise=ac.createBuffer(1,Math.floor(ac.sampleRate*.05),ac.sampleRate);
      const data=collisionNoise.getChannelData(0);
      let seed=0x2f7a3bc1;
      for(let i=0;i<data.length;i++){
        seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;
        data[i]=((seed>>>0)/2147483648-1)*(1-i/data.length);
      }
    }
    const src=ac.createBufferSource(),filter=ac.createBiquadFilter(),noiseGain=ac.createGain();
    src.buffer=collisionNoise;
    filter.type="bandpass";filter.frequency.value=1800+profile.frequency*1.6;
    filter.Q.value=.9;
    noiseGain.gain.value=profile.bumper?.24:.42;
    src.connect(filter).connect(noiseGain).connect(envelope);
    src.start(start);src.stop(start+Math.min(.049,profile.duration));
  }catch{/* Audio is optional; never stop physics rendering. */}
}
function impactVisuals(impacts){
  if(impacts.length===0)return;
  const hit=impacts.reduce((a,b)=>a.speed>b.speed?a:b);
  if(hit.speed>=FEEDBACK.minAudibleImpact)metallicHit(hit);
  if(reduceMotion)return;
  if(hit.speed>90)screenShake=Math.max(screenShake,Math.min(2.0,hit.speed/320));
  for(const impact of impacts){
    if(impact.speed<65)continue;
    if(impactFlashes.length<FEEDBACK.maxImpactFlashes)
      impactFlashes.push({x:impact.x,y:impact.y,life:impact.bumper?.34:.20,
        total:impact.bumper?.34:.20,force:Math.min(1,impact.speed/950),bumper:impact.bumper});
    if(impact.bumper&&impact.speed>70)
      burst(impact.x,impact.y,palette[save.theme].sky,Math.min(8,3+Math.floor(impact.speed/190)));
  }
}
function notify(msg,d=1400){
  floatingUntil=performance.now()+d;
  el.message.textContent=msg;el.message.classList.add("visible");
}
function paintMultiplierLamps(){
  const litIndex=lampVisualIndex(revealState,round,lampRoll.steps[lampRoll.step]??-1);
  multiplierLamps.forEach((lamp,index)=>{
    lamp.classList.toggle("is-rolling",revealState==="rolling"&&index===litIndex);
    lamp.classList.toggle("is-final",revealState==="revealed"&&index===litIndex);
  });
  $("lampStatus").textContent=revealState==="rolling"?"倍率抽取中…":
    revealState==="revealed"?"倍率已锁定 · "+round.lit.length+" 个中奖槽":"投满5颗开启倍率灯";
}
function finishMultiplierRoll(){
  if(revealState!=="rolling"||!round)return;
  revealState="revealed";
  lampRoll={steps:[],step:-1,nextAt:0};
  refresh();
  notify("本局 ×"+round.multiplier+" 倍 · "+round.lit.length+" 个红灯槽",1900);
  beep(920,.22,"triangle",.06);
}
function startMultiplierRoll(){
  if(!round||revealState!=="hidden")return;
  if(reduceMotion){
    revealState="rolling";
    finishMultiplierRoll();
    return;
  }
  revealState="rolling";
  lampRoll={
    steps:buildLampSequence(round.multiplier),
    step:-1,
    nextAt:performance.now()+530, // wait until inserted marbles reach the hopper
  };
  refresh();
  notify("投珠完成 · 倍率抽取中…",1450);
}
function updateMultiplierRoll(now){
  if(revealState!=="rolling")return;
  while(lampRoll.step+1<lampRoll.steps.length && now>=lampRoll.nextAt){
    lampRoll.step++;
    const index=lampRoll.steps[lampRoll.step];
    const stepCount=lampRoll.steps.length;
    lampRoll.nextAt+=lampStepDelay(lampRoll.step,stepCount);
    paintMultiplierLamps();
    if(soundEnabled&&(lampRoll.step%2===0||lampRoll.step>=stepCount-5)){
      beep(375+index*75,.035,"triangle",.023);
    }
  }
  if(lampRoll.step===lampRoll.steps.length-1 && now>=lampRoll.nextAt){
    finishMultiplierRoll();
  }
}
function animateStakeCounter(){
  for(const node of [$("stakeAmount"),$("mobileStake")]){
    node.classList.remove("is-inserting");
    void node.offsetWidth;
    node.classList.add("is-inserting");
  }
}
function playMarbleInsertFx(amount,button){
  animateStakeCounter();
  if(reduceMotion)return;
  marbleHopper.classList.remove("is-feeding");
  void marbleHopper.offsetWidth;
  marbleHopper.classList.add("is-feeding");
  marbleHopper.addEventListener("animationend",event=>{
    if(event.target===marbleHopper)marbleHopper.classList.remove("is-feeding");
  },{once:true});
  const layer=coinFxLayer.getBoundingClientRect();
  const source=button.getBoundingClientRect(),target=marbleHopper.getBoundingClientRect();
  if(!layer.width||!source.width||!target.width)return;
  const startX=source.left+source.width/2-layer.left;
  const startY=source.top+source.height/2-layer.top;
  const targetX=target.left+target.width/2-layer.left;
  const targetY=target.top+target.height/2-layer.top;
  // Representative flying marbles, not one DOM element for every staked marble.
  const count=amount>=10?5:amount>=5?3:1;
  for(let index=0;index<count;index++){
    const marble=document.createElement("span");
    marble.className="coin-fx";
    const dx=targetX-startX+(index-(count-1)/2)*6;
    const dy=targetY-startY+(index%2?4:-4);
    marble.style.left=(startX-6)+"px";
    marble.style.top=(startY-6)+"px";
    marble.style.setProperty("--dx",dx+"px");
    marble.style.setProperty("--dy",dy+"px");
    marble.style.setProperty("--mx",(dx*.54)+"px");
    marble.style.setProperty("--my",(dy*.54)+"px");
    marble.style.animationDelay=index*55+"ms";
    marble.addEventListener("animationend",()=>marble.remove(),{once:true});
    coinFxLayer.append(marble);
  }
}
function displayAwardTotals(){
  const visibleMarbles=payoutFx?save.marbles-payoutFx.plan.reward+payoutFx.shownMarbles:save.marbles;
  const visibleCards=payoutFx?save.cards-payoutFx.plan.newCards+payoutFx.shownCards:save.cards;
  el.balance.textContent=visibleMarbles.toLocaleString("zh-CN");
  $("mobileBalance").textContent=visibleMarbles.toLocaleString("zh-CN");
  el.cards.textContent=visibleCards;
  return {visibleMarbles,visibleCards};
}
function refresh(){
  displayAwardTotals();
  const visibleMultiplier=displayedMultiplier(revealState,round);
  const litCount=revealState==="revealed"&&round?round.lit.length:0;
  $("mobileStake").textContent=stake.toLocaleString("zh-CN");
  $("stakeAmount").textContent=stake.toLocaleString("zh-CN");
  el.shopCards.textContent=save.cards;
  document.body.dataset.theme=save.theme;
  document.querySelectorAll("[data-add]").forEach(btn=>{
    const n=Number(btn.dataset.add);
    btn.disabled=phase!=="ready"||revealState==="rolling"||charging||save.marbles<n||stake+n>MAX_STAKE;
  });
  document.querySelectorAll("[data-refund]").forEach(btn=>{
    btn.disabled=phase!=="ready"||stake===0||charging||revealState==="rolling";
  });
  const remaining=Math.max(0,MIN_STAKE-stake);
  const hint=revealState==="rolling"?"倍率灯跑动中，请看机台顶部…":
    remaining>0?("还差 "+remaining+" 颗开启倍率灯"):
    revealState==="hidden"?"即将开启顶部倍率灯…":
    ("×"+visibleMultiplier+" 倍 · "+litCount+" 个中奖槽，可继续投珠");
  $("betHint").textContent=hint+(remaining>0&&save.marbles<remaining?" · 余额不足可退回投入":"");
  $("mobileBetHint").textContent=hint;
  el.status.textContent=phase==="ready"
    ? (revealState==="rolling"?"倍率灯抽取中，暂不可发射":
       remaining>0?"先投入至少 5 颗":"等待拉杆发射")
    :phase==="shooting"?"弹珠运行中":phase==="payout"?"机器正在兑奖":"本局已结束";
  paintMultiplierLamps();
}
function updatePower(){
  el.bar.style.width=Math.round(charge*100)+"%";
  el.power.textContent=Math.round(charge*100)+"%";
}
function beginCharge(mode, startY=0, pointerId=null){
  if(phase!=="ready"||revealState!=="revealed"||!canLaunch(save)||charging)return false;
  charging=true;charge=0;chargeMode=mode;chargeStarted=performance.now();
  dragStartY=startY;dragPointerId=pointerId;
  updatePower();el.status.textContent=mode==="pointer"?"正在下拉拉杆":"空格蓄力中";
  beep(270,.05,"triangle",.02);
  return true;
}
function cancelCharge(){
  charging=false;charge=0;chargeMode=null;dragPointerId=null;
  updatePower();refresh();
}
function releaseCharge(){
  if(!charging)return;
  // Drag power depends ONLY on pulling distance, not on hold duration.
  const power=chargeMode==="keyboard"
    ?Math.min(1,(performance.now()-chargeStarted)/1550)
    :charge;
  charging=false;chargeMode=null;dragPointerId=null;
  if(!canFire(power)||phase!=="ready"||revealState!=="revealed"||!canLaunch(save)){
    cancelCharge();return;
  }
  charge=power;updatePower();
  // Same pull force is not a guaranteed repeat: small independent variations
  // imitate spring friction and launch alignment, without deciding the outcome.
  const launchVariation=randomLaunch();
  shotVelocity=varyLaunchVelocity(firingVelocity(power),launchVariation);
  // The rail continuously carries the ball to its release tangent.
  // 'entryVx/entryVy' from the earlier game are no longer imposed as a teleport.
  const physicalBall=createPhysicalBall(shotVelocity,launchVariation);
  shotStake=stake;
  // Deposit was already charged when marbles were inserted. Commit only
  // clears the pending stake so a reload cannot replay a fired shot.
  save=commitShot(save);
  priorSave={...save,redeemed:[...save.redeemed]};persist();
  phase="shooting";settled=false;elapsed=0;trail=[];particles=[];impactFlashes=[];slotPulse=null;lastImpactSoundAt=-Infinity;
  ball=physicalBall;
  beep(370+power*210,.23,"sawtooth",.045);notify("GOOD LUCK! ✦",850);refresh();
}
function burst(x,y,color,n=8){
  if(reduceMotion)return;
  for(let k=0;k<Math.min(n,FEEDBACK.maxParticles-particles.length);k++){
    const a=Math.random()*Math.PI*2,s=40+Math.random()*180;
    particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,
      life:.35+Math.random()*.35,color});
  }
}
function advance(dt){
  if(phase==="shooting"&&ball){
    elapsed+=dt;
    const state=stepPhysicalBall(ball,dt,{pegs,bumpers});
    if(state.entered)burst(ball.x,ball.y,palette[save.theme].gold,6);
    if(state.impacts.length)impactVisuals(state.impacts);
    if(!reduceMotion){
      trail.push({x:ball.x,y:ball.y,speed:Math.hypot(ball.vx,ball.vy)});
      if(trail.length>FEEDBACK.maxTrailPoints)trail.shift();
    }
    if(state.settled){beep(450,.10,"triangle",.045);finishShot(state.slot);}
  }
  impactFlashes=impactFlashes.filter(p=>p.life>0);
  for(const flash of impactFlashes)flash.life-=dt;
  if(slotPulse)slotPulse.life=Math.max(0,slotPulse.life-dt);
  particles=particles.filter(p=>p.life>0);
  for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=200*dt;p.life-=dt;}
  screenShake=Math.max(0,screenShake-10*dt);
}
/** Live payout simulation: every visible marble has real position/velocity.
 * No interpolation to a preselected outcome; the solver alone places beads.
 * "instant" fast-forwards those same collisions when animations are skipped.
 */
function paintBasinMarbles(count,total,instant=false){
  // Render into the full payout receiver, not a canvas clipped by the basin.
  // A fixed-size bead can rise over the glass rim or spill sideways.
  const canvas=el.payoutInventory,receiver=el.payoutReceiver.getBoundingClientRect(),
    basin=el.payoutBasin.getBoundingClientRect();
  const w=receiver.width,h=receiver.height;
  if(w<12||h<8)return;
  const tray={left:basin.left-receiver.left,right:basin.right-receiver.left,
    top:basin.top-receiver.top,bottom:basin.bottom-receiver.top};
  const now=performance.now();
  if(!payoutDisplayState||payoutDisplayState.total!==total){
    payoutDisplayState={count:0,total,world:createPayoutWorld(w,h,total,tray),
      lastAt:now,lastDraw:0,settleUntil:0};
  }
  const display=payoutDisplayState,world=display.world;
  if(Math.abs(world.width-w)>.5||Math.abs(world.height-h)>.5||
     Math.abs(world.tray.top-tray.top)>.5||Math.abs(world.tray.left-tray.left)>.5)
    reflowPayoutWorld(world,w,h,tray);
  display.count=Math.min(total,Math.max(0,Math.floor(count)));
  const visible=world.visible;
  const target=Math.min(visible,Math.floor(display.count*visible/total));
  const delta=Math.min(.05,Math.max(0,(now-display.lastAt)/1000));
  display.lastAt=now;
  if(instant){
    // Completes the same genuine collision simulation offscreen.
    if(world.balls.length<visible)finishPayoutWorld(world,240);
    display.settleUntil=now+2200;
  }else{
    stepPayoutWorld(world,delta,target);
  }
  const dpr=Math.min(2,window.devicePixelRatio||1);
  const pxW=Math.round(w*dpr),pxH=Math.round(h*dpr);
  if(canvas.width!==pxW||canvas.height!==pxH){canvas.width=pxW;canvas.height=pxH;}
  const ctx=canvas.getContext("2d");
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const r=world.radius;
  for(const ball of world.balls){
    ctx.fillStyle="#bdd6e4";
    if(r<1.1){
      ctx.fillRect(ball.x-r,ball.y-r,Math.max(1,r*1.8),Math.max(1,r*1.8));
    }else{
      ctx.beginPath();ctx.arc(ball.x,ball.y,r,0,Math.PI*2);ctx.fill();
      if(r>1.8){
        ctx.fillStyle="#f4faff";
        ctx.beginPath();ctx.arc(ball.x-r*.35,ball.y-r*.36,r*.28,0,Math.PI*2);ctx.fill();
      }
    }
  }
}
function clearDispensers(){
  el.payoutCoins.replaceChildren();clearPrintedTickets();
  payoutDisplayState=null;
  const canvas=el.payoutInventory;
  canvas.getContext("2d").clearRect(0,0,canvas.width,canvas.height);
  el.payoutStage.dataset.act="idle";el.payoutStage.classList.remove("is-big-win");
  for(const card of coinFxLayer.querySelectorAll(".reward-flight-card"))card.remove();
}
/** The chute is empty when the physical cards finish ejecting or results appear. */
function clearPrintedTickets(){
  el.payoutTickets.replaceChildren();
  el.ticketDispenser.classList.remove("is-printing");
  el.payoutCardCount.hidden=true;
}
function printRewardTickets(fx){
  if(!fx.plan.newCards)return;
  el.ticketDispenser.classList.add("is-printing");
  el.payoutCardCount.hidden=false;
  el.payoutCardCount.textContent="卡 ×"+fx.plan.newCards;
  const tickets=document.createDocumentFragment();
  for(let i=0;i<fx.plan.cardSprites;i++){
    const card=document.createElement("span");
    card.className="dispensed-ticket";
    card.textContent="★";
    card.style.setProperty("--ticket-delay",i*145+"ms");
    card.style.setProperty("--ticket-x",(i-(fx.plan.cardSprites-1)/2)*14+"px");
    card.addEventListener("animationend",event=>{
      if(event.animationName!=="ticketOut")return;
      card.remove();
      if(!el.payoutTickets.childElementCount)clearPrintedTickets();
    },{once:true});
    tickets.append(card);
  }
  el.payoutTickets.replaceChildren(tickets);
}
/** The card flight begins at the upper-left ticket dispenser, not the bottom tray. */
function flyRewardCards(amount){
  if(reduceMotion||amount<=0)return;
  const base=coinFxLayer.getBoundingClientRect();
  const source=el.ticketDispenser.getBoundingClientRect();
  const destination=$("giftBtn").getBoundingClientRect();
  if(!base.width||!source.width||!destination.width)return;
  const startX=source.left+source.width*.5-base.left;
  const startY=source.top+source.height*.6-base.top;
  const destX=destination.left+destination.width*.5-base.left;
  const destY=destination.top+destination.height*.5-base.top;
  for(let i=0;i<Math.min(amount,3);i++){
    const sprite=document.createElement("span");
    sprite.className="reward-flight-card";
    sprite.textContent="★";
    sprite.style.left=(startX-9)+"px";
    sprite.style.top=(startY-12)+"px";
    sprite.style.setProperty("--dx",(destX-startX)+"px");
    sprite.style.setProperty("--dy",(destY-startY)+"px");
    sprite.style.setProperty("--fly-delay",i*85+"ms");
    sprite.addEventListener("animationend",()=>sprite.remove(),{once:true});
    coinFxLayer.append(sprite);
  }
}
function startPayoutCeremony(result,slot){
  if(!result.hit){showFinalResult();return;}
  const plan=payoutPlan({hit:result.hit,reward:result.reward,
    newCards:result.newCards,slot,multiplier:round.multiplier});
  if(reduceMotion){
    // Accessibility: skip the animation, never skip the earned marbles or cards.
    paintBasinMarbles(plan.reward,plan.reward,true);
    showFinalResult();
    return;
  }
  const now=performance.now();
  payoutFx={plan,startedAt:now,act:"impact",shownMarbles:0,
    shownCards:0,lastCoinSoundAt:-Infinity,flewTickets:false};
  paintBasinMarbles(0,plan.reward);
  el.resultPanel.hidden=true;
  el.next.hidden=true;
  el.payoutEarnings.hidden=false;
  el.payoutSkip.hidden=false;
  el.payoutCounter.textContent="0";
  el.payoutActLabel.hidden=false;
  el.payoutActLabel.textContent="命中第 "+(slot+1)+" 槽 · "+round.multiplier+"×";
  el.payoutStage.dataset.act="impact";
  phase="payout";
  refresh();
}
function showFinalResult(){
  if(payoutFx){
    const fx=payoutFx;
    // Keep the same physical world; never replace the settling beads by a grid.
    paintBasinMarbles(fx.plan.reward,fx.plan.reward,true);
  }
  // Do not leave printed tickets hanging over the playfield after payout.
  // Skipping the ceremony also clears the chute without changing saved cards.
  clearPrintedTickets();
  payoutFx=null;
  if(payoutDisplayState)payoutDisplayState.settleUntil=performance.now()+2600;
  phase="result";
  el.payoutStage.dataset.act="result";
  el.payoutEarnings.hidden=true;
  el.payoutActLabel.hidden=true;
  el.payoutSkip.hidden=true;
  el.resultPanel.hidden=false;
  el.next.hidden=false;
  refresh();
}
function updatePayoutCeremony(now){
  if(!payoutFx)return;
  const fx=payoutFx,ms=Math.max(0,now-fx.startedAt);
  const act=payoutAct(fx.plan,ms);
  if(act==="done"){showFinalResult();return;}
  if(act!==fx.act){
    fx.act=act;
    el.payoutStage.dataset.act=act;
    if(act==="marbles"){
      el.payoutActLabel.textContent="出珠中 · 共 "+fx.plan.reward+" 颗";
      beep(300,.08,"triangle",.032);
    }else if(act==="tickets"){
      el.payoutActLabel.textContent="奖励卡出票 · "+fx.plan.newCards+" 张";
      printRewardTickets(fx);
      beep(900,.12,"triangle",.042);
      beep(1120,.13,"sine",.04,.12);
    }
  }
  if(act==="tickets"&&ms>=fx.plan.marblesEnd+320&&!fx.flewTickets){
    fx.flewTickets=true;
    flyRewardCards(fx.plan.newCards);
  }
  const amounts=payoutProgress(fx.plan,ms);
  if(amounts.marbles!==fx.shownMarbles||amounts.cards!==fx.shownCards){
    fx.shownMarbles=amounts.marbles;
    fx.shownCards=amounts.cards;
    el.payoutCounter.textContent=amounts.marbles.toLocaleString("zh-CN");
    // Physics uses this number to spawn individual physical marbles.
    displayAwardTotals();
  }
  if(act==="marbles"&&soundEnabled&&now-fx.lastCoinSoundAt>170){
    fx.lastCoinSoundAt=now;
    beep(480+Math.random()*130,.046,"triangle",.019);
  }
}
function finishShot(slot){
  if(settled||!priorSave)return;
  settled=true;
  const result=settleFunded(priorSave,round,shotStake,slot);
  save=result.save;persist();
  const tier=jackpotTier(result.hit,round.multiplier);
  el.payoutStage.classList.toggle("is-big-win",Boolean(tier));
  const jackpotBanner=$("jackpotBanner");
  jackpotBanner.hidden=!tier;
  jackpotBanner.textContent=tier==="legendary"?"✦ LEGENDARY 10× ✦":"✦ SUPER JACKPOT 8× ✦";
  slotPulse=result.hit&&!reduceMotion?{slot,life:2.7,total:2.7}:null;
  el.resultStamp.textContent=tier?"ULTRA WIN · "+round.multiplier+"×":
    result.hit?"JACKPOT · NICE SHOT":"TRY AGAIN · NEXT BALL";
  el.resultTitle.textContent=result.hit?"红灯命中！":"没有命中红灯";
  el.resultNumber.classList.toggle("loss",!result.hit);
  el.resultNumber.innerHTML=result.hit?
    "+"+result.reward+" <small>颗</small>":"−"+shotStake+" <small>颗</small>";
  el.resultDetail.textContent=result.hit?
    shotStake+" 颗 × "+round.multiplier+" 倍 = "+result.reward+" 颗":
    "投入 "+shotStake+" 颗 · 落入第 "+String(slot+1).padStart(2,"0")+" 槽";
  el.cardEarned.hidden=result.newCards===0;
  el.cardEarned.textContent="✦ 获得奖励卡 ×"+result.newCards;
  el.next.textContent=save.marbles<MIN_STAKE?"领取体验弹珠，重新开始 →":"下一局 →";
  if(result.hit){
    burst(ball.x,ball.y,palette[save.theme].gold,tier?54:26);
    if(tier){
      beep(620,.16,"triangle",.055,0);
      beep(830,.18,"triangle",.052,.12);
      beep(1100,.35,"sine",.065,.26);
    }else beep(780,.25,"triangle",.065);
  }else beep(190,.18,"sawtooth",.035);
  startPayoutCeremony(result,slot);
}
function nextRound(){
  if(phase!=="result")return;
  if(save.marbles<MIN_STAKE){save={...save,marbles:100};persist();}
  // No pre-rolled multiplier: the next round starts with an empty machine.
  round=save.pendingRound;stake=save.pendingStake;
  revealState=round?"revealed":"hidden";
  lampRoll={steps:[],step:-1,nextAt:0};
  charge=0;charging=false;chargeMode=null;dragPointerId=null;
  ball=null;trail=[];impactFlashes=[];slotPulse=null;
  payoutFx=null;clearDispensers();
  el.resultPanel.hidden=true;el.next.hidden=true;el.payoutSkip.hidden=true;
  el.payoutEarnings.hidden=true;el.payoutActLabel.hidden=false;
  el.payoutActLabel.textContent="等待兑奖";
  settled=false;priorSave=null;shotStake=0;shotVelocity=null;
  updatePower();phase="ready";refresh();
}
function renderGifts(){
  el.shopCards.textContent=save.cards;el.giftList.replaceChildren();
  for(const gift of GIFTS){
    const item=document.createElement("div");item.className="gift-item";
    const swatch=document.createElement("span");swatch.className="gift-swatch "+gift.id;
    const copy=document.createElement("div");copy.className="gift-copy";
    const name=document.createElement("b");name.textContent=gift.name;
    const detail=document.createElement("small");detail.textContent=gift.description;
    copy.append(name,detail);
    const btn=document.createElement("button");btn.type="button";btn.className="gift-cta";
    const owned=save.redeemed.includes(gift.id);
    btn.textContent=owned?(save.theme===gift.id?"使用中":"使用"):gift.cost+" 张兑换";
    btn.disabled=(!owned&&save.cards<gift.cost)||(owned&&save.theme===gift.id);
    btn.addEventListener("click",()=>{
      try{save=owned?selectTheme(save,gift.id):redeem(save,gift.id);
        persist();refresh();renderGifts();beep(660,.2,"sine");}
      catch(error){notify(error.message);}
    });
    item.append(swatch,copy,btn);el.giftList.append(item);
  }
  if(save.theme!=="classic"){
    const item=document.createElement("div");item.className="gift-item";
    const copy=document.createElement("div");copy.className="gift-copy";
    const name=document.createElement("b");name.textContent="经典霓虹";
    const detail=document.createElement("small");detail.textContent="免费默认灯光";
    copy.append(name,detail);
    const btn=document.createElement("button");btn.type="button";btn.className="gift-cta";
    btn.textContent="使用";
    btn.addEventListener("click",()=>{save=selectTheme(save,"classic");persist();refresh();renderGifts();});
    item.append(copy,btn);el.giftList.append(item);
  }
}
function rounded(x,y,w,h,r,fill,stroke){
  ctx.beginPath();ctx.roundRect(x,y,w,h,r);
  if(fill){ctx.fillStyle=fill;ctx.fill();}
  if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}
}
function line(x1,y1,x2,y2,color,width=1){
  ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);
  ctx.lineTo(x2,y2);ctx.stroke();
}
function circle(x,y,r,color){
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
}
function label(t,x,y,size=12,color="#d6d1e7",align="left",weight="500"){
  ctx.font=weight+" "+size+"px Space Grotesk, Microsoft YaHei, sans-serif";
  ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(String(t),x,y);
}
function marble(x,y,r,p){
  ctx.shadowBlur=3;ctx.shadowColor=p.sky;
  const gr=ctx.createRadialGradient(x-2.5,y-3,1,x,y,r+1);
  gr.addColorStop(0,"#fff");gr.addColorStop(.36,"#d8e8ed");
  gr.addColorStop(.68,"#91b4c7");gr.addColorStop(1,"#3a526a");
  circle(x,y,r,gr);ctx.shadowBlur=0;circle(x-2.3,y-2.6,1.4,"#fff");
}
function resizeCanvas(){
  // Match the rendered CSS pixel size on desktop/mobile high-DPI screens.
  // Canvas logical coordinates remain exactly 420 x 710 for collision math.
  const rect=canvas.getBoundingClientRect();
  if(!rect.width||!rect.height)return;
  const dpr=Math.min(3,Math.max(1,window.devicePixelRatio||1));
  const width=Math.max(W,Math.round(rect.width*dpr));
  const height=Math.max(H,Math.round(rect.height*dpr));
  if(canvas.width!==width||canvas.height!==height){
    canvas.width=width;canvas.height=height;
  }
}
if("ResizeObserver" in window)new ResizeObserver(resizeCanvas).observe(canvas);
window.addEventListener("resize",resizeCanvas);
resizeCanvas();

// Fit the COMPLETE cabinet inside the remaining stage height and width,
// accounting for HUD and power bar. CSS-only vh guesses used to clip the
// bottom slots on narrow and short phones.
const machineSection=document.querySelector(".machine-section");
const cabinet=document.querySelector(".cabinet");
const mobilePlaybar=document.querySelector(".mobile-playbar");
const launchConsole=document.querySelector(".launch-console");
let fitScheduled=false;
function fitMachine(){
  if(!machineSection||!cabinet||!launchConsole)return;
  const styles=getComputedStyle(machineSection);
  const gap=parseFloat(styles.rowGap)||0;
  const mobileVisible=getComputedStyle(mobilePlaybar).display!=="none";
  const hudHeight=mobileVisible?mobilePlaybar.getBoundingClientRect().height:0;
  const consoleHeight=launchConsole.getBoundingClientRect().height;
  const usableHeight=Math.max(50,machineSection.clientHeight-hudHeight-consoleHeight-gap*(mobileVisible?2:1)-3);
  const maxWidth=Math.max(70,Math.min(540,machineSection.clientWidth-2));
  let low=70,high=Math.max(70,maxWidth);
  // Measure the actual resized cabinet, including lamps/chrome. Do not
  // transform-scale the canvas: its pointer coordinates must remain accurate.
  for(let i=0;i<13;i++){
    const mid=(low+high)/2;
    machineSection.style.setProperty("--fitted-cabinet-width",mid+"px");
    if(cabinet.getBoundingClientRect().height>usableHeight)high=mid;
    else low=mid;
  }
  machineSection.style.setProperty("--fitted-cabinet-width",Math.floor(low)+"px");
  resizeCanvas();
}
function scheduleMachineFit(){
  if(fitScheduled)return;
  fitScheduled=true;
  requestAnimationFrame(()=>{fitScheduled=false;fitMachine();});
}
if("ResizeObserver" in window){
  const observer=new ResizeObserver(scheduleMachineFit);
  observer.observe(machineSection);
  observer.observe(mobilePlaybar);
  observer.observe(launchConsole);
}
window.addEventListener("resize",scheduleMachineFit);
window.addEventListener("orientationchange",scheduleMachineFit);
window.visualViewport?.addEventListener("resize",scheduleMachineFit);
scheduleMachineFit();

function drawPlunger(p){
  const y=PLUNGER.restY+(charging?charge:0)*PLUNGER.travel;
  const cx=PLUNGER.centerX;
  // Dedicated, visibly mechanical, grabbable steel-and-brass plunger.
  rounded(378,616,29,86,7,"#141727","#9d94a7");
  rounded(382,621,21,75,5,"#273447","#636b82");
  label("↓",cx,600,16,p.gold,"center","700");
  label("PULL",cx,613,8,p.gold,"center","700");
  for(let n=0;n<=4;n++){
    const yy=625+n*14;
    line(379,yy,382,yy,"#e9cfb2",1.5);
    line(403,yy,406,yy,"#e9cfb2",1.5);
  }
  // Spring compresses visually as the metal handle is pulled towards the base.
  const springStart=y+12,springEnd=695;
  ctx.beginPath();ctx.moveTo(cx,springStart);
  for(let n=0;n<9;n++){
    const t=(n+1)/10;
    ctx.lineTo(cx+(n%2?-6:6),springStart+(springEnd-springStart)*t);
  }
  ctx.lineTo(cx,springEnd);ctx.strokeStyle="#d7e5ec";ctx.lineWidth=2.4;ctx.stroke();
  rounded(380,y-11,25,22,6,"#b8743e","#fff2c7");
  rounded(382,y-10,21,17,5,p.gold,"#ffe9bc");
  line(384,y-5,401,y-5,"#fff8e0",2);
  line(384,y+4,401,y+4,"#ac753c",2);
  if(charging)rounded(380,y-11,25,22,6,null,"#ffffff");
}
function draw(timestamp){
  const p=palette[save.theme];
  ctx.setTransform(canvas.width/W,0,0,canvas.height/H,0,0);
  ctx.clearRect(0,0,W,H);
  const bg=ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,"#171732");bg.addColorStop(.55,"#0b142c");bg.addColorStop(1,p.floor);
  ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
  ctx.save();if(screenShake>0)ctx.translate(Math.sin(timestamp*.09)*screenShake,0);
  // Crisp glass reflections, dotted backboard and machine serial markings.
  for(let i=0;i<78;i++)
    circle(24+(i*97.73)%341,83+(i*136.51)%510,i%5===0?1.15:.55,"#ffffff23");
  const glass=ctx.createLinearGradient(18,120,370,590);
  glass.addColorStop(0,"#c0e9ff0c");glass.addColorStop(.19,"#ffffff00");
  glass.addColorStop(.72,"#ffffff00");glass.addColorStop(1,"#9bd7ff0b");
  ctx.fillStyle=glass;ctx.fillRect(23,97,347,516);
  // Keep the upper playfield clear; no decorative title panel.
  line(LEFT,106,LEFT,614,"#e2ac8666",4);
  line(RIGHT,110,RIGHT,615,"#e2ac8666",4);
  ctx.strokeStyle="#ffbc826a";ctx.lineWidth=3;ctx.beginPath();
  ctx.moveTo(LEFT,155);ctx.quadraticCurveTo(50,101,110,106);ctx.stroke();
  // The visible launch elbow follows the SAME continuous rail geometry as the physics.
  ctx.strokeStyle="#dbb995";ctx.lineWidth=3.5;ctx.beginPath();
  let railStarted=false;
  for(let i=0;i<RAIL_POINTS.length;i+=2){
    const p=RAIL_POINTS[i];
    if(p.y>185)continue;
    if(!railStarted){ctx.moveTo(p.x,p.y);railStarted=true;}
    else ctx.lineTo(p.x,p.y);
  }
  ctx.stroke();
  line(377,119,377,676,"#c7a1a0a0",3);line(407,112,407,677,"#c7a1a099",3);
  rounded(380,135,24,479,11,"#0e1428ad");
  for(const pair of [["L",305],["A",326],["N",347],["E",368]])
    label(pair[0],389,pair[1],12,"#ddaa88","center","700");
  for(const peg of pegs){
    circle(peg.x+1.3,peg.y+1.5,peg.r+2,"#030819b0");
    const gr=ctx.createRadialGradient(peg.x-2,peg.y-2,1,peg.x,peg.y,peg.r+1);
    gr.addColorStop(0,"#fff6e0");gr.addColorStop(.35,"#c4b8b9");gr.addColorStop(1,"#5a607e");
    circle(peg.x,peg.y,peg.r,gr);circle(peg.x-1.3,peg.y-1.8,1.4,"#ffffffb0");
  }
  for(const b of bumpers){
    ctx.shadowBlur=5;ctx.shadowColor=p.red;circle(b.x,b.y,b.r+4,"#fe52634a");
    ctx.shadowBlur=0;circle(b.x,b.y,b.r,p.red);circle(b.x,b.y,b.r-4,"#3d243f");
    label("★",b.x,b.y+4,13,p.gold,"center","700");
  }
  // Collision rings are keyed to actual reported contact positions.
  if(!reduceMotion)for(const flash of impactFlashes){
    const t=Math.max(0,flash.life/flash.total);
    ctx.save();ctx.globalCompositeOperation="screen";ctx.globalAlpha=Math.min(.85,t*(.35+flash.force*.5));
    const color=flash.bumper?p.gold:p.sky;
    ctx.shadowColor=color;ctx.shadowBlur=flash.bumper?19:10;
    ctx.strokeStyle=color;ctx.lineWidth=flash.bumper?2.8:1.5;
    ctx.beginPath();ctx.arc(flash.x,flash.y,(flash.bumper?17:8)+(1-t)*15,0,Math.PI*2);ctx.stroke();
    circle(flash.x,flash.y,(flash.bumper?15:5)*t,color);
    ctx.restore();
  }
  line(26,588,53,616,p.gold+"88",3);line(366,588,344,617,p.gold+"88",3);
  for(let i=0;i<SLOT_COUNT;i++){
    const x=SLOT_LEFT+i*SLOT_W,lit=Boolean(revealState==="revealed"&&round&&round.lit.includes(i));
    const center=x+SLOT_W/2;
    const activeGradient=ctx.createLinearGradient(x,SLOT_TOP+8,x,SLOT_BOTTOM+23);
    activeGradient.addColorStop(0,lit?"#9f394f":"#18263b");
    activeGradient.addColorStop(.6,lit?"#49233d":"#10182a");
    activeGradient.addColorStop(1,lit?"#ae5364":"#212c40");
    rounded(x+1,SLOT_TOP+8,SLOT_W-2,77,3,activeGradient,lit?"#ff9390":"#57657e76");
    const strength=slotPulse?.slot===i?slotPulseStrength(slotPulse.life,slotPulse.total):0;
    if(strength>0){
      ctx.save();ctx.globalAlpha=.23+.6*strength;ctx.shadowColor=p.red;
      ctx.shadowBlur=12+24*strength;rounded(x+1,SLOT_TOP+6,SLOT_W-2,80,3,p.red);
      ctx.restore();
    }
    if(lit){
      ctx.shadowColor=p.red;ctx.shadowBlur=9+20*strength;
      rounded(x+3,SLOT_TOP+11,SLOT_W-6,4,2,"#ffab9c");
      ctx.shadowBlur=0;
      circle(center,SLOT_TOP+72,7,p.red);
      circle(center,SLOT_TOP+72,3,"#fff7f3");
    }else{
      rounded(x+3,SLOT_TOP+11,SLOT_W-6,3,1,"#67788b44");
      circle(center,SLOT_TOP+72,3.4,"#596b86");
    }
    label(String(i+1).padStart(2,"0"),center,SLOT_TOP+34,11,
      lit?"#fff8f4":"#dde4f0","center","700");
    if(lit)label("WIN",center,SLOT_TOP+53,9,"#ffd6a8","center","800");
  }
  for(let i=1;i<SLOT_COUNT;i++){
    const x=SLOT_LEFT+i*SLOT_W;
    // Steel slot partitions are genuine collision segments, from entrance to floor.
    line(x,SLOT_TOP,x,SLOT_BOTTOM,"#c8b0b1",2.3);
    circle(x,SLOT_TOP,2.5,"#e0d0c4");
  }
  line(SLOT_LEFT,SLOT_TOP,SLOT_RIGHT,SLOT_TOP,"#ffbf8599",2.4);
  for(let j=0;j<11;j++){
    if(j===0||j===10){
      circle(LEFT+4,SLOT_TOP+34+(j===0?0:25),2,"#fff3c4");
      circle(RIGHT-4,SLOT_TOP+34+(j===0?0:25),2,"#fff3c4");
    }
  }
  drawPlunger(p);
  if(phase==="ready"){marble(LANE,606+Math.sin(timestamp/310)*1.1,R,p);
    label("READY",391,581,8,p.gold,"center","700");}
  if(ball){
    if(!reduceMotion&&trail.length>1){
      ctx.save();ctx.globalCompositeOperation="screen";
      ctx.lineCap="round";ctx.lineJoin="round";ctx.strokeStyle=p.sky;
      for(let i=1;i<trail.length;i++){
        const q=trail[i],prev=trail[i-1];
        ctx.globalAlpha=trailOpacity(i,trail.length,q.speed);
        ctx.lineWidth=1+4*i/trail.length;
        ctx.beginPath();ctx.moveTo(prev.x,prev.y);ctx.lineTo(q.x,q.y);ctx.stroke();
      }
      ctx.globalAlpha=.15;
      const latest=trail[trail.length-1];
      circle(latest.x,latest.y,R+5,p.sky);
      ctx.restore();
    }
    marble(ball.x,ball.y,R,p);
  }
  for(const part of particles){ctx.globalAlpha=Math.min(1,part.life*2);
    circle(part.x,part.y,2.3,part.color);}
  ctx.globalAlpha=1;ctx.restore();
  if(timestamp>floatingUntil)el.message.classList.remove("visible");
}
function frame(now){
  const delta=Math.min((now-(lastTime||now))/1000,.05);lastTime=now;
  if(charging&&chargeMode==="keyboard"){
    charge=Math.min(1,(now-chargeStarted)/1550);updatePower();
  }
  updateMultiplierRoll(now);
  updatePayoutCeremony(now);
  if(payoutDisplayState&&!reduceMotion){
    const display=payoutDisplayState;
    const active=Boolean(payoutFx)||now<display.settleUntil;
    if(active){
      // A 30 fps cap protects narrow phones with hundreds of moving marbles.
      if(display.world.visible<=250||now-display.lastDraw>=33){
        display.lastDraw=now;
        paintBasinMarbles(payoutFx?.shownMarbles??display.count,display.total);
      }
    }
  }
  accumulator+=delta;let steps=0;
  while(accumulator>=STEP&&steps<14){advance(STEP);accumulator-=STEP;steps++;}
  if(steps===14)accumulator=0;
  draw(now);requestAnimationFrame(frame);
}
document.querySelectorAll("[data-add]").forEach(btn=>btn.addEventListener("click",event=>{
  if(phase!=="ready"||charging||revealState==="rolling")return;
  const amount=Number(btn.dataset.add);
  if(save.marbles<amount)return;
  const wasRevealed=Boolean(round);
  try{
    save=depositMarbles(save,amount);
  }catch(error){notify(error.message);return;}
  stake=save.pendingStake;round=save.pendingRound;
  persist();refresh();
  playMarbleInsertFx(amount,event.currentTarget);
  beep(wasRevealed?490:410,.055,"triangle",.025);
  if(!wasRevealed&&round)startMultiplierRoll();
}));
document.querySelectorAll("[data-refund]").forEach(btn=>btn.addEventListener("click",()=>{
  if(phase!=="ready"||charging||revealState==="rolling"||stake===0)return;
  save=refundDeposit(save);stake=0;round=null;revealState="hidden";
  lampRoll={steps:[],step:-1,nextAt:0};
  persist();refresh();beep(310,.08,"triangle",.025);
}));
function pointerPosition(event){
  // Coordinates always track the current canvas bounds, even after orientation
  // change, browser UI resizing or device pixel ratio changes.
  return boardPoint(event.clientX,event.clientY,canvas.getBoundingClientRect(),W,H);
}
function pointerDown(event){
  if(event.pointerType==="mouse"&&event.button!==0)return;
  if(charging||phase!=="ready")return;
  const {x,y}=pointerPosition(event);
  // The overlay enlarges the physical hit area of a tiny mobile plunger.
  // Desktop canvas interactions can still hit the drawn plunger directly.
  if(event.currentTarget===canvas&&!isPlungerHit(x,y))return;
  if(beginCharge("pointer",y,event.pointerId)){
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  }
}
function pointerMove(event){
  if(!charging||chargeMode!=="pointer"||dragPointerId!==event.pointerId)return;
  event.preventDefault();
  charge=pullStrength(dragStartY,pointerPosition(event).y);
  updatePower();
}
function pointerUp(event){
  if(!charging||chargeMode!=="pointer"||dragPointerId!==event.pointerId)return;
  event.preventDefault();
  charge=pullStrength(dragStartY,pointerPosition(event).y);
  releaseCharge();
}
function pointerCancel(event){
  if(chargeMode==="pointer"&&dragPointerId===event.pointerId)cancelCharge();
}
for(const surface of [canvas,plungerGrip]){
  surface.addEventListener("pointerdown",pointerDown);
  surface.addEventListener("pointermove",pointerMove);
  surface.addEventListener("pointerup",pointerUp);
  surface.addEventListener("pointercancel",pointerCancel);
  surface.addEventListener("lostpointercapture",pointerCancel);
  surface.addEventListener("contextmenu",event=>event.preventDefault());
}

// On iOS Safari, touch-action: manipulation alone may not suppress the smart
// double-tap zoom on noninteractive arcade decoration. Cancel ONLY the second,
// nearby tap. Preserve ordinary taps, button rapid presses and two-finger pinch.
let lastGameTapAt=0,lastGameTapX=0,lastGameTapY=0;
document.addEventListener("touchend",event=>{
  if(!event.cancelable||event.changedTouches?.length!==1||event.touches?.length!==0)return;
  const target=event.target;
  if(!target?.closest?.(".shell"))return;
  if(target.closest("button,a,input,select,textarea"))return;
  const touch=event.changedTouches[0];
  const now=performance.now(),x=touch.clientX,y=touch.clientY;
  if(now-lastGameTapAt<340&&Math.hypot(x-lastGameTapX,y-lastGameTapY)<32){
    event.preventDefault();lastGameTapAt=0;return;
  }
  lastGameTapAt=now;lastGameTapX=x;lastGameTapY=y;
},{passive:false});
document.addEventListener("dblclick",event=>{
  if(event.target?.closest?.(".shell")&&event.cancelable)event.preventDefault();
},{passive:false});

if(typeof ResizeObserver!=="undefined"){
  new ResizeObserver(()=>{if(payoutDisplayState)
    paintBasinMarbles(payoutDisplayState.count,payoutDisplayState.total);
  }).observe(el.payoutBasin);
}
window.addEventListener("orientationchange",cancelCharge);
window.addEventListener("keydown",event=>{
  if(event.code!=="Space"||event.repeat||document.querySelector("dialog[open]"))return;
  if(event.target instanceof HTMLElement &&
     event.target.closest("button,a,input,textarea,select"))return;
  event.preventDefault();
  beginCharge("keyboard");
});
window.addEventListener("keyup",event=>{
  if(event.code!=="Space"||!charging||chargeMode!=="keyboard")return;
  event.preventDefault();releaseCharge();
});
window.addEventListener("blur",cancelCharge);
el.next.addEventListener("click",nextRound);
$("payoutSkip").addEventListener("click",()=>{if(payoutFx)showFinalResult();});
window.addEventListener("keydown",event=>{
  if(event.key==="Escape"&&payoutFx){event.preventDefault();showFinalResult();}
});
$("soundBtn").addEventListener("click",event=>{
  soundEnabled=!soundEnabled;
  event.currentTarget.setAttribute("aria-pressed",String(soundEnabled));
  event.currentTarget.textContent=soundEnabled?"♫":"♩";
  event.currentTarget.setAttribute("aria-label",soundEnabled?"关闭音效":"开启音效");
  event.currentTarget.title=soundEnabled?"关闭音效":"开启音效";
  if(soundEnabled)beep(620,.1);
});
$("helpBtn").addEventListener("click",()=>el.info.showModal());
$("giftBtn").addEventListener("click",()=>{renderGifts();el.shop.showModal();});
document.querySelectorAll("[data-close]").forEach(btn=>btn.addEventListener("click",()=>{
  $(btn.dataset.close).close();
}));
$("resetBtn").addEventListener("click",()=>{
  if(!confirm("确定清空所有虚拟弹珠、奖励卡和主题吗？此操作无法撤销。"))return;
  save=freshSave();round=null;stake=0;phase="ready";revealState="hidden";
  lampRoll={steps:[],step:-1,nextAt:0};
  ball=null;trail=[];impactFlashes=[];slotPulse=null;charge=0;charging=false;chargeMode=null;dragPointerId=null;
  payoutFx=null;clearDispensers();el.resultPanel.hidden=true;el.next.hidden=true;
  el.payoutSkip.hidden=true;el.payoutEarnings.hidden=true;
  el.payoutActLabel.hidden=false;el.payoutActLabel.textContent="等待兑奖";
  priorSave=null;settled=false;shotVelocity=null;
  persist();updatePower();refresh();el.shop.close();
});
refresh();updatePower();requestAnimationFrame(frame);
