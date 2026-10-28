#!/usr/bin/env node
/** Production-physics and rule Monte Carlo audit; seeded and repeatable. */
import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import {createPegLayout} from "../public/board-layout.mjs";
import {firingVelocity} from "../public/plunger.mjs";
import {randomLaunch,varyLaunchVelocity} from "../public/physics-variation.mjs";
import {PHYSICS,createPhysicalBall,stepPhysicalBall} from "../public/physics-engine.mjs";
import {MULTIPLIERS,SLOT_COUNT,winningSlotCount,createRound,freshSave,settle,isValidRound} from "../public/rules.mjs";

function countEnv(name,def,max){
  const v=process.env[name]===undefined?def:Number(process.env[name]);
  if(!Number.isSafeInteger(v)||v<1||v>max)throw Error("Invalid "+name);
  return v;
}
const perPower=countEnv("PHYSICS_SHOTS_PER_POWER",1000,20000);
const roundCount=countEnv("PROBABILITY_ROUNDS",250000,2000000);
const out=process.env.AUDIT_OUTPUT||"audit-output";
const powers=[.075,.15,.30,.55,.80,1];
const stepSize=1/180,limit=30*180,seedBase=0x73b4a21d;
const zeroSlots=()=>Array(SLOT_COUNT).fill(0);
const fixed=(x,n=6)=>Number(x.toFixed(n));
const rngFromSeed=seed=>{
  let s=(seed>>>0)||1;
  return ()=>{
    s^=s<<13;s^=s>>>17;s^=s<<5;
    return (s>>>0)/4294967296;
  };
};
function quantile(data,q){
  if(data.length===0)return null;
  const sorted=[...data].sort((a,b)=>a-b);
  return fixed(sorted[Math.floor((sorted.length-1)*q)],3);
}
const counts=MULTIPLIERS.map(winningSlotCount);
assert.deepEqual(counts,[5,4,3,2,1]);
assert.equal(SLOT_COUNT,11);
const layout=createPegLayout(PHYSICS.fieldRight);
const physical=[];
const allSlots=zeroSlots(),allTimes=[];
const errors=[],examples=[];
let enteredAll=0,completedAll=0,timeoutsAll=0,nonFiniteAll=0;
let jumpsAll=0,outsideAll=0,overlapsAll=0;
function anomaly(type,details){
  if(examples.length<20)examples.push({type,...details});
}
for(let p=0;p<powers.length;p++){
  const power=powers[p],slots=zeroSlots(),times=[],impacts=[];
  let entered=0,completed=0,timeouts=0,nonFinite=0,jumps=0,outside=0,overlaps=0;
  let maxSpeed=0,maxJump=0;
  for(let i=0;i<perPower;i++){
    const shotSeed=(seedBase^Math.imul(i+1,0x9e3779b1)^Math.imul(p+1,0x85ebca6b))>>>0;
    const rng=rngFromSeed(shotSeed);
    const variation=randomLaunch(rng);
    const ball=createPhysicalBall(varyLaunchVelocity(firingVelocity(power),variation),variation);
    let done=false,fault=false;
    for(let frame=0;frame<limit;frame++){
      const oldX=ball.x,oldY=ball.y,oldMode=ball.mode;
      const event=stepPhysicalBall(ball,stepSize,layout,rng);
      if(event.entered){entered++;enteredAll++;}
      const speed=Math.hypot(ball.vx,ball.vy);
      maxSpeed=Math.max(maxSpeed,speed);
      if(![ball.x,ball.y,ball.vx,ball.vy,ball.omega,ball.spin,ball.railS,ball.railSpeed].every(Number.isFinite)){
        nonFinite++;nonFiniteAll++;fault=true;
        anomaly("nonfinite",{power,index:i,seed:shotSeed,frame});
        break;
      }
      if(oldMode==="field"&&ball.mode==="field"){
        const displacement=Math.hypot(ball.x-oldX,ball.y-oldY);
        maxJump=Math.max(maxJump,displacement);
        if(displacement>25){
          jumps++;jumpsAll++;
          anomaly("large_displacement",{power,index:i,seed:shotSeed,frame,displacement:fixed(displacement,3)});
        }
        if(ball.x<PHYSICS.fieldLeft+ball.r-2||ball.x>PHYSICS.fieldRight-ball.r+2||ball.y<PHYSICS.fieldTop+ball.r-2){
          outside++;outsideAll++;
          anomaly("field_outside",{power,index:i,seed:shotSeed,frame,x:fixed(ball.x,2),y:fixed(ball.y,2)});
        }
      }
      if(event.settled){
        done=true;completed++;completedAll++;
        assert.ok(Number.isInteger(event.slot)&&event.slot>=0&&event.slot<SLOT_COUNT);
        assert.equal(ball.mode,"done");
        assert.ok(ball.y>=PHYSICS.slotBottom-ball.r-.1);
        slots[event.slot]++;allSlots[event.slot]++;
        const duration=(frame+1)*stepSize;
        times.push(duration);allTimes.push(duration);
        impacts.push(ball.impactCount);
        const width=(PHYSICS.slotRight-PHYSICS.slotLeft)/SLOT_COUNT;
        for(let divider=1;divider<SLOT_COUNT;divider++){
          const x=PHYSICS.slotLeft+divider*width;
          if(Math.abs(ball.x-x)<ball.r+1.15-.5){
            overlaps++;overlapsAll++;
            anomaly("settled_divider_overlap",{power,index:i,seed:shotSeed,slot:event.slot,x:fixed(ball.x,3),divider});
            break;
          }
        }
        break;
      }
    }
    if(!done&&!fault){
      timeouts++;timeoutsAll++;
      anomaly("timeout",{power,index:i,seed:shotSeed,mode:ball.mode,x:fixed(ball.x,2),y:fixed(ball.y,2)});
    }
  }
  const data={
    power,shots:perPower,entered,completed,timeouts,nonFinite,
    slots,percentages:slots.map(n=>fixed(n*100/perPower,3)),
    p50Seconds:quantile(times,.50),p95Seconds:quantile(times,.95),p99Seconds:quantile(times,.99),
    meanImpacts:fixed(impacts.reduce((a,b)=>a+b,0)/(impacts.length||1),2),
    jumpsAbove25px:jumps,outsideFieldSamples:outside,settledDividerOverlaps:overlaps,
    maxSpeed:fixed(maxSpeed,2),maxFrameJump:fixed(maxJump,2)
  };
  physical.push(data);
  console.log("PHYSICS_POWER "+JSON.stringify(data));
}
const totalPhysical=perPower*powers.length;
const physicsSummary={
  shots:totalPhysical,entered:enteredAll,completed:completedAll,timeouts:timeoutsAll,nonFinite:nonFiniteAll,
  jumpsAbove25px:jumpsAll,outsideFieldSamples:outsideAll,settledDividerOverlaps:overlapsAll,
  slots:allSlots,p50Seconds:quantile(allTimes,.5),p95Seconds:quantile(allTimes,.95),p99Seconds:quantile(allTimes,.99)
};
const roundRng=rngFromSeed(seedBase^0xab124dd2);
const slotRng=rngFromSeed(seedBase^0x00f76bad);
const tiers=MULTIPLIERS.map((m,i)=>({multiplier:m,count:counts[i],rounds:0,hits:0,returned:0,gates:zeroSlots()}));
let sum=0,sum2=0,allHits=0;
for(let i=0;i<roundCount;i++){
  const round=createRound(roundRng);
  assert.ok(isValidRound(round));
  const tier=tiers[MULTIPLIERS.indexOf(round.multiplier)];
  tier.rounds++;
  for(const s of round.lit)tier.gates[s]++;
  const slot=Math.floor(slotRng()*SLOT_COUNT);
  const result=settle(freshSave(),round,10,slot);
  const reward=result.reward/10;
  assert.equal(reward,result.hit?round.multiplier:0);
  if(result.hit){allHits++;tier.hits++;}
  tier.returned+=reward;sum+=reward;sum2+=reward*reward;
}
const theoretical=counts.reduce((acc,k,i)=>acc+k*MULTIPLIERS[i],0)/(MULTIPLIERS.length*SLOT_COUNT);
const observed=sum/roundCount;
const standardError=Math.sqrt(Math.max(0,sum2/roundCount-observed*observed)/roundCount);
const probability={
  rounds:roundCount,theoreticalReturn:fixed(theoretical),observedReturn:fixed(observed),
  return95CI:[fixed(observed-1.96*standardError),fixed(observed+1.96*standardError)],
  expectedHitRate:fixed(counts.reduce((a,b)=>a+b,0)/(MULTIPLIERS.length*SLOT_COUNT)),
  observedHitRate:fixed(allHits/roundCount),
  tiers:tiers.map(t=>({
    multiplier:t.multiplier,winningSlots:t.count,rounds:t.rounds,hits:t.hits,
    hitRate:fixed(t.hits/t.rounds),expectedHitRate:fixed(t.count/SLOT_COUNT),
    observedReturn:fixed(t.returned/t.rounds),expectedReturn:fixed(t.count*t.multiplier/SLOT_COUNT),
    gateFrequencies:t.gates.map(n=>fixed(n/t.rounds))
  }))
};
if(nonFiniteAll)errors.push("nonfinite physics states: "+nonFiniteAll);
if(timeoutsAll)errors.push("physics timeouts: "+timeoutsAll);
if(completedAll!==totalPhysical||enteredAll!==totalPhysical)errors.push("not all shots finished and entered");
if(jumpsAll)errors.push("field displacements over 25px: "+jumpsAll);
if(outsideAll)errors.push("field outside bounds: "+outsideAll);
if(overlapsAll)errors.push("settled divider overlaps: "+overlapsAll);
if(Math.abs(observed-theoretical)>Math.max(.025,5*standardError))errors.push("reward return differs from theory");
for(const t of probability.tiers){
  if(Math.abs(t.rounds/roundCount-.2)>.015)errors.push("tier frequency biased: "+t.multiplier);
  if(Math.abs(t.hitRate-t.expectedHitRate)>.02)errors.push("tier hit rate biased: "+t.multiplier);
  if(t.gateFrequencies.some(x=>Math.abs(x-t.expectedHitRate)>.022))errors.push("winning-gate selection biased: "+t.multiplier);
}
const audit={schemaVersion:1,seedBase,productionEngine:true,physicsHz:180,
  physicalSummary:physicsSummary,physical,probability,anomalyExamples:examples,errors,passed:errors.length===0};
const pct=v=>(v*100).toFixed(2)+"%";
const markdown=[
  "# 弹珠机物理与概率验收报告",
  "",
  "- 固定随机种子 "+seedBase+"，使用正式物理与计奖模块，180Hz。",
  "- 真实物理仿真："+totalPhysical+" 次，六档力度各 "+perPower+" 次；独立规则蒙特卡洛："+roundCount+" 局。",
  "- 结果：**"+(audit.passed?"PASS":"FAIL")+"**"+(errors.length?"；问题："+errors.join("; "):""),
  "",
  "## 物理仿真（11 槽，编号 1—11）",
  "",
  "| 发射力度 | 完成次数 | 超时 | P95 秒 | 11 槽实际次数 |",
  "|---:|---:|---:|---:|---|",
  ...physical.map(x=>"| "+x.power+" | "+x.completed+"/"+x.shots+" | "+x.timeouts+" | "+x.p95Seconds+" | "+x.slots.join(", ")+" |"),
  "",
  "- 总计槽位次数："+allSlots.join(", ")+"。",
  "- 非有限状态 "+nonFiniteAll+"；大位移 "+jumpsAll+"；边界外 "+outsideAll+"；静止后穿隔板 "+overlapsAll+"。",
  "",
  "## 规则概率和虚拟弹珠返还",
  "",
  "| 倍率 | 红灯 | 理论命中率 | 实测命中率 | 理论毛返还倍率 | 实测毛返还倍率 |",
  "|---:|---:|---:|---:|---:|---:|",
  ...probability.tiers.map(x=>"| "+x.multiplier+"× | "+x.winningSlots+" | "+pct(x.expectedHitRate)+" | "+pct(x.hitRate)+" | "+x.expectedReturn+" | "+x.observedReturn+" |"),
  "",
  "- 理论毛返还："+pct(theoretical)+"；实测："+pct(observed)+"。",
  "- 实测返还倍率的近似95%置信区间：["+probability.return95CI.join(", ")+"]。",
  "",
  "## 条件与局限",
  "",
  "- 本模拟真实物理样本与规则样本严格区分，不声称执行了相同数量的物理发射。",
  "- 物理落点不假设均匀，红灯位置独立且均匀选取（不重复），因此理论命中率为红灯数/11。",
  "- 这是二维离散钢珠模型的数值验收，不是实物三维钢珠标定。",
  "- 完整原始统计、异常种子及各倍率位置分布见 audit.json。",
  "",
  "复现：设置 PHYSICS_SHOTS_PER_POWER 和 PROBABILITY_ROUNDS 后执行 node scripts/physics-probability-audit.mjs。",
  ""
].join("\n");
mkdirSync(out,{recursive:true});
writeFileSync(out+"/audit.json",JSON.stringify(audit,null,2)+"\n");
writeFileSync(out+"/report.md",markdown);
console.log("AUDIT_SUMMARY "+JSON.stringify({passed:audit.passed,physics:physicsSummary,
  probability:{rounds:roundCount,theoretical:probability.theoreticalReturn,observed:probability.observedReturn,
    ci:probability.return95CI},errors}));
if(errors.length)process.exitCode=1;
