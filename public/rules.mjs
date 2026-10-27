/** Pure scoring and rewards. All credits are virtual; there is no cash-out. */
export const STARTING_MARBLES = 100;
export const BETS = Object.freeze([10, 20, 50]);
export const MULTIPLIERS = Object.freeze([2, 4, 6, 8, 10]);
export const SLOT_COUNT = 11;
export const LIT_COUNT = 3;
export const STORAGE_KEY = "neon-pinball-arcade-v1";

export const GIFTS = Object.freeze([
  { id: "sunset", name: "落日橘灯光", cost: 1, description: "点亮一套暖金色霓虹灯" },
  { id: "mint", name: "薄荷绿灯光", cost: 2, description: "解锁清凉薄荷街机主题" },
  { id: "violet", name: "极光紫灯光", cost: 3, description: "解锁限定极光紫灯光" },
]);

export function freshSave() {
  return { marbles: STARTING_MARBLES, cards: 0, rounds: 0, wins: 0, best: 0, earned: 0, redeemed: [], theme: "classic" };
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
  return {
    marbles: int(candidate.marbles), cards: int(candidate.cards, 9999),
    rounds: int(candidate.rounds), wins: int(candidate.wins),
    best: int(candidate.best), earned: int(candidate.earned),
    redeemed, theme,
  };
}

function rollIndex(length, rng) {
  const sample = Number(rng());
  const value = Number.isFinite(sample) ? Math.min(0.999999999, Math.max(0, sample)) : 0;
  return Math.floor(value * length);
}

export function createRound(rng = Math.random) {
  const multiplier = MULTIPLIERS[rollIndex(MULTIPLIERS.length, rng)];
  const indices = Array.from({ length: SLOT_COUNT }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = rollIndex(i + 1, rng);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return { multiplier, lit: indices.slice(0, LIT_COUNT).sort((a, b) => a - b) };
}

export function validBet(value) { return BETS.includes(value); }
export function canAfford(save, stake) { return validBet(stake) && save.marbles >= stake; }

/** Called once after real physics placed the shot into one slot. */
export function settle(save, round, stake, slot) {
  if (!canAfford(save, stake)) throw new Error("Insufficient virtual marbles or invalid stake");
  if (!round || !MULTIPLIERS.includes(round.multiplier) ||
      !Array.isArray(round.lit) || round.lit.length !== LIT_COUNT ||
      !round.lit.every(n => Number.isInteger(n) && n >= 0 && n < SLOT_COUNT) ||
      new Set(round.lit).size !== LIT_COUNT) throw new Error("Invalid round");
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) throw new Error("Invalid slot");
  const hit = round.lit.includes(slot);
  const reward = hit ? stake * round.multiplier : 0;
  const newCards = reward >= 50 ? 1 : 0;
  const net = reward - stake;
  return {
    hit, reward, newCards, net,
    save: {
      ...save,
      marbles: save.marbles - stake + reward,
      cards: save.cards + newCards,
      rounds: save.rounds + 1,
      wins: save.wins + Number(hit),
      best: Math.max(save.best, reward),
      earned: save.earned + reward,
    },
  };
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
