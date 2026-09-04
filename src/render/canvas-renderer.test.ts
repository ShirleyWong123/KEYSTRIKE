import { describe, expect, it, vi } from 'vitest';
import { PROJECTILE_MS } from '../game/config';
import type { GameEvent, GameSettings, GameSnapshot, Target } from '../game/types';
import { CanvasRenderer } from './canvas-renderer';

type RecordedCall = {
  op: string;
  args: unknown[];
  fillStyle: string;
  strokeStyle: string;
  globalAlpha: number;
  lineWidth: number;
};

class RecordingContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000';
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000';
  globalAlpha = 1;
  lineWidth = 1;
  font = '10px sans-serif';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  shadowBlur = 0;
  shadowColor = 'transparent';
  readonly calls: RecordedCall[] = [];
  private readonly stack: Array<{
    fillStyle: string | CanvasGradient | CanvasPattern;
    strokeStyle: string | CanvasGradient | CanvasPattern;
    globalAlpha: number;
    lineWidth: number;
    font: string;
    textAlign: CanvasTextAlign;
    textBaseline: CanvasTextBaseline;
    shadowBlur: number;
    shadowColor: string;
  }> = [];

  private record(op: string, ...args: unknown[]): void {
    this.calls.push({
      op,
      args,
      fillStyle: String(this.fillStyle),
      strokeStyle: String(this.strokeStyle),
      globalAlpha: this.globalAlpha,
      lineWidth: this.lineWidth,
    });
  }

  save(): void {
    this.stack.push({
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      globalAlpha: this.globalAlpha,
      lineWidth: this.lineWidth,
      font: this.font,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
      shadowBlur: this.shadowBlur,
      shadowColor: this.shadowColor,
    });
  }

  restore(): void {
    Object.assign(this, this.stack.pop());
  }

  setTransform(...args: unknown[]): void { this.record('setTransform', ...args); }
  clearRect(...args: unknown[]): void { this.record('clearRect', ...args); }
  fillRect(...args: unknown[]): void { this.record('fillRect', ...args); }
  strokeRect(...args: unknown[]): void { this.record('strokeRect', ...args); }
  beginPath(): void { this.record('beginPath'); }
  closePath(): void { this.record('closePath'); }
  moveTo(...args: unknown[]): void { this.record('moveTo', ...args); }
  lineTo(...args: unknown[]): void { this.record('lineTo', ...args); }
  arc(...args: unknown[]): void { this.record('arc', ...args); }
  fill(): void { this.record('fill'); }
  stroke(): void { this.record('stroke'); }
  translate(...args: unknown[]): void { this.record('translate', ...args); }
  rotate(...args: unknown[]): void { this.record('rotate', ...args); }
  fillText(...args: unknown[]): void { this.record('fillText', ...args); }
  measureText(text: string): TextMetrics { return { width: text.length * 10 } as TextMetrics; }
  createLinearGradient(): CanvasGradient {
    return { addColorStop: vi.fn(), toString: () => 'linear-gradient' } as unknown as CanvasGradient;
  }
  createRadialGradient(): CanvasGradient {
    return { addColorStop: vi.fn(), toString: () => 'radial-gradient' } as unknown as CanvasGradient;
  }
}

const target = (overrides: Partial<Target> = {}): Target => ({
  id: 1,
  word: 'ORBIT',
  typed: 0,
  x: 120,
  y: 160,
  width: 100,
  height: 36,
  speed: 28,
  kind: 'normal',
  ...overrides,
});

const snapshot = (overrides: Partial<GameSnapshot> = {}): GameSnapshot => ({
  phase: 'playing',
  score: 0,
  combo: 0,
  maxCombo: 0,
  shield: 100,
  level: 1,
  activeMs: 0,
  correctKeys: 0,
  wrongKeys: 0,
  completedWords: 0,
  missedWords: 0,
  lockedTargetId: null,
  freezeRemainingMs: 0,
  nextLevelRemainingMs: 45_000,
  comboBrokenRemainingMs: 0,
  specialHint: null,
  specialHintRemainingMs: 0,
  targets: [],
  ...overrides,
});

const settings = (reducedMotion = false): GameSettings => ({
  difficulty: 'normal',
  soundEnabled: true,
  reducedMotion,
});

const harness = (reducedMotion = false) => {
  const context = new RecordingContext();
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  let now = 1_000;
  const renderer = new CanvasRenderer(canvas, settings(reducedMotion), () => now);
  return { canvas, context, renderer, setNow: (value: number) => { now = value; } };
};

const textCalls = (context: RecordingContext) =>
  context.calls.filter(({ op }) => op === 'fillText');

describe('CanvasRenderer', () => {
  it('keeps a 480x800 logical canvas and caps the backing DPR at two', () => {
    const originalDpr = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 3 });
    const { canvas, context, renderer } = harness();

    renderer.resize();

    expect(canvas.width).toBe(960);
    expect(canvas.height).toBe(1600);
    expect(canvas.style.aspectRatio).toBe('480 / 800');
    expect(context.calls.filter(({ op }) => op === 'setTransform').at(-1)?.args).toEqual([2, 0, 0, 2, 0, 0]);
    renderer.resize();
    expect(context.calls.filter(({ op }) => op === 'setTransform').slice(-2).map(({ args }) => args))
      .toEqual([[2, 0, 0, 2, 0, 0], [2, 0, 0, 2, 0, 0]]);
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: originalDpr });
  });

  it('sizes the backing store from CSS bounds while retaining logical coordinates', () => {
    const originalDpr = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 3 });
    const context = new RecordingContext();
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 300,
      bottom: 500,
      left: 0,
      width: 300,
      height: 500,
      toJSON: () => ({}),
    });

    const renderer = new CanvasRenderer(canvas, settings());

    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(1000);
    expect(context.calls.filter(({ op }) => op === 'setTransform').at(-1)?.args)
      .toEqual([1.25, 0, 0, 1.25, 0, 0]);
    renderer.resize();
    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(1000);
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: originalDpr });
  });

  it('draws typed text separately in orange with an underline before the light untyped text', () => {
    const { context, renderer } = harness();

    renderer.render(snapshot({ targets: [target({ word: 'ORBIT', typed: 2 })], lockedTargetId: 1 }), 0);

    const wordParts = textCalls(context).filter(({ args }) => args[0] === 'OR' || args[0] === 'BIT');
    expect(wordParts.map(({ args, fillStyle }) => [args[0], fillStyle])).toEqual([
      ['OR', '#ff9d2e'],
      ['BIT', '#b9f8ff'],
    ]);
    const typedIndex = context.calls.findIndex(({ op, args }) => op === 'fillText' && args[0] === 'OR');
    const untypedIndex = context.calls.findIndex(({ op, args }) => op === 'fillText' && args[0] === 'BIT');
    expect(context.calls.slice(typedIndex + 1, untypedIndex).some(({ op, strokeStyle }) => op === 'stroke' && strokeStyle === '#ff9d2e')).toBe(true);
  });

  it('draws every unlocked target before the lock connector and locked target', () => {
    const { context, renderer } = harness();
    const unlocked = target({ id: 1, word: 'ALPHA', x: 40 });
    const locked = target({ id: 2, word: 'BETA', x: 240 });

    renderer.render(snapshot({ targets: [locked, unlocked], lockedTargetId: 2 }), 0);

    const unlockedIndex = context.calls.findIndex(({ op, args }) => op === 'fillText' && args[0] === 'ALPHA');
    const connectorIndex = context.calls.findIndex(({ op, strokeStyle }) => op === 'stroke' && strokeStyle === '#4be7ff80');
    const lockedIndex = context.calls.findIndex(({ op, args }) => op === 'fillText' && args[0] === 'BETA');
    expect(unlockedIndex).toBeLessThan(connectorIndex);
    expect(connectorIndex).toBeLessThan(lockedIndex);
  });

  it('layers projectiles and explosions ahead of the ship, with warnings drawn last', () => {
    const { context, renderer } = harness();
    renderer.render(snapshot({ targets: [target()] }), 0);
    renderer.consume([
      { type: 'shot', targetId: 1, progress: 1 },
      { type: 'destroyed', target: target() },
      { type: 'error' },
    ]);
    context.calls.length = 0;
    renderer.render(snapshot({ targets: [target()] }), 0);

    const projectileIndex = context.calls.findIndex(({ op, fillStyle }) => op === 'fill' && fillStyle === '#ffbd66');
    const explosionIndex = context.calls.findIndex(({ op, strokeStyle }) => op === 'stroke' && strokeStyle === '#fff3d6');
    const shipIndex = context.calls.findIndex(({ op, fillStyle }) => op === 'fill' && fillStyle === '#082f46');
    const warningIndex = context.calls.findIndex(({ op, strokeStyle }) => op === 'strokeRect' && strokeStyle === '#ff385c');

    expect(projectileIndex).toBeLessThan(explosionIndex);
    expect(explosionIndex).toBeLessThan(shipIndex);
    expect(shipIndex).toBeLessThan(warningIndex);
  });

  it('creates an 80ms projectile without mutating the immediate model snapshot', () => {
    expect(PROJECTILE_MS).toBe(80);
    const { context, renderer, setNow } = harness();
    const state = snapshot({ targets: [target()] });
    const before = structuredClone(state);

    renderer.consume([{ type: 'shot', targetId: 1, progress: 1 }]);
    renderer.render(state, 0);

    expect(state).toEqual(before);
    expect(context.calls.some(({ op, fillStyle }) => op === 'fill' && fillStyle === '#ffbd66')).toBe(true);
    context.calls.length = 0;
    setNow(1_081);
    renderer.render(state, 0);
    expect(context.calls.some(({ op, fillStyle }) => op === 'fill' && fillStyle === '#ffbd66')).toBe(false);
  });

  it('turns a completed projectile into a small bounded impact flash at its target', () => {
    const { context, renderer, setNow } = harness();
    const state = snapshot({ targets: [target()] });
    renderer.render(state, 0);
    renderer.consume([{ type: 'shot', targetId: 1, progress: 1 }]);
    context.calls.length = 0;

    setNow(1_080);
    renderer.render(state, 0);

    const impact = context.calls.find(({ op, fillStyle }) => op === 'arc' && fillStyle === '#ff9d2e');
    expect(impact?.args.slice(0, 2)).toEqual([170, 178]);
    expect(impact?.args[2]).toBeGreaterThanOrEqual(3);
    expect(impact?.args[2]).toBeLessThanOrEqual(12);
    expect(context.calls.some(({ op, fillStyle }) => op === 'fill' && fillStyle === '#ffbd66')).toBe(false);
  });

  it('bounds the projectile impact pool under repeated fire', () => {
    const { renderer, setNow } = harness();
    renderer.render(snapshot({ targets: [target()] }), 0);
    renderer.consume(Array.from({ length: 80 }, () => ({ type: 'shot' as const, targetId: 1, progress: 1 })));

    setNow(1_080);
    renderer.render(snapshot({ targets: [target()] }), 0);

    const impacts = (renderer as unknown as { impacts: unknown[] }).impacts;
    expect(impacts.length).toBeLessThanOrEqual(32);
  });

  it('timestamps a post-frame projectile at event time instead of the previous rendered frame', () => {
    const { context, renderer, setNow } = harness();
    const state = snapshot({ targets: [target()] });
    renderer.render(state, 0);
    setNow(1_100);
    renderer.consume([{ type: 'shot', targetId: 1, progress: 1 }]);
    setNow(1_150);
    renderer.render(state, 0);

    expect(context.calls.some(({ op, fillStyle }) => op === 'fill' && fillStyle === '#ffbd66')).toBe(true);
  });

  it('turns a destroyed event into one decaying flash, ring, shards, and bounded particles', () => {
    const { context, renderer } = harness();

    renderer.consume([{ type: 'destroyed', target: target({ typed: 5 }) }]);
    renderer.render(snapshot(), 0);

    expect(context.calls.some(({ op, fillStyle }) => op === 'fillRect' && fillStyle === '#ffffff')).toBe(true);
    expect(context.calls.some(({ op, strokeStyle }) => op === 'stroke' && strokeStyle === '#fff3d6')).toBe(true);
    expect(context.calls.some(({ op, strokeStyle }) => op === 'stroke' && strokeStyle === '#ff9d2e')).toBe(true);
    expect(context.calls.filter(({ op, fillStyle }) => op === 'fill' && fillStyle === '#78efff').length).toBeGreaterThan(0);
  });

  it('caps concurrent destroyed-event ambient feedback at one low-flash overlay', () => {
    const { context, renderer } = harness();

    renderer.consume(Array.from({ length: 3 }, () => ({ type: 'destroyed' as const, target: target() })));
    renderer.render(snapshot(), 0);

    const flashes = context.calls.filter(({ op, fillStyle }) => op === 'fillRect' && fillStyle === '#ffffff');
    expect(flashes).toHaveLength(1);
    expect(flashes[0]?.globalAlpha).toBeLessThanOrEqual(0.18);
  });

  it('does not refresh an active ambient flash when another destruction retains its local explosion', () => {
    const { context, renderer, setNow } = harness();
    renderer.render(snapshot(), 0);
    renderer.consume([{ type: 'destroyed', target: target({ id: 1 }) }]);
    renderer.render(snapshot(), 0);
    context.calls.length = 0;

    setNow(1_050);
    renderer.consume([{ type: 'destroyed', target: target({ id: 2, x: 260 }) }]);
    renderer.render(snapshot(), 0);

    const flashes = context.calls.filter(({ op, fillStyle }) => op === 'fillRect' && fillStyle === '#ffffff');
    expect(flashes).toHaveLength(1);
    expect(flashes[0]?.globalAlpha).toBeCloseTo(0.18 * (1 - 50 / 120));
    expect(context.calls.filter(({ op, strokeStyle }) => op === 'stroke' && strokeStyle === '#fff3d6')).toHaveLength(2);
  });

  it('draws threat feedback only for normal targets in the 180px band with stable ties and before labels', () => {
    const { context, renderer } = harness();
    const boundary = snapshot({ targets: [target({ id: 1, y: 504 })] });
    renderer.render(boundary, 0);
    expect(context.calls.some(({ op, strokeStyle }) => op === 'strokeRect' && strokeStyle === '#ff385c')).toBe(true);

    context.calls.length = 0;
    renderer.render(snapshot({ targets: [target({ id: 1, y: 503 })] }), 0);
    expect(context.calls.some(({ op, strokeStyle }) => op === 'strokeRect' && strokeStyle === '#ff385c')).toBe(false);

    context.calls.length = 0;
    const state = snapshot({ targets: [
      target({ id: 8, word: 'TALL', y: 600, height: 100 }),
      target({ id: 99, word: 'heal', kind: 'repair', y: 683 }),
      target({ id: 7, word: 'TIE', y: 600 }),
      target({ id: 6, word: 'OUT', y: 503 }),
    ] });
    const before = structuredClone(state);

    renderer.render(state, 0);

    const warning = context.calls.find(({ op, strokeStyle }) => op === 'strokeRect' && strokeStyle === '#ff385c');
    expect(warning?.globalAlpha).toBeCloseTo(0.08 + ((636 - (720 - 180)) / 180) * (0.07 + 0.5 * 0.09));
    expect(state.targets.map(({ id }) => id)).toEqual(before.targets.map(({ id }) => id));
    const warningIndex = context.calls.findIndex(({ op, strokeStyle }) => op === 'strokeRect' && strokeStyle === '#ff385c');
    const firstLabelIndex = context.calls.findIndex(({ op }) => op === 'fillText');
    expect(warningIndex).toBeLessThan(firstLabelIndex);
  });

  it('does not mutate threat state while drawing a locked target', () => {
    const { context, renderer } = harness();
    const state = snapshot({
      lockedTargetId: 2,
      targets: [target({ id: 2, y: 640 }), target({ id: 1, y: 500 })],
    });
    const before = structuredClone(state);

    renderer.render(state, 0);

    expect(context.calls.some(({ op, strokeStyle }) => op === 'strokeRect' && strokeStyle === '#ff385c')).toBe(true);
    expect(state.lockedTargetId).toBe(before.lockedTargetId);
    expect(state.targets.map(({ id }) => id)).toEqual(before.targets.map(({ id }) => id));
  });

  it('shows special labels and brief level-up and breach defense feedback without changing state', () => {
    const { context, renderer } = harness();
    const state = snapshot({ targets: [
      target({ id: 1, word: 'heal', kind: 'repair' }),
      target({ id: 2, word: 'wave', kind: 'pulse' }),
      target({ id: 3, word: 'ice', kind: 'freeze' }),
    ] });
    const before = structuredClone(state);

    renderer.consume([
      { type: 'level-up', level: 2 },
      { type: 'breach', target: target({ y: 720 }) },
    ]);
    renderer.render(state, 0);

    expect(textCalls(context).map(({ args }) => args[0])).toEqual(expect.arrayContaining([
      'REPAIR', 'PULSE', 'FREEZE', 'LEVEL 2 // SPEED UP',
    ]));
    expect(context.calls.some(({ op, strokeStyle }) => op === 'strokeRect' && strokeStyle === '#ff385c')).toBe(true);
    expect(state).toEqual(before);
  });

  it('uses a static low-flash red border and fewer particles for reduced motion', () => {
    const { context, renderer } = harness(true);

    renderer.consume([
      { type: 'error' },
      { type: 'destroyed', target: target() },
    ]);
    renderer.render(snapshot(), 0);

    expect(context.calls.filter(({ op }) => op === 'translate')).toHaveLength(0);
    const whiteFlash = context.calls.find(({ op, fillStyle }) => op === 'fillRect' && fillStyle === '#ffffff');
    expect(whiteFlash?.globalAlpha).toBeLessThanOrEqual(0.15);
    expect(context.calls.filter(({ op, fillStyle }) => op === 'fill' && fillStyle === '#78efff')).toHaveLength(4);
    expect(context.calls.some(({ op, strokeStyle }) => op === 'strokeRect' && strokeStyle === '#ff385c')).toBe(true);
  });

  it('shakes for a normal error but keeps the reduced-motion warning border static', () => {
    const normal = harness();
    normal.renderer.consume([{ type: 'error' }]);
    normal.renderer.render(snapshot(), 0);
    expect(normal.context.calls.some(({ op, args }) => op === 'translate' && (args[0] !== 0 || args[1] !== 0))).toBe(true);

    const reduced = harness(true);
    reduced.renderer.consume([{ type: 'error' }]);
    reduced.renderer.render(snapshot(), 0);
    const firstBorder = reduced.context.calls.find(({ op, strokeStyle }) => op === 'strokeRect' && strokeStyle === '#ff385c');
    reduced.context.calls.length = 0;
    reduced.setNow(1_060);
    reduced.renderer.render(snapshot(), 0);
    const secondBorder = reduced.context.calls.find(({ op, strokeStyle }) => op === 'strokeRect' && strokeStyle === '#ff385c');

    expect(reduced.context.calls.filter(({ op }) => op === 'translate')).toHaveLength(0);
    expect([secondBorder?.lineWidth, secondBorder?.globalAlpha]).toEqual([firstBorder?.lineWidth, firstBorder?.globalAlpha]);
  });

  it('shows independent level and sector messages only for their presentation lifetimes', () => {
    const { context, renderer, setNow } = harness();
    renderer.consume([{ type: 'level-up', level: 2 }, { type: 'sector-milestone', level: 3 }]);
    renderer.render(snapshot(), 0);

    expect(textCalls(context).map(({ args }) => args[0])).toEqual(expect.arrayContaining([
      'LEVEL 2 // SPEED UP', 'SECTOR 1 STABILIZED',
    ]));

    context.calls.length = 0;
    setNow(1_901);
    renderer.render(snapshot(), 0);
    expect(textCalls(context).map(({ args }) => args[0])).not.toContain('LEVEL 2 // SPEED UP');
    expect(textCalls(context).map(({ args }) => args[0])).toContain('SECTOR 1 STABILIZED');

    context.calls.length = 0;
    setNow(2_201);
    renderer.render(snapshot(), 0);
    expect(textCalls(context).map(({ args }) => args[0])).not.toContain('SECTOR 1 STABILIZED');
  });

  it('keeps the error border through 149ms but removes it after 150ms', () => {
    const { context, renderer, setNow } = harness();
    renderer.consume([{ type: 'error' }]);
    renderer.render(snapshot(), 0);

    context.calls.length = 0;
    setNow(1_149);
    renderer.render(snapshot(), 0);
    expect(context.calls.some(({ op, strokeStyle }) => op === 'strokeRect' && strokeStyle === '#ff385c')).toBe(true);

    context.calls.length = 0;
    setNow(1_151);
    renderer.render(snapshot(), 0);
    expect(context.calls.some(({ op, strokeStyle }) => op === 'strokeRect' && strokeStyle === '#ff385c')).toBe(false);
  });

  it('keeps active effects at the same age while paused, then resumes their remaining lifetime', () => {
    const { context, renderer, setNow } = harness();
    renderer.consume([
      { type: 'shot', targetId: 1, progress: 1 },
      { type: 'destroyed', target: target() },
      { type: 'level-up', level: 2 },
      { type: 'breach', target: target({ y: 720 }) },
      { type: 'error' },
    ]);
    const playing = snapshot({ targets: [target()] });
    renderer.render(playing, 0);
    const initialProjectile = context.calls.find(({ op, fillStyle }) => op === 'arc' && fillStyle === '#ffbd66');
    const initialLevel = context.calls.find(({ op, args }) => op === 'fillText' && args[0] === 'LEVEL 2 // SPEED UP');
    const initialExplosion = context.calls.find(({ op, strokeStyle }) => op === 'arc' && strokeStyle === '#fff3d6');
    const initialBreach = context.calls.find(({ op, strokeStyle }) => op === 'arc' && strokeStyle === '#ff385c');
    const initialShake = context.calls.find(({ op }) => op === 'translate');
    context.calls.length = 0;

    setNow(11_000);
    renderer.render(snapshot({ ...playing, phase: 'paused' }), 0);
    const pausedProjectile = context.calls.find(({ op, fillStyle }) => op === 'arc' && fillStyle === '#ffbd66');
    const pausedLevel = context.calls.find(({ op, args }) => op === 'fillText' && args[0] === 'LEVEL 2 // SPEED UP');
    const pausedExplosion = context.calls.find(({ op, strokeStyle }) => op === 'arc' && strokeStyle === '#fff3d6');
    const pausedBreach = context.calls.find(({ op, strokeStyle }) => op === 'arc' && strokeStyle === '#ff385c');
    const pausedShake = context.calls.find(({ op }) => op === 'translate');

    expect(pausedProjectile?.args).toEqual(initialProjectile?.args);
    expect(pausedLevel?.globalAlpha).toBe(initialLevel?.globalAlpha);
    expect(pausedExplosion?.args).toEqual(initialExplosion?.args);
    expect(pausedBreach?.args).toEqual(initialBreach?.args);
    expect(pausedShake?.args).toEqual(initialShake?.args);

    context.calls.length = 0;
    setNow(11_040);
    renderer.render(playing, 0);
    const resumedProjectile = context.calls.find(({ op, fillStyle }) => op === 'arc' && fillStyle === '#ffbd66');
    expect(resumedProjectile).toBeDefined();
    expect(resumedProjectile?.args).not.toEqual(initialProjectile?.args);
    expect(context.calls.some(({ op, args }) => op === 'fillText' && args[0] === 'LEVEL 2 // SPEED UP')).toBe(true);
    expect(context.calls.some(({ op, strokeStyle }) => op === 'arc' && strokeStyle === '#fff3d6')).toBe(true);
    expect(context.calls.some(({ op, strokeStyle }) => op === 'arc' && strokeStyle === '#ff385c')).toBe(true);

    context.calls.length = 0;
    setNow(11_081);
    renderer.render(playing, 0);
    expect(context.calls.some(({ op, fillStyle }) => op === 'arc' && fillStyle === '#ffbd66')).toBe(false);
  });

  it('preserves the same fifty milliseconds of projectile travel across pause and resume', () => {
    const { context, renderer, setNow } = harness();
    const playing = snapshot({ targets: [target()] });
    renderer.render(playing, 0);
    renderer.consume([{ type: 'shot', targetId: 1, progress: 1 }]);

    setNow(1_030);
    context.calls.length = 0;
    renderer.render(playing, 0);
    const beforePause = context.calls.find(({ op, fillStyle }) => op === 'arc' && fillStyle === '#ffbd66');

    setNow(9_030);
    context.calls.length = 0;
    renderer.render(snapshot({ ...playing, phase: 'paused' }), 0);
    const duringPause = context.calls.find(({ op, fillStyle }) => op === 'arc' && fillStyle === '#ffbd66');
    expect(duringPause?.args).toEqual(beforePause?.args);

    setNow(9_080);
    context.calls.length = 0;
    renderer.render(playing, 0);
    const impact = context.calls.find(({ op, fillStyle }) => op === 'arc' && fillStyle === '#ff9d2e');
    expect(impact?.args.slice(0, 2)).toEqual([170, 178]);
    expect(context.calls.some(({ op, fillStyle }) => op === 'fill' && fillStyle === '#ffbd66')).toBe(false);
  });

  it('does not rewind effect timing when the injected wall clock moves backward', () => {
    const { context, renderer, setNow } = harness();
    renderer.consume([{ type: 'error' }]);
    renderer.render(snapshot(), 0);
    context.calls.length = 0;

    setNow(1_050);
    renderer.render(snapshot(), 0);
    const advancedBorder = context.calls.find(({ op, strokeStyle }) => op === 'strokeRect' && strokeStyle === '#ff385c');
    context.calls.length = 0;

    setNow(1_020);
    renderer.render(snapshot(), 0);
    const regressedBorder = context.calls.find(({ op, strokeStyle }) => op === 'strokeRect' && strokeStyle === '#ff385c');
    context.calls.length = 0;

    setNow(1_100);
    renderer.render(snapshot(), 0);
    const recoveredBorder = context.calls.find(({ op, strokeStyle }) => op === 'strokeRect' && strokeStyle === '#ff385c');

    expect(regressedBorder?.globalAlpha).toBe(advancedBorder?.globalAlpha);
    expect(recoveredBorder?.globalAlpha).toBeCloseTo(0.25 + (1 - 100 / 150) * 0.55);
  });

  it('uses half-speed target interpolation while freeze remains active', () => {
    const normal = harness();
    normal.renderer.render(snapshot({ targets: [target({ speed: 60 })] }), 1);
    const normalY = textCalls(normal.context).find(({ args }) => args[0] === 'ORBIT')?.args[2] as number;

    const frozen = harness();
    frozen.renderer.render(snapshot({ freezeRemainingMs: 1, targets: [target({ speed: 60 })] }), 1);
    const frozenY = textCalls(frozen.context).find(({ args }) => args[0] === 'ORBIT')?.args[2] as number;

    expect(normalY - frozenY).toBeCloseTo(0.5);
  });

  it('replaces known target positions with the current active snapshot over a long run', () => {
    const { renderer } = harness();
    for (let id = 1; id <= 250; id += 1) {
      renderer.render(snapshot({ targets: [target({ id })] }), 0);
    }

    const cachedTargets = (renderer as unknown as { knownTargets: Map<number, unknown> }).knownTargets;
    expect(cachedTargets.size).toBe(1);
  });

  it('does not retain a removed target just to resolve a later special pulse', () => {
    const { context, renderer } = harness();
    renderer.render(snapshot({ targets: [target()] }), 0);
    renderer.render(snapshot(), 0);
    renderer.consume([{ type: 'special', kind: 'freeze', affectedIds: [1] }]);
    context.calls.length = 0;
    renderer.render(snapshot(), 0);

    expect(context.calls.some(({ op, strokeStyle }) => op === 'stroke' && strokeStyle === '#82dfff')).toBe(false);
  });

  it('keeps special-pulse coordinates after the target cache is replaced', () => {
    const { context, renderer } = harness();
    renderer.render(snapshot({ targets: [target({ x: 120 })] }), 0);
    renderer.consume([{ type: 'special', kind: 'freeze', affectedIds: [1] }]);
    context.calls.length = 0;
    renderer.render(snapshot({ targets: [target({ x: 280 })] }), 0);

    const pulse = context.calls.find(({ op, strokeStyle }) => op === 'arc' && strokeStyle === '#82dfff');
    expect(pulse?.args.slice(0, 2)).toEqual([170, 178]);
  });

  it('ignores an unknown runtime event without attempting special-event fields', () => {
    const { renderer } = harness();
    expect(() => renderer.consume([{ type: 'unknown' }] as unknown as GameEvent[])).not.toThrow();
  });

  it('bounds secondary effects independently so shots survive particle pressure', () => {
    const { context, renderer } = harness();
    const destroyed = Array.from({ length: 80 }, (_, id) => ({
      type: 'destroyed' as const,
      target: target({ id, x: id % 400 }),
    }));

    renderer.consume([...destroyed, { type: 'shot', targetId: 999, progress: 1 }]);
    renderer.render(snapshot({ targets: [target({ id: 999 })] }), 0);

    expect(context.calls.filter(({ op, fillStyle }) => op === 'fill' && fillStyle === '#78efff').length).toBeLessThanOrEqual(120);
    expect(context.calls.some(({ op, fillStyle }) => op === 'fill' && fillStyle === '#ffbd66')).toBe(true);
  });

  it('clears projectile and effect pools when a run restarts or returns to menu', () => {
    const { renderer } = harness();
    renderer.render(snapshot({ targets: [target()] }), 0);
    renderer.consume([
      { type: 'shot', targetId: 1, progress: 1 },
      { type: 'destroyed', target: target() },
      { type: 'breach', target: target() },
      { type: 'level-up', level: 2 },
      { type: 'special', kind: 'freeze', affectedIds: [1] },
      { type: 'error' },
    ]);

    renderer.resetPresentation();

    const state = renderer as unknown as {
      shots: unknown[];
      impacts: unknown[];
      explosions: unknown[];
      breaches: unknown[];
      specialPulses: unknown[];
      knownTargets: Map<number, unknown>;
      levelUp: unknown;
      errorStartedAt: number;
    };
    expect(state.shots).toEqual([]);
    expect(state.impacts).toEqual([]);
    expect(state.explosions).toEqual([]);
    expect(state.breaches).toEqual([]);
    expect(state.specialPulses).toEqual([]);
    expect(state.knownTargets.size).toBe(0);
    expect(state.levelUp).toBeNull();
    expect(state.errorStartedAt).toBe(Number.NEGATIVE_INFINITY);
  });
});
