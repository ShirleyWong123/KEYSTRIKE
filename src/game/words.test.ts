import { describe, expect, it } from 'vitest';
import { WORD_BANKS, selectWord } from './words';

const ranges = { easy: [3, 5], normal: [4, 8], hard: [6, 12] } as const;

describe('curated word banks', () => {
  it.each(Object.entries(ranges))('has at least 120 unique words in the %s range', (difficulty, range) => {
    const bank = WORD_BANKS[difficulty as keyof typeof WORD_BANKS];
    expect(bank.length).toBeGreaterThanOrEqual(120);
    expect(new Set(bank).size).toBe(bank.length);
    expect(bank.every((word) => /^[a-z]+$/.test(word))).toBe(true);
    expect(bank.every((word) => word.length >= range[0] && word.length <= range[1])).toBe(true);
  });

  it('prefers candidates whose initials are not active, then avoids active words', () => {
    expect(selectWord('easy', 1, ['cat'], ['b'], () => 0)).toBe('dog');
    expect(selectWord('easy', 1, WORD_BANKS.easy, [], () => 0)).toBeNull();
  });
});
