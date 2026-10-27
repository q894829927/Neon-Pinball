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

export const GIFTS = Object.freeze([
  { id: "sunset", name: "落日橘灯光", cost: 1, description: "点亮一套暖金色霓虹灯" },
  { id: "mint", name: "薄荷绿灯光", cost: 2, description: "解锁清凉薄荷街机主题" },
  { id: "violet", name: "极光紫灯光", cost: 3, description: "解锁限定极光紫灯光" },
]);

export function freshSave() {
  return { marbles: STARTING_MARBLES, cards: 0, rounds: 0, wins: 0, best: 0, earned: 0, redeemed: [], theme: "classic", pendingStake: 0, pendingRound: null };
}

function int(value, max = 1_000_000_000) {
  return Number.isSafeInteger(value) ? Math.min(max, Math.max(0, value)) : 0;
}

export function restoreSave(candidate) {
  const fallback = freshSave();
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return fallback;
  const valid = new Set(GIFTS.map(g => g.id));
  const redeemed = Array.isArray(candidate.redeemed)
    ? [...new Set(candidate.redeemed.filter(id => typeof id === "string" && valid.has(id)))]
    : [];
  const theme = candidate.theme === "classic" || redeemed.includes(candidate.theme) ? candidate.theme : "classic";
  const pendingStake = int(candidate.pendingStake, MAX_STAKE);
  const pendingRound = pendingStake >= MIN_STAKE
    ? normalizePendingRound(candidate.pendingRound) : null;
  return {
    marbles: int(candidate.marbles), cards: int(candidate.cards, 9999),
    rounds: int(candidate.rounds), wins: int(candidate.wins),
    best: int(candidate.best), earned: int(candidate.earned),
    redeemed, theme,
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

/** Pending rounds saved under the old all-3-slots rule must not lose their bet.
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
  const newCards = reward >= 50 ? 1 : 0;
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
  const gift = GIFTS.find(entry => entry.id === id);
  if (!gift) throw new Error("Unknown virtual gift");
  if (save.redeemed.includes(id)) throw new Error("Gift already unlocked");
  if (save.cards < gift.cost) throw new Error("Not enough cards");
  return { ...save, cards: save.cards - gift.cost, redeemed: [...save.redeemed, id], theme: id };
}

export function selectTheme(save, id) {
  if (id !== "classic" && !save.redeemed.includes(id)) throw new Error("Theme not unlocked");
  return { ...save, theme: id };
}
