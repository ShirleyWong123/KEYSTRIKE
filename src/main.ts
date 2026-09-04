import './styles.css';
import { AudioEngine } from './audio/audio-engine';
import { GameModel } from './game/game-model';
import { DEFENSE_LINE, TargetManager } from './game/target-manager';
import type { GameEvent, GameSnapshot, Target, TargetKind } from './game/types';
import { CanvasRenderer } from './render/canvas-renderer';
import { AppShell } from './ui/app-shell';

export const APP_NAME = 'KEYSTRIKE';
export const LOGIC_STEP_MS = 1_000 / 60;
export const MAX_CATCH_UP_STEPS = 5;

type Listener = EventListenerOrEventListenerObject;

export interface RuntimeEnvironment {
  now(): number;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
  keyboardTarget: EventTarget;
  windowTarget: EventTarget;
  documentTarget: EventTarget;
  getVisibilityState(): DocumentVisibilityState;
}

export interface RuntimeParts {
  model: GameModel;
  renderer: Pick<CanvasRenderer, 'consume' | 'render' | 'resize'>;
  audio: Pick<AudioEngine, 'consume' | 'dispose'>;
  shell: Pick<AppShell, 'update'>;
}

export interface KeystrikeDebugApi {
  snapshot(): GameSnapshot;
  injectTarget(target: Target): void;
  forceSpecial(kind: Exclude<TargetKind, 'normal'>): void;
  forceBreaches(count?: number): void;
  forceLevel(level: number): void;
}

export interface KeystrikeRuntime {
  readonly debug: KeystrikeDebugApi;
  dispose(): void;
}

export interface MountOptions {
  random?: () => number;
  environment?: RuntimeEnvironment;
  exposeDebug?: boolean;
}

const freezeEvents = (events: GameEvent[]): readonly GameEvent[] => Object.freeze(events.map((event) => {
  if (event.type === 'destroyed' || event.type === 'breach') Object.freeze(event.target);
  if (event.type === 'special') Object.freeze(event.affectedIds);
  return Object.freeze(event);
}));

/** Drives an already-composed game through deterministic fixed updates. */
export const createKeystrikeRuntime = (
  { model, renderer, audio, shell }: RuntimeParts,
  environment: RuntimeEnvironment,
): KeystrikeRuntime => {
  let animationFrame: number | null = null;
  let lastTimestamp: number | null = null;
  let lastPhase = model.snapshot().phase;
  let accumulatorMs = 0;
  let disposed = false;
  let nextDebugTargetId = 900_000;

  const flushEvents = (): void => {
    const drained = model.drainEvents();
    const events = freezeEvents(drained);
    renderer.consume(events);
    audio.consume(events);
  };

  const synchronizePhase = (phase: GameSnapshot['phase']): void => {
    if (phase === lastPhase) return;
    accumulatorMs = 0;
    lastTimestamp = environment.now();
    lastPhase = phase;
  };

  const publish = (): GameSnapshot => {
    flushEvents();
    const snapshot = model.snapshot();
    shell.update(snapshot);
    synchronizePhase(snapshot.phase);
    return snapshot;
  };

  const frame: FrameRequestCallback = (timestamp) => {
    if (disposed) return;
    const phaseAtStart = model.snapshot().phase;
    if (lastTimestamp === null || phaseAtStart !== lastPhase) {
      if (lastPhase === 'menu' && phaseAtStart !== 'menu') renderer.resize();
      accumulatorMs = 0;
      lastTimestamp = timestamp;
      lastPhase = phaseAtStart;
    } else {
      const elapsed = Number.isFinite(timestamp) ? Math.max(0, timestamp - lastTimestamp) : 0;
      lastTimestamp = Number.isFinite(timestamp) ? Math.max(lastTimestamp, timestamp) : lastTimestamp;
      accumulatorMs = Math.min(accumulatorMs + elapsed, LOGIC_STEP_MS * MAX_CATCH_UP_STEPS);
    }

    let steps = 0;
    while (accumulatorMs + 1e-9 >= LOGIC_STEP_MS && steps < MAX_CATCH_UP_STEPS) {
      model.update(LOGIC_STEP_MS);
      accumulatorMs = Math.max(0, accumulatorMs - LOGIC_STEP_MS);
      flushEvents();
      steps += 1;
    }

    const snapshot = model.snapshot();
    shell.update(snapshot);
    synchronizePhase(snapshot.phase);
    renderer.render(snapshot, accumulatorMs / LOGIC_STEP_MS);
    animationFrame = environment.requestAnimationFrame(frame);
  };

  const onKeyDown = (rawEvent: Event): void => {
    if (disposed || rawEvent.defaultPrevented || !(rawEvent instanceof KeyboardEvent)) return;
    const before = model.snapshot().phase;
    const isEscape = rawEvent.key === 'Escape' || rawEvent.key === 'Esc';
    const isGameplayLetter = before === 'playing' && /^[a-zA-Z]$/.test(rawEvent.key);
    if (!isEscape && !isGameplayLetter) return;

    model.handleKey({
      key: rawEvent.key,
      repeat: rawEvent.repeat,
      altKey: rawEvent.altKey,
      ctrlKey: rawEvent.ctrlKey,
      metaKey: rawEvent.metaKey,
    });
    const after = publish();
    if (after.phase !== before || isGameplayLetter) rawEvent.preventDefault();
  };

  const pauseActiveRun = (): void => {
    if (disposed || model.snapshot().phase !== 'playing') return;
    model.pause();
    publish();
  };

  const onVisibilityChange = (): void => {
    if (environment.getVisibilityState() === 'hidden') pauseActiveRun();
  };

  const onResize = (): void => { renderer.resize(); };

  environment.keyboardTarget.addEventListener('keydown', onKeyDown as Listener);
  environment.windowTarget.addEventListener('blur', pauseActiveRun as Listener);
  environment.windowTarget.addEventListener('resize', onResize as Listener);
  environment.documentTarget.addEventListener('visibilitychange', onVisibilityChange as Listener);
  animationFrame = environment.requestAnimationFrame(frame);

  const debug: KeystrikeDebugApi = Object.freeze({
    snapshot: () => model.snapshot(),
    injectTarget: (target: Target) => {
      model.injectTarget(target);
      publish();
    },
    forceSpecial: (kind: Exclude<TargetKind, 'normal'>) => {
      if (kind !== 'repair' && kind !== 'pulse' && kind !== 'freeze') return;
      const word = kind.toUpperCase();
      const width = Math.max(74, word.length * 10 + 36);
      model.injectTarget({
        id: nextDebugTargetId++,
        word,
        typed: 0,
        x: 240 - width / 2,
        y: 620,
        width,
        height: 42,
        speed: 0,
        kind,
      });
      publish();
    },
    forceBreaches: (requestedCount = 1) => {
      if (model.snapshot().phase !== 'playing') return;
      const count = Math.min(5, Math.max(1, Math.floor(requestedCount)));
      for (let index = 0; index < count; index += 1) {
        model.injectTarget({
          id: nextDebugTargetId++,
          word: 'BREACH',
          typed: 0,
          x: 30 + index * 82,
          y: DEFENSE_LINE - 20,
          width: 74,
          height: 20,
          speed: 1,
          kind: 'normal',
        });
      }
      model.update(LOGIC_STEP_MS);
      publish();
    },
    forceLevel: (level: number) => {
      model.forceLevelForDebug(level);
      publish();
    },
  });

  return {
    debug,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (animationFrame !== null) environment.cancelAnimationFrame(animationFrame);
      animationFrame = null;
      environment.keyboardTarget.removeEventListener('keydown', onKeyDown as Listener);
      environment.windowTarget.removeEventListener('blur', pauseActiveRun as Listener);
      environment.windowTarget.removeEventListener('resize', onResize as Listener);
      environment.documentTarget.removeEventListener('visibilitychange', onVisibilityChange as Listener);
      audio.dispose();
    },
  };
};

const browserEnvironment = (): RuntimeEnvironment => ({
  now: () => performance.now(),
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
  cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
  keyboardTarget: window,
  windowTarget: window,
  documentTarget: document,
  getVisibilityState: () => document.visibilityState,
});

const shouldExposeDebug = (): boolean => {
  try {
    return new URLSearchParams(window.location.search).get('debug') === '1';
  } catch {
    return false;
  }
};

/** Creates the production model, shell, renderer, audio, and browser lifecycle. */
export const mountKeystrike = (root: HTMLElement, options: MountOptions = {}): KeystrikeRuntime => {
  const environment = options.environment ?? browserEnvironment();
  const random = options.random ?? Math.random;
  let renderer: CanvasRenderer | null = null;
  const targetManager = new TargetManager(random, (word) =>
    renderer?.measureWord(word) ?? { width: Math.max(74, word.length * 10 + 36), height: 42 });
  const model = new GameModel(targetManager, { random });
  const audio = new AudioEngine();
  const shell = new AppShell(root, model, audio);
  renderer = new CanvasRenderer(shell.canvas, shell.settings, environment.now);
  const runtime = createKeystrikeRuntime({ model, renderer, audio, shell }, environment);

  if (options.exposeDebug === true) {
    Object.defineProperty(window, '__KEYSTRIKE_DEBUG__', {
      configurable: true,
      value: runtime.debug,
    });
    const dispose = runtime.dispose;
    runtime.dispose = () => {
      dispose();
      try { delete window.__KEYSTRIKE_DEBUG__; } catch { /* Non-critical debug cleanup. */ }
    };
  }
  return runtime;
};

declare global {
  interface Window {
    __KEYSTRIKE_DEBUG__?: KeystrikeDebugApi;
  }
}

const boot = (): void => {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root || root.dataset.keystrikeMounted === 'true') return;
  root.dataset.keystrikeMounted = 'true';
  const runtime = mountKeystrike(root, { exposeDebug: shouldExposeDebug() });
  import.meta.hot?.dispose(() => runtime.dispose());
};

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}
