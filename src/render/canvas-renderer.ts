import { PROJECTILE_MS } from '../game/config';
import { CANVAS_HEIGHT, CANVAS_WIDTH, DEFENSE_LINE, type WordMeasure } from '../game/target-manager';
import type { GameEvent, GameSettings, GameSnapshot, Target, TargetKind } from '../game/types';

const MAX_DPR = 2;
const SHIP_X = CANVAS_WIDTH / 2;
const SHIP_Y = 748;
const ERROR_MS = 120;
const EXPLOSION_MS = 650;
const BREACH_MS = 500;
const LEVEL_UP_MS = 900;
const SPECIAL_PULSE_MS = 420;
const MAX_SHOTS = 64;
const MAX_EXPLOSIONS = 12;
const MAX_BREACHES = 6;
const MAX_SPECIAL_PULSES = 24;
const MAX_PARTICLES = 120;
const MAX_REDUCED_PARTICLES = 32;
const MAX_SHARDS = 48;

const COLORS = {
  cyan: '#4be7ff',
  light: '#b9f8ff',
  orange: '#ff9d2e',
  projectile: '#ffbd66',
  particle: '#78efff',
  red: '#ff385c',
  repair: '#53e39b',
  pulse: '#c979ff',
  freeze: '#82dfff',
} as const;

type Point = { x: number; y: number };

type Shot = {
  targetId: number;
  progress: number;
  startedAt: number;
  destination: Point;
};

type Particle = Point & {
  dx: number;
  dy: number;
  size: number;
};

type Explosion = {
  x: number;
  y: number;
  startedAt: number;
  shards: Particle[];
  particles: Particle[];
};

type TimedPoint = Point & { startedAt: number };

type SpecialPulse = TimedPoint & { kind: Exclude<TargetKind, 'normal'> };

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

const interpolatedTargetY = (target: Target, interpolation: number, frozen: boolean): number =>
  target.y + target.speed * (clamp(interpolation, 0, 1) / 60) * (frozen ? 0.5 : 1);

const targetCenter = (target: Target, interpolation = 0, frozen = false): Point => ({
  x: target.x + target.width / 2,
  y: interpolatedTargetY(target, interpolation, frozen) + target.height / 2,
});

const specialColor = (kind: TargetKind): string => {
  if (kind === 'repair') return COLORS.repair;
  if (kind === 'pulse') return COLORS.pulse;
  if (kind === 'freeze') return COLORS.freeze;
  return COLORS.cyan;
};

const specialLabel = (kind: TargetKind): string | null => {
  if (kind === 'repair') return 'REPAIR';
  if (kind === 'pulse') return 'PULSE';
  if (kind === 'freeze') return 'FREEZE';
  return null;
};

/** Draws the fixed-size battlefield and owns cosmetic, wall-clock effect state only. */
export class CanvasRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly shots: Shot[] = [];
  private readonly explosions: Explosion[] = [];
  private readonly breaches: TimedPoint[] = [];
  private readonly specialPulses: SpecialPulse[] = [];
  private readonly knownTargets = new Map<number, Point>();
  private errorStartedAt = Number.NEGATIVE_INFINITY;
  private levelUp: { level: number; startedAt: number } | null = null;
  private presentationTime = 0;
  private lastWallTime: number | null = null;
  private lastRenderedPhase: GameSnapshot['phase'] | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly settings: GameSettings,
    private readonly clock: () => number = () => performance.now(),
  ) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context is unavailable');
    this.context = context;
    this.resize();
  }

  resize(): void {
    const rawDpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
    const dpr = clamp(rawDpr, 1, MAX_DPR);
    const bounds = this.canvas.getBoundingClientRect();
    const cssWidth = bounds.width > 0 ? bounds.width : CANVAS_WIDTH;
    const cssHeight = bounds.height > 0 ? bounds.height : CANVAS_HEIGHT;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.canvas.style.aspectRatio = `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`;
    this.context.setTransform(
      this.canvas.width / CANVAS_WIDTH,
      0,
      0,
      this.canvas.height / CANVAS_HEIGHT,
      0,
      0,
    );
  }

  readonly measureWord = (word: string): WordMeasure => {
    this.context.save();
    this.context.font = '700 18px "SFMono-Regular", Consolas, monospace';
    const width = Math.ceil(this.context.measureText(word).width + 36);
    this.context.restore();
    return { width: Math.max(74, width), height: 42 };
  };

  consume(events: readonly GameEvent[]): void {
    const currentTime = this.advancePresentationClock(this.lastRenderedPhase ?? 'playing');
    this.prune(currentTime);

    for (const event of events) {
      switch (event.type) {
        case 'shot': {
          const point = this.knownTargets.get(event.targetId) ?? { x: SHIP_X, y: 260 };
          this.pushBounded(this.shots, {
            targetId: event.targetId,
            progress: event.progress,
            startedAt: currentTime,
            destination: { ...point },
          }, MAX_SHOTS);
          break;
        }
        case 'error':
          this.errorStartedAt = currentTime;
          break;
        case 'destroyed':
          this.addExplosion(targetCenter(event.target), currentTime);
          break;
        case 'breach':
          this.pushBounded(this.breaches, { ...targetCenter(event.target), startedAt: currentTime }, MAX_BREACHES);
          break;
        case 'level-up':
          this.levelUp = { level: event.level, startedAt: currentTime };
          break;
        case 'special':
          for (const targetId of event.affectedIds) {
            const point = this.knownTargets.get(targetId);
            if (point) {
              this.pushBounded(
                this.specialPulses,
                { ...point, kind: event.kind, startedAt: currentTime },
                MAX_SPECIAL_PULSES,
              );
            }
          }
          break;
        default:
          // Runtime callers can bypass TypeScript's GameEvent union; malformed events are cosmetic no-ops.
          break;
        }
    }
  }

  render(snapshot: GameSnapshot, interpolation: number): void {
    const currentTime = this.advancePresentationClock(snapshot.phase);
    this.lastRenderedPhase = snapshot.phase;
    this.prune(currentTime);
    const frozen = snapshot.freezeRemainingMs > 0;
    const currentTargets = new Map<number, Point>();
    for (const target of snapshot.targets) {
      currentTargets.set(target.id, targetCenter(target, interpolation, frozen));
    }
    this.knownTargets.clear();
    for (const [id, point] of currentTargets) this.knownTargets.set(id, point);

    const context = this.context;
    context.save();
    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    this.applyErrorShake(currentTime);
    this.drawDeepSpace(snapshot.activeMs);
    this.drawStarDust(snapshot.activeMs);
    this.drawScanLines();
    this.drawPerspectiveGrid();
    this.drawDefenseLine(snapshot.shield);

    const locked = snapshot.targets.find(({ id }) => id === snapshot.lockedTargetId);
    for (const target of snapshot.targets) {
      if (target.id !== snapshot.lockedTargetId) this.drawTarget(target, interpolation, frozen, false);
    }
    if (locked) this.drawLockConnector(locked, interpolation, frozen);
    if (locked) this.drawTarget(locked, interpolation, frozen, true);

    this.drawProjectiles(currentTime);
    this.drawExplosions(currentTime);
    this.drawSpecialPulses(currentTime);
    this.drawShip();
    this.drawLevelIndicator(currentTime);
    this.drawEdgeWarning(currentTime);
    context.restore();
  }

  private addExplosion(center: Point, startedAt: number): void {
    const particleBudget = this.settings.reducedMotion ? MAX_REDUCED_PARTICLES : MAX_PARTICLES;
    const particleCount = this.settings.reducedMotion ? 4 : 14;
    const shardCount = this.settings.reducedMotion ? 2 : 5;
    const availableParticles = Math.max(
      0,
      particleBudget - this.explosions.reduce((total, explosion) => total + explosion.particles.length, 0),
    );
    const availableShards = Math.max(
      0,
      MAX_SHARDS - this.explosions.reduce((total, explosion) => total + explosion.shards.length, 0),
    );
    const makeParticle = (index: number, total: number, speed: number, size: number): Particle => {
      const angle = (Math.PI * 2 * index) / Math.max(1, total) + center.x * 0.017;
      return {
        ...center,
        dx: Math.cos(angle) * speed,
        dy: Math.sin(angle) * speed,
        size,
      };
    };
    const particles = Array.from(
      { length: Math.min(particleCount, availableParticles) },
      (_, index) => makeParticle(index, particleCount, 46 + (index % 4) * 9, 1.4 + (index % 3) * 0.5),
    );
    const shards = Array.from(
      { length: Math.min(shardCount, availableShards) },
      (_, index) => makeParticle(index, shardCount, 62 + (index % 3) * 12, 7),
    );
    this.pushBounded(this.explosions, { ...center, startedAt, particles, shards }, MAX_EXPLOSIONS);
  }

  private advancePresentationClock(phase: GameSnapshot['phase']): number {
    const wallTime = this.clock();
    if (!Number.isFinite(wallTime)) return this.presentationTime;
    if (this.lastWallTime === null) {
      this.lastWallTime = wallTime;
      return this.presentationTime;
    }

    const elapsed = Math.max(0, wallTime - this.lastWallTime);
    this.lastWallTime = Math.max(this.lastWallTime, wallTime);
    if (phase !== 'paused') this.presentationTime += elapsed;
    return this.presentationTime;
  }

  private prune(currentTime: number): void {
    this.removeExpired(this.shots, (shot) => currentTime - shot.startedAt <= PROJECTILE_MS);
    this.removeExpired(this.explosions, (effect) => currentTime - effect.startedAt <= EXPLOSION_MS);
    this.removeExpired(this.breaches, (effect) => currentTime - effect.startedAt <= BREACH_MS);
    this.removeExpired(this.specialPulses, (effect) => currentTime - effect.startedAt <= SPECIAL_PULSE_MS);
    if (this.levelUp && currentTime - this.levelUp.startedAt > LEVEL_UP_MS) this.levelUp = null;
  }

  private removeExpired<T>(items: T[], keep: (item: T) => boolean): void {
    let writeIndex = 0;
    for (const item of items) {
      if (keep(item)) items[writeIndex++] = item;
    }
    items.length = writeIndex;
  }

  private pushBounded<T>(items: T[], item: T, maximum: number): void {
    if (items.length >= maximum) items.splice(0, items.length - maximum + 1);
    items.push(item);
  }

  private applyErrorShake(currentTime: number): void {
    const age = currentTime - this.errorStartedAt;
    if (this.settings.reducedMotion || age < 0 || age > ERROR_MS) return;
    const decay = 1 - age / ERROR_MS;
    this.context.translate(Math.sin((age + 1) * 0.85) * 3 * decay, Math.cos((age + 1) * 0.63) * 1.5 * decay);
  }

  private drawDeepSpace(activeMs: number): void {
    const gradient = this.context.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    gradient.addColorStop(0, '#02040d');
    gradient.addColorStop(0.55, '#07142a');
    gradient.addColorStop(1, '#020711');
    this.context.fillStyle = gradient;
    this.context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const orbitalGlow = this.context.createRadialGradient(240, 585, 10, 240, 585, 330);
    orbitalGlow.addColorStop(0, 'rgba(30, 154, 210, 0.11)');
    orbitalGlow.addColorStop(1, 'rgba(3, 10, 26, 0)');
    this.context.fillStyle = orbitalGlow;
    this.context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    void activeMs;
  }

  private drawStarDust(activeMs: number): void {
    this.context.fillStyle = '#9adfff';
    for (let index = 0; index < 44; index += 1) {
      const x = (index * 83 + 29) % CANVAS_WIDTH;
      const speed = 0.002 + (index % 5) * 0.0004;
      const y = (index * 137 + activeMs * speed) % CANVAS_HEIGHT;
      this.context.globalAlpha = 0.2 + (index % 4) * 0.08;
      this.context.fillRect(x, y, index % 7 === 0 ? 1.5 : 1, index % 7 === 0 ? 1.5 : 1);
    }
    this.context.globalAlpha = 1;
  }

  private drawScanLines(): void {
    this.context.fillStyle = '#8edfff';
    this.context.globalAlpha = 0.025;
    for (let y = 0; y < CANVAS_HEIGHT; y += 8) this.context.fillRect(0, y, CANVAS_WIDTH, 1);
    this.context.globalAlpha = 1;
  }

  private drawPerspectiveGrid(): void {
    const horizon = 250;
    this.context.strokeStyle = '#1aa4c840';
    this.context.lineWidth = 1;
    this.context.beginPath();
    for (let x = -360; x <= 840; x += 80) {
      this.context.moveTo(CANVAS_WIDTH / 2, horizon);
      this.context.lineTo(x, DEFENSE_LINE);
    }
    for (let y = horizon; y <= DEFENSE_LINE; y += Math.max(14, (y - horizon) * 0.16)) {
      this.context.moveTo(0, y);
      this.context.lineTo(CANVAS_WIDTH, y);
    }
    this.context.stroke();
  }

  private drawDefenseLine(shield: number): void {
    const strength = clamp(shield, 0, 100) / 100;
    this.context.strokeStyle = strength <= 0.3 ? COLORS.red : COLORS.cyan;
    this.context.globalAlpha = 0.45 + strength * 0.35;
    this.context.lineWidth = 2;
    this.context.beginPath();
    this.context.moveTo(12, DEFENSE_LINE);
    this.context.lineTo(CANVAS_WIDTH - 12, DEFENSE_LINE);
    this.context.stroke();
    this.context.globalAlpha = 1;
  }

  private drawLockConnector(target: Target, interpolation: number, frozen: boolean): void {
    const center = targetCenter(target, interpolation, frozen);
    this.context.strokeStyle = '#4be7ff80';
    this.context.lineWidth = 1;
    this.context.beginPath();
    this.context.moveTo(SHIP_X, SHIP_Y - 16);
    this.context.lineTo(center.x, center.y);
    this.context.stroke();
  }

  private drawTarget(target: Target, interpolation: number, frozen: boolean, locked: boolean): void {
    const y = interpolatedTargetY(target, interpolation, frozen);
    const center = { x: target.x + target.width / 2, y: y + target.height / 2 };
    const coreColor = specialColor(target.kind);
    this.context.save();
    this.context.strokeStyle = coreColor;
    this.context.fillStyle = coreColor;
    this.context.lineWidth = locked ? 2 : 1.25;
    this.context.globalAlpha = locked ? 1 : 0.82;

    this.context.beginPath();
    this.context.moveTo(target.x + 4, center.y);
    this.context.lineTo(target.x + 12, y + 5);
    this.context.lineTo(target.x + 20, center.y);
    this.context.lineTo(target.x + 12, y + target.height - 5);
    this.context.closePath();
    this.context.stroke();
    this.context.beginPath();
    this.context.arc(target.x + 12, center.y, 3.5, 0, Math.PI * 2);
    this.context.fill();

    if (locked) {
      const left = target.x - 6;
      const right = target.x + target.width + 6;
      this.context.beginPath();
      this.context.moveTo(left + 10, y - 5);
      this.context.lineTo(left, y - 5);
      this.context.lineTo(left, y + 7);
      this.context.moveTo(right - 10, y - 5);
      this.context.lineTo(right, y - 5);
      this.context.lineTo(right, y + 7);
      this.context.moveTo(left, y + target.height - 7);
      this.context.lineTo(left, y + target.height + 5);
      this.context.lineTo(left + 10, y + target.height + 5);
      this.context.moveTo(right, y + target.height - 7);
      this.context.lineTo(right, y + target.height + 5);
      this.context.lineTo(right - 10, y + target.height + 5);
      this.context.stroke();
    }

    const label = specialLabel(target.kind);
    if (label) {
      this.context.font = '700 8px "SFMono-Regular", Consolas, monospace';
      this.context.textAlign = 'right';
      this.context.textBaseline = 'bottom';
      this.context.fillStyle = coreColor;
      this.context.fillText(label, target.x + target.width, y - 3);
    }

    this.drawWord(target, y);
    this.context.restore();
  }

  private drawWord(target: Target, y: number): void {
    const typed = target.word.slice(0, clamp(Math.floor(target.typed), 0, target.word.length));
    const untyped = target.word.slice(typed.length);
    const x = target.x + 27;
    const baseline = y + target.height / 2 + 1;
    this.context.font = '700 18px "SFMono-Regular", Consolas, monospace';
    this.context.textAlign = 'left';
    this.context.textBaseline = 'middle';

    if (typed) {
      this.context.fillStyle = COLORS.orange;
      this.context.shadowColor = COLORS.orange;
      this.context.shadowBlur = 10;
      this.context.fillText(typed, x, baseline);
      const typedWidth = this.context.measureText(typed).width;
      this.context.strokeStyle = COLORS.orange;
      this.context.lineWidth = 1.5;
      this.context.beginPath();
      this.context.moveTo(x, baseline + 12);
      this.context.lineTo(x + typedWidth, baseline + 12);
      this.context.stroke();
    }

    if (untyped) {
      const offset = this.context.measureText(typed).width;
      this.context.fillStyle = COLORS.light;
      this.context.shadowColor = COLORS.cyan;
      this.context.shadowBlur = 3;
      this.context.fillText(untyped, x + offset, baseline);
    }
    this.context.shadowBlur = 0;
  }

  private drawProjectiles(currentTime: number): void {
    for (const shot of this.shots) {
      const destination = shot.destination;
      const progress = clamp((currentTime - shot.startedAt) / PROJECTILE_MS, 0, 1);
      const eased = 1 - (1 - progress) ** 2;
      const x = SHIP_X + (destination.x - SHIP_X) * eased;
      const y = SHIP_Y - 20 + (destination.y - (SHIP_Y - 20)) * eased;
      this.context.fillStyle = COLORS.projectile;
      this.context.shadowColor = COLORS.projectile;
      this.context.shadowBlur = 12;
      this.context.beginPath();
      this.context.arc(x, y, 3.2, 0, Math.PI * 2);
      this.context.fill();
      this.context.shadowBlur = 0;
    }
  }

  private drawExplosions(currentTime: number): void {
    let flashOpacity = 0;
    for (const explosion of this.explosions) {
      const age = currentTime - explosion.startedAt;
      const progress = clamp(age / EXPLOSION_MS, 0, 1);
      flashOpacity = Math.max(
        flashOpacity,
        (this.settings.reducedMotion ? 0.1 : 0.26) * Math.max(0, 1 - age / 120),
      );

      this.context.strokeStyle = '#fff3d6';
      this.context.globalAlpha = 1 - progress;
      this.context.lineWidth = 2;
      this.context.beginPath();
      this.context.arc(explosion.x, explosion.y, 7 + progress * 42, 0, Math.PI * 2);
      this.context.stroke();

      for (const shard of explosion.shards) {
        const elapsed = age / 1_000;
        const x = shard.x + shard.dx * elapsed;
        const y = shard.y + shard.dy * elapsed;
        this.context.strokeStyle = COLORS.orange;
        this.context.globalAlpha = 1 - progress;
        this.context.lineWidth = 2;
        this.context.beginPath();
        this.context.moveTo(x, y);
        this.context.lineTo(x + shard.dx * 0.06, y + shard.dy * 0.06);
        this.context.stroke();
      }

      for (const particle of explosion.particles) {
        const elapsed = age / 1_000;
        const motionScale = this.settings.reducedMotion ? 0.2 : 1;
        this.context.fillStyle = COLORS.particle;
        this.context.globalAlpha = 1 - progress;
        this.context.beginPath();
        this.context.arc(
          particle.x + particle.dx * elapsed * motionScale,
          particle.y + particle.dy * elapsed * motionScale,
          particle.size,
          0,
          Math.PI * 2,
        );
        this.context.fill();
      }
    }

    if (flashOpacity > 0) {
      this.context.fillStyle = '#ffffff';
      this.context.globalAlpha = flashOpacity;
      this.context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
    this.context.globalAlpha = 1;
  }

  private drawSpecialPulses(currentTime: number): void {
    for (const pulse of this.specialPulses) {
      const progress = clamp((currentTime - pulse.startedAt) / SPECIAL_PULSE_MS, 0, 1);
      this.context.strokeStyle = specialColor(pulse.kind);
      this.context.globalAlpha = (1 - progress) * (this.settings.reducedMotion ? 0.35 : 0.75);
      this.context.lineWidth = 2;
      this.context.beginPath();
      this.context.arc(pulse.x, pulse.y, 12 + progress * (this.settings.reducedMotion ? 12 : 70), 0, Math.PI * 2);
      this.context.stroke();
    }
    this.context.globalAlpha = 1;
  }

  private drawShip(): void {
    this.context.strokeStyle = COLORS.cyan;
    this.context.fillStyle = '#082f46';
    this.context.lineWidth = 2;
    this.context.shadowColor = COLORS.cyan;
    this.context.shadowBlur = 12;
    this.context.beginPath();
    this.context.moveTo(SHIP_X, SHIP_Y - 27);
    this.context.lineTo(SHIP_X + 13, SHIP_Y - 5);
    this.context.lineTo(SHIP_X + 31, SHIP_Y + 8);
    this.context.lineTo(SHIP_X + 11, SHIP_Y + 5);
    this.context.lineTo(SHIP_X, SHIP_Y + 17);
    this.context.lineTo(SHIP_X - 11, SHIP_Y + 5);
    this.context.lineTo(SHIP_X - 31, SHIP_Y + 8);
    this.context.lineTo(SHIP_X - 13, SHIP_Y - 5);
    this.context.closePath();
    this.context.fill();
    this.context.stroke();
    this.context.shadowBlur = 0;
  }

  private drawLevelIndicator(currentTime: number): void {
    if (!this.levelUp) return;
    const progress = clamp((currentTime - this.levelUp.startedAt) / LEVEL_UP_MS, 0, 1);
    this.context.fillStyle = COLORS.light;
    this.context.globalAlpha = 1 - progress;
    this.context.font = '800 28px "SFMono-Regular", Consolas, monospace';
    this.context.textAlign = 'center';
    this.context.textBaseline = 'middle';
    this.context.shadowColor = COLORS.cyan;
    this.context.shadowBlur = 14;
    this.context.fillText(`LEVEL ${this.levelUp.level}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT * 0.42);
    this.context.shadowBlur = 0;
    this.context.globalAlpha = 1;
  }

  private drawEdgeWarning(currentTime: number): void {
    const errorAge = currentTime - this.errorStartedAt;
    const errorActive = errorAge >= 0 && errorAge <= ERROR_MS;
    const breachStrength = this.breaches.reduce((maximum, breach) => {
      const progress = clamp((currentTime - breach.startedAt) / BREACH_MS, 0, 1);
      return Math.max(maximum, 1 - progress);
    }, 0);
    if (!errorActive && breachStrength === 0) return;

    const errorStrength = errorActive ? 1 - errorAge / ERROR_MS : 0;
    this.context.strokeStyle = COLORS.red;
    this.context.lineWidth = this.settings.reducedMotion ? 4 : 2 + 4 * Math.max(errorStrength, breachStrength);
    this.context.globalAlpha = this.settings.reducedMotion
      ? 0.65
      : 0.25 + Math.max(errorStrength, breachStrength) * 0.55;
    this.context.strokeRect(3, 3, CANVAS_WIDTH - 6, CANVAS_HEIGHT - 6);

    for (const breach of this.breaches) {
      const progress = clamp((currentTime - breach.startedAt) / BREACH_MS, 0, 1);
      this.context.strokeStyle = COLORS.red;
      this.context.globalAlpha = (1 - progress) * (this.settings.reducedMotion ? 0.35 : 0.8);
      this.context.beginPath();
      this.context.arc(breach.x, DEFENSE_LINE, 12 + progress * 48, Math.PI, Math.PI * 2);
      this.context.stroke();
    }
    this.context.globalAlpha = 1;
  }
}
