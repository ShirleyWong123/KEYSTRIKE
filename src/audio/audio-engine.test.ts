import { describe, expect, it } from 'vitest';
import { PROJECTILE_MS } from '../game/config';
import type { GameEvent } from '../game/types';
import { AudioEngine, type AudioContextLike, type AudioNodeLike, type AudioParamLike, type AudioSourceLike } from './audio-engine';

type Automation = { value: number; at: number };

class FakeParam implements AudioParamLike {
  readonly values: Automation[] = [];
  readonly ramps: Automation[] = [];

  setValueAtTime(value: number, at: number): void {
    this.values.push({ value, at });
  }

  linearRampToValueAtTime(value: number, at: number): void {
    this.ramps.push({ value, at });
  }
}

class FakeNode implements AudioNodeLike {
  connected = false;
  disconnected = false;

  connect(): AudioNodeLike {
    this.connected = true;
    return this;
  }

  disconnect(): void {
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

  start(at: number): void { this.starts.push(at); }
  stop(at: number): void { this.stops.push(at); }
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

  it('schedules no audio while muted', () => {
    const { engine, contexts } = createEngine();
    engine.unlock();
    engine.setEnabled(false);
    engine.consume(events);
    expect(contexts[0]!.sources).toEqual([]);
  });

  it('plays a launch tone and a quieter hit pulse exactly one projectile delay later', () => {
    const { engine, contexts } = createEngine();
    engine.unlock();
    engine.consume([{ type: 'shot', targetId: 1, progress: 0 }]);
    const context = contexts[0]!;

    expect(context.sources).toHaveLength(2);
    expect(context.sources.map((source) => source.starts[0])).toEqual([4, 4 + PROJECTILE_MS / 1000]);
    expect(context.gains.map((gain) => gain.gain.values[0]!.value)).toEqual([0.12, 0.06]);
  });

  it('uses distinct synthesized envelopes for error, explosion, level-up, and breach', () => {
    const { engine, contexts } = createEngine();
    engine.unlock();
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
});
