#!/usr/bin/env node
/**
 * Seeded, paired Monte-Carlo audit of REAL pinboard trajectories.
 * Every layout gets the same launch powers and RNG seeds; no preselected
 * destination, weighting, or adjustment of the real collision solver.
 */
import {performance} from "node:perf_hooks";
import {mkdirSync,writeFileSync} from "node:fs";
import {BOARD_LAYOUT_IDS,createPegLayout,getBoardLayout} from "../public/board-layout.mjs";
import {PHYSICS,createPhysicalBall,stepPhysicalBall} from "../public/physics-engine.mjs";
import {firingVelocity} from "../public/plunger.mjs";
import {randomLaunch,varyLaunchVelocity} from "../public/physics-variation.mjs";

const count=Number(process.env.LAYOUT_SHOTS??3000);
const selected=process.env.LAYOUT_ID??"all";
const maxSteps=Number(process.env.LAYOUT_MAX_STEPS??5400);
if(!Number.isInteger(count)||count<1||count>50000)throw Error("Invalid LAYOUT_SHOTS");
if(!Number.isInteger(maxSteps)||maxSteps<100||maxSteps>10000)throw Error("Invalid LAYOUT_MAX_STEPS");
if(selected!=="all"&&!BOARD_LAYOUT_IDS.includes(selected))throw Error("Invalid LAYOUT_ID");
const ids=selected==="all"?BOARD_LAYOUT_IDS:[selected];
const seedRng=seed=>()=>{
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  return seed/4294967296;
};
function runOne(layout,index){
  // Balanced powers, identical across layouts, avoids choosing only one
  // convenient power. Seed is identical per shot across layouts.
  const power=.075+.925*(((index*13)%20)+.5)/20;
  const rng=seedRng((0xD1B54A35^Math.imul(index+1,2654435761))>>>0);
  const random=randomLaunch(rng);
  const ball=createPhysicalBall(varyLaunchVelocity(firingVelocity(power),random),random);
  let steps=0,hitCount=0;
  for(;steps<maxSteps;steps++){
    const state=stepPhysicalBall(ball,1/180,layout,rng);
    if(state.impacts?.length)hitCount+=state.impacts.length;
    if(!Number.isFinite(ball.x)||!Number.isFinite(ball.y)||
       !Number.isFinite(ball.vx)||!Number.isFinite(ball.vy))
      return {error:"nonfinite",power,steps,hitCount};
    if(state.settled)
      return {slot:state.slot,power,steps:steps+1,hitCount};
  }
  return {error:"timeout",power,steps:maxSteps,hitCount};
}
function statistics(id){
  const layout=createPegLayout(PHYSICS.fieldRight,id);
  const buckets=Array(11).fill(0),powerBuckets=Array.from({length:4},()=>Array(11).fill(0));
  let invalid=0,timeouts=0,impacts=0,steps=0;
  const start=performance.now();
  for(let i=0;i<count;i++){
    const r=runOne(layout,i);
    steps+=r.steps;impacts+=r.hitCount;
    if(r.error){invalid++;if(r.error==="timeout")timeouts++;}
    else{
      buckets[r.slot]++;
      const band=Math.min(3,Math.floor(((i*13)%20)/5));
      powerBuckets[band][r.slot]++;
    }
    if((i+1)%Math.max(100,Math.floor(count/5))===0)
      console.log("LAYOUT_PROGRESS "+id+" "+(i+1)+"/"+count);
  }
  const n=count-invalid;
  const percent=buckets.map(v=>n?+(100*v/n).toFixed(3):0);
  const expected=100/11;
  const totalVariation=n?+(percent.reduce((a,v)=>a+Math.abs(v-expected),0)/2).toFixed(3):0;
  const edge=n?+((buckets[0]+buckets[10])*100/n).toFixed(3):0;
  const right=n?+(buckets.slice(6).reduce((a,b)=>a+b,0)*100/n).toFixed(3):0;
  const sum=buckets.reduce((a,b)=>a+b,0);
  const elapsedMs=Math.round(performance.now()-start);
  const result={layout:id,name:getBoardLayout(id).name,shots:count,settled:n,invalid,timeouts,
    pegCount:layout.pegs.length,bumperCount:layout.bumpers.length,
    counts:buckets,percent,totalVariationFromUniformPct:totalVariation,
    edgeSlotsPct:edge,rightFiveSlotsPct:right,
    maxSlotIndex:buckets.indexOf(Math.max(...buckets))+1,
    maxSlotPct:Math.max(...percent),
    meanImpacts:+(impacts/count).toFixed(2),
    meanSteps:+(steps/count).toFixed(2),elapsedMs,
    powers:["low","mid-low","mid-high","high"].map((name,j)=>({
      name,counts:powerBuckets[j],
      shots:powerBuckets[j].reduce((a,b)=>a+b,0)
    })),
    uniformReferencePct:+expected.toFixed(3),
    method:"Fixed 180Hz production physics; 20 balanced launch-power levels; paired seeded random variation; up to "+maxSteps+" steps per shot.",
  };
  if(sum+invalid!==count)throw Error("Shot totals do not reconcile");
  if(invalid>0)throw Error(id+" has "+invalid+" physically unsettled or invalid shots");
  return result;
}
mkdirSync("layout-distribution-output",{recursive:true});
for(const id of ids){
  const r=statistics(id);
  const header=["layout","shots","settled","timeouts","max_slot","max_slot_percent","edge_percent","TV_uniform_pct","elapsed_ms"];
  const csv=[header.join(","),[id,r.shots,r.settled,r.timeouts,r.maxSlotIndex,
    r.maxSlotPct,r.edgeSlotsPct,r.totalVariationFromUniformPct,r.elapsedMs].join(","),
    "",["slot",...Array.from({length:11},(_,i)=>i+1)].join(","),
    ["count",...r.counts].join(","),["percentage",...r.percent].join(",")].join("\n")+"\n";
  writeFileSync("layout-distribution-output/"+id+".json",JSON.stringify(r,null,2)+"\n");
  writeFileSync("layout-distribution-output/"+id+".csv",csv);
  console.log("LAYOUT_DISTRIBUTION "+JSON.stringify(r));
}
