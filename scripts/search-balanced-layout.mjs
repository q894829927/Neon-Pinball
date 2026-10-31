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
  return +(tv*100 + Math.max(0,max-.15)*90 + (max-min)*14).toFixed(4);
};
const point=(x,y,r)=>({x:+x.toFixed(1),y:+y.toFixed(1),r:+r.toFixed(1)});
const okay=(p,pegs)=>p.x>=48&&p.x<=348&&p.y>=143&&p.y<=608&&pegs.every(b=>Math.hypot(b.x-p.x,b.y-p.y)>b.r+p.r+2);
function randomCandidate(){
  for(let trials=0;trials<100;trials++){
    const pins=[];
    // Upper distributor near right-hand rail; acts only by actual contact.
    if(searchRng()<.84){
      const p=point(rand(282,343),rand(147,173),rand(6,11));
      if(okay(p,[...aBase,...pins]))pins.push(p);
    }
    // Lower guides are true circular metal pegs above slot dividers.
    const n=sample([1,2,2,3,3,4]);
    for(let i=0;i<n;i++){
      const x=i===0?rand(298,349):rand(62,349);
      const y=rand(573,604);
      const p=point(x,y,rand(6,12));
      if(okay(p,[...aBase,...pins]))pins.push(p);
    }
    if(pins.length>=1)return pins;
  }
  return [point(336,594,9)];
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
  return {counts,invalid,score:cost(counts),max:Math.max(...counts)/shots,meanImpacts:+(impacts/shots).toFixed(2)};
}
const candidates=[];
for(let i=0;i<140;i++){
  const pins=i===0?[]:randomCandidate();
  const res=run(pins,120,0);
  candidates.push({pins,...res});
  if((i+1)%28===0)console.log("SEARCH_COARSE "+(i+1)+"/140 best="+Math.min(...candidates.map(x=>x.score)));
}
candidates.sort((a,b)=>a.score-b.score);
const refined=[];
for(let i=0;i<Math.min(12,candidates.length);i++){
  const a=candidates[i];
  const b=run(a.pins,850,5000);
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
