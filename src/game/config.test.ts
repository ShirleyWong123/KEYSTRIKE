import { describe, expect, it } from 'vitest';
import { LEVELS, levelForActiveMs, scoreForCompletion } from './config';

describe('progression configuration', () => {
  it('advances one level per 45 seconds of active combat and caps at twelve', () => {
    expect(levelForActiveMs(0)).toBe(1);
    expect(levelForActiveMs(44_999)).toBe(1);
    expect(levelForActiveMs(45_000)).toBe(2);
    expect(levelForActiveMs(999_999)).toBe(12);
  });

  it('contains the exact final pressure settings', () => {
    expect(LEVELS[11]).toEqual({ speed: 44, spawnMs: 1900, maxTargets: 5, longWordBoost: 0.45 });
  });

  it('scores a completion from word length, level, and prior combo', () => {
    expect(scoreForCompletion(6, 4, 3)).toBe(224);
  });
});
