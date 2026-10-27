import { BETS, MULTIPLIERS, SLOT_COUNT, GIFTS, STORAGE_KEY,
  freshSave, restoreSave, createRound, canAfford, settle, redeem, selectTheme
} from "./rules.mjs";
import {PLUNGER, boardPoint, isPlungerHit, pullStrength, canFire, firingVelocity} from "./plunger.mjs";

const W=420,H=710,LEFT=25,RIGHT=368,LANE=393,TOP=126;
const SLOT_LEFT=28,SLOT_RIGHT=365,SLOT_TOP=619,SLOT_BOTTOM=681;
const SLOT_W=(SLOT_RIGHT-SLOT_LEFT)/SLOT_COUNT;
const R=7.1,GRAVITY=1060,STEP=1/180;
const $=id=>document.getElementById(id);
const canvas=$("board"),ctx=canvas.getContext("2d",{alpha:false});
const plungerGrip=$("plungerGrip");
const el={balance:$("balance"),rounds:$("rounds"),wins:$("wins"),cards:$("cards"),
  multiplier:$("multiplier"),payout:$("possiblePayout"),best:$("best"),
  earned:$("earned"),themeName:$("themeName"),status:$("launchStatus"),
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
const pegs=[];
for(let row=0;row<10;row++){
  for(let i=0;i<8;i++){
    const x=48+i*39+(row%2)*18.5;
    if(x<RIGHT-12)pegs.push({x,y:184+row*42,r:5.9});
  }
}
const bumpers=[{x:60,y:348,r:16},{x:324,y:388,r:16},{x:203,y:452,r:14}];
let save;
try{save=restoreSave(JSON.parse(localStorage.getItem(STORAGE_KEY)||"null"));}
catch{save=freshSave();}
let round=createRound(),stake=10,phase="ready";
let ball=null,trail=[],lastTime=0,accumulator=0,elapsed=0;
let charging=false,charge=0,chargeStarted=0,chargeMode=null,dragPointerId=null,dragStartY=0;
let shotStake=0,priorSave=null,settled=false;
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
function refresh(){
  el.balance.textContent=save.marbles.toLocaleString("zh-CN");
  $("mobileBalance").textContent=save.marbles.toLocaleString("zh-CN");
  $("mobileMultiplier").textContent=round.multiplier;
  $("mobileCards").textContent=save.cards;
  el.cards.textContent=save.cards;el.rounds.textContent=save.rounds;
  el.wins.textContent=save.wins;el.best.textContent=save.best;
  el.earned.textContent=save.earned.toLocaleString("zh-CN");
  el.multiplier.textContent=round.multiplier;
  el.payout.textContent=stake*round.multiplier;
  el.shopCards.textContent=save.cards;
  const names={classic:"经典霓虹",sunset:"落日橘灯光",mint:"薄荷绿灯光",violet:"极光紫灯光"};
  el.themeName.textContent=names[save.theme]||names.classic;
  document.body.dataset.theme=save.theme;
  document.querySelectorAll(".rate-strip span").forEach((n,i)=>
    n.classList.toggle("active",MULTIPLIERS[i]===round.multiplier));
  document.querySelectorAll("[data-bet]").forEach(btn=>{
    const v=Number(btn.dataset.bet),selected=v===stake;
    btn.classList.toggle("selected",selected);btn.setAttribute("aria-pressed",String(selected));
    btn.disabled=phase!=="ready"||save.marbles<v;
  });
  el.status.textContent=phase==="ready"?"等待发射":
    phase==="shooting"?"弹珠运行中":phase==="result"?"本局已结束":"弹珠不足";
  $("betHint").textContent=save.marbles<10?"余额不足：下一局可免费领取体验弹珠。":
    "仅在发射时扣除投入；未中奖不返还。";
}
function updatePower(){
  el.bar.style.width=Math.round(charge*100)+"%";
  el.power.textContent=Math.round(charge*100)+"%";
}
function beginCharge(mode, startY=0, pointerId=null){
  if(phase!=="ready"||!canAfford(save,stake)||charging)return false;
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
  if(!canFire(power)||phase!=="ready"||!canAfford(save,stake)){
    cancelCharge();return;
  }
  charge=power;updatePower();
  const velocity=firingVelocity(power);
  priorSave={...save,redeemed:[...save.redeemed]};shotStake=stake;
  save={...save,marbles:save.marbles-stake};persist();
  phase="shooting";settled=false;elapsed=0;trail=[];particles=[];
  ball={x:LANE,y:606,vx:0,vy:velocity.laneVy,r:R,mode:"lane",slot:-1,spin:0};
  beep(370+power*210,.23,"sawtooth",.045);notify("GOOD LUCK! ✦",850);refresh();
}
function burst(x,y,color,n=8){
  for(let k=0;k<n;k++){
    const a=Math.random()*Math.PI*2,s=40+Math.random()*180;
    particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,
      life:.35+Math.random()*.35,color});
  }
}
function bump(cx,cy,r,energy=.76){
  if(!ball||ball.mode!=="field")return false;
  const dx=ball.x-cx,dy=ball.y-cy,range=ball.r+r,dist=Math.hypot(dx,dy);
  if(dist>=range)return false;
  const nx=dist>.001?dx/dist:0,ny=dist>.001?dy/dist:-1;
  ball.x+=nx*(range-dist+.06);ball.y+=ny*(range-dist+.06);
  const impact=ball.vx*nx+ball.vy*ny;
  if(impact<0){
    ball.vx-=(1+energy)*impact*nx;ball.vy-=(1+energy)*impact*ny;
    ball.vx+=ny*7*Math.sin(ball.spin);
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
        const velocity=firingVelocity(charge);
        ball.vx=velocity.entryVx;ball.vy=velocity.entryVy;ball.mode="field";
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
      for(let i=1;i<SLOT_COUNT;i++)bump(SLOT_LEFT+i*SLOT_W,SLOT_TOP-1,4.2,.62);
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
  const result=settle(priorSave,round,shotStake,slot);
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
  el.next.textContent=save.marbles<10?"领取体验弹珠，重新开始 →":"下一局 →";
  el.overlay.hidden=false;
  if(result.hit){beep(780,.25,"triangle",.065);burst(ball.x,ball.y,palette[save.theme].gold,26);}
  else beep(190,.18,"sawtooth",.035);
  refresh();
}
function nextRound(){
  if(phase!=="result")return;
  if(save.marbles<10){save={...save,marbles:100};persist();}
  round=createRound();stake=BETS.find(v=>v<=save.marbles)||10;
  charge=0;charging=false;chargeMode=null;dragPointerId=null;
  ball=null;trail=[];settled=false;priorSave=null;shotStake=0;
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
  for(let i=0;i<60;i++)
    circle(24+(i*97.73)%341,80+(i*136.51)%537,i%5===0?1.2:.6,"#ffffff1b");
  rounded(16,12,389,65,12,"#281b37","#96716b");
  rounded(29,22,362,45,8,"#110f27","#b276666b");
  label("✦   MARBLE LUCK   ✦",210,39,13,p.gold,"center","700");
  label("倍率 "+round.multiplier+"× / 中奖红灯 03",210,57,10,"#be9fa7","center");
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
    const x=SLOT_LEFT+i*SLOT_W,lit=round.lit.includes(i);
    rounded(x+1,SLOT_TOP+8,SLOT_W-2,77,2,lit?"#813041":"#15243c",
      lit?"#ff7d8299":"#5f617955");
    if(lit){ctx.shadowBlur=5;ctx.shadowColor=p.red;
      circle(x+SLOT_W/2,SLOT_TOP+71,6,p.red);
      ctx.shadowBlur=0;circle(x+SLOT_W/2,SLOT_TOP+71,2.4,"#fff7f3");}
    else circle(x+SLOT_W/2,SLOT_TOP+71,3.3,"#536078");
    label(String(i+1).padStart(2,"0"),x+SLOT_W/2,SLOT_TOP+31,10,
      lit?"#fff8f4":"#cfdae9","center","700");
    if(lit)label("WIN",x+SLOT_W/2,SLOT_TOP+49,8,p.gold,"center","700");
  }
  for(let i=1;i<SLOT_COUNT;i++){
    const x=SLOT_LEFT+i*SLOT_W;line(x,SLOT_TOP+2,x,SLOT_BOTTOM+24,"#cfadad",2);
    circle(x,SLOT_TOP,4.2,"#e0d0c4");
  }
  line(SLOT_LEFT,SLOT_TOP,SLOT_RIGHT,SLOT_TOP,"#ffbf8599",2);
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
  accumulator+=delta;let steps=0;
  while(accumulator>=STEP&&steps<14){advance(STEP);accumulator-=STEP;steps++;}
  if(steps===14)accumulator=0;
  draw(now);requestAnimationFrame(frame);
}
document.querySelectorAll("[data-bet]").forEach(btn=>btn.addEventListener("click",()=>{
  if(phase!=="ready")return;
  const value=Number(btn.dataset.bet);
  if(!canAfford(save,value))return;
  stake=value;refresh();beep(450,.06,"sine",.025);
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
for(const id of ["helpBtn","howToBtn"])$(id).addEventListener("click",()=>el.info.showModal());
$("giftBtn").addEventListener("click",()=>{renderGifts();el.shop.showModal();});
document.querySelectorAll("[data-close]").forEach(btn=>btn.addEventListener("click",()=>{
  $(btn.dataset.close).close();
}));
$("resetBtn").addEventListener("click",()=>{
  if(!confirm("确定清空所有虚拟弹珠、奖励卡和主题吗？此操作无法撤销。"))return;
  save=freshSave();round=createRound();stake=10;phase="ready";
  ball=null;trail=[];charge=0;charging=false;chargeMode=null;dragPointerId=null;
  priorSave=null;settled=false;
  persist();updatePower();refresh();el.shop.close();el.overlay.hidden=true;
});
refresh();updatePower();requestAnimationFrame(frame);
