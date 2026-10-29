/**
 * Small 2D circle physics solver for reward marbles in the glass payout basin.
 * This simulates motion, not precomputed trajectories:
 * gravity, velocity, floor and wall restitution, bead/bead contact impulses.
 * Uses a spatial-hash broadphase to avoid quadratic work for 500+ beads.
 * No gameplay physics, score, odds, or inventory is imported or mutated.
 */
import {basinPacking} from "./payout-basin.mjs";

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const STEP=1/120;
const GRAVITY=790;
const MAX_SIMULATED=850; // practical physical basin limit; credits still exact
const RESTITUTION=.16;
const WALL_BOUNCE=.24;
const SURFACE_FRICTION=.982;

function hash32(value){
  let x=(value>>>0)+0x9e3779b9|0;
  x=Math.imul(x^(x>>>16),0x85ebca6b);
  x=Math.imul(x^(x>>>13),0xc2b2ae35);
  return (x^(x>>>16))>>>0;
}
function jitter(index,salt=0){return hash32((index+1+salt*2903)>>>0)/4294967296;}

export function createPayoutWorld(width,height,reward){
  if(!Number.isSafeInteger(reward)||reward<=0)throw Error("Positive payout required");
  const packing=basinPacking(width,height,reward);
  const visible=Math.min(reward,packing.capacity,MAX_SIMULATED);
  // Recompute the radius for the simulated bead count, but never increase
  // it so far that the exact reward would no longer fit in the actual basin.
  const radius=packing.radius;
  return {
    width,height,reward,visible,radius,balls:[],
    frames:0,contacts:0,wallHits:0,elapsed:0,
    cellSize:Math.max(1.1,2*radius+.12),
  };
}
export function spawnPayoutBall(world){
  if(world.balls.length>=world.visible)return null;
  const index=world.balls.length,r=world.radius;
  const minX=r+.35,maxX=world.width-r-.35;
  const x=clamp(world.width*.5+(jitter(index,1)-.5)*r*2.4,minX,maxX);
  const ball={
    index,x,y:r+.45,
    vx:(jitter(index,2)-.5)*50,
    vy:12+jitter(index,3)*18,
    radius:r,contacts:0,
  };
  world.balls.push(ball);
  return ball;
}
function boundaries(world,ball){
  const r=world.radius,lo=r+.3,hi=world.width-r-.3,top=r+.3,bottom=world.height-r-.3;
  if(ball.x<lo){
    ball.x=lo;
    if(ball.vx<0)ball.vx=-ball.vx*WALL_BOUNCE;
    ball.vy*=.96;world.wallHits++;
  }else if(ball.x>hi){
    ball.x=hi;
    if(ball.vx>0)ball.vx=-ball.vx*WALL_BOUNCE;
    ball.vy*=.96;world.wallHits++;
  }
  if(ball.y<top){
    ball.y=top;
    if(ball.vy<0)ball.vy=-ball.vy*.12;
  }else if(ball.y>bottom){
    ball.y=bottom;
    if(ball.vy>0){
      ball.vy=ball.vy>24?-ball.vy*.23:0;
      ball.vx*=.84;
      ball.contacts++;world.contacts++;
    }
  }
}
function resolvePairs(world){
  const balls=world.balls,cell=world.cellSize,r=world.radius;
  const stride=Math.ceil(world.width/cell)+4;
  const nearest=2*r+.035,nearest2=nearest*nearest;
  // Two iterations produce stable bead piles without scanning all N² pairs.
  for(let iter=0;iter<2;iter++){
    const bins=new Map();
    for(let i=0;i<balls.length;i++){
      const a=balls[i],col=Math.floor(a.x/cell),row=Math.floor(a.y/cell);
      const key=row*stride+col;
      let stack=bins.get(key);
      if(!stack)bins.set(key,stack=[]);
      stack.push(i);
    }
    for(let i=0;i<balls.length;i++){
      const a=balls[i],col=Math.floor(a.x/cell),row=Math.floor(a.y/cell);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const members=bins.get((row+dy)*stride+col+dx);
        if(!members)continue;
        for(const j of members){
          if(j<=i)continue;
          const b=balls[j];let nx=b.x-a.x,ny=b.y-a.y;
          let dist2=nx*nx+ny*ny;
          if(dist2>=nearest2)continue;
          if(dist2<1e-10){
            const theta=2*Math.PI*jitter(i+j,iter);
            nx=Math.cos(theta)*.001;ny=Math.sin(theta)*.001;
            dist2=1e-6;
          }
          const dist=Math.sqrt(dist2),overlap=nearest-dist;
          nx/=dist;ny/=dist;
          const correction=overlap*.5;
          a.x-=nx*correction;a.y-=ny*correction;
          b.x+=nx*correction;b.y+=ny*correction;
          const vn=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
          if(vn<0){
            const impulse=-(1+RESTITUTION)*vn*.5;
            a.vx-=impulse*nx;a.vy-=impulse*ny;
            b.vx+=impulse*nx;b.vy+=impulse*ny;
            // Tangential friction suppresses continuous jitter in a dense pile.
            const tx=-ny,ty=nx;
            const slide=(b.vx-a.vx)*tx+(b.vy-a.vy)*ty;
            const friction=slide*.06;
            a.vx+=friction*tx;a.vy+=friction*ty;
            b.vx-=friction*tx;b.vy-=friction*ty;
          }
          a.contacts++;b.contacts++;world.contacts++;
        }
      }
    }
    for(const ball of balls)boundaries(world,ball);
  }
}
function integrate(world,dt){
  for(const ball of world.balls){
    ball.vx*=Math.pow(SURFACE_FRICTION,dt*120);
    ball.vy=clamp(ball.vy+GRAVITY*dt,-400,440);
    ball.x+=ball.vx*dt;
    ball.y+=ball.vy*dt;
    boundaries(world,ball);
  }
  if(world.balls.length>1)resolvePairs(world);
  for(const ball of world.balls){
    boundaries(world,ball);
    // Keep especially dense piles from accumulating unbounded kinetic energy.
    ball.vx=clamp(ball.vx,-400,400);
    ball.vy=clamp(ball.vy,-400,400);
  }
  world.frames++;
  world.elapsed+=dt;
}
/**
 * Spawn the requested cumulative number evenly across fixed substeps.
 * Only one authoritative visual simulation state is maintained per payout.
 */
export function stepPayoutWorld(world,seconds,targetCount=world.balls.length){
  if(!Number.isFinite(seconds)||seconds<0)throw Error("Invalid elapsed time");
  const target=clamp(Math.floor(targetCount),world.balls.length,world.visible);
  if(seconds===0)return world;
  // Clamp frame delta; tab resumes won't instantly shoot marbles through walls.
  const substeps=Math.max(1,Math.min(8,Math.ceil(clamp(seconds,.0001,.06)/STEP)));
  const start=world.balls.length,adds=target-start;
  for(let i=0;i<substeps;i++){
    const next=start+Math.floor(adds*(i+1)/substeps);
    while(world.balls.length<next)spawnPayoutBall(world);
    integrate(world,STEP);
  }
  return world;
}
/**
 * Skip/reduced-motion uses the SAME physical solver, just runs it offscreen.
 * No grid replacement, magical transverse impulse, or reward recalculation.
 */
export function finishPayoutWorld(world,settlingSteps=180){
  const total=world.visible,steps=Math.max(1,Math.min(600,Math.floor(settlingSteps)));
  const prior=world.balls.length;
  for(let i=0;i<steps;i++){
    const next=prior+Math.floor((total-prior)*(i+1)/steps);
    while(world.balls.length<next)spawnPayoutBall(world);
    integrate(world,STEP);
  }
  return world;
}
export function reflowPayoutWorld(world,width,height){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<12||height<8)return world;
  const beforeW=world.width,beforeH=world.height,oldR=world.radius;
  const packing=basinPacking(width,height,world.reward);
  world.width=width;world.height=height;
  world.radius=packing.radius;world.cellSize=Math.max(1.1,2*world.radius+.12);
  world.visible=Math.min(world.reward,packing.capacity,MAX_SIMULATED);
  if(world.balls.length>world.visible)world.balls.length=world.visible;
  for(const b of world.balls){
    b.x=clamp(b.x*width/beforeW,world.radius+.3,width-world.radius-.3);
    b.y=clamp(b.y*height/beforeH,world.radius+.3,height-world.radius-.3);
    b.vx*=width/beforeW;b.vy*=height/beforeH;
    b.radius=world.radius;
  }
  return world;
}
export function withinPayoutBasin(ball,world){
  const r=world.radius;
  return [ball.x,ball.y,ball.vx,ball.vy].every(Number.isFinite)&&
    ball.x>=r-.1&&ball.x<=world.width-r+.1&&
    ball.y>=r-.1&&ball.y<=world.height-r+.1;
}
