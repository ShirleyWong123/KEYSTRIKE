import { PROJECTILE_MS } from '../game/config';
import type { GameEvent } from '../game/types';

export interface AudioParamLike {
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): AudioNodeLike;
  disconnect(): void;
}

export interface AudioSourceLike extends AudioNodeLike {
  onended: ((event: Event) => unknown) | null;
  start(when: number): void;
  stop(when: number): void;
}

interface OscillatorLike extends AudioSourceLike {
  frequency: AudioParamLike;
  type: OscillatorType;
}

interface BufferSourceLike extends AudioSourceLike {
  buffer: AudioBuffer | null;
}

interface GainLike extends AudioNodeLike {
  gain: AudioParamLike;
}

export interface AudioContextLike {
  currentTime: number;
  destination: AudioNodeLike;
  resume(): Promise<void>;
  close(): Promise<void>;
  createOscillator(): OscillatorLike;
  createBufferSource(): BufferSourceLike;
  createGain(): GainLike;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer;
}

export interface AudioEngineOptions {
  contextFactory?: () => AudioContextLike | null;
  enabled?: boolean;
}

const DEFAULT_SAMPLE_RATE = 44_100;
const NOOP = (): void => undefined;

interface SourceRecord {
  source: AudioSourceLike;
  gain: GainLike | null;
}

const browserContextFactory = (): AudioContextLike | null => {
  const Context = (globalThis as typeof globalThis & {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  }).AudioContext ?? (globalThis as typeof globalThis & {
    webkitAudioContext?: new () => AudioContextLike;
  }).webkitAudioContext;
  if (!Context) return null;

  try {
    return new Context();
  } catch {
    return null;
  }
};

export class AudioEngine {
  private readonly contextFactory: () => AudioContextLike | null;
  private context: AudioContextLike | null = null;
  private enabled: boolean;
  private unlocked = false;
  private unlockPending = false;
  private unlockAttempt = 0;
  private disposed = false;
  private readonly activeSources = new Set<SourceRecord>();

  constructor({ contextFactory = browserContextFactory, enabled = true }: AudioEngineOptions = {}) {
    this.contextFactory = contextFactory;
    this.enabled = enabled;
  }

  unlock(): void {
    if (this.disposed || this.unlocked || this.unlockPending) return;

    let context: AudioContextLike | null;
    try {
      context = this.contextFactory();
    } catch {
      return;
    }
    if (!context) return;

    this.context = context;
    this.unlockPending = true;
    const attempt = ++this.unlockAttempt;

    try {
      void Promise.resolve(context.resume()).then(
        () => this.finishUnlock(context, attempt),
        () => this.failUnlock(context, attempt),
      );
    } catch {
      this.failUnlock(context, attempt);
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancelAll(this.currentTime(this.context));
  }

  consume(events: readonly GameEvent[]): void {
    const context = this.context;
    if (this.disposed || !this.unlocked || !this.enabled || !context) return;

    for (const event of events) {
      try {
        switch (event.type) {
          case 'shot':
            {
              const shotStart = this.currentTime(context);
              this.tone(context, 'sine', 680, 0.12, 0.05, shotStart);
              this.tone(context, 'sine', 920, 0.06, 0.045, shotStart + PROJECTILE_MS / 1000);
            }
            break;
          case 'error':
            this.tone(context, 'sawtooth', 120, 0.16, 0.14);
            break;
          case 'destroyed':
            this.noise(context, 0.18, 0.22);
            break;
          case 'level-up':
            this.tone(context, 'triangle', 440, 0.14, 0.16);
            break;
          case 'breach':
            this.tone(context, 'square', 80, 0.18, 0.2);
            break;
          case 'special':
            break;
          default:
            break;
        }
      } catch {
        // Individual browser audio operations must never break the game loop.
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const context = this.context;
    this.context = null;
    this.unlocked = false;
    this.unlockPending = false;
    this.unlockAttempt += 1;
    this.cancelAll(this.currentTime(context));
    if (context) this.closeSafely(context);
  }

  private tone(
    context: AudioContextLike,
    type: OscillatorType,
    frequency: number,
    volume: number,
    duration: number,
    start = this.currentTime(context),
  ): void {
    let record: SourceRecord | null = null;
    try {
      const source = context.createOscillator();
      record = this.track(source);
      source.type = type;
      source.frequency.setValueAtTime(frequency, start);
      this.schedule(context, record, volume, duration, start);
    } catch {
      if (record) this.cancel(record, this.currentTime(context));
    }
  }

  private noise(context: AudioContextLike, volume: number, duration: number, start = this.currentTime(context)): void {
    let record: SourceRecord | null = null;
    try {
      const source = context.createBufferSource();
      record = this.track(source);
      const samples = Math.ceil(DEFAULT_SAMPLE_RATE * duration);
      const buffer = context.createBuffer(1, samples, DEFAULT_SAMPLE_RATE);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
      source.buffer = buffer;
      this.schedule(context, record, volume, duration, start);
    } catch {
      if (record) this.cancel(record, this.currentTime(context));
    }
  }

  private schedule(
    context: AudioContextLike,
    record: SourceRecord,
    volume: number,
    duration: number,
    start: number,
  ): void {
    try {
      const gain = context.createGain();
      record.gain = gain;
      const end = start + Math.min(duration, 1);
      gain.gain.setValueAtTime(volume, start);
      gain.gain.linearRampToValueAtTime(0.001, end);
      record.source.connect(gain);
      gain.connect(context.destination);
      record.source.onended = () => this.cancel(record);
      record.source.start(start);
      record.source.stop(end);
    } catch {
      this.cancel(record, this.currentTime(context));
    }
  }

  private finishUnlock(context: AudioContextLike, attempt: number): void {
    if (this.disposed || this.context !== context || this.unlockAttempt !== attempt) return;
    this.unlockPending = false;
    this.unlocked = true;
  }

  private failUnlock(context: AudioContextLike, attempt: number): void {
    if (this.context !== context || this.unlockAttempt !== attempt) return;
    this.context = null;
    this.unlockPending = false;
    this.unlocked = false;
    this.closeSafely(context);
  }

  private track(source: AudioSourceLike): SourceRecord {
    const record = { source, gain: null };
    this.activeSources.add(record);
    return record;
  }

  private cancelAll(stopAt: number): void {
    for (const record of [...this.activeSources]) this.cancel(record, stopAt);
  }

  private cancel(record: SourceRecord, stopAt?: number): void {
    this.activeSources.delete(record);
    if (stopAt !== undefined) this.callSafely(() => record.source.stop(stopAt));
    this.callSafely(() => record.source.disconnect());
    if (record.gain) this.callSafely(() => record.gain?.disconnect());
  }

  private currentTime(context: AudioContextLike | null): number {
    try {
      return context?.currentTime ?? 0;
    } catch {
      return 0;
    }
  }

  private closeSafely(context: AudioContextLike): void {
    try {
      void Promise.resolve(context.close()).catch(NOOP);
    } catch {
      // Closing an already-invalid browser context is harmless to gameplay.
    }
  }

  private callSafely(operation: () => void): void {
    try {
      operation();
    } catch {
      // Best-effort cleanup must continue after one failed operation.
    }
  }
}
