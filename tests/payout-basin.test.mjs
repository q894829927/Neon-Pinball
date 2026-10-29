import test from "node:test";
import assert from "node:assert/strict";
import {basinPacking,basinPosition,basinVisibleCount} from "../public/payout-basin.mjs";
test("one marble appears per credited marble within physical collecting-basin capacity",()=>{
  for(const [w,h] of [[210,40],[168,32],[122,28]]){
    for(const amount of [1,2,10,50,150,500]){
      const plan=basinPacking(w,h,amount);
      assert.equal(plan.stored,amount);
      assert.equal(plan.visible,amount,"No old 20-marble cap for "+amount+" at "+w+"x"+h);
      const pos=new Set();
      for(let n=0;n<amount;n++){
        const p=basinPosition(n,plan,w,h);
        assert.ok(p.x>=plan.radius&&p.x<=w-plan.radius);
        assert.ok(p.y>=plan.radius&&p.y<=h-plan.radius);
        pos.add(p.x.toFixed(4)+"/"+p.y.toFixed(4));
      }
      assert.equal(pos.size,amount,"Every reward marble has a different position");
    }
  }
});
test("huge payouts never require millions of DOM nodes and exact totals remain",()=>{
  const plan=basinPacking(122,28,10_000_000);
  assert.equal(plan.stored,10_000_000);
  assert.ok(plan.visible>=200&&plan.visible<3000);
  assert.equal(basinVisibleCount(10_000_000,plan),plan.visible);
  assert.throws(()=>basinPacking(0,20,1));
  assert.throws(()=>basinPacking(100,20,-1));
});