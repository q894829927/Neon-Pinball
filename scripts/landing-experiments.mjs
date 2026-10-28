#!/usr/bin/env node
/**
 * Reproducible comparison of production E0 vs three PHYSICAL prototypes.
 * E1/E2 only translate the last two Bezier x controls by 10/20 px.
 * E3 adds a physical tilted deflector on the right; no score/slot override.
 * Production engine is never modified; variants are loaded in memory.
 */
import assert from "node:assert/strict";
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {createPegLayout} from "../public/board-layout.mjs";
import {firingVelocity} from "../public/plunger.mjs";
import {randomLaunch,varyLaunchVelocity} from "../public/physics-variation.mjs";
import * as baseline from "../public/physics-engine.mjs";
const source=readFileSync(new URL("../public/physics-engine.mjs",import.meta.url),"utf8");
const variationUrl=new URL("../public/physics-variation.mjs",import.meta.url).href;
const replacementImport='from "'+variationUrl+'"';
const originalImport='from "./physics-variation.mjs?v=0.8.0"';
assert.equal(source.split(originalImport).length,2,"Production variation import changed");
const baseSource=source.replace(originalImport,replacementImport);
const railPattern="3*v*u*u*364+u*u*u*345";
const dividerPattern="// Each divider exists as a full vertical capsule rather than a top pin.";
assert.equal(baseSource.split(railPattern).length,2,"Rail geometry changed; review experiment");
assert.equal(baseSource.split(dividerPattern).length,2,"Divider position changed; review experiment");
const deflector={ax:359,ay:250,bx:344,by:283,r:1.15};
function variantSource(kind){
  if(kind==="E1"||kind==="E2"){
    const shift=kind==="E1"?10:20;
    return baseSource.replace(railPattern,
      "3*v*u*u*"+(364-shift)+"+u*u*u*"+(345-shift));
  }
  if(kind==="E3"){
    // Collision in both substeps, with same restitution/friction as a divider.
    const segment="const e=resolveSegment(ball,{ax:359,ay:250,bx:344,by:283,r:1.15},PHYSICS.dividerRestitution,PHYSICS.dividerFriction,rng);if(e)impacts.push(e);";
    return baseSource.replace(dividerPattern,"{ "+segment+" }\n   "+dividerPattern);
  }
  throw Error("Unexpected experiment");
}
async function importPrototype(kind){
  const code=variantSource(kind);
  const url="data:text/javascript;base64,"+Buffer.from(code,"utf8").toString("base64");
  return import(url);
}
const engines={
  E0:baseline,
  E1:await importPrototype("E1"),
  E2:await importPrototype("E2"),
  E3:await importPrototype("E3")
};
const powers=[.075,.15,.30,.55,.80,1];
const slotCount=baseline.PHYSICS.slotCount;
assert.equal(slotCount,11);
for(const id of ["E1","E2"]){
  const shift=id==="E1"?10:20;
  const end=engines[id].sampleRail(engines[id].RAIL_LENGTH);
  assert.ok(Math.abs(end.x-(345-shift))<.01,"Endpoint geometry error for "+id);
  assert.ok(Math.abs(end.y-133)<.01,"Endpoint y must not move");
}
const outDir=process.env.EXPERIMENT_OUTPUT||"experiment-output";
const sample=Number(process.env.EXPERIMENT_SHOTS_PER_POWER||1000);
assert.ok(Number.isSafeInteger(sample)&&sample>=1&&sample<=20000);
const dt=1/180,maxSteps=30*180,seedBase=0x73b4a21d;
const layout=createPegLayout(baseline.PHYSICS.fieldRight);
function rngFromSeed(seed){
  let s=(seed>>>0)||1;
  return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296;};
}
const pct=(x)=>(x*100).toFixed(2)+"%";
const fixed=(x,n=6)=>+x.toFixed(n);
const percentile=(data,p)=>{
  if(!data.length)return null;
  const sorted=[...data].sort((a,b)=>a-b);
  return fixed(sorted[Math.floor((sorted.length-1)*p)],3);
};
const ones=()=>Array(slotCount).fill(0);
const groupResults=[],outcomes={};
for(const [id,engine] of Object.entries(engines)){
  const slots=ones(),powersOut=[],allDuration=[];
  const perShot=Array(powers.length*sample).fill(-1);
  let entered=0,settled=0,timeouts=0,nonfinite=0,outside=0,largeJumps=0,dividerOverlap=0;
  let railEndpointX=engine.sampleRail(engine.RAIL_LENGTH).x;
  let maxFrameDisplacement=0,maxSpeed=0,impactTotal=0;
  const failures=[];
  for(let p=0;p<powers.length;p++){
    const power=powers[p];
    const localSlots=ones(),localTimes=[];
    let localTimeout=0,localEntered=0,localSettled=0,localOutside=0,localNonfinite=0,localOverlaps=0,localJumps=0;
    for(let i=0;i<sample;i++){
      // Seed mapping identical to existing full physics audit.
      const seed=(seedBase^Math.imul(i+1,0x9e3779b1)^Math.imul(p+1,0x85ebca6b))>>>0;
      const rng=rngFromSeed(seed),variation=randomLaunch(rng);
      const ball=engine.createPhysicalBall(varyLaunchVelocity(firingVelocity(power),variation),variation);
      let finished=false,invalid=false;
      for(let frame=0;frame<maxSteps;frame++){
        const oldX=ball.x,oldY=ball.y,oldMode=ball.mode;
        const event=engine.stepPhysicalBall(ball,dt,layout,rng);
        if(event.entered){entered++;localEntered++;}
        maxSpeed=Math.max(maxSpeed,Math.hypot(ball.vx,ball.vy));
        if(![ball.x,ball.y,ball.vx,ball.vy,ball.omega,ball.spin,ball.railS,ball.railSpeed].every(Number.isFinite)){
          nonfinite++;localNonfinite++;invalid=true;
          if(failures.length<15)failures.push({type:"nonfinite",power,seed,frame});
          break;
        }
        if(oldMode==="field"&&ball.mode==="field"){
          const dis=Math.hypot(ball.x-oldX,ball.y-oldY);
          maxFrameDisplacement=Math.max(maxFrameDisplacement,dis);
          if(dis>25){largeJumps++;localJumps++;}
          if(ball.x<baseline.PHYSICS.fieldLeft+ball.r-2||
             ball.x>baseline.PHYSICS.fieldRight-ball.r+2||
             ball.y<baseline.PHYSICS.fieldTop+ball.r-2){
            outside++;localOutside++;
          }
        }
        if(event.settled){
          assert.ok(Number.isInteger(ball.slot)&&ball.slot>=0&&ball.slot<11);
          assert.equal(ball.mode,"done");
          assert.ok(ball.y>=baseline.PHYSICS.slotBottom-ball.r-.1);
          finished=true;settled++;localSettled++;
          slots[ball.slot]++;localSlots[ball.slot]++;
          perShot[p*sample+i]=ball.slot;
          const time=(frame+1)*dt;
          allDuration.push(time);localTimes.push(time);
          impactTotal+=ball.impactCount;
          const width=(baseline.PHYSICS.slotRight-baseline.PHYSICS.slotLeft)/11;
          for(let divider=1;divider<11;divider++){
            const x=baseline.PHYSICS.slotLeft+divider*width;
            if(Math.abs(ball.x-x)<ball.r+1.15-.5){
              dividerOverlap++;localOverlaps++;
              if(failures.length<15)failures.push({type:"divider_overlap",power,seed,x:fixed(ball.x,2),divider});
              break;
            }
          }
          break;
        }
      }
      if(!finished&&!invalid){
        timeouts++;localTimeout++;
        if(failures.length<15)failures.push({type:"timeout",power,seed,x:fixed(ball.x,2),y:fixed(ball.y,2),mode:ball.mode});
      }
    }
    powersOut.push({
      power,shots:sample,entered:localEntered,settled:localSettled,timeouts:localTimeout,
      nonfinite:localNonfinite,largeJumps:localJumps,outside:localOutside,dividerOverlap:localOverlaps,
      slots:localSlots,slot11:localSlots[10],slot11Rate:fixed(localSlots[10]/sample),
      p95Seconds:percentile(localTimes,.95)
    });
  }
  const total=powers.length*sample;
  const p=slots.map(x=>x/total);
  const tvd=.5*p.reduce((s,x)=>s+Math.abs(x-1/11),0);
  const chiSq=slots.reduce((s,x)=>s+(x-total/11)**2/(total/11),0);
  const entropy=-p.reduce((s,x)=>s+(x?x*Math.log(x):0),0)/Math.log(11);
  const result={
    id,description:{
      E0:"Current production baseline",E1:"Rail outlet 10px left; last control moved 10px left",
      E2:"Rail outlet 20px left; last control moved 20px left",
      E3:"One real slanted right-side deflector capsule, (359,250) to (344,283)"
    }[id],railEndpointX:fixed(railEndpointX,2),shots:total,
    entered,settled,timeouts,nonfinite,largeJumps,outside,dividerOverlap,
    maxFrameDisplacement:fixed(maxFrameDisplacement,2),maxSpeed:fixed(maxSpeed,2),
    slot11:slots[10],slot11Rate:fixed(p[10]),worstPowerSlot11Rate:fixed(Math.max(...powersOut.map(x=>x.slot11Rate))),
    totalVariationFromUniform:fixed(tvd),normalizedEntropy:fixed(entropy),chiSquareFromUniform:fixed(chiSq,2),
    meanImpacts:fixed(impactTotal/(settled||1),2),p50Seconds:percentile(allDuration,.5),
    p95Seconds:percentile(allDuration,.95),p99Seconds:percentile(allDuration,.99),
    slots,powers:powersOut,failures
  };
  groupResults.push(result);outcomes[id]=perShot;
  console.log("EXPERIMENT "+JSON.stringify(result));
}
const base=groupResults[0];
for(const experiment of groupResults.slice(1)){
  // Paired-seed uncertainty: compare each corresponding launched marble.
  let sum=0,sum2=0,discordant=0;
  for(let i=0;i<outcomes.E0.length;i++){
    const d=Number(outcomes[experiment.id][i]===10)-Number(outcomes.E0[i]===10);
    sum+=d;sum2+=d*d;if(d!==0)discordant++;
  }
  const mean=sum/base.shots;
  const se=Math.sqrt(Math.max(0,sum2/base.shots-mean*mean)/base.shots);
  experiment.vsBaseline={
    slot11DeltaPercentagePoints:fixed(100*mean,3),
    paired95CIpp:[fixed(100*(mean-1.96*se),3),fixed(100*(mean+1.96*se),3)],
    discordantMatchedShots:discordant,
    tvdDifference:fixed(experiment.totalVariationFromUniform-base.totalVariationFromUniform),
    worstPowerDeltaPP:fixed(100*(experiment.worstPowerSlot11Rate-base.worstPowerSlot11Rate),3)
  };
}
const valid=groupResults.filter(x=>x.timeouts===0&&x.nonfinite===0&&x.outside===0&&x.largeJumps===0&&x.dividerOverlap===0&&x.settled===x.shots);
const eligible=valid.filter(x=>x.id!=="E0");
const ranked=[...eligible].sort((a,b)=>a.slot11Rate-b.slot11Rate);
const best=ranked[0]||null;
const report={
  scriptVersion:1,productionEngineUnchanged:true,
  fixedSeed:seedBase,shotsPerPower:sample,shotLimitSeconds:30,physicsHz:180,
  powers,groups:groupResults,
  comparisonMethod:"Common random seeds for each group and strength; paired 95% normal approximation CI for the fraction landing in slot 11.",
  evaluation:"Lower slot11 probability is desired, but total variation, worst-power probability and error counts must also be checked.",
  bestValidBySlot11:best?.id??null,passed:valid.length===groupResults.length
};
const header=[
  "# E0 / E1 / E2 / E3：真实物理落点对照实验",
  "",
  "- 使用生产物理代码，仅在内存中生成实验模块；线上物理逻辑与奖金规则均未修改。",
  "- E0 当前；E1 / E2 仅将贝塞尔导轨末端及其前一控制点分别左移 10 / 20px（保持末端切线方向）；E3 仅增加右侧斜向实体导流板 (359,250) → (344,283)，半径 1.15px，同现有隔板的碰撞参数。",
  "- 六档发射力度："+powers.join(" / ")+"；每档每组 "+sample+" 次；每组 "+(sample*powers.length)+" 次，四组共 "+(sample*powers.length*4)+" 次物理仿真。",
  "- 所有组使用一组一组**相同的随机种子和发射力度**，最终比较使用配对差分；物理碰撞导致后续随机数调用分歧是实验真实差异。",
  "",
  "## 主要指标",
  "",
  "| 实验 | 第11槽占比 | 最差力度的第11槽占比 | 与E0差异（百分点） | 11槽分布TVD（越小越平均） | 超时 | 异常数 | P95落槽秒数 |",
  "|---|---:|---:|---:|---:|---:|---:|---:|",
  ...groupResults.map(x=>{
    const anomal=x.nonfinite+x.largeJumps+x.outside+x.dividerOverlap;
    const diff=x.id==="E0"?"—":x.vsBaseline.slot11DeltaPercentagePoints+"pp";
    return "| "+x.id+" | "+pct(x.slot11Rate)+" | "+pct(x.worstPowerSlot11Rate)+" | "+diff+" | "+
      x.totalVariationFromUniform+" | "+x.timeouts+" | "+anomal+" | "+x.p95Seconds+" |";
  }),
  "",
  "## 第11槽：各力度的实测概率",
  "",
  "| 发射力度 | E0 | E1 | E2 | E3 |",
  "|---:|---:|---:|---:|---:|",
  ...powers.map((power,i)=>"| "+power+" | "+groupResults.map(x=>pct(x.powers[i].slot11Rate)).join(" | ")+" |"),
  "",
  "## 11槽完整计数",
  "",
  "| 实验 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...groupResults.map(x=>"| "+x.id+" | "+x.slots.join(" | ")+" |"),
  "",
  "## 配对置信区间与判定",
  "",
  ...groupResults.slice(1).map(x=>
    "- "+x.id+" 与 E0 相比，第11槽差异 "+x.vsBaseline.slot11DeltaPercentagePoints+
      " 个百分点，配对近似95%区间 ["+x.vsBaseline.paired95CIpp.join(", ")+"]；"+
      "TVD 变化 "+x.vsBaseline.tvdDifference+"。"),
  "",
  "- 满足数值验收、且第11槽最低的候选：**"+(best?.id||"无")+"**。该排序仅根据第11槽比例，不代表一定建议上线；需要同时检查TVD、最差力度与界面碰撞几何。",
  "- 目标参考：第11槽低于15%，且所有发射力度未明显恶化；完全平均的理论值为 1/11 ≈ 9.09%。",
  "",
  "## 实验限制",
  "",
  "- 右侧导流板 E3 是*实验物理碰撞体*，未修改正式画布绘制。若决定上线，必须同步绘制实体挡板，再做电脑/手机浏览器真实游玩测试。",
  "- E1/E2 是导轨几何位置的受控测试；如决定采用，需同步调整绘图、导轨视觉、入口安全范围。",
  "- 未修改结算方式、不预设随机槽位、不对钢珠施加暗中位置修正。本实验不测虚拟弹珠收益，因为红灯抽签独立于弹道。",
  ""
].join("\n");
mkdirSync(outDir,{recursive:true});
writeFileSync(outDir+"/experiments.json",JSON.stringify(report,null,2)+"\n");
writeFileSync(outDir+"/report.md",header);
console.log("EXPERIMENT_SUMMARY "+JSON.stringify({
  passed:report.passed,bestValidBySlot11:report.bestValidBySlot11,
  groups:groupResults.map(x=>({id:x.id,slot11Rate:x.slot11Rate,tvd:x.totalVariationFromUniform,
     worstPower:x.worstPowerSlot11Rate,timeout:x.timeouts,anomalies:x.nonfinite+x.largeJumps+x.outside+x.dividerOverlap,
     deltaPP:x.vsBaseline?.slot11DeltaPercentagePoints,ciPP:x.vsBaseline?.paired95CIpp})),
  report:outDir+"/report.md"
}));
if(!report.passed)process.exitCode=1;
