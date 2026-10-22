import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DIFFICULTY_ID,
  DIFFICULTY_MODES,
  DIFFICULTY_STORAGE_KEY,
  difficultyEffectLines,
  getDifficultyProfile,
  loadDifficultyId,
  normalizeDifficultyId,
  playerVitalsForDifficulty,
  saveDifficultyId,
  scaleEnemyVitals,
} from '../src/combat/difficulty.js';

const BASELINE_KEYS = [
  'enemyHpMult',
  'enemyDamageMult',
  'enemyPoiseMult',
  'enemySpeedMult',
  'enemyCooldownMult',
  'enemyAggressionMult',
  'playerDamageMult',
  'playerMaxHpMult',
  'playerStaminaMult',
  'staminaRegenMult',
  'staminaCostMult',
  'healMult',
];

const BONUS_KEYS = ['gourdBonus', 'deflectWindowBonus'];

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    peek: (key) => values.get(key),
  };
}

test('Expert preserves the shipped balance with exact 1.0 multipliers', () => {
  assert.deepEqual(
    DIFFICULTY_MODES.map((mode) => mode.id),
    ['easy', 'normal', 'expert'],
  );
  const expert = getDifficultyProfile('expert');
  assert.equal(expert.name, 'Expert');
  for (const key of BASELINE_KEYS) assert.equal(expert[key], 1.0, `${key} must stay untouched`);
  for (const key of BONUS_KEYS) assert.equal(expert[key], 0, `${key} must stay untouched`);
  assert.equal(DEFAULT_DIFFICULTY_ID, 'expert');
});

test('unknown ids, aliases and case variations normalize safely', () => {
  assert.equal(normalizeDifficultyId('EASY'), 'easy');
  assert.equal(normalizeDifficultyId('  Normal  '), 'normal');
  assert.equal(normalizeDifficultyId('medium'), 'normal');
  assert.equal(normalizeDifficultyId('hard'), 'expert');
  assert.equal(normalizeDifficultyId('story'), 'easy');
  assert.equal(normalizeDifficultyId('__proto__'), 'expert');
  assert.equal(normalizeDifficultyId(null), 'expert');
  assert.equal(getDifficultyProfile('does-not-exist').id, 'expert');
});

test('Easy is gentler than Normal, and both are gentler than Expert', () => {
  const easy = getDifficultyProfile('easy');
  const normal = getDifficultyProfile('normal');
  const expert = getDifficultyProfile('expert');

  for (const profile of [easy, normal]) {
    assert.ok(profile.enemyHpMult < expert.enemyHpMult);
    assert.ok(profile.enemyDamageMult < expert.enemyDamageMult);
    assert.ok(profile.enemyCooldownMult > expert.enemyCooldownMult);
    assert.ok(profile.playerDamageMult > expert.playerDamageMult);
    assert.ok(profile.playerMaxHpMult > expert.playerMaxHpMult);
    assert.ok(profile.healMult > expert.healMult);
    assert.ok(profile.gourdBonus > expert.gourdBonus);
    assert.ok(profile.deflectWindowBonus > expert.deflectWindowBonus);
  }

  assert.ok(easy.enemyDamageMult < normal.enemyDamageMult);
  assert.ok(easy.enemyHpMult < normal.enemyHpMult);
  assert.ok(easy.playerDamageMult > normal.playerDamageMult);
  assert.ok(easy.gourdBonus > normal.gourdBonus);
});

test('enemy and player vitals scale with the selected difficulty', () => {
  assert.deepEqual(scaleEnemyVitals(2600, 620, 'expert'), {
    maxHp: 2600,
    maxPoise: 620,
    maxLegDamage: 508,
  });
  assert.deepEqual(scaleEnemyVitals(2600, 620, 'normal'), {
    maxHp: 1612,
    maxPoise: 496,
    maxLegDamage: 407,
  });
  assert.deepEqual(scaleEnemyVitals(2600, 620, 'easy'), {
    maxHp: 1170,
    maxPoise: 372,
    maxLegDamage: 305,
  });

  assert.deepEqual(playerVitalsForDifficulty({ maxHp: 500, maxStamina: 150, maxGourds: 5 }, 'expert'), {
    maxHp: 500,
    maxStamina: 150,
    maxGourds: 5,
  });
  assert.deepEqual(playerVitalsForDifficulty({ maxHp: 500, maxStamina: 150, maxGourds: 5 }, 'normal'), {
    maxHp: 600,
    maxStamina: 173,
    maxGourds: 6,
  });
  assert.deepEqual(playerVitalsForDifficulty({ maxHp: 500, maxStamina: 150, maxGourds: 5 }, 'easy'), {
    maxHp: 750,
    maxStamina: 210,
    maxGourds: 8,
  });
});

test('difficulty persists through storage and survives unavailable/corrupt storage', () => {
  const storage = memoryStorage();
  assert.equal(loadDifficultyId(storage), 'expert');
  assert.equal(saveDifficultyId('easy', storage), true);
  assert.equal(storage.peek(DIFFICULTY_STORAGE_KEY), 'easy');
  assert.equal(loadDifficultyId(storage), 'easy');

  const corrupt = memoryStorage({ [DIFFICULTY_STORAGE_KEY]: 'not-a-mode' });
  assert.equal(loadDifficultyId(corrupt), 'expert');

  const broken = {
    getItem() {
      throw new Error('storage blocked');
    },
    setItem() {
      throw new Error('storage blocked');
    },
  };
  assert.equal(loadDifficultyId(broken), 'expert');
  assert.equal(saveDifficultyId('normal', broken), false);
});

test('settings effect lines describe the actual multipliers', () => {
  assert.match(difficultyEffectLines('normal').join(' '), /Enemy health ×0\.62/);
  assert.match(difficultyEffectLines('normal').join(' '), /Your damage ×1\.55/);
  assert.match(difficultyEffectLines('normal').join(' '), /Deflect window \+35 ms/);
  assert.match(difficultyEffectLines('easy').join(' '), /Gourds \+3/);
  assert.match(difficultyEffectLines('expert').join(' '), /Original balance/);
});
