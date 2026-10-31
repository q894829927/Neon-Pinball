#!/usr/bin/env node
/** Offline search for a geometry-only, more uniform physical peg layout.
 * Experimental script: does not modify game outcomes or any player's save.
 * Training and final holdout seeds are intentionally disjoint.
 */
import {createPegLayout} from "../public/board-layout.mjs";
import {PHYSICS,createPhysicalBall,stepPhysicalBall} from "../public/physics-engine.mjs";
import {firingVelocity} from "../public/plunger.mjs";
import {randomLaunch,varyLaunchVelocity} from "../public/physics-variation.mjs";
import {writeFileSync,mkdirSync} from "node:fs";
const rng=(seed)=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const searchRng=rng(9043);
const rand=(lo,hi)=>lo+(hi-lo)*searchRng();
const sample=(a)=>a[Math.floor(searchRng()*a.length)];
const classic=createPegLayout(PHYSICS.fieldRight,"classic");
const aBase=[...classic.pegs,...classic.bumpers];
const cost=counts=>{
  const n=counts.reduce((a,b)=>a+b,0);
  if(!n)return 999;
  const probs=counts.map(x=>x/n);
  const target=1/11;
  const tv=probs.reduce((v,p)=>v+Math.abs(p-target),0)/2;
  const max=Math.max(...probs),min=Math.min(...probs);
  return +(tv*100 + (max-min)*65 + Math.max(0,max-.16)*75 +
    Math.max(0,.055-min)*450).toFixed(4);
};
const point=(x,y,r)=>({x:+x.toFixed(1),y:+y.toFixed(1),r:+r.toFixed(1)});
const okay=(p,pegs)=>p.x>=48&&p.x<=348&&p.y>=143&&p.y<=608&&pegs.every(b=>Math.hypot(b.x-p.x,b.y-p.y)>b.r+p.r+2);
const seeds=[
  [{x:344,y:160.6,r:9.4},{x:343.3,y:600.8,r:8.2}],
  [{x:344,y:160.6,r:9.4},{x:343.3,y:600.8,r:8.2},{x:67,y:601,r:6.2}],
  [{x:344,y:160.6,r:9.4},{x:343.3,y:600.8,r:8.2},{x:86,y:594,r:6.2}],
  [{x:344,y:160.6,r:9.4},{x:343.3,y:600.8,r:8.2},{x:106,y:601,r:6.2}],
  [{x:344,y:160.6,r:9.4},{x:343.3,y:600.8,r:8.2},{x:126,y:600,r:5.8}],
];
function randomCandidate(){
  for(let attempt=0;attempt<100;attempt++){
    const pins=[];
    const top=point(rand(338,348),rand(154,166.5),rand(8,11));
    if(okay(top,[...aBase,...pins]))pins.push(top);
    const right=point(rand(337,348),rand(593,605),rand(6,10));
    if(okay(right,[...aBase,...pins]))pins.push(right);
    // Independent lightweight left bumper to prevent newly created first-slot
    // pileup; unlike a magnet, it acts only if there is an actual collision.
    if(searchRng()<.7){
      const left=point(rand(54,155),rand(585,607),rand(5,9));
      if(okay(left,[...aBase,...pins]))pins.push(left);
    }
    if(pins.length>=2)return pins;
  }
  return seeds[0];
}
function run(pins,shots,offset,timeout=3700){
  const layout={pegs:[...classic.pegs,...pins.map((p,i)=>({...p,row:-1,col:i}))],
    bumpers:classic.bumpers};
  const counts=Array(11).fill(0);
  let invalid=0,impacts=0;
  for(let i=offset;i<offset+shots;i++){
    const force=.075+.925*(((i*13)%20)+.5)/20;
    const sr=rng((0xD1B54A35^Math.imul(i+1,2654435761))>>>0);
    const variation=randomLaunch(sr);
    const ball=createPhysicalBall(varyLaunchVelocity(firingVelocity(force),variation),variation);
    let result;
    for(let step=0;step<timeout;step++){
      result=stepPhysicalBall(ball,1/180,layout,sr);
      impacts+=result.impacts?.length??0;
      if(result.settled)break;
    }
    if(result?.settled)counts[result.slot]++;
    else invalid++;
  }
  return {counts,invalid,score:cost(counts)+invalid*.85,max:Math.max(...counts)/shots,
    min:Math.min(...counts)/shots,meanImpacts:+(impacts/shots).toFixed(2)};
}
const candidates=[];
for(let i=0;i<135;i++){
  const pins=i<seeds.length?seeds[i]:randomCandidate();
  const res=run(pins,155,0);
  candidates.push({pins,...res});
  if((i+1)%27===0)console.log("SEARCH_COARSE "+(i+1)+"/135 best="+Math.min(...candidates.map(x=>x.score)));
}
candidates.sort((a,b)=>a.score-b.score);
const refined=[];
for(let i=0;i<Math.min(12,candidates.length);i++){
  const a=candidates[i];
  const b=run(a.pins,1100,5000);
  refined.push({pins:a.pins,coarse:a.score,...b});
  console.log("SEARCH_REFINE "+i+" score="+b.score+" invalid="+b.invalid);
}
refined.sort((a,b)=>a.score-b.score);
const validated=[];
for(let i=0;i<Math.min(4,refined.length);i++){
  const a=refined[i];
  const b=run(a.pins,3000,13000,5400);
  validated.push({pins:a.pins,refined:a.score,...b});
  console.log("SEARCH_HOLDOUT "+JSON.stringify(validated[i]));
}
validated.sort((a,b)=>a.score-b.score);
const baseline=run([],3000,13000,5400);
console.log("SEARCH_BASELINE "+JSON.stringify(baseline));
console.log("SEARCH_BEST "+JSON.stringify(validated[0]));
mkdirSync("balanced-layout-search-output",{recursive:true});
writeFileSync("balanced-layout-search-output/results.json",JSON.stringify({baseline,validated,refined,candidates:candidates.slice(0,15)},null,2)+"\n");
