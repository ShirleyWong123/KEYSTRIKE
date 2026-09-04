import { LEVELS } from './config';
import { selectWord } from './words';
import type { Target, TargetKind, Difficulty } from './types';

export const CANVAS_WIDTH = 480;
export const CANVAS_HEIGHT = 800;
export const DEFENSE_LINE = 720;
export const HORIZONTAL_MARGIN = 16;
export const LABEL_GAP = 12;

export interface WordMeasure {
  width: number;
  height: number;
}

export type MeasureWord = (word: string) => WordMeasure;

export interface SpawnRequest {
  difficulty: Difficulty;
  level: number;
  targets: readonly Target[];
  kind?: TargetKind;
  tutorial?: boolean;
  id?: number;
}

export interface MovementResult {
  active: Target[];
  breached: Target[];
}

const defaultMeasure: MeasureWord = (word) => ({ width: word.length * 10, height: 36 });

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Owns deterministic target geometry, spawning, and movement rules. */
export class TargetManager {
  private nextId = 1;

  constructor(
    private readonly random: () => number = Math.random,
    private readonly measureWord: MeasureWord = defaultMeasure,
  ) {}

  isLegalRect(rect: { x: number; y: number; width: number; height: number }, existing: readonly Target[]): boolean {
    if (rect.x < HORIZONTAL_MARGIN || rect.x + rect.width > CANVAS_WIDTH - HORIZONTAL_MARGIN) return false;
    const expanded = { x: rect.x - LABEL_GAP, y: rect.y - LABEL_GAP, width: rect.width + LABEL_GAP * 2, height: rect.height + LABEL_GAP * 2 };
    return existing.every((target) => !overlaps(expanded, target));
  }

  trySpawn(request: SpawnRequest): Target | null {
    const levelIndex = Math.min(LEVELS.length, Math.max(1, Math.floor(request.level))) - 1;
    const level = LEVELS[levelIndex] ?? LEVELS[0];
    if (request.targets.length >= level.maxTargets) return null;

    const excludedWords = request.targets.map((target) => target.word);
    const excludedInitials = request.targets.map((target) => target.word.charAt(0));
    const word = selectWord(request.difficulty, request.level, excludedWords, excludedInitials, this.random);
    if (!word) return null;
    const size = this.measureWord(word);
    const positions = this.candidatePositions(size.width, size.height);
    for (let offset = 0; offset < positions.length; offset += 1) {
      const position = positions[(Math.floor(this.random() * positions.length) + offset) % positions.length]!;
      if (!this.isLegalRect({ ...position, width: size.width, height: size.height }, request.targets)) continue;
      const id = request.id ?? this.allocateId(request.targets);
      this.nextId = Math.max(this.nextId, id + 1);
      return {
        id,
        word,
        typed: 0,
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        speed: request.tutorial ? level.speed * 0.7 : level.speed,
        kind: request.kind ?? 'normal',
        ...(request.tutorial ? { tutorial: true } : {}),
      };
    }
    return null;
  }

  update(targets: readonly Target[], deltaMs: number, freezeFactor: number): MovementResult {
    const factor = Number.isFinite(freezeFactor) ? freezeFactor : 1;
    const active: Target[] = [];
    const breached: Target[] = [];
    for (const target of targets) {
      const moved = { ...target, y: target.y + target.speed * (deltaMs / 1000) * factor };
      if (moved.y + moved.height >= DEFENSE_LINE) breached.push(moved);
      else active.push(moved);
    }
    return { active, breached };
  }

  private allocateId(existing: readonly Target[]): number {
    const highest = existing.reduce((max, target) => Math.max(max, target.id), 0);
    this.nextId = Math.max(this.nextId, highest + 1);
    return this.nextId++;
  }

  private candidatePositions(width: number, height: number): Array<{ x: number; y: number }> {
    const maxX = Math.max(HORIZONTAL_MARGIN, CANVAS_WIDTH - HORIZONTAL_MARGIN - width);
    const maxY = Math.max(0, DEFENSE_LINE - height - LABEL_GAP);
    return Array.from({ length: 12 }, (_, index) => ({
      x: HORIZONTAL_MARGIN + ((maxX - HORIZONTAL_MARGIN) * index) / 11,
      y: LABEL_GAP + ((maxY - LABEL_GAP) * ((index * 5) % 12)) / 11,
    }));
  }
}

export const findLockCandidate = (targets: readonly Target[], initial: string): Target | null =>
  targets
    .filter((target) => target.word[0] === initial)
    .sort((a, b) => b.y - a.y || a.id - b.id)[0] ?? null;
