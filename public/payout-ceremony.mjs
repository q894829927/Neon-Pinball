/** Payout ceremony timings and counts; pure presentation, never awards inventory. */
export const PAYOUT_TIMELINE=Object.freeze({
  confirmationEnd:430,
  marblesEnd:1650,
  noCardFinish:1950,
  ticketFinish:2750,
});
export function payoutPlan({hit,reward,newCards,slot,multiplier}){
  if(!hit)return null;
  if(!Number.isSafeInteger(reward)||reward<=0||
      !Number.isSafeInteger(newCards)||newCards<0||
      !Number.isInteger(slot)||slot<0||slot>10||
      ![2,4,6,8,10].includes(multiplier))
    throw new Error("Invalid settled payout");
  // Large real-physics payouts need more than a fixed 1.2 s to pass through
  // a single outlet without hundreds of beads overlapping at once.
  const marbleDuration=Math.max(1220,Math.min(5000,reward*8));
  const marblesEnd=PAYOUT_TIMELINE.confirmationEnd+marbleDuration;
  return Object.freeze({
    reward,newCards,slot,multiplier,marblesEnd,
    coinSprites:reward, // exact credit count; visual basin has a finite capacity
    cardSprites:Math.min(3,newCards),
    duration:marblesEnd+(newCards?1100:300),
  });
}
export function payoutAct(plan,elapsedMs){
  if(!plan)return "done";
  if(!Number.isFinite(elapsedMs))return "impact";
  if(elapsedMs>=plan.duration)return "done";
  if(elapsedMs<PAYOUT_TIMELINE.confirmationEnd)return "impact";
  if(elapsedMs<plan.marblesEnd)return "marbles";
  return plan.newCards?"tickets":"marbles";
}
export function payoutProgress(plan,elapsedMs){
  if(!plan)return Object.freeze({marbles:0,cards:0});
  const time=Number.isFinite(elapsedMs)?Math.max(0,elapsedMs):0;
  const fraction=Math.max(0,Math.min(1,
    (time-PAYOUT_TIMELINE.confirmationEnd)/
    (plan.marblesEnd-PAYOUT_TIMELINE.confirmationEnd)));
  const cardFraction=plan.newCards?
    Math.max(0,Math.min(1,(time-plan.marblesEnd)/1100)):0;
  return {
    marbles:Math.min(plan.reward,Math.floor(plan.reward*fraction)),
    cards:Math.min(plan.newCards,Math.floor(plan.newCards*cardFraction)),
  };
}
