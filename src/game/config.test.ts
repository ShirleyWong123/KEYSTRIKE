import { describe, expect, it } from 'vitest';
import {
  LEVELS,
  PROJECTILE_MS,
  difficultyTuning,
  levelForActiveMs,
  msUntilNextLevel,
  scoreForCompletion,
  scoreForLetter,
  spawnIntervalFor,
} from './config';

const EXPECTED_LEVELS = [
  { speed: 28, spawnMs: 2800, maxTargets: 3, longWordBoost: 0 },
  { speed: 32, spawnMs: 2800, maxTargets: 3, longWordBoost: 0 },
  { speed: 32, spawnMs: 2550, maxTargets: 3, longWordBoost: 0 },
  { speed: 32, spawnMs: 2550, maxTargets: 3, longWordBoost: 0.15 },
  { speed: 32, spawnMs: 2550, maxTargets: 4, longWordBoost: 0.15 },
  { speed: 37, spawnMs: 2550, maxTargets: 4, longWordBoost: 0.15 },
  { speed: 37, spawnMs: 2250, maxTargets: 4, longWordBoost: 0.15 },
  { speed: 37, spawnMs: 2250, maxTargets: 4, longWordBoost: 0.3 },
  { speed: 37, spawnMs: 2250, maxTargets: 5, longWordBoost: 0.3 },
  { speed: 44, spawnMs: 2250, maxTargets: 5, longWordBoost: 0.3 },
  { speed: 44, spawnMs: 1900, maxTargets: 5, longWordBoost: 0.3 },
  { speed: 44, spawnMs: 1900, maxTargets: 5, longWordBoost: 0.45 },
] as const;

describe('progression configuration', () => {
  it('advances one level per 45 seconds of active combat and caps at twelve', () => {
    expect(levelForActiveMs(0)).toBe(1);
    expect(levelForActiveMs(44_999)).toBe(1);
    expect(levelForActiveMs(45_000)).toBe(2);
    expect(levelForActiveMs(999_999)).toBe(12);
  });

  it('contains the complete pressure curve and projectile timing', () => {
    expect(LEVELS).toEqual(EXPECTED_LEVELS);
    expect(PROJECTILE_MS).toBe(80);
  });

  it('scores a completion from word length, level, and prior combo', () => {
    expect(scoreForCompletion(6, 4, 3, 'normal')).toBe(224);
  });

  it('defines difficulty tuning and Ace pacing', () => {
    expect(difficultyTuning('easy')).toMatchObject({ scoreMultiplier: 1, specialProtectionMs: 12_000, specialCooldownMs: 14_000, freezeMinimumLevel: 3 });
    expect(difficultyTuning('normal')).toEqual(difficultyTuning('easy'));
    expect(difficultyTuning('hard')).toMatchObject({ scoreMultiplier: 1.25, specialProtectionMs: 10_000, specialCooldownMs: 12_000, freezeMinimumLevel: 2 });
    expect(spawnIntervalFor('hard', 1)).toBe(2576);
    expect(spawnIntervalFor('hard', 12)).toBe(1750);
  });

  it('calculates remaining level time and Ace scores', () => {
    expect(msUntilNextLevel(44_999)).toBe(1);
    expect(msUntilNextLevel(45_000)).toBe(45_000);
    expect(msUntilNextLevel(540_000)).toBeNull();
    expect(scoreForLetter('hard')).toBe(12.5);
    expect(scoreForCompletion(6, 1, 5, 'hard')).toBe(246);
    expect(scoreForCompletion(6, 1, 10, 'hard')).toBe(309);
    expect(scoreForCompletion(6, 1, 15, 'hard')).toBe(377);
    expect(scoreForCompletion(6, 1, 5, 'easy')).toBe(188);
    expect(scoreForCompletion(6, 1, 5, 'normal')).toBe(188);
  });
});
