import { describe, expect, it } from 'vitest';
import { TargetManager, findLockCandidate } from './target-manager';
import type { Target } from './types';

const measure = (word: string) => ({ width: word.length * 10, height: 36 });
const target = (overrides: Partial<Target> = {}): Target => ({
  id: 1, word: 'star', typed: 0, x: 100, y: 80, width: 120, height: 36,
  speed: 28, kind: 'normal', ...overrides,
});

describe('target placement and movement', () => {
  it('rejects a candidate that overlaps an existing label', () => {
    const manager = new TargetManager(() => 0.5, measure);
    expect(manager.isLegalRect({ x: 110, y: 86, width: 100, height: 36 }, [target()])).toBe(false);
  });

  it('keeps labels inside the 16px horizontal safety margins and 12px apart', () => {
    const manager = new TargetManager(() => 0, measure);
    const spawned = manager.trySpawn({ difficulty: 'easy', level: 1, targets: [] });
    expect(spawned).not.toBeNull();
    expect(spawned!.x).toBeGreaterThanOrEqual(16);
    expect(spawned!.x + spawned!.width).toBeLessThanOrEqual(464);
    expect(manager.isLegalRect({ x: spawned!.x, y: spawned!.y, width: spawned!.width, height: spawned!.height }, [])).toBe(true);
    expect(manager.isLegalRect({ x: spawned!.x + spawned!.width + 11, y: spawned!.y, width: 20, height: 36 }, [spawned!])).toBe(false);
  });

  it('spawns labels above the visible field and varies horizontal placement', () => {
    const manager = new TargetManager(() => 0, measure);
    const first = manager.trySpawn({ difficulty: 'easy', level: 1, targets: [] });
    const second = manager.trySpawn({ difficulty: 'easy', level: 1, targets: first ? [first] : [] });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.y).toBe(-first!.height);
    expect(second!.y).toBe(-second!.height);
    expect(second!.x).not.toBe(first!.x);
  });

  it('allows exactly a 12px vertical gap and rejects an 11px gap', () => {
    const manager = new TargetManager(() => 0.5, measure);
    const existing = target({ x: 250, y: 100, width: 80, height: 36 });
    expect(manager.isLegalRect({ x: 250, y: 147, width: 80, height: 36 }, [existing])).toBe(false);
    expect(manager.isLegalRect({ x: 250, y: 148, width: 80, height: 36 }, [existing])).toBe(true);
  });

  it('returns null after exhausting all 12 placement attempts from one random start', () => {
    let randomCalls = 0;
    const manager = new TargetManager(() => {
      randomCalls += 1;
      return 0;
    }, measure);
    const blocker = target({ x: -100, y: -100, width: 700, height: 1000 });
    expect(manager.trySpawn({ difficulty: 'easy', level: 1, targets: [blocker] })).toBeNull();
    expect(randomCalls).toBe(2);
  });

  it('respects the level active-target cap', () => {
    const manager = new TargetManager(() => 0.5, measure);
    const active = [target({ id: 1 }), target({ id: 2, x: 300 }), target({ id: 3, x: 200, y: 300 })];
    expect(manager.trySpawn({ difficulty: 'easy', level: 1, targets: active })).toBeNull();
  });

  it('uses 70% of current-level speed for tutorial targets', () => {
    const manager = new TargetManager(() => 0.5, measure);
    expect(manager.trySpawn({ difficulty: 'easy', level: 2, targets: [], tutorial: true })!.speed).toBe(22.4);
  });

  it('moves active targets and applies the 50% frozen factor', () => {
    const manager = new TargetManager(() => 0.5, measure);
    const result = manager.update([target({ speed: 40, y: 100 })], 1000, 0.5);
    expect(result.active[0]!.y).toBe(120);
    expect(result.breached).toEqual([]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -100])('normalizes invalid deltaMs (%s) to zero', (deltaMs) => {
    const manager = new TargetManager(() => 0.5, measure);
    const result = manager.update([target({ speed: 40, y: 100 })], deltaMs, 1);
    expect(result.active[0]!.y).toBe(100);
  });

  it('defaults non-finite freeze factors to one and clamps finite values to [0, 1]', () => {
    const manager = new TargetManager(() => 0.5, measure);
    expect(manager.update([target({ speed: 40, y: 100 })], 1000, -1).active[0]!.y).toBe(100);
    expect(manager.update([target({ speed: 40, y: 100 })], 1000, 2).active[0]!.y).toBe(140);
    expect(manager.update([target({ speed: 40, y: 100 })], 1000, Number.NaN).active[0]!.y).toBe(140);
    expect(manager.update([target({ speed: 40, y: 100 })], 1000, Number.POSITIVE_INFINITY).active[0]!.y).toBe(140);
  });

  it('reports targets that reach the defense line as breached', () => {
    const manager = new TargetManager(() => 0.5, measure);
    const result = manager.update([target({ y: 700, height: 20, speed: 40 })], 1000, 1);
    expect(result.active).toEqual([]);
    expect(result.breached).toHaveLength(1);
  });
});

describe('same-initial locking', () => {
  it('locks the lowest matching target, stable by id', () => {
    const high = target({ id: 1, word: 'star', y: 100 });
    const low = target({ id: 2, word: 'shield', y: 500 });
    expect(findLockCandidate([high, low], 's')?.id).toBe(2);
    expect(findLockCandidate([target({ id: 4, word: 'sun', y: 500 }), target({ id: 3, word: 'ship', y: 500 })], 's')?.id).toBe(3);
  });
});
