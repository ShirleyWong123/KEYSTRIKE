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
  suspend(): Promise<void>;
  close(): Promise<void>;
  createOscillator(): OscillatorLike;
  createBufferSource(): BufferSourceLike;
  createGain(): GainLike;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer;
}

export interface AudioEngineOptions {
  contextFactory?: () => AudioContextLike | null;
  enabled?: boolean;
  random?: () => number;
}

const DEFAULT_SAMPLE_RATE = 44_100;
const NOOP = (): void => undefined;

interface SourceRecord {
  source: AudioSourceLike;
  gain: GainLike | null;
}

interface ScheduledHit {
  record: SourceRecord;
  frequency: number;
  dueAt: number;
}

interface PausedHit {
  frequency: number;
  remainingSeconds: number;
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
  private readonly random: () => number;
  private context: AudioContextLike | null = null;
  private enabled: boolean;
  private unlocked = false;
  private unlockPending = false;
  private unlockAttempt = 0;
  private disposed = false;
  private presentationPaused = false;
  private readonly activeSources = new Set<SourceRecord>();
  private readonly scheduledHits: ScheduledHit[] = [];
  private readonly pausedHits: PausedHit[] = [];

  constructor({ contextFactory = browserContextFactory, enabled = true, random = Math.random }: AudioEngineOptions = {}) {
    this.contextFactory = contextFactory;
    this.enabled = enabled;
    this.random = random;
  }

  unlock(): void {
    if (this.disposed || this.unlockPending) return;
    if (this.unlocked) {
      if (this.context && !this.presentationPaused) this.resumeSafely(this.context);
      return;
    }

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
    if (!enabled) {
      this.pausedHits.length = 0;
      this.cancelAll(this.currentTime(this.context));
    }
  }

  pausePresentation(): void {
    if (this.disposed || this.presentationPaused) return;
    this.presentationPaused = true;
    const context = this.context;
    const pausedAt = this.currentTime(context);
    this.pausedHits.length = 0;
    for (const hit of this.scheduledHits) {
      if (hit.dueAt > pausedAt && this.activeSources.has(hit.record)) {
        this.pausedHits.push({
          frequency: hit.frequency,
          remainingSeconds: hit.dueAt - pausedAt,
        });
      }
    }
    this.cancelAll(pausedAt);
    if (context) this.suspendSafely(context);
  }

  resumeFromGesture(): void {
    if (this.disposed) return;
    this.presentationPaused = false;
    const context = this.context;
    if (!context || !this.unlocked) {
      this.unlock();
      return;
    }
    this.resumeSafely(context);
    this.resumePendingHits(context);
  }

  resetPresentation(): void {
    if (this.disposed) return;
    this.presentationPaused = false;
    this.pausedHits.length = 0;
    this.cancelAll(this.currentTime(this.context));
  }

  consume(events: readonly GameEvent[]): void {
    const context = this.context;
    if (this.disposed || this.presentationPaused || !this.unlocked || !this.enabled || !context) return;

    for (const event of events) {
      try {
        switch (event.type) {
          case 'shot':
            {
              const shotStart = this.currentTime(context);
              const shotPitch = 680 + (this.randomUnit() - 0.5) * 80;
              this.tone(context, 'sine', shotPitch, 0.12, 0.05, shotStart);
              this.scheduleHit(context, shotPitch + 240, shotStart + PROJECTILE_MS / 1000);
            }
            break;
          case 'error':
            this.tone(context, 'sawtooth', 120, 0.16, 0.14);
            break;
          case 'destroyed':
            this.noise(context, 0.18, 0.22);
            break;
          case 'level-up':
            {
              const phraseStart = this.currentTime(context);
              this.tone(context, 'triangle', 440, 0.1, 0.14, phraseStart);
              this.tone(context, 'triangle', 554, 0.12, 0.14, phraseStart + 0.06);
              this.tone(context, 'triangle', 659, 0.14, 0.16, phraseStart + 0.12);
            }
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
    this.pausedHits.length = 0;
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
  ): SourceRecord | null {
    let record: SourceRecord | null = null;
    try {
      const source = context.createOscillator();
      record = this.track(source);
      source.type = type;
      source.frequency.setValueAtTime(frequency, start);
      this.schedule(context, record, volume, duration, start);
      return this.activeSources.has(record) ? record : null;
    } catch {
      if (record) this.cancel(record, this.currentTime(context));
      return null;
    }
  }

  private scheduleHit(context: AudioContextLike, frequency: number, dueAt: number): void {
    const record = this.tone(context, 'sine', frequency, 0.06, 0.045, dueAt);
    if (record) this.scheduledHits.push({ record, frequency, dueAt });
  }

  private resumePendingHits(context: AudioContextLike): void {
    const pending = this.pausedHits.splice(0);
    if (!this.enabled || pending.length === 0) return;
    const resumedAt = this.currentTime(context);
    for (const hit of pending) {
      this.scheduleHit(context, hit.frequency, resumedAt + hit.remainingSeconds);
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
    if (this.presentationPaused) this.suspendSafely(context);
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
    const scheduledHit = this.scheduledHits.findIndex((hit) => hit.record === record);
    if (scheduledHit >= 0) this.scheduledHits.splice(scheduledHit, 1);
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

  private randomUnit(): number {
    try {
      const value = this.random();
      return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
    } catch {
      return 0.5;
    }
  }

  private closeSafely(context: AudioContextLike): void {
    try {
      void Promise.resolve(context.close()).catch(NOOP);
    } catch {
      // Closing an already-invalid browser context is harmless to gameplay.
    }
  }

  private suspendSafely(context: AudioContextLike): void {
    try {
      void Promise.resolve(context.suspend()).catch(NOOP);
    } catch {
      // Suspension is best effort; active sources were already cancelled.
    }
  }

  private resumeSafely(context: AudioContextLike): void {
    try {
      void Promise.resolve(context.resume()).catch(NOOP);
    } catch {
      // A rejected resume leaves gameplay running silently until the next gesture.
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
