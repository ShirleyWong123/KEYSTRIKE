import { describe, expect, it } from 'vitest';
import { LEVELS, PROJECTILE_MS, levelForActiveMs, scoreForCompletion } from './config';

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
    expect(scoreForCompletion(6, 4, 3)).toBe(224);
  });
});
