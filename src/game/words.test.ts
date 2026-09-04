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

  it('falls back to a legal word when every candidate initial is active', () => {
    const candidates = ['cat', 'dog'];
    const excludedWords = WORD_BANKS.easy.filter((word) => !candidates.includes(word));

    expect(selectWord('easy', 1, excludedWords, ['c', 'd'], () => 0)).toBe('cat');
  });

  it('applies the boosted long-word weight at its exact selection boundary', () => {
    const candidates = ['airport', 'borderless'];
    const excludedWords = WORD_BANKS.hard.filter((word) => !candidates.includes(word));
    const boundary = 1 / (1 + 1.45);

    expect(selectWord('hard', 12, excludedWords, [], () => boundary - Number.EPSILON)).toBe('airport');
    expect(selectWord('hard', 12, excludedWords, [], () => boundary)).toBe('borderless');
  });
});
