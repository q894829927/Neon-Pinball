/** Physical-looking marble payout in the visible cabinet tray.
 * Coordinates are CSS pixels INSIDE the transparent basin, never outside it.
 * The authoritative gameplay physics, winning and card quantities are unchanged.
 */
export const TRAY_GRAVITY=850;
export const TRAY_RADIUS=3.5;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function makeTrayBall(index,width,height,radius=TRAY_RADIUS){
  if(!Number.isInteger(index)||index<0||!Number.isFinite(width)||!Number.isFinite(height)
    ||width<radius*4+8||height<radius*3+5)throw new Error("Invalid tray geometry");
  const spread=((index*7)%11-5)*.32;
  return {index,x:width*.5+spread,y:radius+2,vx:((index*17)%9-4)*12,
    vy:10+(index%4)*7,radius,settled:false,contacts:0};
}
export function stepTrayBalls(balls,dt,width,height){
  if(!Number.isFinite(dt)||dt<=0||!Number.isFinite(width)||!Number.isFinite(height))return balls;
  const step=clamp(dt,0,1/30),gravity=TRAY_GRAVITY;
  const minX=TRAY_RADIUS+2,maxX=width-TRAY_RADIUS-2;
  const floor=height-TRAY_RADIUS-2,roof=TRAY_RADIUS+1;
  for(const ball of balls){
    if(ball.settled)continue;
    ball.vy+=gravity*step;
    ball.x+=ball.vx*step;
    ball.y+=ball.vy*step;
    if(ball.x<minX){ball.x=minX;ball.vx=Math.abs(ball.vx)*.38;ball.contacts++;}
    if(ball.x>maxX){ball.x=maxX;ball.vx=-Math.abs(ball.vx)*.38;ball.contacts++;}
    if(ball.y>floor){ball.y=floor;ball.vy=-Math.abs(ball.vy)*.23;
      ball.vx*=.82;ball.contacts++;}
    if(ball.y<roof){ball.y=roof;ball.vy=Math.abs(ball.vy)*.24;}
    ball.vx*=Math.pow(.98,step*60);
  }
  // Pairwise sphere separation: creates genuine small piles in the tray.
  // Under 20 sprites; O(n²) is bounded to <190 pairs per simulation step.
  for(let pass=0;pass<2;pass++)for(let i=0;i<balls.length;i++)for(let j=i+1;j<balls.length;j++){
    const a=balls[i],b=balls[j];
    let dx=b.x-a.x,dy=b.y-a.y,dist=Math.hypot(dx,dy);
    const target=a.radius+b.radius;
    if(dist>=target)continue;
    if(dist<.0001){dx=(i+j)%2?.01:-.01;dy=.02;dist=Math.hypot(dx,dy);}
    const nx=dx/dist,ny=dy/dist,overlap=target-dist;
    // Keep all visible centres within the actual bowl.
    a.x=clamp(a.x-nx*overlap*.5,minX,maxX);
    b.x=clamp(b.x+nx*overlap*.5,minX,maxX);
    a.y=clamp(a.y-ny*overlap*.5,roof,floor);
    b.y=clamp(b.y+ny*overlap*.5,roof,floor);
    const separation=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
    if(separation<0){
      const impulse=-separation*.24;
      a.vx-=impulse*nx;a.vy-=impulse*ny;
      b.vx+=impulse*nx;b.vy+=impulse*ny;
      a.settled=false;b.settled=false;
    }
  }
  for(const ball of balls){
    ball.x=clamp(ball.x,minX,maxX);
    ball.y=clamp(ball.y,roof,floor);
    // Contact with the floor may settle, but never remove the ball from view.
    if(ball.y>=floor-.6&&Math.hypot(ball.vx,ball.vy)<22){
      ball.vx=0;ball.vy=0;ball.settled=true;
    }
  }
  return balls;
}
export function isBallInTray(ball,width,height){
  const r=ball.radius;
  return Number.isFinite(ball.x)&&Number.isFinite(ball.y)&&
    ball.x>=r&&ball.x<=width-r&&ball.y>=r&&ball.y<=height-r;
}
