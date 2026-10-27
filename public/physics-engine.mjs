/* 2D steel sphere on a tilted pinboard. No payout logic in the solver.
   Normal restitution + Coulomb friction + angular impulse (I=.4mr²).
   Real collision geometry includes every bottom divider and the slot floor. */
import {varyPegRebound} from "./physics-variation.mjs?v=0.8.0";
export const PHYSICS=Object.freeze({
 radius:7.1,gravity:1060,railGravity:640,railResistance:.12,
 airDrag:.08,rollingDrag:26,inertiaRatio:.4,
 pegRestitution:.76,bumperRestitution:.92,dividerRestitution:.38,wallRestitution:.60,
 pegFriction:.22,bumperFriction:.18,dividerFriction:.42,
 maxNumericalSpeed:2350,slotLeft:28,slotRight:365,slotTop:619,slotBottom:681,slotCount:11,
 fieldLeft:25,fieldRight:368,fieldTop:126,
});
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const lerp=(a,b,t)=>a+(b-a)*t;
/* A smooth upper steel guide joins the right vertical lane.
   Arc-length position and acceleration derived from the track tangent,
   without snapping the ball to a new velocity at the top. */
function railAt(t){
 if(t<.78)return {x:393,y:lerp(606,154,t/.78)};
 const u=(t-.78)/.22,v=1-u;
 return {x:v*v*v*393+3*v*v*u*393+3*v*u*u*364+u*u*u*345,
         y:v*v*v*154+3*v*v*u*104+3*v*u*u*102+u*u*u*133};
}
let railLength=0;
const rail=[{...railAt(0),s:0}];
for(let i=1;i<=240;i++){
 const p=railAt(i/240),prev=rail.at(-1);
 railLength+=Math.hypot(p.x-prev.x,p.y-prev.y);
 rail.push({...p,s:railLength});
}
export const RAIL_LENGTH=railLength;
export const RAIL_POINTS=Object.freeze(rail.map(p=>Object.freeze(p)));
export function sampleRail(s){
 const d=clamp(s,0,railLength);let lo=0,hi=rail.length-1;
 while(lo<hi){const m=(lo+hi)>>1;if(rail[m].s<d)lo=m+1;else hi=m;}
 const b=rail[Math.max(1,lo)],a=rail[Math.max(0,lo-1)];
 const denom=Math.max(1e-8,b.s-a.s),f=clamp((d-a.s)/denom,0,1);
 return {x:lerp(a.x,b.x,f),y:lerp(a.y,b.y,f),
         tx:(b.x-a.x)/denom,ty:(b.y-a.y)/denom};
}
export function createPhysicalBall(velocity,variation={angle:0,entryScale:1}){
 return {x:393,y:606,vx:0,vy:velocity.laneVy,r:PHYSICS.radius,
   omega:0,spin:0,mode:"lane",railS:0,railSpeed:Math.max(0,-velocity.laneVy),
   variation:{angle:clamp(variation.angle||0,-.02,.02),
              entryScale:clamp(variation.entryScale||1,.98,1.02)},
   slot:-1,settleTime:0,impactCount:0};
}
export function resolveCircle(ball,peg,restitution=.76,friction=.22,rng=Math.random){
 const dx=ball.x-peg.x,dy=ball.y-peg.y,minDist=ball.r+peg.r,d2=dx*dx+dy*dy;
 if(d2>=minDist*minDist)return null;
 const dist=Math.sqrt(d2),nx=dist>1e-8?dx/dist:0,ny=dist>1e-8?dy/dist:-1;
 ball.x+=nx*(minDist-dist+1e-4);ball.y+=ny*(minDist-dist+1e-4);
 const vn=ball.vx*nx+ball.vy*ny;
 if(vn>=0)return null;
 const normalImpulse=-(1+restitution)*vn;
 ball.vx+=normalImpulse*nx;ball.vy+=normalImpulse*ny;
 const tx=-ny,ty=nx,slip=ball.vx*tx+ball.vy*ty-ball.omega*ball.r;
 const tangentImpulse=clamp(-slip/(1+1/PHYSICS.inertiaRatio),
   -friction*normalImpulse,friction*normalImpulse);
 ball.vx+=tangentImpulse*tx;ball.vy+=tangentImpulse*ty;
 ball.omega-=tangentImpulse/(PHYSICS.inertiaRatio*ball.r);
 if(-vn>35){
   const perturbed=varyPegRebound(ball.vx,ball.vy,nx,ny,-vn,rng);
   ball.vx=perturbed.vx;ball.vy=perturbed.vy;
 }
 ball.impactCount++;
 return {speed:-vn,x:peg.x,y:peg.y,bumper:restitution>=.9};
}
export function resolveSegment(ball,segment,restitution=.38,friction=.42,rng=Math.random){
 const dx=segment.bx-segment.ax,dy=segment.by-segment.ay;
 const t=clamp(((ball.x-segment.ax)*dx+(ball.y-segment.ay)*dy)/
   Math.max(1e-9,dx*dx+dy*dy),0,1);
 return resolveCircle(ball,{x:segment.ax+t*dx,y:segment.ay+t*dy,r:segment.r||1.15},
   restitution,friction,rng);
}
export function stepPhysicalBall(ball,dt,layout,rng=Math.random){
 const impacts=[];
 if(ball.mode==="done")return {settled:true,slot:ball.slot,impacts};
 if(ball.mode==="lane"){
   const at=sampleRail(ball.railS);
   ball.railSpeed+=(PHYSICS.railGravity*at.ty-PHYSICS.railResistance*ball.railSpeed)*dt;
   ball.railS+=ball.railSpeed*dt;
   if(ball.railS<0){ball.railS=0;ball.railSpeed=0;}
   if(ball.railS>=RAIL_LENGTH){
     const end=sampleRail(RAIL_LENGTH),angle=ball.variation.angle;
     const vx=end.tx*ball.railSpeed*ball.variation.entryScale;
     const vy=end.ty*ball.railSpeed*ball.variation.entryScale;
     ball.vx=vx*Math.cos(angle)-vy*Math.sin(angle);
     ball.vy=vx*Math.sin(angle)+vy*Math.cos(angle);
     ball.x=end.x;ball.y=end.y;ball.mode="field";
     ball.omega=-ball.railSpeed/ball.r;
     return {entered:true,impacts};
   }
   const p=sampleRail(ball.railS);
   ball.x=p.x;ball.y=p.y;
   ball.vx=p.tx*ball.railSpeed;ball.vy=p.ty*ball.railSpeed;
   ball.omega=-ball.railSpeed/ball.r;ball.spin+=ball.omega*dt;
   return {impacts};
 }
 if(ball.mode!=="field")return {impacts};
 // Half-step collision substepping reduces tunneling through small pegs.
 for(let sub=0;sub<2;sub++){
   const h=dt/2,drag=Math.exp(-PHYSICS.airDrag*h);
   ball.vx*=drag;ball.vy=(ball.vy+PHYSICS.gravity*h)*drag;
   ball.x+=ball.vx*h;ball.y+=ball.vy*h;
   ball.spin+=ball.omega*h;ball.omega*=Math.exp(-.38*h);
   if(ball.x<PHYSICS.fieldLeft+ball.r){
     ball.x=PHYSICS.fieldLeft+ball.r;
     if(ball.vx<0){ball.vx=-ball.vx*PHYSICS.wallRestitution;ball.vy*=.91;ball.omega*=.82;}
   }
   if(ball.x>PHYSICS.fieldRight-ball.r){
     ball.x=PHYSICS.fieldRight-ball.r;
     if(ball.vx>0){ball.vx=-ball.vx*PHYSICS.wallRestitution;ball.vy*=.91;ball.omega*=.82;}
   }
   if(ball.y<PHYSICS.fieldTop+ball.r){
     ball.y=PHYSICS.fieldTop+ball.r;
     if(ball.vy<0){ball.vy=-ball.vy*PHYSICS.wallRestitution;ball.vx*=.9;}
   }
   for(const p of layout.pegs){
     const e=resolveCircle(ball,p,PHYSICS.pegRestitution,PHYSICS.pegFriction,rng);
     if(e)impacts.push(e);
   }
   for(const p of layout.bumpers){
     const e=resolveCircle(ball,p,PHYSICS.bumperRestitution,PHYSICS.bumperFriction,rng);
     if(e)impacts.push(e);
   }
   // Each divider exists as a full vertical capsule rather than a top pin.
   for(let i=1;i<PHYSICS.slotCount;i++){
     const x=PHYSICS.slotLeft+i*(PHYSICS.slotRight-PHYSICS.slotLeft)/PHYSICS.slotCount;
     const e=resolveSegment(ball,{ax:x,ay:PHYSICS.slotTop,bx:x,by:PHYSICS.slotBottom,r:1.15},
       PHYSICS.dividerRestitution,PHYSICS.dividerFriction,rng);
     if(e)impacts.push(e);
   }
   if(ball.y>=PHYSICS.slotBottom-ball.r){
     ball.y=PHYSICS.slotBottom-ball.r;
     if(ball.vy>0){
       ball.vy=ball.vy>42?-ball.vy*.18:0;
       ball.vx*=.69;ball.omega*=.5;
     }
     ball.vx-=Math.sign(ball.vx)*Math.min(Math.abs(ball.vx),26*h);
     if(Math.abs(ball.vy)<20&&Math.abs(ball.vx)<35)ball.settleTime+=h;
     else ball.settleTime=0;
   }else ball.settleTime=0;
   const speed=Math.hypot(ball.vx,ball.vy);
   if(speed>PHYSICS.maxNumericalSpeed){
     const scale=PHYSICS.maxNumericalSpeed/speed;
     ball.vx*=scale;ball.vy*=scale;
   }
   if(ball.settleTime>=.09){
     ball.slot=clamp(Math.floor((ball.x-PHYSICS.slotLeft)/
       ((PHYSICS.slotRight-PHYSICS.slotLeft)/PHYSICS.slotCount)),
       0,PHYSICS.slotCount-1);
     ball.mode="done";ball.vx=0;ball.vy=0;
     return {settled:true,slot:ball.slot,impacts};
   }
 }
 return {impacts};
}
