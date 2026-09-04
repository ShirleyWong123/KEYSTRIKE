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
  private disposed = false;

  constructor({ contextFactory = browserContextFactory, enabled = true }: AudioEngineOptions = {}) {
    this.contextFactory = contextFactory;
    this.enabled = enabled;
  }

  unlock(): void {
    if (this.disposed || this.unlocked) return;
    this.unlocked = true;
    try {
      this.context = this.contextFactory();
      void this.context?.resume().catch(NOOP);
    } catch {
      this.context = null;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  consume(events: readonly GameEvent[]): void {
    const context = this.context;
    if (this.disposed || !this.unlocked || !this.enabled || !context) return;

    for (const event of events) {
      switch (event.type) {
        case 'shot':
          this.tone(context, 'sine', 680, 0.12, 0.05);
          this.tone(context, 'sine', 920, 0.06, 0.045, PROJECTILE_MS / 1000);
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
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const context = this.context;
    this.context = null;
    if (context) void context.close().catch(NOOP);
  }

  private tone(
    context: AudioContextLike,
    type: OscillatorType,
    frequency: number,
    volume: number,
    duration: number,
    delay = 0,
  ): void {
    const source = context.createOscillator();
    source.type = type;
    source.frequency.setValueAtTime(frequency, context.currentTime + delay);
    this.schedule(context, source, volume, duration, delay);
  }

  private noise(context: AudioContextLike, volume: number, duration: number): void {
    const source = context.createBufferSource();
    const samples = Math.ceil(DEFAULT_SAMPLE_RATE * duration);
    const buffer = context.createBuffer(1, samples, DEFAULT_SAMPLE_RATE);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    source.buffer = buffer;
    this.schedule(context, source, volume, duration);
  }

  private schedule(
    context: AudioContextLike,
    source: AudioSourceLike,
    volume: number,
    duration: number,
    delay = 0,
  ): void {
    const gain = context.createGain();
    const start = context.currentTime + delay;
    const end = start + Math.min(duration, 1);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.linearRampToValueAtTime(0.001, end);
    source.connect(gain);
    gain.connect(context.destination);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    source.start(start);
    source.stop(end);
  }
}
