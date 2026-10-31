import test from "node:test";
import assert from "node:assert/strict";
import {renderBudget,shouldDrawFrame} from "../public/render-budget.mjs";
test("small devices and degraded mode reduce only render work",()=>{
  const desktop=renderBudget(false,false),mobile=renderBudget(true,false),slow=renderBudget(true,true);
  for(const k of ["trailPoints","flashes","particles","shadow","boardDpr"])
    assert.ok(desktop[k]>=mobile[k]&&mobile[k]>=slow[k],k);
  assert.ok(slow.drawInterval>=30);
  assert.ok(desktop.drawInterval===0);
  assert.ok(shouldDrawFrame(120,100,33,true));
  assert.equal(shouldDrawFrame(120,100,33),false);
  assert.equal(shouldDrawFrame(135,100,33),true);
});
