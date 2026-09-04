import { describe, expect, it, vi } from 'vitest';
import { GameModel } from './game/game-model';
import { TargetManager } from './game/target-manager';
import type { GameEvent, GameSettings, GameSnapshot } from './game/types';
import {
  APP_NAME,
  LOGIC_STEP_MS,
  MAX_CATCH_UP_STEPS,
  createKeystrikeRuntime,
  type RuntimeEnvironment,
  type RuntimeParts,
} from './main';

class FrameHarness {
  readonly keyboardTarget = new EventTarget();
  readonly windowTarget = new EventTarget();
  readonly documentTarget = new EventTarget();
  visibilityState: DocumentVisibilityState = 'visible';
  now = 0;
  private nextHandle = 1;
  private readonly callbacks = new Map<number, FrameRequestCallback>();

  readonly environment: RuntimeEnvironment = {
    now: () => this.now,
    requestAnimationFrame: (callback) => {
      const handle = this.nextHandle++;
      this.callbacks.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame: (handle) => { this.callbacks.delete(handle); },
    keyboardTarget: this.keyboardTarget,
    windowTarget: this.windowTarget,
    documentTarget: this.documentTarget,
    getVisibilityState: () => this.visibilityState,
  };

  frame(timestamp: number): void {
    this.now = timestamp;
    const pending = [...this.callbacks.values()];
    this.callbacks.clear();
    expect(pending).toHaveLength(1);
    pending[0]!(timestamp);
  }

  pendingFrames(): number {
    return this.callbacks.size;
  }
}

const settings = (): GameSettings => ({
  difficulty: 'normal',
  soundEnabled: true,
  reducedMotion: false,
});

const createHarness = () => {
  const frames = new FrameHarness();
  const model = new GameModel(new TargetManager(() => 0), { autoSpawn: false });
  model.start(settings());
  model.beginCombat();
  const consumedByRenderer: Array<readonly GameEvent[]> = [];
  const consumedByAudio: Array<readonly GameEvent[]> = [];
  const renderer = {
    consume: vi.fn((events: readonly GameEvent[]) => { consumedByRenderer.push(events); }),
    render: vi.fn(),
    resize: vi.fn(),
  };
  const audio = {
    consume: vi.fn((events: readonly GameEvent[]) => { consumedByAudio.push(events); }),
    dispose: vi.fn(),
  };
  const shell = { update: vi.fn() };
  const parts = { model, renderer, audio, shell } satisfies RuntimeParts;
  const runtime = createKeystrikeRuntime(parts, frames.environment);
  return { frames, model, renderer, audio, shell, runtime, consumedByRenderer, consumedByAudio };
};

const advanceAtHz = (hz: number): { snapshot: GameSnapshot; renders: number } => {
  const { frames, model, renderer } = createHarness();
  frames.frame(0);
  for (let frame = 1; frame <= hz; frame += 1) frames.frame((frame * 1_000) / hz);
  return { snapshot: model.snapshot(), renders: renderer.render.mock.calls.length };
};

describe('application shell', () => {
  it('exposes the KEYSTRIKE product name', () => {
    expect(APP_NAME).toBe('KEYSTRIKE');
  });
});

describe('fixed-step browser runtime', () => {
  it('advances equal active time at 60Hz and 120Hz while rendering every frame', () => {
    const sixty = advanceAtHz(60);
    const oneTwenty = advanceAtHz(120);

    expect(sixty.snapshot.activeMs).toBeCloseTo(1_000, 8);
    expect(oneTwenty.snapshot.activeMs).toBeCloseTo(sixty.snapshot.activeMs, 8);
    expect(sixty.renders).toBe(61);
    expect(oneTwenty.renders).toBe(121);
  });

  it('caps a suspended frame at five catch-up updates and drops the excess backlog', () => {
    const { frames, model, renderer } = createHarness();
    const drainEvents = vi.spyOn(model, 'drainEvents');
    frames.frame(0);

    frames.frame(5_000);

    expect(MAX_CATCH_UP_STEPS).toBe(5);
    expect(model.snapshot().activeMs).toBeCloseTo(LOGIC_STEP_MS * 5, 8);
    expect(drainEvents).toHaveBeenCalledTimes(5);
    expect(renderer.consume).toHaveBeenCalledTimes(5);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    frames.frame(5_000 + LOGIC_STEP_MS);
    expect(model.snapshot().activeMs).toBeCloseTo(LOGIC_STEP_MS * 6, 8);
    expect(drainEvents).toHaveBeenCalledTimes(6);
  });

  it('drains each update once and gives renderer and audio the same frozen event list', () => {
    const { frames, model, renderer, audio, consumedByRenderer, consumedByAudio } = createHarness();
    model.injectTarget({
      id: 90,
      word: 'p',
      typed: 0,
      x: 120,
      y: 400,
      width: 74,
      height: 42,
      speed: 0,
      kind: 'normal',
    });
    frames.keyboardTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));

    expect(renderer.consume).toHaveBeenCalledOnce();
    expect(audio.consume).toHaveBeenCalledOnce();
    expect(consumedByRenderer[0]).toBe(consumedByAudio[0]);
    expect(Object.isFrozen(consumedByRenderer[0])).toBe(true);
    expect(Object.isFrozen(consumedByRenderer[0]?.at(-1))).toBe(true);
    expect(consumedByRenderer[0]?.map(({ type }) => type)).toEqual(['shot', 'destroyed']);
    expect(model.drainEvents()).toEqual([]);
  });

  it('routes P as gameplay input and Escape as the only pause key', () => {
    const { frames, model, shell } = createHarness();
    model.injectTarget({
      id: 91,
      word: 'pause',
      typed: 0,
      x: 120,
      y: 400,
      width: 100,
      height: 42,
      speed: 0,
      kind: 'normal',
    });

    frames.keyboardTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
    expect(model.snapshot()).toMatchObject({ phase: 'playing', lockedTargetId: 91 });
    expect(model.snapshot().targets.find(({ id }) => id === 91)?.typed).toBe(1);

    frames.keyboardTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(model.snapshot().phase).toBe('paused');
    frames.keyboardTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(model.snapshot().phase).toBe('playing');
    expect(shell.update).toHaveBeenCalled();
  });

  it.each([
    ['Alt', { altKey: true }],
    ['Control', { ctrlKey: true }],
    ['Meta', { metaKey: true }],
  ] as const)('leaves %s+letter shortcuts to the browser', (_modifier, init) => {
    const { frames, model, renderer, audio, shell } = createHarness();
    const handleKey = vi.spyOn(model, 'handleKey');
    const event = new KeyboardEvent('keydown', { key: 'p', cancelable: true, ...init });

    frames.keyboardTarget.dispatchEvent(event);

    expect(handleKey).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(renderer.consume).not.toHaveBeenCalled();
    expect(audio.consume).not.toHaveBeenCalled();
    expect(shell.update).not.toHaveBeenCalled();
  });

  it('leaves repeated keys to the browser', () => {
    const { frames, model, renderer, audio, shell } = createHarness();
    const handleKey = vi.spyOn(model, 'handleKey');
    const event = new KeyboardEvent('keydown', { key: 'p', repeat: true, cancelable: true });

    frames.keyboardTarget.dispatchEvent(event);

    expect(handleKey).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(renderer.consume).not.toHaveBeenCalled();
    expect(audio.consume).not.toHaveBeenCalled();
    expect(shell.update).not.toHaveBeenCalled();
  });

  it('auto-pauses a playing run when hidden or blurred', () => {
    const hidden = createHarness();
    hidden.frames.visibilityState = 'hidden';
    hidden.frames.documentTarget.dispatchEvent(new Event('visibilitychange'));
    expect(hidden.model.snapshot().phase).toBe('paused');
    expect(hidden.shell.update).toHaveBeenCalledWith(expect.objectContaining({ phase: 'paused' }));

    const blurred = createHarness();
    blurred.frames.windowTarget.dispatchEvent(new Event('blur'));
    expect(blurred.model.snapshot().phase).toBe('paused');
  });

  it('forwards resize and removes every global listener on disposal', () => {
    const { frames, renderer, audio, runtime, model } = createHarness();
    frames.windowTarget.dispatchEvent(new Event('resize'));
    expect(renderer.resize).toHaveBeenCalledOnce();

    runtime.dispose();
    expect(frames.pendingFrames()).toBe(0);
    expect(audio.dispose).toHaveBeenCalledOnce();
    frames.windowTarget.dispatchEvent(new Event('resize'));
    frames.windowTarget.dispatchEvent(new Event('blur'));
    frames.keyboardTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(renderer.resize).toHaveBeenCalledOnce();
    expect(model.snapshot().phase).toBe('playing');
  });

  it('keeps retained debug controls inert after disposal', () => {
    const { runtime, model, renderer, audio, shell } = createHarness();
    const debug = runtime.debug;
    runtime.dispose();
    const before = model.snapshot();

    debug.injectTarget({
      id: 92,
      word: 'stale',
      typed: 0,
      x: 120,
      y: 400,
      width: 100,
      height: 42,
      speed: 0,
      kind: 'normal',
    });
    debug.forceSpecial('repair');
    debug.forceLevel(12);
    debug.forceBreaches(1);

    expect(debug.snapshot()).toEqual(before);
    expect(renderer.consume).not.toHaveBeenCalled();
    expect(audio.consume).not.toHaveBeenCalled();
    expect(shell.update).not.toHaveBeenCalled();
  });

  it.each(['repair', 'pulse', 'freeze'] as const)(
    'offers opt-in debug forcing for %s targets without adding UI controls',
    (kind) => {
      const { runtime, model } = createHarness();
      runtime.debug.forceSpecial(kind);
      expect(model.snapshot().targets.at(-1)).toMatchObject({ kind, word: kind.toUpperCase() });
      runtime.debug.forceLevel(12);
      expect(model.snapshot().level).toBe(12);
      runtime.debug.forceBreaches(1);
      expect(model.snapshot().shield).toBe(80);
    },
  );
});
