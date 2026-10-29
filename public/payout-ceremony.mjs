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
  return Object.freeze({
    reward,newCards,slot,multiplier,
    coinSprites:reward, // exact number of prize marbles; canvas storage bounds rendering cost
    cardSprites:Math.min(3,newCards),
    duration:newCards?PAYOUT_TIMELINE.ticketFinish:PAYOUT_TIMELINE.noCardFinish,
  });
}
export function payoutAct(plan,elapsedMs){
  if(!plan)return "done";
  if(!Number.isFinite(elapsedMs))return "impact";
  if(elapsedMs>=plan.duration)return "done";
  if(elapsedMs<PAYOUT_TIMELINE.confirmationEnd)return "impact";
  if(elapsedMs<PAYOUT_TIMELINE.marblesEnd)return "marbles";
  return plan.newCards?"tickets":"marbles";
}
export function payoutProgress(plan,elapsedMs){
  if(!plan)return Object.freeze({marbles:0,cards:0});
  const time=Number.isFinite(elapsedMs)?Math.max(0,elapsedMs):0;
  const fraction=Math.max(0,Math.min(1,
    (time-PAYOUT_TIMELINE.confirmationEnd)/
    (PAYOUT_TIMELINE.marblesEnd-PAYOUT_TIMELINE.confirmationEnd)));
  const cardFraction=plan.newCards?
    Math.max(0,Math.min(1,(time-PAYOUT_TIMELINE.marblesEnd)/
      (PAYOUT_TIMELINE.ticketFinish-PAYOUT_TIMELINE.marblesEnd))):0;
  return {
    marbles:Math.min(plan.reward,Math.floor(plan.reward*fraction)),
    cards:Math.min(plan.newCards,Math.floor(plan.newCards*cardFraction)),
  };
}
