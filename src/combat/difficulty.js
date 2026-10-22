// Trial difficulty profiles for REINCARNATION: The Serpent's Spine.
//
// The game shipped with a single, deliberately punishing balance. That balance
// is now "Expert" and its multipliers are all exactly 1.0, so selecting Expert
// reproduces the original experience byte-for-byte. Easy and Normal lower the
// incoming pressure while leaving every authored move, combo and boss phase in
// place.
//
// This module is intentionally free of Three.js/DOM dependencies so the HUD,
// the combat engine and the unit tests can all share the same definitions.

export const DIFFICULTY_STORAGE_KEY = 'reincarnation.difficulty';
export const DEFAULT_DIFFICULTY_ID = 'expert';

const EXPERT_BASELINE = Object.freeze({
  enemyHpMult: 1.0,
  enemyDamageMult: 1.0,
  enemyPoiseMult: 1.0,
  enemySpeedMult: 1.0,
  enemyCooldownMult: 1.0,
  enemyAggressionMult: 1.0,
  playerDamageMult: 1.0,
  playerMaxHpMult: 1.0,
  playerStaminaMult: 1.0,
  staminaRegenMult: 1.0,
  staminaCostMult: 1.0,
  healMult: 1.0,
  gourdBonus: 0,
  deflectWindowBonus: 0,
});

export const DIFFICULTY_MODES = Object.freeze([
  Object.freeze({
    id: 'easy',
    name: 'Easy',
    tag: 'Story',
    tagline: 'Lower stakes. Full spectacle.',
    summary:
      'Enemies strike gently, break under pressure and give you room to breathe. Your vessel is sturdier and healing is generous.',
    ...EXPERT_BASELINE,
    enemyHpMult: 0.45,
    enemyDamageMult: 0.42,
    enemyPoiseMult: 0.6,
    enemySpeedMult: 0.9,
    enemyCooldownMult: 1.75,
    enemyAggressionMult: 0.55,
    playerDamageMult: 2.0,
    playerMaxHpMult: 1.5,
    playerStaminaMult: 1.4,
    staminaRegenMult: 1.45,
    staminaCostMult: 0.7,
    healMult: 1.5,
    gourdBonus: 3,
    deflectWindowBonus: 0.07,
  }),
  Object.freeze({
    id: 'normal',
    name: 'Normal',
    tag: 'Balanced',
    tagline: 'Still punishing, never unfair.',
    summary:
      'A fairer duel: less enemy health and damage, a sturdier vessel, and more forgiving deflects and healing.',
    ...EXPERT_BASELINE,
    enemyHpMult: 0.62,
    enemyDamageMult: 0.65,
    enemyPoiseMult: 0.8,
    enemySpeedMult: 0.96,
    enemyCooldownMult: 1.35,
    enemyAggressionMult: 0.85,
    playerDamageMult: 1.55,
    playerMaxHpMult: 1.2,
    playerStaminaMult: 1.15,
    staminaRegenMult: 1.2,
    staminaCostMult: 0.88,
    healMult: 1.2,
    gourdBonus: 1,
    deflectWindowBonus: 0.035,
  }),
  Object.freeze({
    id: 'expert',
    name: 'Expert',
    tag: 'Original',
    tagline: "The Serpent's Spine as first forged.",
    summary:
      'The original balance, untouched: every chapter multiplier and every punishing hit exactly as they were.',
    ...EXPERT_BASELINE,
  }),
]);

const DIFFICULTY_BY_ID = new Map(DIFFICULTY_MODES.map((mode) => [mode.id, mode]));

const DIFFICULTY_ALIASES = new Map([
  ['story', 'easy'],
  ['casual', 'easy'],
  ['beginner', 'easy'],
  ['medium', 'normal'],
  ['standard', 'normal'],
  ['default', 'normal'],
  ['hard', 'expert'],
  ['original', 'expert'],
  ['soulslike', 'expert'],
]);

/** Normalize loose user/URL input to a known difficulty id. */
export function normalizeDifficultyId(id) {
  if (typeof id !== 'string') return DEFAULT_DIFFICULTY_ID;
  const key = id.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (DIFFICULTY_BY_ID.has(key)) return key;
  return DIFFICULTY_ALIASES.get(key) || DEFAULT_DIFFICULTY_ID;
}

/** Return the immutable profile for a difficulty id (unknown ids fall back to Expert). */
export function getDifficultyProfile(id) {
  return DIFFICULTY_BY_ID.get(normalizeDifficultyId(id)) || DIFFICULTY_BY_ID.get(DEFAULT_DIFFICULTY_ID);
}

/** Human-readable effect summary used by the Sanctuary settings panel. */
export function difficultyEffectLines(id) {
  const diff = getDifficultyProfile(id);
  if (diff.id === 'expert') {
    return ['Original balance: 1.00x enemy health and damage.'];
  }
  const lines = [
    `Enemy health ×${diff.enemyHpMult.toFixed(2)}`,
    `Enemy damage ×${diff.enemyDamageMult.toFixed(2)}`,
    `Your damage ×${diff.playerDamageMult.toFixed(2)}`,
    `Healing ×${diff.healMult.toFixed(2)}`,
  ];
  if (diff.gourdBonus > 0) lines.push(`Gourds +${diff.gourdBonus}`);
  if (diff.deflectWindowBonus > 0) {
    lines.push(`Deflect window +${Math.round(diff.deflectWindowBonus * 1000)} ms`);
  }
  return lines;
}

/**
 * Scale a fighter's authored vitals for a difficulty.
 * `baseMaxHp`/`baseMaxPoise` are the chapter-scaled values before difficulty.
 */
export function scaleEnemyVitals(baseMaxHp, baseMaxPoise, id) {
  const diff = getDifficultyProfile(id);
  const maxHp = Math.max(1, Math.round(Math.max(1, baseMaxHp) * diff.enemyHpMult));
  const maxPoise = Math.max(1, Math.round(Math.max(1, baseMaxPoise) * diff.enemyPoiseMult));
  return {
    maxHp,
    maxPoise,
    maxLegDamage: Math.max(1, Math.round(maxPoise * 0.82)),
  };
}

/** Scale the player's authored vitals for a difficulty. */
export function playerVitalsForDifficulty({ maxHp, maxStamina, maxGourds }, id) {
  const diff = getDifficultyProfile(id);
  return {
    maxHp: Math.max(1, Math.round(Math.max(1, maxHp) * diff.playerMaxHpMult)),
    maxStamina: Math.max(1, Math.round(Math.max(1, maxStamina) * diff.playerStaminaMult)),
    maxGourds: Math.max(1, Math.max(1, maxGourds) + diff.gourdBonus),
  };
}

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Read the persisted difficulty (defaults to Expert, the original balance). */
export function loadDifficultyId(storage = null) {
  const store = resolveStorage(storage);
  if (!store) return DEFAULT_DIFFICULTY_ID;
  try {
    return normalizeDifficultyId(store.getItem(DIFFICULTY_STORAGE_KEY));
  } catch {
    return DEFAULT_DIFFICULTY_ID;
  }
}

/** Persist the difficulty. Returns false when storage is unavailable. */
export function saveDifficultyId(id, storage = null) {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    store.setItem(DIFFICULTY_STORAGE_KEY, normalizeDifficultyId(id));
    return true;
  } catch {
    return false;
  }
}
