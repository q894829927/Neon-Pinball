#!/usr/bin/env node
/** Reproducible 500/850 bead payout stress test on the production solver. */
import assert from "node:assert/strict";
import {performance} from "node:perf_hooks";
import {mkdirSync,writeFileSync} from "node:fs";
import {PAYOUT_RADIUS,createPayoutWorld,stepPayoutWorld,finishPayoutWorld,
  withinPayoutBasin,payoutOverflow} from "../public/payout-physics.mjs";

const frames=Number(process.env.PAYOUT_STRESS_FRAMES||540);
assert.ok(Number.isInteger(frames)&&frames>=60&&frames<=1200);
const scenarios=[
  {name:"desktop-500",reward:500,width:168,height:66,tray:{left:23.5,right:144.5,top:26,bottom:62}},
  {name:"mobile-850",reward:850,width:108,height:54,tray:{left:15,right:93,top:20,bottom:50}}
];
const outcomes=[];
for(const spec of scenarios){
  const world=createPayoutWorld(spec.width,spec.height,spec.reward,spec.tray);
  const durations=[],memStart=process.memoryUsage().heapUsed;
  let maxHeap=memStart;
  const started=performance.now();
  for(let i=0;i<frames;i++){
    const begin=performance.now();
    const desired=Math.floor(spec.reward*(i+1)/frames);
    stepPayoutWorld(world,1/120,desired);
    durations.push(performance.now()-begin);
    if(i%45===0){
      assert.ok(world.balls.every(b=>withinPayoutBasin(b,world)),"Invalid position at "+i);
      maxHeap=Math.max(maxHeap,process.memoryUsage().heapUsed);
    }
  }
  const settling=performance.now();
  finishPayoutWorld(world,120);
  const elapsed=performance.now()-started;
  durations.sort((a,b)=>a-b);
  const sum=durations.reduce((a,b)=>a+b,0);
  const row={
    scenario:spec.name,releaseCount:spec.reward,radius:world.radius,
    simulated:world.balls.length,frames:world.frames,contacts:world.contacts,
    beadImpacts:world.beadImpacts,wallHits:world.wallHits,
    platformLandings:world.platformLandings,platformImpacts:world.platformImpacts,
    escapedReceiver:world.spilled,overflow:payoutOverflow(world),
    elapsedMs:+elapsed.toFixed(2),settlingMs:+(performance.now()-settling).toFixed(2),
    meanFrameMs:+(sum/frames).toFixed(3),
    p95FrameMs:+durations[Math.floor((frames-1)*.95)].toFixed(3),
    maxFrameMs:+Math.max(...durations).toFixed(3),
    peakHeapMB:+(maxHeap/1024/1024).toFixed(1),
    finite:world.balls.every(b=>withinPayoutBasin(b,world)),
  };
  outcomes.push(row);
  console.log("PAYOUT_STRESS "+JSON.stringify(row));
  assert.equal(row.radius,PAYOUT_RADIUS);
  assert.equal(row.simulated,spec.reward);
  assert.ok(row.finite);
  assert.ok(row.contacts>100);
  assert.ok(row.beadImpacts>0);
  assert.ok(row.overflow>0,"Filled bowl must produce actual overflow");
  assert.ok(row.platformLandings>0,"Spilled steel balls must land on the spillover platform");
  assert.ok(row.meanFrameMs<20,"Mean step too expensive for arcade device budget");
  assert.ok(row.p95FrameMs<50,"95th percentile payout step too slow on CI runner");
  assert.ok(row.elapsedMs<30000,"Stress simulation exceeded hard 30-second budget");
}
const json={version:"0.10.7",engine:"production 120Hz",
  frameCountPerScenario:frames,simulations:outcomes};
const outDir="payout-stress-output";
mkdirSync(outDir,{recursive:true});
writeFileSync(outDir+"/results.json",JSON.stringify(json,null,2)+"\n");
const md=[
"# v0.10.7 兑奖物理压力测试","",
"使用生产物理代码，真实钢珠大小固定3.05 CSS px 半径。每种场景 "+frames+" 帧出珠，随后120步结算稳定化。","",
"| 项目 | 500颗桌面 | 850颗手机 |",
"|---|---:|---:|",
...["simulated","radius","contacts","beadImpacts","platformLandings","platformImpacts","overflow","escapedReceiver","meanFrameMs","p95FrameMs","maxFrameMs","elapsedMs","peakHeapMB"].map(k=>
"| "+k+" | "+outcomes[0][k]+" | "+outcomes[1][k]+" |"),
"","**判定：** 固定尺寸、无非有限值、钢珠数准确、真实碰撞、溢珠平台着陆、平均帧开销与P95通过。报告是此 CI runner 的结果，不代表所有手机的实际 FPS。",""
].join("\n");
writeFileSync(outDir+"/report.md",md);
console.log("PAYOUT_STRESS_SUMMARY "+JSON.stringify({passed:true,scenarioCount:outcomes.length}));
