import { describe, expect, it } from 'vitest';
import { accuracy, wpm } from './metrics';

describe('performance metrics', () => {
  it('calculates rounded accuracy and handles zero input', () => {
    expect(accuracy(8, 2)).toBe(80);
    expect(accuracy(0, 0)).toBe(0);
  });

  it('calculates rounded words per minute from active combat time', () => {
    expect(wpm(250, 60_000)).toBe(50);
    expect(wpm(0, 0)).toBe(0);
  });
});
