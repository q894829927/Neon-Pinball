import { MIN_STAKE, MAX_STAKE, SLOT_COUNT, GIFTS, STORAGE_KEY,
  freshSave, restoreSave, depositMarbles, refundDeposit, canLaunch,
  commitShot, settleFunded, redeem, selectTheme
} from "./rules.mjs?v=0.7.3";
import {PLUNGER, boardPoint, isPlungerHit, pullStrength, canFire, firingVelocity} from "./plunger.mjs?v=0.7.3";
import {randomLaunch, varyLaunchVelocity, varyPegRebound} from "./physics-variation.mjs?v=0.7.3";
import {buildLampSequence, lampStepDelay, displayedMultiplier, lampVisualIndex} from "./roulette.mjs?v=0.7.3";
import {createPegLayout} from "./board-layout.mjs?v=0.7.3";

const W=420,H=710,LEFT=25,RIGHT=368,LANE=393,TOP=126;
const SLOT_LEFT=28,SLOT_RIGHT=365,SLOT_TOP=619,SLOT_BOTTOM=681;
const SLOT_W=(SLOT_RIGHT-SLOT_LEFT)/SLOT_COUNT;
const R=7.1,GRAVITY=1060,STEP=1/180;
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
  overlay:$("shootOverlay"),resultTitle:$("resultTitle"),
  resultStamp:$("resultStamp"),resultNumber:$("resultNumber"),
  resultDetail:$("resultDetail"),cardEarned:$("cardEarned"),
  next:$("nextBtn"),message:$("floatMessage"),shop:$("shopDialog"),
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
function persist(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(save));}catch{}}
function beep(f=520,d=.08,type="sine",volume=.05){
  if(!soundEnabled)return;
  try{
    if(!audioContext)audioContext=new(window.AudioContext||window.webkitAudioContext)();
    if(audioContext.state==="suspended")audioContext.resume();
    const o=audioContext.createOscillator(),gain=audioContext.createGain();
    o.type=type;o.frequency.setValueAtTime(f,audioContext.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(60,f*.65),audioContext.currentTime+d);
    gain.gain.setValueAtTime(volume,audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001,audioContext.currentTime+d);
    o.connect(gain).connect(audioContext.destination);o.start();o.stop(audioContext.currentTime+d);
  }catch{}
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
function refresh(){
  el.balance.textContent=save.marbles.toLocaleString("zh-CN");
  $("mobileBalance").textContent=save.marbles.toLocaleString("zh-CN");
  const visibleMultiplier=displayedMultiplier(revealState,round);
  const litCount=revealState==="revealed"&&round?round.lit.length:0;
  $("mobileStake").textContent=stake.toLocaleString("zh-CN");
  $("stakeAmount").textContent=stake.toLocaleString("zh-CN");
  el.cards.textContent=save.cards;
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
    :phase==="shooting"?"弹珠运行中":"本局已结束";
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
  shotVelocity=varyLaunchVelocity(firingVelocity(power),randomLaunch());
  shotStake=stake;
  // Deposit was already charged when marbles were inserted. Commit only
  // clears the pending stake so a reload cannot replay a fired shot.
  save=commitShot(save);
  priorSave={...save,redeemed:[...save.redeemed]};persist();
  phase="shooting";settled=false;elapsed=0;trail=[];particles=[];
  ball={x:LANE,y:606,vx:0,vy:shotVelocity.laneVy,r:R,mode:"lane",slot:-1,spin:0};
  beep(370+power*210,.23,"sawtooth",.045);notify("GOOD LUCK! ✦",850);refresh();
}
function burst(x,y,color,n=8){
  for(let k=0;k<n;k++){
    const a=Math.random()*Math.PI*2,s=40+Math.random()*180;
    particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,
      life:.35+Math.random()*.35,color});
  }
}
function bump(cx,cy,r,energy=.76,withVariation=true){
  if(!ball||ball.mode!=="field")return false;
  const dx=ball.x-cx,dy=ball.y-cy,range=ball.r+r,dist=Math.hypot(dx,dy);
  if(dist>=range)return false;
  const nx=dist>.001?dx/dist:0,ny=dist>.001?dy/dist:-1;
  ball.x+=nx*(range-dist+.06);ball.y+=ny*(range-dist+.06);
  const impact=ball.vx*nx+ball.vy*ny;
  if(impact<0){
    ball.vx-=(1+energy)*impact*nx;ball.vy-=(1+energy)*impact*ny;
    ball.vx+=ny*7*Math.sin(ball.spin);
    if(withVariation&&-impact>35){
      // Bounded tangential impulse only after a real contact.
      const rebound=varyPegRebound(ball.vx,ball.vy,nx,ny,-impact);
      ball.vx=rebound.vx;ball.vy=rebound.vy;
    }
    if(-impact>65){beep(320+Math.min(850,-impact*.75),.045,"sine",.014);
      screenShake=Math.max(screenShake,Math.min(2.8,-impact/210));}
  }
  return true;
}
function advance(dt){
  if(phase==="shooting"&&ball){
    elapsed+=dt;ball.spin+=dt*10;
    if(ball.mode==="lane"){
      ball.vy+=GRAVITY*.09*dt;ball.y+=ball.vy*dt;
      if(ball.y<=TOP-15){
        // The curved upper firing track guides the ball onto the peg field.
        ball.x=RIGHT-10;ball.y=TOP-15;
        ball.vx=shotVelocity.entryVx;ball.vy=shotVelocity.entryVy;
        ball.mode="field";
        burst(ball.x,ball.y,palette[save.theme].gold,6);
      }
    }else if(ball.mode==="field"){
      ball.vy+=GRAVITY*dt*(elapsed>13?1.5:1);
      ball.x+=ball.vx*dt;ball.y+=ball.vy*dt;
      if(ball.x<LEFT+ball.r){ball.x=LEFT+ball.r;ball.vx=Math.abs(ball.vx)*.74;}
      if(ball.x>RIGHT-ball.r){ball.x=RIGHT-ball.r;ball.vx=-Math.abs(ball.vx)*.74;}
      if(ball.y<TOP-ball.r){ball.y=TOP-ball.r;ball.vy=Math.abs(ball.vy)*.66;}
      for(const p of pegs)bump(p.x,p.y,p.r);
      for(const p of bumpers)if(bump(p.x,p.y,p.r,.92) && Math.random()<.16)
        burst(p.x,p.y,palette[save.theme].sky,3);
      for(let i=1;i<SLOT_COUNT;i++)bump(SLOT_LEFT+i*SLOT_W,SLOT_TOP-1,4.2,.62,false);
      if(ball.y>=SLOT_TOP+15&&ball.vy>0){
        ball.slot=Math.min(SLOT_COUNT-1,Math.max(0,Math.floor((ball.x-SLOT_LEFT)/SLOT_W)));
        ball.mode="slot";ball.vx=0;ball.vy=170;beep(450,.11,"triangle",.045);
      }
      const v=Math.hypot(ball.vx,ball.vy);
      if(v>1350){ball.vx*=1350/v;ball.vy*=1350/v;}
    }else if(ball.mode==="slot"){
      const target=SLOT_LEFT+(ball.slot+.5)*SLOT_W;
      ball.x+=(target-ball.x)*Math.min(1,dt*12);ball.y+=ball.vy*dt;
      if(ball.y>=SLOT_BOTTOM){ball.y=SLOT_BOTTOM;finishShot(ball.slot);}
    }
    trail.push({x:ball.x,y:ball.y});if(trail.length>9)trail.shift();
  }
  particles=particles.filter(p=>p.life>0);
  for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=200*dt;p.life-=dt;}
  screenShake=Math.max(0,screenShake-10*dt);
}
function finishShot(slot){
  if(settled||!priorSave)return;
  settled=true;
  const result=settleFunded(priorSave,round,shotStake,slot);
  save=result.save;persist();phase="result";
  el.resultStamp.textContent=result.hit?"JACKPOT · NICE SHOT":"TRY AGAIN · NEXT BALL";
  el.resultTitle.textContent=result.hit?"红灯命中！":"没有命中红灯";
  el.resultNumber.classList.toggle("loss",!result.hit);
  el.resultNumber.innerHTML=result.hit?
    "+"+result.reward+" <small>颗</small>":"−"+shotStake+" <small>颗</small>";
  el.resultDetail.textContent=result.hit?
    shotStake+" 颗 × "+round.multiplier+" 倍 = "+result.reward+" 颗":
    "投入 "+shotStake+" 颗 · 落入第 "+String(slot+1).padStart(2,"0")+" 槽";
  el.cardEarned.hidden=result.newCards===0;
  el.next.textContent=save.marbles<MIN_STAKE?"领取体验弹珠，重新开始 →":"下一局 →";
  el.overlay.hidden=false;
  if(result.hit){beep(780,.25,"triangle",.065);burst(ball.x,ball.y,palette[save.theme].gold,26);}
  else beep(190,.18,"sawtooth",.035);
  refresh();
}
function nextRound(){
  if(phase!=="result")return;
  if(save.marbles<MIN_STAKE){save={...save,marbles:100};persist();}
  // No pre-rolled multiplier: the next round starts with an empty machine.
  round=save.pendingRound;stake=save.pendingStake;
  revealState=round?"revealed":"hidden";
  lampRoll={steps:[],step:-1,nextAt:0};
  charge=0;charging=false;chargeMode=null;dragPointerId=null;
  ball=null;trail=[];settled=false;priorSave=null;shotStake=0;shotVelocity=null;
  updatePower();phase="ready";el.overlay.hidden=true;refresh();
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
  rounded(32,88,327,18,5,"#0e1a30","#997b7655");
  label("✦  CHROME DROP  •  11 GATES  •  NEON SERIES  ✦",195,101,9,"#b5b6ce","center","700");
  rounded(16,12,389,65,12,"#2c2039","#e5b67f");
  rounded(20,16,381,57,10,"#100f26","#c78f70");
  rounded(29,22,362,45,8,"#171329","#db996f88");
  line(39,24,380,24,"#ffe5a951",1.3);
  label("✦   MARBLE LUCK   ✦",210,40,15,p.gold,"center","800");
  label(revealState==="rolling"?"顶部跑灯抽取倍率中…":
    revealState==="revealed"&&round?"倍率 "+round.multiplier+"× · 红灯中奖槽 "+round.lit.length+"/11":
    "投入 5 颗后抽取倍率与红灯槽",210,57,11,"#f7d7a7","center");
  line(LEFT,106,LEFT,614,"#e2ac8666",4);
  line(RIGHT,110,RIGHT,615,"#e2ac8666",4);
  ctx.strokeStyle="#ffbc826a";ctx.lineWidth=3;ctx.beginPath();
  ctx.moveTo(LEFT,155);ctx.quadraticCurveTo(50,101,110,106);
  ctx.moveTo(RIGHT,145);ctx.quadraticCurveTo(392,86,LANE,107);ctx.stroke();
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
  line(26,588,53,616,p.gold+"88",3);line(366,588,344,617,p.gold+"88",3);
  for(let i=0;i<SLOT_COUNT;i++){
    const x=SLOT_LEFT+i*SLOT_W,lit=Boolean(revealState==="revealed"&&round&&round.lit.includes(i));
    const center=x+SLOT_W/2;
    const activeGradient=ctx.createLinearGradient(x,SLOT_TOP+8,x,SLOT_BOTTOM+23);
    activeGradient.addColorStop(0,lit?"#9f394f":"#18263b");
    activeGradient.addColorStop(.6,lit?"#49233d":"#10182a");
    activeGradient.addColorStop(1,lit?"#ae5364":"#212c40");
    rounded(x+1,SLOT_TOP+8,SLOT_W-2,77,3,activeGradient,lit?"#ff9390":"#57657e76");
    if(lit){
      ctx.shadowColor=p.red;ctx.shadowBlur=9;
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
    const x=SLOT_LEFT+i*SLOT_W;line(x,SLOT_TOP+2,x,SLOT_BOTTOM+24,"#cfadad",2);
    circle(x,SLOT_TOP,4.2,"#e0d0c4");
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
    for(let i=0;i<trail.length;i++){
      const q=trail[i];ctx.globalAlpha=i/trail.length*.13;
      circle(q.x,q.y,R*(.3+i/trail.length*.5),p.sky);
    }
    ctx.globalAlpha=1;marble(ball.x,ball.y,R,p);
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
$("soundBtn").addEventListener("click",event=>{
  soundEnabled=!soundEnabled;
  event.currentTarget.setAttribute("aria-pressed",String(soundEnabled));
  event.currentTarget.textContent=soundEnabled?"♫":"♩";
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
  ball=null;trail=[];charge=0;charging=false;chargeMode=null;dragPointerId=null;
  priorSave=null;settled=false;shotVelocity=null;
  persist();updatePower();refresh();el.shop.close();el.overlay.hidden=true;
});
refresh();updatePower();requestAnimationFrame(frame);
