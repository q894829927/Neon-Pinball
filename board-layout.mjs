/**
 * Authoritative selectable peg patterns. The very same layout object is passed
 * to the full-physics solver and used to paint the offscreen game board.
 * Original geometry and bumper positions are preserved under "classic".
 */
export const PEG_GRID=Object.freeze({
  rows:10,columns:8,left:48,top:184,
  horizontalSpacing:39,verticalSpacing:42,oddRowOffset:18.5,pegRadius:5.9,
});
export const BUMPER_CELLS=Object.freeze([
  Object.freeze({row:3,col:2}),
  Object.freeze({row:5,col:5}),
  Object.freeze({row:7,col:3}),
]);
export const BOARD_LAYOUTS=Object.freeze([
  Object.freeze({id:"classic",name:"经典错列",description:"原版10行×8列，三处红色弹力器",
    rows:10,columns:8,left:48,top:184,dx:39,dy:42,offsets:[0,18.5],
    pegRadius:5.9,bumpers:BUMPER_CELLS}),
  Object.freeze({id:"mirror",name:"反向错列",description:"左右错位顺序翻转，观察边缘落槽差异",
    rows:10,columns:8,left:68,top:184,dx:39,dy:42,offsets:[0,-18.5],
    pegRadius:5.9,bumpers:[{row:3,col:3},{row:5,col:2},{row:7,col:4}]}),
  Object.freeze({id:"dense",name:"密集钉阵",description:"12行×8列，缩小行距、增加碰撞机会",
    rows:12,columns:8,left:48,top:184,dx:39,dy:33,offsets:[0,18.5],
    pegRadius:5.6,bumpers:[{row:3,col:2},{row:6,col:5},{row:9,col:3}]}),
  Object.freeze({id:"wave",name:"波浪钉阵",description:"10行×8列，横向错列按波形变化",
    rows:10,columns:8,left:53,top:184,dx:38,dy:42,
    offsets:[0,16,23,7,-8,15,23,7,-8,15],
    pegRadius:5.9,bumpers:[{row:3,col:2},{row:5,col:5},{row:7,col:3}]}),
  // Additional steel guide pins are physical circles, not forced slot bias.
  Object.freeze({id:"balanced",name:"均衡导流",description:"两颗物理导流钉，降低单槽最高落入概率",
    rows:10,columns:8,left:48,top:184,dx:39,dy:42,offsets:[0,18.5],
    pegRadius:5.9,bumpers:BUMPER_CELLS,
    guidePegs:[{x:340,y:161.4,r:9.3},{x:343.7,y:594.4,r:8.2}]}),
]);
export const BOARD_LAYOUT_IDS=Object.freeze(BOARD_LAYOUTS.map(item=>item.id));
export function getBoardLayout(id){
  return BOARD_LAYOUTS.find(item=>item.id===id)??BOARD_LAYOUTS[0];
}
export function pegPosition(row,col,id="classic"){
  const grid=getBoardLayout(id);
  if(!Number.isInteger(row)||row<0||row>=grid.rows||
     !Number.isInteger(col)||col<0||col>=grid.columns)
    throw new Error("Peg cell out of range");
  const offset=grid.offsets.length===2?grid.offsets[row%2]:grid.offsets[row];
  return {x:grid.left+col*grid.dx+offset,y:grid.top+row*grid.dy};
}
export function createPegLayout(rightWall=368,id="classic"){
  if(!BOARD_LAYOUT_IDS.includes(id))throw new Error("Unknown peg layout");
  const grid=getBoardLayout(id);
  const selected=new Set(grid.bumpers.map(({row,col})=>row+","+col));
  const pegs=[],bumpers=[];
  for(let row=0;row<grid.rows;row++)for(let col=0;col<grid.columns;col++){
    const {x,y}=pegPosition(row,col,id);
    // Unlike clipping a malformed grid, reject it early. All cells must be
    // physical and visible for unbiased comparisons across patterns.
    if(x<=38||x>=rightWall-12||y<170||y>575)
      throw new Error("Peg outside playable board: "+id+"/"+row+"/"+col);
    const cell={row,col,x,y};
    if(selected.has(row+","+col))bumpers.push({...cell,r:15});
    else pegs.push({...cell,r:grid.pegRadius});
  }
  for(const [i,p] of (grid.guidePegs??[]).entries()){
    if(p.x<42||p.x>348||p.y<143||p.y>608||p.r<4||p.r>13)
      throw new Error("Guide peg outside board: "+id+"/"+i);
    if([...pegs,...bumpers].some(q=>Math.hypot(p.x-q.x,p.y-q.y)<=p.r+q.r+1))
      throw new Error("Guide peg overlaps board obstacle: "+id+"/"+i);
    pegs.push({row:-1,col:i,x:p.x,y:p.y,r:p.r,guide:true});
  }
  if(bumpers.length!==grid.bumpers.length)
    throw new Error("A bumper is outside the peg field");
  // Configured bumpers must never physically intersect their metal neighbors.
  for(const bumper of bumpers)for(const peg of pegs){
    if(Math.hypot(bumper.x-peg.x,bumper.y-peg.y)<bumper.r+peg.r+0.02)
      throw new Error("Bumper collides with fixed peg in layout "+id);
  }
  return {pegs,bumpers,id};
}
