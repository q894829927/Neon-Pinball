/** Gravity-deposited marble positions for the payout tray, never a grid.
 * Each bead enters at the central nozzle and rolls downhill against other beads.
 * The generated coordinates remain stable throughout and after the animation.
 */
import {basinPacking} from "./payout-basin.mjs";
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function scatter(index){
  let x=Math.imul((index+1)>>>0,0x9e3779b1)>>>0;
  x^=x>>>16;x=Math.imul(x,0x85ebca6b)>>>0;x^=x>>>13;
  return (x>>>0)/4294967296;
}
export function createFallenPile(width,height,reward){
  const packing=basinPacking(width,height,reward);
  const r=packing.radius;
  const visible=packing.visible;
  const floor=height-r-1,top=r+1,left=r+1,right=width-r-1;
  const clearance=2*r+.09,cellSize=clearance;
  const bins=new Map(),balls=[];
  const neighbours=(x)=>{
    const cell=Math.floor(x/cellSize),found=[];
    for(let c=cell-2;c<=cell+2;c++){
      const group=bins.get(c);
      if(group)found.push(...group);
    }
    return found;
  };
  const contactY=(x)=>{
    let y=floor;
    for(const ball of neighbours(x)){
      const dx=x-ball.x,dist=Math.abs(dx);
      if(dist<clearance){
        const touch=ball.y-Math.sqrt(Math.max(0,clearance*clearance-dx*dx));
        y=Math.min(y,touch);
      }
    }
    return y;
  };
  for(let i=0;i<visible;i++){
    // Increasing outlet scatter imitates beads spreading to both sides of
    // the basin; it does not create discrete columns or rows.
    const spread=Math.min(width*.475,Math.max(r*1.9,Math.pow(i+1,.75)*r*1.1));
    const origin=width/2+(scatter(i)*2-1)*spread;
    let x=clamp(origin,left,right),y=contactY(x);
    const step=Math.max(.25,r*.52);
    for(let j=0;j<12;j++){
      // Roll into a nearby pocket, not all the way to the opposite wall.
      const limit=Math.min(width*.48,spread+r*1.2);
      const lx=clamp(x-step,Math.max(left,width/2-limit),Math.min(right,width/2+limit));
      const rx=clamp(x+step,Math.max(left,width/2-limit),Math.min(right,width/2+limit));
      const ly=contactY(lx),ry=contactY(rx);
      if(ly<=y+.09&&ry<=y+.09)break;
      if(ly>ry+.12){x=lx;y=ly;}
      else if(ry>ly+.12){x=rx;y=ry;}
      else{const chooseLeft=scatter(i+j*17)>.5;x=chooseLeft?lx:rx;y=chooseLeft?ly:ry;}
    }
    // If the immediate channel fills up, continue the fall in a nearby
    // lower pocket instead of forcing beads to overlap above the rim.
    if(y<top+.01){
      let bestY=y,bestX=x;
      for(let j=0;j<Math.min(80,Math.ceil(width/Math.max(.4,r)));j++){
        const trial=clamp(left+(right-left)*(j+.3*scatter(i+j*31))/Math.min(80,Math.ceil(width/Math.max(.4,r))),left,right);
        const yy=contactY(trial);
        if(yy>bestY){bestX=trial;bestY=yy;}
      }
      x=bestX;y=bestY;
    }
    const ball={x,y:clamp(y,top,floor),r,entryX:clamp(width/2+(scatter(i+113)-.5)*r*2,left,right)};
    balls.push(ball);
    const cell=Math.floor(x/cellSize);
    if(!bins.has(cell))bins.set(cell,[]);
    bins.get(cell).push(ball);
  }
  return Object.freeze({width,height,reward,radius:r,visible,balls});
}
/** Display the exact same final location while dropping in, not a second
 * "tidy" replacement arrangement when the celebration ends. */
export function fallingBeadPosition(ball,index,total,now,startAt,reduceMotion=false){
  if(reduceMotion)return {x:ball.x,y:ball.y};
  const bornAt=startAt+430+(1220*(index+.5)/Math.max(1,total));
  const t=clamp((now-bornAt)/265,0,1);
  if(t>=1)return {x:ball.x,y:ball.y};
  const remain=1-t;
  const x=ball.x+(ball.entryX-ball.x)*remain*remain;
  const ease=1-remain*remain*remain;
  const bounce=t>.78?Math.sin((t-.78)/.22*Math.PI)*ball.r*.25:0;
  return {x,y:ball.r+1+(ball.y-ball.r-1)*ease-bounce};
}
