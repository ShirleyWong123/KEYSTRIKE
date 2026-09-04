import type { AudioEngine } from '../audio/audio-engine';
import { accuracy, wpm } from '../game/metrics';
import type { GameModel } from '../game/game-model';
import type { Difficulty, GamePhase, GameSettings, GameSnapshot } from '../game/types';
import { StorageAdapter } from './storage';

const DIFFICULTIES = [
  { value: 'easy', label: 'Cadet', length: '3–5 letters', wpm: '20–35 WPM' },
  { value: 'normal', label: 'Pilot', length: '4–8 letters', wpm: '35–50 WPM' },
  { value: 'hard', label: 'Ace', length: '6–12 letters', wpm: '50+ WPM' },
] as const satisfies ReadonlyArray<{
  value: Difficulty;
  label: string;
  length: string;
  wpm: string;
}>;

const safeLocalStorage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

const systemReducedMotion = (): boolean => {
  try {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
};

const formatMetric = (value: number): string => Number.isInteger(value) ? String(value) : value.toFixed(1);

const formatDuration = (activeMs: number): string => {
  const safeMs = Number.isFinite(activeMs) && activeMs > 0 ? activeMs : 0;
  const minutes = Math.floor(safeMs / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1_000);
  const tenths = Math.floor((safeMs % 1_000) / 100);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
};

const defaultStorage = (): StorageAdapter =>
  new StorageAdapter(safeLocalStorage(), systemReducedMotion());

/** Owns semantic screens and focus while leaving game timing to the composition root. */
export class AppShell {
  readonly canvas: HTMLCanvasElement;
  readonly settings: GameSettings;

  private readonly menu: HTMLElement;
  private readonly game: HTMLElement;
  private readonly pauseDialog: HTMLElement;
  private readonly resultsDialog: HTMLElement;
  private readonly continueButton: HTMLButtonElement;
  private readonly selectedDifficultyLabel: HTMLElement;
  private lastPhase: GamePhase = 'menu';

  constructor(
    private readonly root: HTMLElement,
    private readonly model: GameModel,
    private readonly audio: AudioEngine,
    private readonly storage: StorageAdapter = defaultStorage(),
  ) {
    const stored = this.storage.loadSettings();
    this.settings = {
      difficulty: 'easy',
      soundEnabled: stored.soundEnabled,
      reducedMotion: stored.reducedMotion,
    };

    this.root.classList.add('app-shell');
    this.root.innerHTML = this.template();
    this.menu = this.required('[data-screen="menu"]');
    this.game = this.required('[data-screen="game"]');
    this.pauseDialog = this.required('[data-screen="pause"]');
    this.resultsDialog = this.required('[data-screen="results"]');
    this.continueButton = this.required<HTMLButtonElement>('[data-action="continue"]');
    this.selectedDifficultyLabel = this.required('[data-selected-difficulty]');
    this.canvas = this.required<HTMLCanvasElement>('#battlefield');

    this.bindMenu();
    this.bindActions();
    this.bindDialogFocus();
    this.bindFocusState();
    this.audio.setEnabled(this.settings.soundEnabled);
    const initialSnapshot = this.model.snapshot();
    this.render(initialSnapshot);
    if (initialSnapshot.phase === 'menu') this.radios().find(({ checked }) => checked)?.focus();
  }

  update(snapshot: GameSnapshot = this.model.snapshot()): void {
    this.render(snapshot);
  }

  render(snapshot: GameSnapshot = this.model.snapshot()): void {
    this.updateHud(snapshot);
    const inMenu = snapshot.phase === 'menu';
    this.menu.hidden = !inMenu;
    this.game.hidden = inMenu;
    this.pauseDialog.hidden = snapshot.phase !== 'paused';
    this.resultsDialog.hidden = snapshot.phase !== 'gameover';
    this.required('[data-countdown]').hidden = snapshot.phase !== 'countdown';
    this.required('[data-tutorial-hint]').hidden = snapshot.phase !== 'playing'
      || !snapshot.targets.some(({ tutorial }) => tutorial === true);

    if (snapshot.phase === 'gameover' && this.lastPhase !== 'gameover') this.updateResults(snapshot);
    if (snapshot.phase !== this.lastPhase) this.moveFocus(snapshot.phase);
    this.lastPhase = snapshot.phase;
  }

  private template(): string {
    const cards = DIFFICULTIES.map(({ value, label, length, wpm }, index) => `
      <label class="difficulty-card">
        <input type="radio" name="difficulty" value="${value}" ${index === 0 ? 'checked' : ''}>
        <span class="difficulty-copy">
          <span class="difficulty-name">${label}</span>
          <span>${length}</span>
          <span>Recommended ${wpm}</span>
        </span>
      </label>
    `).join('');

    return `
      <div class="orbital-ambience" aria-hidden="true"></div>
      <section class="menu-screen" data-screen="menu" aria-labelledby="mission-title">
        <p class="eyebrow">ORBITAL DEFENSE COMMAND // KS-01</p>
        <h1 id="mission-title"><span>KEY</span>STRIKE</h1>
        <p class="mission-copy">Lock a beacon with its first letter. Keep typing to fire and defend the orbital line.</p>
        <fieldset class="difficulty-picker">
          <legend>Select mission clearance</legend>
          <div class="difficulty-grid">${cards}</div>
        </fieldset>
        <div class="mission-settings" aria-label="Mission settings">
          <label class="toggle-row" for="sound-enabled">
            <span><strong>Sound</strong><small>Synthesized mission cues</small></span>
            <input id="sound-enabled" type="checkbox" ${this.settings.soundEnabled ? 'checked' : ''}>
          </label>
          <label class="toggle-row" for="reduced-motion">
            <span><strong>Reduced motion</strong><small>Less shake, flash, and debris</small></span>
            <input id="reduced-motion" type="checkbox" ${this.settings.reducedMotion ? 'checked' : ''}>
          </label>
        </div>
        <button class="primary-action" type="button" data-action="start">
          Start mission <span aria-hidden="true">↵</span>
        </button>
        <p class="keyboard-note">Arrow keys choose clearance · Tab moves controls · Enter launches</p>
      </section>

      <section class="game-screen" data-screen="game" aria-label="Orbital defense mission" hidden>
        <div class="game-frame">
          <header class="hud" aria-label="Mission status">
            <div class="hud-metric"><span>Score</span><strong data-hud="score">0</strong></div>
            <div class="hud-metric"><span>Combo</span><strong data-hud="combo">0</strong></div>
            <div class="hud-metric"><span>Level</span><strong data-hud="level">1</strong></div>
            <div class="shield-status">
              <span>Shield <strong data-hud="shield-text">100%</strong></span>
              <progress data-hud="shield" max="100" value="100" aria-label="Shield integrity">100%</progress>
            </div>
          </header>
          <div class="canvas-wrap">
            <canvas id="battlefield" width="480" height="800" tabindex="0" role="application"
              aria-label="KEYSTRIKE battlefield. Type letters to lock and fire. Press Escape to pause."></canvas>
            <div class="countdown" data-countdown role="status" aria-live="polite" hidden>
              <span>Systems synchronized</span><strong>Mission starting</strong>
            </div>
            <p class="tutorial-hint" data-tutorial-hint hidden>
              Type the first letter to lock. Keep typing to fire.
            </p>
          </div>
        </div>
      </section>

      <section class="dialog-backdrop" data-screen="pause" role="dialog" aria-modal="true"
        aria-labelledby="pause-title" hidden>
        <div class="command-dialog">
          <p class="eyebrow">MISSION HOLD</p>
          <h2 id="pause-title">Defense paused</h2>
          <p>Combat time and target movement are frozen.</p>
          <div class="dialog-actions">
            <button class="primary-action" type="button" data-action="continue">Continue</button>
            <button type="button" data-action="restart">Restart mission</button>
            <button type="button" data-action="menu">Return to command</button>
          </div>
        </div>
      </section>

      <section class="dialog-backdrop" data-screen="results" role="dialog" aria-modal="true"
        aria-labelledby="results-title" hidden>
        <div class="command-dialog results-panel">
          <p class="eyebrow">MISSION DEBRIEF</p>
          <h2 id="results-title">Defense line lost</h2>
          <div class="score-lockup"><span>Final score</span><strong data-result="score">0</strong></div>
          <p class="record-line"><span data-selected-difficulty>Cadet</span> high score <strong data-result="high-score">0</strong></p>
          <dl class="results-grid">
            <div><dt>Survival time</dt><dd data-result="time">00:00.0</dd></div>
            <div><dt>Completed words</dt><dd data-result="words">0</dd></div>
            <div><dt>Accuracy</dt><dd data-result="accuracy">0%</dd></div>
            <div><dt>Average speed</dt><dd data-result="wpm">0 WPM</dd></div>
            <div><dt>Max combo</dt><dd data-result="combo">0</dd></div>
            <div><dt>Misses</dt><dd data-result="misses">0</dd></div>
            <div><dt>Reached</dt><dd data-result="level">Level 1</dd></div>
          </dl>
          <div class="dialog-actions horizontal">
            <button class="primary-action" type="button" data-action="restart">Restart mission</button>
            <button type="button" data-action="menu">Return to command</button>
          </div>
        </div>
      </section>
    `;
  }

  private bindMenu(): void {
    const radios = this.radios();
    const fieldset = this.required<HTMLFieldSetElement>('.difficulty-picker');
    fieldset.addEventListener('keydown', (event) => {
      if (!(event.target instanceof HTMLInputElement) || event.target.name !== 'difficulty') return;
      if (event.key === 'Enter') {
        event.preventDefault();
        this.startRun();
        return;
      }
      const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
      if (direction === 0) return;
      event.preventDefault();
      const current = radios.indexOf(event.target);
      const next = radios[(current + direction + radios.length) % radios.length];
      if (!next) return;
      next.checked = true;
      next.focus();
      this.selectDifficulty(next.value);
    });
    for (const radio of radios) {
      radio.addEventListener('change', () => {
        if (radio.checked) this.selectDifficulty(radio.value);
      });
    }

    const sound = this.required<HTMLInputElement>('#sound-enabled');
    const motion = this.required<HTMLInputElement>('#reduced-motion');
    sound.addEventListener('change', () => {
      this.settings.soundEnabled = sound.checked;
      this.audio.setEnabled(sound.checked);
      this.saveSettings();
    });
    motion.addEventListener('change', () => {
      this.settings.reducedMotion = motion.checked;
      this.saveSettings();
    });
  }

  private bindActions(): void {
    this.required<HTMLButtonElement>('[data-action="start"]').addEventListener('click', () => this.startRun());
    this.continueButton.addEventListener('click', () => {
      this.audio.resumeFromGesture();
      this.model.resume();
      this.render();
      this.canvas.focus();
    });
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-action="restart"]')) {
      button.addEventListener('click', () => {
        this.audio.setEnabled(this.settings.soundEnabled);
        this.audio.resetPresentation();
        this.audio.resumeFromGesture();
        this.model.restart();
        this.render();
        this.canvas.focus();
      });
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-action="menu"]')) {
      button.addEventListener('click', () => {
        this.audio.resetPresentation();
        this.model.returnToMenu();
        this.render();
      });
    }
  }

  private bindFocusState(): void {
    for (const control of this.root.querySelectorAll<HTMLElement>('button, input, canvas[tabindex]')) {
      control.addEventListener('focus', () => control.classList.add('is-focused'));
      control.addEventListener('blur', () => control.classList.remove('is-focused'));
    }
  }

  private bindDialogFocus(): void {
    this.root.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const dialog = [this.pauseDialog, this.resultsDialog].find(({ hidden }) => !hidden);
      if (!dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;

      const focused = document.activeElement;
      const leavingStart = event.shiftKey && focused === first;
      const leavingEnd = !event.shiftKey && focused === last;
      if (!dialog.contains(focused) || leavingStart || leavingEnd) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    });
  }

  private startRun(): void {
    this.saveSettings();
    this.audio.setEnabled(this.settings.soundEnabled);
    this.audio.unlock();
    this.model.start({ ...this.settings });
    this.render();
    this.canvas.focus();
  }

  private saveSettings(): void {
    this.storage.saveSettings({
      soundEnabled: this.settings.soundEnabled,
      reducedMotion: this.settings.reducedMotion,
    });
  }

  private selectDifficulty(rawDifficulty: string): void {
    const difficulty = DIFFICULTIES.find(({ value }) => value === rawDifficulty);
    if (!difficulty) return;
    this.settings.difficulty = difficulty.value;
    this.selectedDifficultyLabel.textContent = difficulty.label;
  }

  private updateHud(snapshot: GameSnapshot): void {
    this.setText('[data-hud="score"]', snapshot.score.toLocaleString('en-US'));
    this.setText('[data-hud="combo"]', String(snapshot.combo));
    this.setText('[data-hud="level"]', String(snapshot.level));
    this.setText('[data-hud="shield-text"]', `${snapshot.shield}%`);
    const shield = this.required<HTMLProgressElement>('[data-hud="shield"]');
    shield.value = snapshot.shield;
    shield.setAttribute('aria-valuenow', String(snapshot.shield));
    shield.classList.toggle('is-critical', snapshot.shield <= 40);
  }

  private updateResults(snapshot: GameSnapshot): void {
    const highScore = this.storage.saveHighScore(this.settings.difficulty, snapshot.score);
    const runAccuracy = accuracy(snapshot.correctKeys, snapshot.wrongKeys);
    const runWpm = wpm(snapshot.correctKeys, snapshot.activeMs);
    this.setText('[data-result="score"]', snapshot.score.toLocaleString('en-US'));
    this.setText('[data-result="high-score"]', highScore.toLocaleString('en-US'));
    this.setText('[data-result="time"]', formatDuration(snapshot.activeMs));
    this.setText('[data-result="words"]', String(snapshot.completedWords));
    this.setText('[data-result="accuracy"]', `${formatMetric(runAccuracy)}%`);
    this.setText('[data-result="wpm"]', `${formatMetric(runWpm)} WPM`);
    this.setText('[data-result="combo"]', String(snapshot.maxCombo));
    this.setText('[data-result="misses"]', String(snapshot.missedWords));
    this.setText('[data-result="level"]', `Level ${snapshot.level}`);
  }

  private moveFocus(phase: GamePhase): void {
    if (phase === 'paused') {
      this.continueButton.focus();
      return;
    }
    if (phase === 'gameover') {
      this.resultsDialog.querySelector<HTMLButtonElement>('[data-action="restart"]')?.focus();
      return;
    }
    if (phase === 'playing' && this.lastPhase === 'paused') {
      this.canvas.focus();
      return;
    }
    if (phase === 'menu') this.radios().find(({ checked }) => checked)?.focus();
  }

  private radios(): HTMLInputElement[] {
    return [...this.root.querySelectorAll<HTMLInputElement>('input[name="difficulty"]')];
  }

  private setText(selector: string, text: string): void {
    this.required(selector).textContent = text;
  }

  private required<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing AppShell element: ${selector}`);
    return element;
  }
}
