/**
 * Live payout marble physics with a FIXED bead radius independent of award size.
 *
 * The receiver has a bottom-supported basin, open space above the lip and
 * short physical side walls. Once a pile rises above those walls, beads can
 * roll over the rim. Spilled beads remain in the visible receiver when possible
 * and may roll off the cabinet edge; they never reduce the credited reward.
 */
export const PAYOUT_RADIUS=3.05;
const STEP=1/120,GRAVITY=790,RESTITUTION=.15,WALL_BOUNCE=.23;
const MAX_SIMULATED=850;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
function rand(index,salt=0){
  let x=(index+1+salt*2903)>>>0;
  x=Math.imul(x^(x>>>16),0x85ebca6b);
  x=Math.imul(x^(x>>>13),0xc2b2ae35);
  return ((x^(x>>>16))>>>0)/4294967296;
}
function normalizedTray(width,height,tray){
  if(!tray)return {left:0,right:width,top:0,bottom:height,open:false};
  const left=clamp(tray.left,0,width-12),right=clamp(tray.right,left+12,width);
  const top=clamp(tray.top,1,height-8),bottom=clamp(tray.bottom,top+8,height);
  return {left,right,top,bottom,open:true};
}
export function createPayoutWorld(width,height,reward,tray=null){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<12||height<8||
      !Number.isSafeInteger(reward)||reward<=0)throw Error("Invalid payout geometry");
  const radius=PAYOUT_RADIUS,limits=normalizedTray(width,height,tray);
  return {
    width,height,reward,visible:Math.min(reward,MAX_SIMULATED),radius,
    tray:limits,balls:[],frames:0,contacts:0,wallHits:0,spilled:0,elapsed:0,
    cellSize:2*radius+.12,
  };
}
export function spawnPayoutBall(world){
  if(world.balls.length>=world.visible)return null;
  const index=world.balls.length,r=world.radius,t=world.tray;
  const ball={
    index,x:clamp((t.left+t.right)/2+(rand(index,1)-.5)*r*1.5,r,world.width-r),
    y:t.open?Math.max(r+.4,t.top-r*2.3):r+.4,
    vx:(rand(index,2)-.5)*64,vy:12+rand(index,3)*24,
    radius:r,contacts:0,spilled:false,
  };
  world.balls.push(ball);
  return ball;
}
function bounceWall(ball,nx,ny,world,elasticity){
  const normal=ball.vx*nx+ball.vy*ny;
  if(normal<0){
    ball.vx-=(1+elasticity)*normal*nx;
    ball.vy-=(1+elasticity)*normal*ny;
  }
  ball.contacts++;world.wallHits++;
}
// The physical basin walls are finite line segments, not infinite clip planes.
// Above the lip there is no barrier; marbles can roll out after piling up.
function segmentContact(world,ball,x1,y1,x2,y2){
  const tx=x2-x1,ty=y2-y1,len2=tx*tx+ty*ty;
  const u=clamp(((ball.x-x1)*tx+(ball.y-y1)*ty)/len2,0,1);
  const nearX=x1+tx*u,nearY=y1+ty*u;
  let nx=ball.x-nearX,ny=ball.y-nearY,dist=Math.hypot(nx,ny);
  if(dist>=world.radius)return;
  if(dist<.0001){
    nx=ball.x<=(x1+x2)/2?-1:1;ny=0;dist=1;
  }else{nx/=dist;ny/=dist;}
  const correction=world.radius-dist;
  ball.x+=nx*correction;ball.y+=ny*correction;
  bounceWall(ball,nx,ny,world,WALL_BOUNCE);
}
function boundaries(world,ball){
  if(ball.spilled)return;
  const r=world.radius,t=world.tray,roomBottom=world.height-r-.2;
  if(!t.open){
    const lo=r+.3,hi=world.width-r-.3,top=r+.3,bottom=world.height-r-.3;
    if(ball.x<lo){ball.x=lo;if(ball.vx<0)ball.vx=-ball.vx*WALL_BOUNCE;world.wallHits++;}
    if(ball.x>hi){ball.x=hi;if(ball.vx>0)ball.vx=-ball.vx*WALL_BOUNCE;world.wallHits++;}
    if(ball.y<top){ball.y=top;if(ball.vy<0)ball.vy=-ball.vy*.12;}
    if(ball.y>bottom){
      ball.y=bottom;
      if(ball.vy>0){ball.vy=ball.vy>24?-ball.vy*.24:0;ball.vx*=.84;
        ball.contacts++;world.contacts++;}
    }
    return;
  }
  // Visible receiver top. Overflow travels sideways over the basin lip.
  if(ball.y<r+.2){ball.y=r+.2;if(ball.vy<0)ball.vy=-ball.vy*.08;}
  // Basin has a floor but its upper rim is intentionally open.
  const inside=ball.x>=t.left+r*.2&&ball.x<=t.right-r*.2;
  const floor=inside?t.bottom-r:roomBottom;
  if(ball.y>floor){
    ball.y=floor;
    if(ball.vy>0){
      ball.vy=ball.vy>24?-ball.vy*.23:0;
      ball.vx*=.82;ball.contacts++;world.contacts++;
    }
  }
  segmentContact(world,ball,t.left,t.top,t.left,t.bottom);
  segmentContact(world,ball,t.right,t.top,t.right,t.bottom);
  // Escaped marbles have crossed the receiver edge after rolling over the rim.
  if(ball.x<-r||ball.x>world.width+r||ball.y>world.height+r){
    ball.spilled=true;world.spilled++;
  }
}
function solveContacts(world){
  const balls=world.balls,cell=world.cellSize,r=world.radius;
  const minDist=2*r+.025,minDist2=minDist*minDist;
  // Spatial hashing works even if an overflowed bead leaves the basin width.
  for(let iteration=0;iteration<2;iteration++){
    const bins=new Map();
    const key=(x,y)=>x+":"+y;
    for(let i=0;i<balls.length;i++){
      const b=balls[i];if(b.spilled)continue;
      const k=key(Math.floor(b.x/cell),Math.floor(b.y/cell));
      if(!bins.has(k))bins.set(k,[]);
      bins.get(k).push(i);
    }
    for(let i=0;i<balls.length;i++){
      const a=balls[i];if(a.spilled)continue;
      const x=Math.floor(a.x/cell),y=Math.floor(a.y/cell);
      for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
        const neighbours=bins.get(key(x+ox,y+oy));if(!neighbours)continue;
        for(const j of neighbours){
          if(j<=i)continue;
          const b=balls[j];if(b.spilled)continue;
          let dx=b.x-a.x,dy=b.y-a.y,d2=dx*dx+dy*dy;
          if(d2>=minDist2)continue;
          if(d2<1e-10){
            const theta=rand(i+j,iteration)*Math.PI*2;
            dx=Math.cos(theta)*.001;dy=Math.sin(theta)*.001;d2=1e-6;
          }
          const d=Math.sqrt(d2),nx=dx/d,ny=dy/d;
          const correction=(minDist-d)*.5;
          a.x-=correction*nx;a.y-=correction*ny;
          b.x+=correction*nx;b.y+=correction*ny;
          const vn=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
          if(vn<0){
            const impulse=-(1+RESTITUTION)*vn*.5;
            a.vx-=impulse*nx;a.vy-=impulse*ny;
            b.vx+=impulse*nx;b.vy+=impulse*ny;
          }
          const tangentX=-ny,tangentY=nx;
          const slide=(b.vx-a.vx)*tangentX+(b.vy-a.vy)*tangentY;
          a.vx+=slide*.055*tangentX;a.vy+=slide*.055*tangentY;
          b.vx-=slide*.055*tangentX;b.vy-=slide*.055*tangentY;
          a.contacts++;b.contacts++;world.contacts++;
        }
      }
    }
    for(const ball of balls)boundaries(world,ball);
  }
}
function integrate(world){
  for(const ball of world.balls){
    if(ball.spilled)continue;
    ball.vx*=.982;
    ball.vy=clamp(ball.vy+GRAVITY*STEP,-400,440);
    ball.x+=ball.vx*STEP;
    ball.y+=ball.vy*STEP;
    boundaries(world,ball);
  }
  if(world.balls.length>1)solveContacts(world);
  for(const ball of world.balls){
    if(ball.spilled)continue;
    boundaries(world,ball);
    ball.vx=clamp(ball.vx,-420,420);
    ball.vy=clamp(ball.vy,-420,420);
  }
  world.frames++;world.elapsed+=STEP;
}
export function stepPayoutWorld(world,seconds,targetCount=world.balls.length){
  if(!Number.isFinite(seconds)||seconds<0)throw Error("Invalid elapsed time");
  if(seconds===0)return world;
  const target=clamp(Math.floor(targetCount),world.balls.length,world.visible);
  const substeps=Math.max(1,Math.min(8,Math.ceil(clamp(seconds,.0001,.06)/STEP)));
  const first=world.balls.length,additions=target-first;
  for(let i=0;i<substeps;i++){
    const next=first+Math.floor(additions*(i+1)/substeps);
    while(world.balls.length<next)spawnPayoutBall(world);
    integrate(world);
  }
  return world;
}
export function finishPayoutWorld(world,settlingSteps=180){
  const steps=Math.max(1,Math.min(600,Math.floor(settlingSteps)));
  const first=world.balls.length,addition=world.visible-first;
  for(let i=0;i<steps;i++){
    const target=first+Math.floor(addition*(i+1)/steps);
    while(world.balls.length<target)spawnPayoutBall(world);
    integrate(world);
  }
  return world;
}
export function reflowPayoutWorld(world,width,height,tray=null){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<12||height<8)return world;
  const oldW=world.width,oldH=world.height;
  const previous=world.tray,oldTrayWidth=previous.right-previous.left;
  const updated=normalizedTray(width,height,tray??(previous.open?{
    left:previous.left*width/oldW,
    right:previous.right*width/oldW,
    top:previous.top*height/oldH,
    bottom:previous.bottom*height/oldH,
  }:null));
  world.width=width;world.height=height;world.tray=updated;
  // Bead size remains exactly the same through resize and reward changes.
  for(const ball of world.balls){
    ball.x*=width/oldW;ball.y*=height/oldH;
    ball.vx*=width/oldW;ball.vy*=height/oldH;
    ball.radius=PAYOUT_RADIUS;
    if(!ball.spilled)boundaries(world,ball);
  }
  return world;
}
export function withinPayoutBasin(ball,world){
  const r=world.radius;
  if(ball.spilled)return true;
  return [ball.x,ball.y,ball.vx,ball.vy].every(Number.isFinite)&&
    ball.x>=-r-.1&&ball.x<=world.width+r+.1&&
    ball.y>=r-.1&&ball.y<=world.height-r+.1;
}
export function payoutOverflow(world){
  const t=world.tray;
  return world.balls.filter(b=>b.spilled||
    (t.open&&(b.y<t.top-world.radius*.4||
      b.x<t.left-world.radius*.5||b.x>t.right+world.radius*.5))).length;
}
