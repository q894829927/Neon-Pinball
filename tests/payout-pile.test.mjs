import test from "node:test";
import assert from "node:assert/strict";
import {createFallenPile,fallingBeadPosition} from "../public/payout-pile.mjs";
test("marbles rest in an irregular gravity pile with no grid rewrite",()=>{
  for(const [w,h] of [[168,36],[122,30],[80,20]]){
    for(const n of [2,10,50,150,500]){
      const pile=createFallenPile(w,h,n);
      assert.equal(pile.balls.length,n);
      const locations=new Set();
      for(const b of pile.balls){
        assert.ok(b.x>=b.r-1&&b.x<=w-b.r+1&&b.y>=b.r&&b.y<=h-b.r);
        locations.add(b.x.toFixed(4)+"/"+b.y.toFixed(4));
      }
      assert.equal(locations.size,n);
      if(n===10){
        const min=Math.min(...pile.balls.map(b=>b.x));
        const max=Math.max(...pile.balls.map(b=>b.x));
        assert.ok(min>w*.1&&max<w*.9,"Small wins must collect near the central payout nozzle");
        assert.ok(new Set(pile.balls.map(b=>b.y.toFixed(2))).size>=2,
          "Not all beads can settle into the same unnatural bottom row");
      }
      const copy=createFallenPile(w,h,n);
      assert.deepEqual(copy.balls,pile.balls,"A completed pile cannot randomly rearrange");
    }
  }
});
test("falling sequence ends exactly at the resting position",()=>{
  const pile=createFallenPile(122,30,10);
  const b=pile.balls[3];
  const start=fallingBeadPosition(b,3,10,600,0);
  const end=fallingBeadPosition(b,3,10,5000,0);
  assert.ok(start.y<=b.y+1);
  assert.equal(end.x,b.x);
  assert.equal(end.y,b.y);
  assert.deepEqual(fallingBeadPosition(b,3,10,0,0,true),end);
});
