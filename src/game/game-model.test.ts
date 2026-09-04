import { describe, expect, it } from 'vitest';
import { scoreForCompletion } from './config';
import { GameModel } from './game-model';
import { TargetManager } from './target-manager';
import type { Difficulty, GameSettings, Target } from './types';

const settings = (difficulty: Difficulty = 'normal'): GameSettings => ({
  difficulty,
  soundEnabled: true,
  reducedMotion: false,
});

const target = (overrides: Partial<Target> = {}): Target => ({
  id: 1,
  word: 'star',
  typed: 0,
  x: 100,
  y: 80,
  width: 120,
  height: 36,
  speed: 28,
  kind: 'normal',
  ...overrides,
});

const combatModel = (difficulty: Difficulty = 'normal'): GameModel => {
  const model = new GameModel();
  model.start(settings(difficulty));
  model.beginCombat();
  return model;
};

const specialSpawnModel = (randomValues: number[], autoSpawn = false): GameModel => {
  let nextId = 1_000;
  const values = [...randomValues];
  const model = new GameModel(new TargetManager(() => 0), {
    random: () => values.shift() ?? 0,
    spawnTarget: ({ kind = 'normal' }) => target({ id: nextId++, word: kind, kind }),
    autoSpawn,
  });
  model.start(settings());
  model.beginCombat();
  return model;
};

describe('GameModel lifecycle', () => {
  it.each([
    ['easy', 'NOVA'],
    ['normal', 'ORBIT'],
    ['hard', 'VECTOR'],
  ] as const)('starts %s with the fixed %s tutorial target', (difficulty, word) => {
    const model = new GameModel();

    model.start(settings(difficulty));

    expect(model.snapshot().phase).toBe('countdown');
    expect(model.snapshot().targets).toMatchObject([{ word, typed: 0, tutorial: true }]);
  });

  it('does not count countdown time as active combat time', () => {
    const model = new GameModel();
    model.start(settings());

    model.advanceCountdown(2_999);
    expect(model.snapshot()).toMatchObject({ phase: 'countdown', activeMs: 0 });

    model.advanceCountdown(1);
    expect(model.snapshot()).toMatchObject({ phase: 'playing', activeMs: 0 });
  });

  it('consumes only the countdown remainder when an update crosses into combat', () => {
    const model = new GameModel();
    model.start(settings());

    model.update(3_001);

    expect(model.snapshot()).toMatchObject({ phase: 'playing', activeMs: 1 });
    expect(model.snapshot().targets[0]?.y).toBeCloseTo(-36 + 28 * 0.7 * 0.001, 8);
  });

  it('restarts the selected difficulty and returns to a cleared menu', () => {
    const model = combatModel('hard');
    model.injectTarget(target({ id: 9, word: 'z' }));
    model.handleKey('z');

    model.restart();
    expect(model.snapshot()).toMatchObject({ phase: 'countdown', score: 0, shield: 100, combo: 0 });
    expect(model.snapshot().targets).toMatchObject([{ word: 'VECTOR', tutorial: true }]);

    model.returnToMenu();
    expect(model.snapshot()).toMatchObject({ phase: 'menu', score: 0, shield: 100, targets: [] });
  });
});

describe('GameModel input and scoring', () => {
  it('locks a matching target and preserves its progress after a wrong letter', () => {
    const model = combatModel();
    model.injectTarget(target({ id: 9, word: 'a' }));
    model.handleKey('a');
    expect(model.snapshot().combo).toBe(1);
    model.drainEvents();
    model.injectTarget(target({ id: 1, word: 'pulse', y: 300 }));

    model.handleKey('P');
    expect(model.snapshot()).toMatchObject({ phase: 'playing', lockedTargetId: 1 });
    expect(model.snapshot().targets.find(({ id }) => id === 1)?.typed).toBe(1);

    model.handleKey('x');
    expect(model.snapshot()).toMatchObject({ combo: 0, lockedTargetId: 1, wrongKeys: 1 });
    expect(model.snapshot().targets.find(({ id }) => id === 1)?.typed).toBe(1);
    expect(model.drainEvents()).toEqual([
      { type: 'shot', targetId: 1, progress: 1 },
      { type: 'error' },
    ]);
  });

  it('uses the lowest matching same-initial target when acquiring a lock', () => {
    const model = combatModel();
    model.injectTarget(target({ id: 1, word: 'star', y: 100 }));
    model.injectTarget(target({ id: 2, word: 'shield', y: 500 }));

    model.handleKey('s');

    expect(model.snapshot().lockedTargetId).toBe(2);
    expect(model.snapshot().targets.find(({ id }) => id === 2)?.typed).toBe(1);
  });

  it('adds ten points and emits a shot for every correct letter', () => {
    const model = combatModel();
    model.injectTarget(target({ id: 3, word: 'so' }));

    model.handleKey('s');

    expect(model.snapshot()).toMatchObject({ score: 10, correctKeys: 1 });
    expect(model.drainEvents()).toEqual([{ type: 'shot', targetId: 3, progress: 1 }]);
  });

  it('removes a completed target immediately and awards completion points before growing combo', () => {
    const model = combatModel();
    model.injectTarget(target({ id: 4, word: 'go' }));

    model.handleKey('g');
    model.handleKey('o');

    expect(model.snapshot()).toMatchObject({
      score: 20 + scoreForCompletion(2, 1, 0),
      combo: 1,
      maxCombo: 1,
      completedWords: 1,
      lockedTargetId: null,
    });
    expect(model.snapshot().targets.some(({ id }) => id === 4)).toBe(false);
    expect(model.drainEvents()).toEqual([
      { type: 'shot', targetId: 4, progress: 1 },
      { type: 'shot', targetId: 4, progress: 2 },
      { type: 'destroyed', target: target({ id: 4, word: 'go', typed: 2 }) },
    ]);
  });

  it('uses the existing combo for completion scoring and grows combo per completed word', () => {
    const model = combatModel();
    model.injectTarget(target({ id: 5, word: 'a' }));
    model.injectTarget(target({ id: 6, word: 'b' }));

    model.handleKey('a');
    model.handleKey('b');

    expect(model.snapshot()).toMatchObject({
      score: 20 + scoreForCompletion(1, 1, 0) + scoreForCompletion(1, 1, 1),
      combo: 2,
      maxCombo: 2,
      completedWords: 2,
    });
  });

  it('filters repeated, modified, and non-letter input without changing state', () => {
    const model = combatModel();
    model.injectTarget(target({ id: 7, word: 'p' }));
    const before = model.snapshot();

    model.handleKey({ key: 'p', repeat: true });
    model.handleKey({ key: 'p', altKey: true });
    model.handleKey({ key: 'p', ctrlKey: true });
    model.handleKey({ key: 'p', metaKey: true });
    model.handleKey({ key: '1' });
    model.handleKey({ key: 'ArrowLeft' });

    expect(model.snapshot()).toEqual(before);
    expect(model.drainEvents()).toEqual([]);
  });

  it('ignores malformed runtime key values without throwing', () => {
    const model = combatModel();
    const before = model.snapshot();

    for (const value of [null, undefined, 42, true, [], {}, { key: null }, { key: 7 }, { repeat: false }]) {
      expect(() => model.handleKey(value as never)).not.toThrow();
    }

    expect(model.snapshot()).toEqual(before);
    expect(model.drainEvents()).toEqual([]);
  });

  it('isolates snapshot targets from authoritative model state', () => {
    const model = combatModel();
    model.injectTarget(target({ id: 9, word: 'pulse' }));
    const snapshot = model.snapshot();
    snapshot.targets[0]!.word = 'changed';
    snapshot.targets[0]!.typed = 4;

    expect(model.snapshot().targets[0]).toMatchObject({ word: 'ORBIT', typed: 0 });
  });

  it('uses Escape as the only pause key and ignores letters while paused', () => {
    const model = combatModel();
    model.injectTarget(target({ id: 8, word: 'p' }));

    model.handleKey({ key: 'Escape' });
    model.update(1_000);
    model.handleKey('p');
    expect(model.snapshot()).toMatchObject({ phase: 'paused', score: 0, activeMs: 0, lockedTargetId: null });
    expect(model.snapshot().targets.find(({ id }) => id === 8)?.y).toBe(80);

    model.handleKey({ key: 'Esc' });
    model.handleKey('p');
    expect(model.snapshot()).toMatchObject({
      phase: 'playing',
      score: 10 + scoreForCompletion(1, 1, 0),
      completedWords: 1,
    });
  });
});

describe('GameModel breaches', () => {
  it('removes breached targets, resets combo, subtracts twenty shield, and clears their lock', () => {
    const model = combatModel();
    model.injectTarget(target({ id: 10, word: 'p', y: 300 }));
    model.injectTarget(target({ id: 11, word: 'z', y: 700, height: 20, speed: 40 }));
    model.handleKey('p');
    expect(model.snapshot().combo).toBe(1);

    model.update(1_000);

    expect(model.snapshot()).toMatchObject({ shield: 80, combo: 0, missedWords: 1, lockedTargetId: null });
    expect(model.snapshot().targets.some(({ id }) => id === 11)).toBe(false);
    expect(model.drainEvents().some((event) => event.type === 'breach' && event.target.id === 11)).toBe(true);
  });

  it('ends the run when the shield reaches zero', () => {
    const model = combatModel();
    for (let id = 20; id < 25; id += 1) {
      model.injectTarget(target({ id, word: `word${id}`.replace(/[0-9]/g, 'a'), y: 700, height: 20, speed: 40 }));
    }

    model.update(1_000);

    expect(model.snapshot()).toMatchObject({ phase: 'gameover', shield: 0, missedWords: 5 });
  });

  it('counts and emits every simultaneous breach after shield reaches zero', () => {
    const model = combatModel();
    for (let id = 30; id < 38; id += 1) {
      model.injectTarget(target({ id, word: `word${id}`.replace(/[0-9]/g, 'a'), y: 700, height: 20, speed: 40 }));
    }

    model.update(1_000);

    const events = model.drainEvents().filter((event) => event.type === 'breach');
    expect(model.snapshot()).toMatchObject({ phase: 'gameover', shield: 0, missedWords: 8 });
    expect(events).toHaveLength(8);
    expect(events.map((event) => event.type === 'breach' && event.target.id)).toEqual([30, 31, 32, 33, 34, 35, 36, 37]);
  });

  it('isolates drained breach and destroyed event targets from model and sibling payloads', () => {
    const model = combatModel();
    model.injectTarget(target({ id: 40, word: 'a' }));
    model.injectTarget(target({ id: 43, word: 'b' }));
    model.handleKey('a');
    model.handleKey('b');
    const destroyed = model.drainEvents();
    const destroyedEvents = destroyed.filter((event) => event.type === 'destroyed');
    const destroyedTarget = destroyedEvents[0]!;
    if (destroyedTarget.type === 'destroyed') destroyedTarget.target.word = 'mutated';

    model.injectTarget(target({ id: 41, word: 'b', y: 700, height: 20, speed: 40 }));
    model.injectTarget(target({ id: 42, word: 'c', y: 700, height: 20, speed: 40 }));
    model.update(1_000);
    const breached = model.drainEvents();
    const breachEvents = breached.filter((event) => event.type === 'breach');
    const breachTarget = breachEvents[0]!;
    if (breachTarget.type === 'breach') breachTarget.target.word = 'mutated';

    expect(model.snapshot().targets.find(({ id }) => id === 41)).toBeUndefined();
    expect(model.snapshot().targets.find(({ id }) => id === 42)).toBeUndefined();
    expect(destroyedEvents[1]).toMatchObject({ type: 'destroyed', target: { id: 43, word: 'b' } });
    expect(breachEvents[1]).toMatchObject({ type: 'breach', target: { id: 42, word: 'c' } });
    expect(destroyedTarget.type === 'destroyed' && destroyedTarget.target.word).toBe('mutated');
    expect(breachTarget.type === 'breach' && breachTarget.target.word).toBe('mutated');
  });
});

describe('GameModel progression', () => {
  it('derives level from active combat time rather than score and emits crossed level events', () => {
    const model = combatModel();
    model.injectTarget(target({ id: 50, word: 'a' }));

    model.handleKey('a');
    model.update(44_999);

    expect(model.snapshot()).toMatchObject({ score: 10 + scoreForCompletion(1, 1, 0), level: 1, activeMs: 44_999 });
    expect(model.drainEvents().filter((event) => event.type === 'level-up')).toEqual([]);

    model.update(45_001);

    expect(model.snapshot()).toMatchObject({ level: 3, activeMs: 90_000 });
    expect(model.drainEvents().filter((event) => event.type === 'level-up')).toEqual([
      { type: 'level-up', level: 2 },
      { type: 'level-up', level: 3 },
    ]);
  });

  it('does not advance active progression after game over', () => {
    const model = combatModel();
    for (let id = 95; id < 100; id += 1) {
      model.injectTarget(target({ id, word: 'a', y: 700, height: 20, speed: 40 }));
    }
    model.update(1_000);
    const gameOver = model.snapshot();

    model.update(90_000);

    expect(model.snapshot()).toMatchObject({ phase: 'gameover', activeMs: gameOver.activeMs, level: gameOver.level });
  });
});

describe('GameModel repair specials', () => {
  it('restores exactly twenty shield without changing combo when a repair target is completed', () => {
    const model = combatModel();
    model.injectTarget(target({ id: 51, word: 'a', y: 700, height: 20, speed: 40 }));
    model.injectTarget(target({ id: 52, word: 'b', y: 700, height: 20, speed: 40 }));
    model.update(1_000);
    model.injectTarget(target({ id: 53, word: 'r', kind: 'repair' }));

    model.handleKey('r');

    expect(model.snapshot()).toMatchObject({ shield: 80, combo: 0, maxCombo: 0 });
    expect(model.drainEvents().filter((event) => event.type === 'special')).toEqual([
      { type: 'special', kind: 'repair', affectedIds: [] },
    ]);
  });
});

describe('GameModel pulse specials', () => {
  it('clears at most the four lowest normal targets and awards only twenty percent of base completion score', () => {
    const model = combatModel();
    model.injectTarget(target({ id: 54, word: 'a' }));
    model.handleKey('a');
    model.drainEvents();
    model.injectTarget(target({ id: 55, word: 'b', y: 100 }));
    model.injectTarget(target({ id: 56, word: 'c', y: 250 }));
    model.injectTarget(target({ id: 57, word: 'd', y: 400 }));
    model.injectTarget(target({ id: 58, word: 'e', y: 600 }));
    model.injectTarget(target({ id: 59, word: 'p', kind: 'pulse' }));

    model.handleKey('p');

    expect(model.snapshot()).toMatchObject({ score: 65, combo: 1, maxCombo: 1 });
    expect(model.snapshot().targets.map(({ id }) => id)).toContain(1);
    expect(model.snapshot().targets.map(({ id }) => id)).not.toEqual(expect.arrayContaining([55, 56, 57, 58, 59]));
    expect(model.drainEvents().filter((event) => event.type === 'special')).toEqual([
      { type: 'special', kind: 'pulse', affectedIds: [58, 57, 56, 55] },
    ]);
  });
});

describe('GameModel freeze specials', () => {
  it('slows movement for five active seconds and does not consume its duration while paused', () => {
    const model = combatModel();
    model.injectTarget(target({ id: 60, word: 'a', y: 100, speed: 0 }));
    model.injectTarget(target({ id: 61, word: 'b', y: 220, speed: 0 }));
    model.injectTarget(target({ id: 62, word: 'f', kind: 'freeze', speed: 0 }));
    model.update(90_000);
    model.injectTarget(target({ id: 60, word: 'a', y: 100, speed: 40 }));
    model.injectTarget(target({ id: 61, word: 'b', y: 220, speed: 40 }));

    model.handleKey('f');
    model.update(1_000);
    expect(model.snapshot()).toMatchObject({ level: 3, freezeRemainingMs: 4_000 });
    expect(model.snapshot().targets.find(({ id }) => id === 60)?.y).toBe(120);

    model.pause();
    model.update(2_000);
    expect(model.snapshot()).toMatchObject({ phase: 'paused', activeMs: 91_000, freezeRemainingMs: 4_000 });
    expect(model.snapshot().targets.find(({ id }) => id === 60)?.y).toBe(120);

    model.resume();
    model.update(4_000);
    expect(model.snapshot()).toMatchObject({ freezeRemainingMs: 0 });
    expect(model.snapshot().targets.find(({ id }) => id === 60)?.y).toBe(200);
    model.update(1_000);
    expect(model.snapshot().targets.find(({ id }) => id === 60)?.y).toBe(240);
  });
});

describe('GameModel special spawning', () => {
  it('creates normal spawn opportunities from active combat time', () => {
    const model = specialSpawnModel([], true);

    model.update(2_799);
    expect(model.snapshot().targets).toHaveLength(1);
    model.update(1);

    expect(model.snapshot().targets).toMatchObject([
      { tutorial: true, kind: 'normal' },
      { word: 'normal', kind: 'normal' },
    ]);
  });

  it('uses active time for the protection period and special cooldown', () => {
    const model = specialSpawnModel([0.079, 0, 0.079, 0]);
    model.attemptSpawn();
    expect(model.snapshot().targets.at(-1)?.kind).toBe('normal');

    model.update(12_000);
    model.injectTarget(target({ id: 70, word: 'a', y: 700, height: 20, speed: 40 }));
    model.injectTarget(target({ id: 71, word: 'b', y: 700, height: 20, speed: 40 }));
    model.update(1_000);
    expect(model.snapshot()).toMatchObject({ activeMs: 13_000, shield: 60 });

    model.attemptSpawn();
    expect(model.snapshot().targets.at(-1)?.kind).toBe('repair');
    for (const letter of 'repair') model.handleKey(letter);
    model.injectTarget(target({ id: 72, word: 'c', y: 700, height: 20, speed: 40 }));
    model.update(1_000);
    model.pause();
    model.update(20_000);
    expect(model.snapshot()).toMatchObject({ phase: 'paused', activeMs: 14_000 });
    model.resume();
    model.update(12_999);

    model.attemptSpawn();
    expect(model.snapshot().targets.at(-1)?.kind).toBe('normal');
    for (const letter of 'normal') model.handleKey(letter);
    model.update(1);
    model.attemptSpawn();
    expect(model.snapshot().targets.at(-1)?.kind).toBe('repair');
  });

  it('falls back to normal when repair, pulse, and freeze are ineligible', () => {
    const model = specialSpawnModel([0.079]);
    model.update(12_000);
    model.injectTarget(target({ id: 80, word: 'a', speed: 0 }));

    model.attemptSpawn();

    expect(model.snapshot()).toMatchObject({ shield: 100, level: 1 });
    expect(model.snapshot().targets.at(-1)?.kind).toBe('normal');
  });

  it.each([
    [0, 'repair'],
    [0.34, 'pulse'],
    [0.67, 'freeze'],
  ] as const)('selects the eligible special kind with equal random partitions: %s', (selection, expectedKind) => {
    const model = specialSpawnModel([0.079, selection]);
    model.update(180_000);
    model.injectTarget(target({ id: 81, word: 'a', speed: 0 }));
    model.injectTarget(target({ id: 82, word: 'b', speed: 0 }));
    model.injectTarget(target({ id: 83, word: 'c', speed: 0 }));
    model.injectTarget(target({ id: 84, word: 'd', y: 700, height: 20, speed: 40 }));
    model.injectTarget(target({ id: 85, word: 'e', y: 700, height: 20, speed: 40 }));
    model.update(1_000);

    model.attemptSpawn();

    expect(model.snapshot().targets.find(({ kind }) => kind !== 'normal')?.kind).toBe(expectedKind);
  });

  it('does not create a second special while one remains active', () => {
    const model = specialSpawnModel([0.079, 0, 0.079]);
    model.update(360_000);
    model.injectTarget(target({ id: 86, word: 'a', speed: 0 }));
    model.injectTarget(target({ id: 87, word: 'b', speed: 0 }));
    model.injectTarget(target({ id: 88, word: 'c', speed: 0 }));
    model.injectTarget(target({ id: 89, word: 'd', y: 700, height: 20, speed: 40 }));
    model.injectTarget(target({ id: 90, word: 'e', y: 700, height: 20, speed: 40 }));
    model.update(1_000);
    model.attemptSpawn();
    model.attemptSpawn();

    expect(model.snapshot().targets.filter(({ kind }) => kind !== 'normal')).toHaveLength(1);
    expect(model.snapshot().targets.at(-1)?.kind).toBe('normal');
  });
});

describe('GameModel special effects', () => {
  it('refreshes freeze to five seconds rather than stacking its duration', () => {
    const model = specialSpawnModel([]);
    model.update(90_000);
    model.injectTarget(target({ id: 91, word: 'f', kind: 'freeze', speed: 0 }));
    model.handleKey('f');
    model.update(2_000);
    model.injectTarget(target({ id: 92, word: 'f', kind: 'freeze', speed: 0 }));
    model.handleKey('f');

    expect(model.snapshot().freezeRemainingMs).toBe(5_000);
    model.update(5_000);
    expect(model.snapshot().freezeRemainingMs).toBe(0);
  });

  it('applies normal breach damage and combo reset to special targets', () => {
    const model = combatModel();
    model.injectTarget(target({ id: 93, word: 'a' }));
    model.handleKey('a');
    model.drainEvents();
    model.injectTarget(target({ id: 94, word: 'r', kind: 'repair', y: 700, height: 20, speed: 40 }));

    model.update(1_000);

    expect(model.snapshot()).toMatchObject({ shield: 80, combo: 0, missedWords: 1 });
    expect(model.drainEvents()).toContainEqual(expect.objectContaining({
      type: 'breach',
      target: expect.objectContaining({ id: 94, kind: 'repair' }),
    }));
  });
});
