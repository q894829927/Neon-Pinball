import test from "node:test";
import assert from "node:assert/strict";
import {PEG_GRID,BUMPER_CELLS,BOARD_LAYOUTS,BOARD_LAYOUT_IDS,
  pegPosition,createPegLayout,getBoardLayout} from "../public/board-layout.mjs";
import {PHYSICS,createPhysicalBall,stepPhysicalBall} from "../public/physics-engine.mjs";
import {firingVelocity} from "../public/plunger.mjs";
import {randomLaunch,varyLaunchVelocity} from "../public/physics-variation.mjs";
const random=seed=>()=>{
  seed=(Math.imul(1664525,seed)+1013904223)>>>0;
  return seed/4294967296;
};
test("legacy original arrangement remains exactly unchanged",()=>{
  assert.equal(PEG_GRID.rows,10);
  assert.equal(PEG_GRID.columns,8);
  assert.deepEqual(BUMPER_CELLS.map(x=>[x.row,x.col]),[[3,2],[5,5],[7,3]]);
  const original=createPegLayout(368);
  const explicit=createPegLayout(368,"classic");
  assert.deepEqual(original,explicit);
  assert.equal(original.pegs.length,77);
  assert.equal(original.bumpers.length,3);
  assert.deepEqual(pegPosition(3,2),{x:144.5,y:310});
});
test("all four selectable patterns have separate actual geometry without overlapping bumpers",()=>{
  assert.deepEqual(BOARD_LAYOUT_IDS,["classic","mirror","dense","wave"]);
  assert.equal(new Set(BOARD_LAYOUTS.map(l=>l.id)).size,4);
  const layouts=BOARD_LAYOUT_IDS.map(id=>createPegLayout(368,id));
  for(let i=0;i<layouts.length;i++){
    const l=layouts[i],config=getBoardLayout(l.id);
    assert.equal(l.pegs.length+l.bumpers.length,config.rows*config.columns);
    assert.equal(l.bumpers.length,3);
    const cells=new Set();
    for(const peg of [...l.pegs,...l.bumpers]){
      assert.ok(peg.x>38&&peg.x<356&&peg.y>170&&peg.y<575);
      assert.equal(JSON.stringify({x:peg.x,y:peg.y}),
                   JSON.stringify(pegPosition(peg.row,peg.col,l.id)));
      const key=peg.row+"/"+peg.col;
      assert.ok(!cells.has(key));cells.add(key);
    }
    for(const b of l.bumpers)for(const p of l.pegs)
      assert.ok(Math.hypot(b.x-p.x,b.y-p.y)>b.r+p.r);
    if(i)assert.notDeepEqual(l.pegs.map(p=>[p.x,p.y]),
                              layouts[0].pegs.map(p=>[p.x,p.y]));
  }
  assert.throws(()=>createPegLayout(368,"missing"),/Unknown/);
  assert.equal(getBoardLayout("unknown").id,"classic");
});
test("the actual physical engine settles on every new pattern over variable forces",()=>{
  for(const id of BOARD_LAYOUT_IDS){
    const layout=createPegLayout(PHYSICS.fieldRight,id);
    for(const force of [.1,.4,.7,1]){
      for(let seed=1;seed<=4;seed++){
        const rng=random(seed*1337+Math.floor(force*100));
        const variation=randomLaunch(rng);
        const ball=createPhysicalBall(varyLaunchVelocity(firingVelocity(force),variation),variation);
        let settled=false;
        for(let j=0;j<5400;j++){
          const next=stepPhysicalBall(ball,1/180,layout,rng);
          if(next.settled){settled=true;break;}
        }
        assert.ok(settled,id+" force="+force+" seed="+seed);
        assert.ok(ball.slot>=0&&ball.slot<11);
      }
    }
  }
});
