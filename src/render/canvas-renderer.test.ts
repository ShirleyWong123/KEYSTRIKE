import { describe, expect, it, vi } from 'vitest';
import { PROJECTILE_MS } from '../game/config';
import type { GameSettings, GameSnapshot, Target } from '../game/types';
import { CanvasRenderer } from './canvas-renderer';

type RecordedCall = {
  op: string;
  args: unknown[];
  fillStyle: string;
  strokeStyle: string;
  globalAlpha: number;
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

  it('turns a destroyed event into one decaying flash, ring, shards, and bounded particles', () => {
    const { context, renderer } = harness();

    renderer.consume([{ type: 'destroyed', target: target({ typed: 5 }) }]);
    renderer.render(snapshot(), 0);

    expect(context.calls.some(({ op, fillStyle }) => op === 'fillRect' && fillStyle === '#ffffff')).toBe(true);
    expect(context.calls.some(({ op, strokeStyle }) => op === 'stroke' && strokeStyle === '#fff3d6')).toBe(true);
    expect(context.calls.some(({ op, strokeStyle }) => op === 'stroke' && strokeStyle === '#ff9d2e')).toBe(true);
    expect(context.calls.filter(({ op, fillStyle }) => op === 'fill' && fillStyle === '#78efff').length).toBeGreaterThan(0);
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

    expect(textCalls(context).map(({ args }) => args[0])).toEqual(expect.arrayContaining(['REPAIR', 'PULSE', 'FREEZE', 'LEVEL 2']));
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

    expect(context.calls.filter(({ op }) => op === 'translate').every(({ args }) => args[0] === 0 && args[1] === 0)).toBe(true);
    const whiteFlash = context.calls.find(({ op, fillStyle }) => op === 'fillRect' && fillStyle === '#ffffff');
    expect(whiteFlash?.globalAlpha).toBeLessThanOrEqual(0.15);
    expect(context.calls.filter(({ op, fillStyle }) => op === 'fill' && fillStyle === '#78efff')).toHaveLength(4);
    expect(context.calls.some(({ op, strokeStyle }) => op === 'strokeRect' && strokeStyle === '#ff385c')).toBe(true);
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
});
