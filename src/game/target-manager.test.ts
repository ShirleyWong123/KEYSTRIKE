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
