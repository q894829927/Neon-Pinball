/** Visual budgets only. Physics, probabilities and payout totals are untouched. */
export function renderBudget(compact=false,degraded=false){
  if(degraded)return Object.freeze({
    trailPoints:4,flashes:4,particles:24,shadow:0,boardDpr:1.25,drawInterval:33,
    payoutInterval:50
  });
  if(compact)return Object.freeze({
    trailPoints:7,flashes:8,particles:36,shadow:3,boardDpr:1.6,drawInterval:0,
    payoutInterval:33
  });
  return Object.freeze({
    trailPoints:14,flashes:12,particles:64,shadow:12,boardDpr:2,drawInterval:0,
    payoutInterval:33
  });
}
export function shouldDrawFrame(now,lastDraw,interval,force=false){
  return force||interval<=0||now-lastDraw>=interval;
}
