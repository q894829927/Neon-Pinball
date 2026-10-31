/** Pure scoring and rewards. All credits are virtual; there is no cash-out. */
export const STARTING_MARBLES = 100;
export const MIN_STAKE = 5;
export const DEPOSIT_STEPS = Object.freeze([1, 5, 10]);
export const MAX_STAKE = 1_000_000; // guard unsafe integer growth in local saves
export const MULTIPLIERS = Object.freeze([2, 4, 6, 8, 10]);
export const SLOT_COUNT = 11;
// High multipliers have fewer winning mouths. All 11 slots are equally wide,
// but actual landing probabilities are determined by physical collisions.
export const WIN_SLOTS_BY_MULTIPLIER = Object.freeze({2:5,4:4,6:3,8:2,10:1});
export function winningSlotCount(multiplier) {
  if (!Object.hasOwn(WIN_SLOTS_BY_MULTIPLIER, multiplier)) throw new Error("Invalid multiplier");
  return WIN_SLOTS_BY_MULTIPLIER[multiplier];
}
export const STORAGE_KEY = "neon-pinball-arcade-v1";

// Keep the three original IDs and prices: v0.10.x save files must migrate
// without losing any purchased theme or changing a player's card balance.
export const GIFTS = Object.freeze([
  { id:"sunset",category:"theme",name:"落日橘灯光",cost:1,rarity:"普通",description:"暖金霓虹机台灯光" },
  { id:"mint",category:"theme",name:"薄荷绿灯光",cost:2,rarity:"稀有",description:"清凉薄荷机台灯光" },
  { id:"violet",category:"theme",name:"极光紫灯光",cost:3,rarity:"史诗",description:"极光紫机台灯光" },
]);
export const MARBLE_SKINS=Object.freeze([
  {id:"pearl",category:"marble",name:"珍珠银珠",cost:1,rarity:"普通",description:"乳白金属质感与柔和高光"},
  {id:"ember",category:"marble",name:"熔金弹珠",cost:3,rarity:"稀有",description:"琥珀色钢珠与金色反射"},
  {id:"nebula",category:"marble",name:"星云弹珠",cost:5,rarity:"史诗",description:"紫蓝渐变的星空钢珠"},
]);
export const TRAIL_EFFECTS=Object.freeze([
  {id:"comet",category:"trail",name:"彗星金尾迹",cost:2,rarity:"普通",description:"细密暖金色拖尾"},
  {id:"frost",category:"trail",name:"冰晶尾迹",cost:3,rarity:"稀有",description:"冷蓝色发光轨迹"},
  {id:"prism",category:"trail",name:"棱镜尾迹",cost:5,rarity:"史诗",description:"渐变紫粉色流光"},
]);
export const CATALOG=Object.freeze([...GIFTS,...MARBLE_SKINS,...TRAIL_EFFECTS]);
export const DEFAULT_LOOKS=Object.freeze([
  {id:"classic",category:"theme",name:"经典霓虹",cost:0,rarity:"基础",description:"初始机台主题"},
  {id:"steel",category:"marble",name:"标准钢珠",cost:0,rarity:"基础",description:"原版银色钢珠"},
  {id:"standard",category:"trail",name:"标准拖尾",cost:0,rarity:"基础",description:"经典淡蓝钢珠轨迹"},
]);
export const ALL_COLLECTIBLES=Object.freeze([...DEFAULT_LOOKS,...CATALOG]);
export function collectionProgress(save){
  return {unlocked:CATALOG.filter(item=>save.redeemed.includes(item.id)).length,
    total:CATALOG.length};
}

export function freshSave() {
  return { marbles: STARTING_MARBLES, cards: 0, rounds: 0, wins: 0, best: 0, earned: 0,
    redeemed: [], theme: "classic", marbleSkin:"steel", trailEffect:"standard",
    boardLayout:"classic",
    pendingStake: 0, pendingRound: null };
}

function int(value, max = 1_000_000_000) {
  return Number.isSafeInteger(value) ? Math.min(max, Math.max(0, value)) : 0;
}

export function restoreSave(candidate) {
  const fallback = freshSave();
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return fallback;
  const valid = new Set(CATALOG.map(g => g.id));
  const redeemed = Array.isArray(candidate.redeemed)
    ? [...new Set(candidate.redeemed.filter(id => typeof id === "string" && valid.has(id)))]
    : [];
  const theme = candidate.theme === "classic" ||
    (GIFTS.some(g=>g.id===candidate.theme)&&redeemed.includes(candidate.theme))
      ? candidate.theme : "classic";
  const marbleSkin=candidate.marbleSkin==="steel"||
    (MARBLE_SKINS.some(g=>g.id===candidate.marbleSkin)&&redeemed.includes(candidate.marbleSkin))
      ? candidate.marbleSkin : "steel";
  const trailEffect=candidate.trailEffect==="standard"||
    (TRAIL_EFFECTS.some(g=>g.id===candidate.trailEffect)&&redeemed.includes(candidate.trailEffect))
      ? candidate.trailEffect : "standard";
  const boardLayout=["classic","mirror","dense","wave"].includes(candidate.boardLayout)
    ?candidate.boardLayout:"classic";
  const pendingStake = int(candidate.pendingStake, MAX_STAKE);
  const pendingRound = pendingStake >= MIN_STAKE
    ? normalizePendingRound(candidate.pendingRound) : null;
  return {
    marbles: int(candidate.marbles), cards: int(candidate.cards),
    rounds: int(candidate.rounds), wins: int(candidate.wins),
    best: int(candidate.best), earned: int(candidate.earned),
    redeemed, theme, marbleSkin, trailEffect, boardLayout,
    // A partial deposit stays funded across a refresh. No multiplier before 5.
    pendingStake: pendingRound || pendingStake < MIN_STAKE ? pendingStake : 0,
    pendingRound,
  };
}

function rollIndex(length, rng) {
  const sample = Number(rng());
  const value = Number.isFinite(sample) ? Math.min(0.999999999, Math.max(0, sample)) : 0;
  return Math.floor(value * length);
}

/** Pending rounds saved under earlier gate-count rules must not lose their bet.
 * Keep previously lit positions first; resize to the new multiplier tier.
 * No new multiplier is drawn on migration.
 */
function normalizePendingRound(candidate) {
  if (!candidate || !MULTIPLIERS.includes(candidate.multiplier) ||
      !Array.isArray(candidate.lit)) return null;
  const lit = candidate.lit;
  if (lit.length<1 || lit.length>SLOT_COUNT ||
      !lit.every(i=>Number.isInteger(i)&&i>=0&&i<SLOT_COUNT) ||
      new Set(lit).size!==lit.length) return null;
  const desired = winningSlotCount(candidate.multiplier);
  const chosen = [...lit].slice(0, desired);
  // Fill from alternating centre/outside slots to avoid clustering.
  const fillOrder = [5,3,7,1,9,4,6,2,8,0,10];
  for (const index of fillOrder) {
    if(chosen.length>=desired)break;
    if(!chosen.includes(index))chosen.push(index);
  }
  return {multiplier:candidate.multiplier,lit:chosen.sort((a,b)=>a-b)};
}

export function createRound(rng = Math.random) {
  const multiplier = MULTIPLIERS[rollIndex(MULTIPLIERS.length, rng)];
  const indices = Array.from({ length: SLOT_COUNT }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = rollIndex(i + 1, rng);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return { multiplier, lit: indices.slice(0, winningSlotCount(multiplier)).sort((a, b) => a - b) };
}

export function isValidRound(round) {
  return Boolean(round && MULTIPLIERS.includes(round.multiplier) &&
    Array.isArray(round.lit) && round.lit.length === winningSlotCount(round.multiplier) &&
    round.lit.every(n => Number.isInteger(n) && n >= 0 && n < SLOT_COUNT) &&
    new Set(round.lit).size === winningSlotCount(round.multiplier));
}

export function validBet(value) {
  return Number.isSafeInteger(value) && value >= MIN_STAKE && value <= MAX_STAKE;
}
export function canAfford(save, stake) {
  return validBet(stake) && save.marbles >= stake;
}
export function canLaunch(save) {
  return validBet(save.pendingStake) && isValidRound(save.pendingRound);
}

/** Transfer virtual marbles from the bank to the current unreleased shot.
 * The random multiplier and tier-dependent red slots are revealed ONCE, at the fifth marble.
 */
export function depositMarbles(save, amount, rng = Math.random) {
  if (!Number.isSafeInteger(amount) || amount <= 0 ||
      amount > save.marbles || save.pendingStake + amount > MAX_STAKE) {
    throw new Error("投入数量无效或弹珠不足");
  }
  const pendingStake = save.pendingStake + amount;
  const pendingRound = pendingStake >= MIN_STAKE
    ? (save.pendingRound ?? createRound(rng))
    : null;
  return { ...save, marbles: save.marbles - amount, pendingStake, pendingRound };
}

export function refundDeposit(save) {
  if (!Number.isSafeInteger(save.pendingStake) || save.pendingStake < 0) {
    throw new Error("投入状态无效");
  }
  return {
    ...save,
    marbles: save.marbles + save.pendingStake,
    pendingStake: 0,
    pendingRound: null,
  };
}

/** Marks an already-funded shot as fired. Do not debit the balance twice. */
export function commitShot(save) {
  if (!canLaunch(save)) throw new Error("先投入至少5颗弹珠");
  return { ...save, pendingStake: 0, pendingRound: null };
}

function scoreShot(save, round, stake, slot, funded) {
  if (!validBet(stake) || !isValidRound(round)) throw new Error("Invalid stake or round");
  if (!funded && !canAfford(save, stake)) throw new Error("Insufficient virtual marbles");
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) throw new Error("Invalid slot");
  const hit = round.lit.includes(slot);
  const reward = hit ? stake * round.multiplier : 0;
  const newCards = Math.floor(reward / 50);
  return {
    hit, reward, newCards, net: reward - stake,
    save: {
      ...save,
      marbles: save.marbles - (funded ? 0 : stake) + reward,
      cards: save.cards + newCards,
      rounds: save.rounds + 1,
      wins: save.wins + Number(hit),
      best: Math.max(save.best, reward),
      earned: save.earned + reward,
    },
  };
}

/** Compatibility helper for unfunded score simulations. */
export function settle(save, round, stake, slot) {
  return scoreShot(save, round, stake, slot, false);
}
/** Used after commitShot:投入 already removed from balance. */
export function settleFunded(save, round, stake, slot) {
  return scoreShot(save, round, stake, slot, true);
}

export function redeem(save, id) {
  const gift = CATALOG.find(entry => entry.id === id);
  if (!gift) throw new Error("Unknown virtual gift");
  if (save.redeemed.includes(id)) throw new Error("Gift already unlocked");
  if (save.cards < gift.cost) throw new Error("Not enough cards");
  const equipment=gift.category==="theme"?{theme:id}:
    gift.category==="marble"?{marbleSkin:id}:{trailEffect:id};
  return { ...save, cards: save.cards - gift.cost,
    redeemed: [...save.redeemed,id],...equipment };
}

export function selectTheme(save, id) {
  if (id !== "classic" && !save.redeemed.includes(id)) throw new Error("Theme not unlocked");
  return { ...save, theme: id };
}

/** Equipping a purchased visual item has no credit or physics side effects. */
export function selectCosmetic(save,category,id){
  const defaults={theme:"classic",marble:"steel",trail:"standard"};
  const fields={theme:"theme",marble:"marbleSkin",trail:"trailEffect"};
  if(!Object.hasOwn(defaults,category))throw new Error("Unknown cosmetic category");
  if(id!==defaults[category]&&
    (!CATALOG.some(item=>item.id===id&&item.category===category)||!save.redeemed.includes(id)))
    throw new Error("Cosmetic not unlocked");
  return {...save,[fields[category]]:id};
}
