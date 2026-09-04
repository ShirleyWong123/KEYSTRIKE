import { describe, expect, it, vi } from 'vitest';
import { PROJECTILE_MS } from '../game/config';
import type { GameEvent } from '../game/types';
import { AudioEngine, type AudioContextLike, type AudioNodeLike, type AudioParamLike, type AudioSourceLike } from './audio-engine';

type Automation = { value: number; at: number };

class FakeParam implements AudioParamLike {
  readonly values: Automation[] = [];
  readonly ramps: Automation[] = [];
  throwOnSet = false;
  throwOnRamp = false;

  setValueAtTime(value: number, at: number): void {
    if (this.throwOnSet) throw new Error('setValue failed');
    this.values.push({ value, at });
  }

  linearRampToValueAtTime(value: number, at: number): void {
    if (this.throwOnRamp) throw new Error('ramp failed');
    this.ramps.push({ value, at });
  }
}

class FakeNode implements AudioNodeLike {
  connected = false;
  disconnected = false;
  throwOnConnect = false;
  throwOnDisconnect = false;

  connect(): AudioNodeLike {
    if (this.throwOnConnect) throw new Error('connect failed');
    this.connected = true;
    return this;
  }

  disconnect(): void {
    if (this.throwOnDisconnect) throw new Error('disconnect failed');
    this.disconnected = true;
  }
}

class FakeSource extends FakeNode implements AudioSourceLike {
  readonly starts: number[] = [];
  readonly stops: number[] = [];
  onended: ((event: Event) => unknown) | null = null;
  readonly frequency = new FakeParam();
  type: OscillatorType = 'sine';
  buffer: AudioBuffer | null = null;
  throwOnStart = false;
  throwOnStop = false;

  start(at: number): void {
    if (this.throwOnStart) throw new Error('start failed');
    this.starts.push(at);
  }
  stop(at: number): void {
    if (this.throwOnStop) throw new Error('stop failed');
    this.stops.push(at);
  }
  end(): void { this.onended?.(new Event('ended')); }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeAudioContext implements AudioContextLike {
  currentTime = 4;
  readonly destination = new FakeNode();
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  closed = 0;
  resumed = 0;
  buffers = 0;

  resume(): Promise<void> { this.resumed += 1; return Promise.resolve(); }
  close(): Promise<void> { this.closed += 1; return Promise.resolve(); }
  createOscillator(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createBuffer(_channels: number, length: number, _sampleRate: number): AudioBuffer {
    this.buffers += 1;
    return { getChannelData: () => new Float32Array(length) } as unknown as AudioBuffer;
  }
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const settleUnlock = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

type FaultStage = 'oscillator' | 'buffer-source' | 'gain' | 'buffer' | 'buffer-fill' | 'frequency'
  | 'gain-param' | 'source-connect' | 'gain-connect' | 'start' | 'stop';

class FaultyAudioContext extends FakeAudioContext {
  fault: FaultStage | null = null;
  resumeResult: Promise<void> = Promise.resolve();

  override resume(): Promise<void> {
    this.resumed += 1;
    return this.resumeResult;
  }

  override createOscillator(): FakeSource {
    if (this.fault === 'oscillator') throw new Error('oscillator failed');
    const source = super.createOscillator();
    source.frequency.throwOnSet = this.fault === 'frequency';
    source.throwOnConnect = this.fault === 'source-connect';
    source.throwOnStart = this.fault === 'start';
    source.throwOnStop = this.fault === 'stop';
    return source;
  }

  override createBufferSource(): FakeSource {
    if (this.fault === 'buffer-source') throw new Error('buffer source failed');
    return super.createBufferSource();
  }

  override createGain(): FakeGain {
    if (this.fault === 'gain') throw new Error('gain failed');
    const gain = super.createGain();
    gain.gain.throwOnSet = this.fault === 'gain-param';
    gain.throwOnConnect = this.fault === 'gain-connect';
    return gain;
  }

  override createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    if (this.fault === 'buffer') throw new Error('buffer failed');
    const buffer = super.createBuffer(channels, length, sampleRate);
    if (this.fault === 'buffer-fill') {
      return { getChannelData: () => { throw new Error('buffer fill failed'); } } as unknown as AudioBuffer;
    }
    return buffer;
  }
}

const createEngine = (): { engine: AudioEngine; factory: () => FakeAudioContext | null; contexts: FakeAudioContext[] } => {
  const contexts: FakeAudioContext[] = [];
  const factory = (): FakeAudioContext => {
    const context = new FakeAudioContext();
    contexts.push(context);
    return context;
  };
  return { engine: new AudioEngine({ contextFactory: factory }), factory, contexts };
};

const events: GameEvent[] = [
  { type: 'shot', targetId: 1, progress: 0.5 },
  { type: 'error' },
  { type: 'destroyed', target: { id: 2, word: 'NOVA', typed: 4, x: 0, y: 0, width: 1, height: 1, speed: 1, kind: 'normal' } },
  { type: 'level-up', level: 2 },
  { type: 'breach', target: { id: 3, word: 'VOID', typed: 0, x: 0, y: 0, width: 1, height: 1, speed: 1, kind: 'normal' } },
];

describe('AudioEngine', () => {
  it('does not create or schedule audio before a user-driven unlock', () => {
    const { engine, contexts } = createEngine();
    engine.consume(events);
    expect(contexts).toEqual([]);
  });

  it('schedules no audio while muted', async () => {
    const { engine, contexts } = createEngine();
    engine.unlock();
    await settleUnlock();
    engine.setEnabled(false);
    engine.consume(events);
    expect(contexts[0]!.sources).toEqual([]);
  });

  it('plays a launch tone and a quieter hit pulse exactly one projectile delay later', async () => {
    const { engine, contexts } = createEngine();
    engine.unlock();
    await settleUnlock();
    engine.consume([{ type: 'shot', targetId: 1, progress: 0 }]);
    const context = contexts[0]!;

    expect(context.sources).toHaveLength(2);
    expect(context.sources.map((source) => source.starts[0])).toEqual([4, 4 + PROJECTILE_MS / 1000]);
    expect(context.gains.map((gain) => gain.gain.values[0]!.value)).toEqual([0.12, 0.06]);
  });

  it('uses distinct synthesized envelopes for error, explosion, level-up, and breach', async () => {
    const { engine, contexts } = createEngine();
    engine.unlock();
    await settleUnlock();
    engine.consume(events.slice(1));
    const context = contexts[0]!;

    expect(context.sources).toHaveLength(4);
    expect(context.sources.map((source) => source.buffer === null ? source.type : 'noise')).toEqual([
      'sawtooth', 'noise', 'triangle', 'square',
    ]);
    expect(context.sources.map((source) => source.frequency.values[0]?.value)).toEqual([120, undefined, 440, 80]);
    expect(context.buffers).toBe(1);
  });

  it('bounds source lifetime, disconnects on ended, and safely closes once', async () => {
    const { engine, contexts } = createEngine();
    engine.unlock();
    await settleUnlock();
    engine.consume(events);
    const context = contexts[0]!;

    for (const source of context.sources) {
      expect(source.stops[0]! - source.starts[0]!).toBeLessThanOrEqual(1);
      source.end();
      expect(source.disconnected).toBe(true);
    }

    engine.dispose();
    engine.dispose();
    await Promise.resolve();
    expect(context.closed).toBe(1);
    engine.consume(events);
    expect(context.sources).toHaveLength(6);
  });

  it('retries later when a context factory returns null or throws', async () => {
    const context = new FakeAudioContext();
    const nullFactory = vi.fn<() => AudioContextLike | null>()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(context);
    const nullEngine = new AudioEngine({ contextFactory: nullFactory });
    nullEngine.unlock();
    nullEngine.consume([{ type: 'error' }]);
    nullEngine.unlock();
    await settleUnlock();
    nullEngine.consume([{ type: 'error' }]);
    expect(nullFactory).toHaveBeenCalledTimes(2);
    expect(context.sources).toHaveLength(1);

    const recovered = new FakeAudioContext();
    const throwFactory = vi.fn<() => AudioContextLike | null>()
      .mockImplementationOnce(() => { throw new Error('factory failed'); })
      .mockReturnValueOnce(recovered);
    const throwEngine = new AudioEngine({ contextFactory: throwFactory });
    throwEngine.unlock();
    throwEngine.unlock();
    await settleUnlock();
    throwEngine.consume([{ type: 'error' }]);
    expect(throwFactory).toHaveBeenCalledTimes(2);
    expect(recovered.sources).toHaveLength(1);
  });

  it('does not schedule while resume is pending and retries after a rejected resume', async () => {
    const pending = deferred<void>();
    const first = new FaultyAudioContext();
    first.resumeResult = pending.promise;
    const recovered = new FakeAudioContext();
    const factory = vi.fn<() => AudioContextLike | null>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(recovered);
    const engine = new AudioEngine({ contextFactory: factory });
    engine.unlock();
    engine.unlock();
    engine.consume([{ type: 'shot', targetId: 1, progress: 0 }]);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(first.sources).toEqual([]);

    pending.reject(new Error('resume denied'));
    await settleUnlock();
    engine.unlock();
    await settleUnlock();
    engine.consume([{ type: 'error' }]);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(recovered.sources).toHaveLength(1);
  });

  it.each<FaultStage>([
    'oscillator', 'gain', 'frequency', 'gain-param', 'source-connect', 'gain-connect', 'start', 'stop',
  ])('contains %s failures and cleans up a partial tone graph', async (fault) => {
    const context = new FaultyAudioContext();
    context.fault = fault;
    const engine = new AudioEngine({ contextFactory: () => context });
    engine.unlock();
    await settleUnlock();
    expect(() => engine.consume([{ type: 'error' }])).not.toThrow();
    expect(context.sources.every((source) => source.disconnected)).toBe(true);
    expect(context.gains.every((gain) => gain.disconnected)).toBe(true);
  });

  it.each<FaultStage>(['buffer-source', 'buffer', 'buffer-fill'])
    ('contains %s failures and cleans up a partial noise graph', async (fault) => {
      const context = new FaultyAudioContext();
      context.fault = fault;
      const engine = new AudioEngine({ contextFactory: () => context });
      engine.unlock();
      await settleUnlock();
      expect(() => engine.consume([{ type: 'destroyed', target: { id: 2, word: 'NOVA', typed: 4, x: 0, y: 0, width: 1, height: 1, speed: 1, kind: 'normal' } }])).not.toThrow();
      expect(context.sources.every((source) => source.disconnected)).toBe(true);
      expect(context.gains.every((gain) => gain.disconnected)).toBe(true);
    });

  it('immediately cancels active and delayed sounds when muted', async () => {
    const { engine, contexts } = createEngine();
    engine.unlock();
    await settleUnlock();
    engine.consume([{ type: 'shot', targetId: 1, progress: 0 }]);
    const context = contexts[0]!;
    engine.setEnabled(false);
    for (const source of context.sources) {
      expect(source.stops).toContain(context.currentTime);
      expect(source.disconnected).toBe(true);
    }
    expect(context.gains.every((gain) => gain.disconnected)).toBe(true);
  });

  it('disposes safely during a pending unlock and cancels scheduled sources', async () => {
    const pending = deferred<void>();
    const context = new FaultyAudioContext();
    context.resumeResult = pending.promise;
    const engine = new AudioEngine({ contextFactory: () => context });
    engine.unlock();
    engine.consume([{ type: 'error' }]);
    engine.dispose();
    pending.resolve();
    await settleUnlock();
    engine.consume([{ type: 'error' }]);
    expect(context.sources).toEqual([]);
    expect(context.closed).toBe(1);
  });

  it('cancels active and delayed sources before closing during dispose', async () => {
    const { engine, contexts } = createEngine();
    engine.unlock();
    await settleUnlock();
    engine.consume([{ type: 'shot', targetId: 1, progress: 0 }]);
    const context = contexts[0]!;
    engine.dispose();
    for (const source of context.sources) {
      expect(source.stops).toContain(context.currentTime);
      expect(source.disconnected).toBe(true);
    }
    expect(context.gains.every((gain) => gain.disconnected)).toBe(true);
    await Promise.resolve();
    expect(context.closed).toBe(1);
  });
});
