import { describe, expect, it } from 'vitest';
import { scoreForCompletion } from './config';
import { GameModel } from './game-model';
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
});
