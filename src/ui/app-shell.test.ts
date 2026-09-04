import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AudioEngine } from '../audio/audio-engine';
import { GameModel } from '../game/game-model';
import type { GameSnapshot } from '../game/types';
import { AppShell } from './app-shell';
import { StorageAdapter } from './storage';

const memoryStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
};

const resultSnapshot = (overrides: Partial<GameSnapshot> = {}): GameSnapshot => ({
  phase: 'gameover',
  score: 1_480,
  combo: 0,
  maxCombo: 12,
  shield: 0,
  level: 4,
  activeMs: 61_200,
  correctKeys: 150,
  wrongKeys: 10,
  completedWords: 24,
  missedWords: 5,
  lockedTargetId: null,
  freezeRemainingMs: 0,
  targets: [],
  ...overrides,
});

const setup = () => {
  const root = document.createElement('main');
  document.body.append(root);
  const model = new GameModel();
  const unlock = vi.fn();
  const setEnabled = vi.fn();
  const audio = { unlock, setEnabled } as unknown as AudioEngine;
  const storage = new StorageAdapter(memoryStorage(), false);
  const shell = new AppShell(root, model, audio, storage);
  return { root, model, audio, storage, shell, unlock, setEnabled };
};

const key = (element: Element, value: string) => {
  element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));
};

beforeEach(() => {
  document.body.replaceChildren();
});

describe('AppShell menu', () => {
  it('uses semantic controls and explains every difficulty with length and recommended WPM', () => {
    const { root } = setup();

    expect(root.querySelector('fieldset')).not.toBeNull();
    expect(root.querySelectorAll('input[type="radio"][name="difficulty"]')).toHaveLength(3);
    expect(root.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    expect(root.querySelector('button[data-action="start"]')).not.toBeNull();
    expect(root.textContent).toContain('3–5 letters');
    expect(root.textContent).toContain('20–35 WPM');
    expect(root.textContent).toContain('4–8 letters');
    expect(root.textContent).toContain('35–50 WPM');
    expect(root.textContent).toContain('6–12 letters');
    expect(root.textContent).toContain('50+ WPM');
  });

  it('moves radio selection with arrows and starts through Enter as a user action', () => {
    const { root, model, shell, unlock } = setup();
    const radios = [...root.querySelectorAll<HTMLInputElement>('input[name="difficulty"]')];

    radios[0]!.focus();
    key(radios[0]!, 'ArrowRight');
    expect(radios[1]!.checked).toBe(true);
    expect(document.activeElement).toBe(radios[1]);
    key(radios[1]!, 'Enter');

    expect(model.snapshot().phase).toBe('countdown');
    expect(model.snapshot().targets[0]?.word).toBe('ORBIT');
    expect(shell.settings.difficulty).toBe('normal');
    expect(unlock).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(shell.canvas);
  });

  it('keeps settings and start in tab order and gives focused controls a visible class', () => {
    const { root } = setup();
    const sound = root.querySelector<HTMLInputElement>('#sound-enabled')!;
    const motion = root.querySelector<HTMLInputElement>('#reduced-motion')!;
    const start = root.querySelector<HTMLButtonElement>('[data-action="start"]')!;

    expect(sound.tabIndex).toBe(0);
    expect(motion.tabIndex).toBe(0);
    expect(start.tabIndex).toBe(0);
    for (const control of [sound, motion, start]) {
      control.focus();
      expect(control.classList.contains('is-focused')).toBe(true);
      control.blur();
      expect(control.classList.contains('is-focused')).toBe(false);
    }
  });

  it('loads the system motion default and safely persists setting changes', () => {
    const root = document.createElement('main');
    document.body.append(root);
    const model = new GameModel();
    const audio = { unlock: vi.fn(), setEnabled: vi.fn() } as unknown as AudioEngine;
    const storage = new StorageAdapter(memoryStorage(), true);
    new AppShell(root, model, audio, storage);
    const motion = root.querySelector<HTMLInputElement>('#reduced-motion')!;
    const sound = root.querySelector<HTMLInputElement>('#sound-enabled')!;

    expect(motion.checked).toBe(true);
    sound.click();

    expect(storage.loadSettings()).toEqual({ soundEnabled: false, reducedMotion: true });
    expect(audio.setEnabled).toHaveBeenLastCalledWith(false);
  });
});

describe('AppShell game screens', () => {
  it('shows the in-field typing hint only while the tutorial target remains active', () => {
    const { root, shell } = setup();
    const tutorial = {
      id: 1,
      word: 'NOVA',
      typed: 0,
      x: 190,
      y: 100,
      width: 100,
      height: 42,
      speed: 19.6,
      kind: 'normal' as const,
      tutorial: true,
    };

    shell.render(resultSnapshot({ phase: 'playing', shield: 100, targets: [tutorial] }));
    const hint = root.querySelector<HTMLElement>('[data-tutorial-hint]');
    expect(hint).not.toBeNull();
    expect(hint?.hidden).toBe(false);
    expect(hint?.textContent).toContain('first letter');
    expect(hint?.textContent).toContain('Keep typing');

    shell.render(resultSnapshot({ phase: 'playing', shield: 100, targets: [] }));
    expect(hint?.hidden).toBe(true);
  });

  it('keeps crisp HUD text outside the canvas and includes a labelled shield bar', () => {
    const { root, shell } = setup();
    shell.render(resultSnapshot({ phase: 'playing', shield: 65, score: 890, combo: 7, level: 3 }));

    const hud = root.querySelector<HTMLElement>('.hud')!;
    expect(hud.contains(shell.canvas)).toBe(false);
    expect(hud.textContent).toContain('890');
    expect(hud.textContent).toContain('7');
    expect(hud.textContent).toContain('3');
    expect(root.querySelector<HTMLProgressElement>('progress')?.value).toBe(65);
    expect(root.textContent).toContain('65%');
  });

  it('synchronizes the shield progress value and accessibility value on every render', () => {
    const { root, shell } = setup();
    const shield = root.querySelector<HTMLProgressElement>('[data-hud="shield"]')!;

    shell.render(resultSnapshot({ phase: 'playing', shield: 60 }));
    expect(shield.value).toBe(60);
    expect(shield.getAttribute('aria-valuenow')).toBe('60');

    shell.render(resultSnapshot({ phase: 'paused', shield: 25 }));
    expect(shield.value).toBe(25);
    expect(shield.getAttribute('aria-valuenow')).toBe('25');
  });

  it('moves focus into pause and restores it to the game surface on continue', () => {
    const { root, model, shell } = setup();
    root.querySelector<HTMLButtonElement>('[data-action="start"]')!.click();
    model.beginCombat();
    model.pause();

    shell.render(model.snapshot());
    const dialog = root.querySelector<HTMLElement>('[data-screen="pause"]')!;
    const continueButton = root.querySelector<HTMLButtonElement>('[data-action="continue"]')!;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(document.activeElement).toBe(continueButton);

    continueButton.click();
    expect(model.snapshot().phase).toBe('playing');
    expect(document.activeElement).toBe(shell.canvas);
  });

  it('restores focus when update observes an Escape-driven resume', () => {
    const { root, model, shell } = setup();
    root.querySelector<HTMLButtonElement>('[data-action="start"]')!.click();
    model.beginCombat();
    model.handleKey({ key: 'Escape' });
    shell.update();
    expect(document.activeElement).toBe(root.querySelector('[data-action="continue"]'));

    model.handleKey({ key: 'Escape' });
    shell.update();

    expect(model.snapshot().phase).toBe('playing');
    expect(document.activeElement).toBe(shell.canvas);
  });

  it.each([
    { screen: 'pause', enter: (model: GameModel) => model.pause(), actions: ['continue', 'restart', 'menu'] },
    { screen: 'results', enter: undefined, actions: ['restart', 'menu'] },
  ] as const)('contains Tab focus within the $screen dialog', ({ screen, enter, actions }) => {
    const { root, model, shell } = setup();
    root.querySelector<HTMLButtonElement>('[data-action="start"]')!.click();
    model.beginCombat();
    if (enter) {
      enter(model);
      shell.update();
    } else {
      shell.update(resultSnapshot());
    }
    const dialog = root.querySelector<HTMLElement>(`[data-screen="${screen}"]`)!;
    const buttons = actions.map((action) => dialog.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!);
    const first = buttons[0]!;
    const last = buttons.at(-1)!;

    last.focus();
    key(last, 'Tab');
    expect(document.activeElement).toBe(first);

    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(last);

    shell.canvas.focus();
    key(shell.canvas, 'Tab');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('supports restart and menu actions from the pause dialog', () => {
    const { root, model, shell } = setup();
    root.querySelector<HTMLInputElement>('input[value="hard"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-action="start"]')!.click();
    model.beginCombat();
    model.pause();
    shell.render();

    root.querySelector<HTMLButtonElement>('[data-action="restart"]')!.click();
    expect(model.snapshot()).toMatchObject({ phase: 'countdown', score: 0 });
    expect(model.snapshot().targets[0]?.word).toBe('VECTOR');

    model.beginCombat();
    model.pause();
    shell.render();
    root.querySelector<HTMLButtonElement>('[data-action="menu"]')!.click();
    expect(model.snapshot().phase).toBe('menu');
  });

  it('shows all run metrics and the high score for the selected difficulty', () => {
    const { root, shell, storage } = setup();
    root.querySelector<HTMLInputElement>('input[value="hard"]')!.click();
    storage.saveHighScore('hard', 2_000);

    shell.render(resultSnapshot());

    const results = root.querySelector<HTMLElement>('[data-screen="results"]')!;
    expect(results.getAttribute('role')).toBe('dialog');
    expect(results.textContent).toContain('1,480');
    expect(results.textContent).toContain('01:01.2');
    expect(results.textContent).toContain('24');
    expect(results.textContent).toContain('93.8%');
    expect(results.textContent).toContain('29.4 WPM');
    expect(results.textContent).toContain('12');
    expect(results.textContent).toContain('5');
    expect(results.textContent).toContain('Level 4');
    expect(results.textContent).toContain('2,000');
  });

  it('displays zero accuracy and WPM when no input was recorded', () => {
    const { root, shell } = setup();

    shell.render(resultSnapshot({ correctKeys: 0, wrongKeys: 0, activeMs: 0 }));

    const results = root.querySelector<HTMLElement>('[data-screen="results"]')!;
    expect(results.textContent).toContain('0%');
    expect(results.textContent).toContain('0 WPM');
  });

  it('accesses high-score storage once per gameover entry', () => {
    let highScoreReads = 0;
    let highScoreWrites = 0;
    const throwing = {
      getItem: (storageKey: string) => {
        if (storageKey.startsWith('keystrike.highScore.')) {
          highScoreReads += 1;
          throw new Error('blocked high-score read');
        }
        return null;
      },
      setItem: (storageKey: string) => {
        if (storageKey.startsWith('keystrike.highScore.')) {
          highScoreWrites += 1;
          throw new Error('blocked high-score write');
        }
      },
    } as unknown as Storage;
    const root = document.createElement('main');
    document.body.append(root);
    const model = new GameModel();
    const audio = { unlock: vi.fn(), setEnabled: vi.fn() } as unknown as AudioEngine;
    const shell = new AppShell(root, model, audio, new StorageAdapter(throwing, false));

    shell.update(resultSnapshot({ score: 1_000 }));
    shell.update(resultSnapshot({ score: 1_000 }));
    shell.update(resultSnapshot({ score: 1_000 }));

    expect(highScoreReads).toBe(1);
    expect(highScoreWrites).toBe(1);

    shell.update(resultSnapshot({ phase: 'playing' }));
    shell.update(resultSnapshot({ score: 1_500 }));

    expect(highScoreReads).toBe(2);
    expect(highScoreWrites).toBe(2);
    expect(root.querySelector('[data-result="score"]')?.textContent).toBe('1,500');
    expect(root.querySelector('[data-result="high-score"]')?.textContent).toBe('1,500');
  });
});

describe('short-height layout', () => {
  it('only detaches the HUD when the viewport is wide enough for a side column', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toContain('@media (max-height: 720px) and (min-width: 1040px)');
    expect(styles).toContain('@media (max-height: 720px) and (max-width: 1039px)');
  });

  it('keeps the detached HUD viewport-relative and outside the portrait battlefield', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
    const wideStart = styles.indexOf('@media (max-height: 720px) and (min-width: 1040px)');
    const narrowStart = styles.indexOf('@media (max-height: 720px) and (max-width: 1039px)');
    const wideRules = styles.slice(wideStart, narrowStart);
    const narrowRules = styles.slice(narrowStart, styles.indexOf('@media (prefers-reduced-motion', narrowStart));

    expect(wideRules).toMatch(/\.game-frame\s*{[^}]*filter:\s*none;/s);
    expect(wideRules).toMatch(/\.hud\s*{[^}]*position:\s*fixed;[^}]*left:\s*16px;/s);
    expect(narrowRules).toMatch(/\.hud\s*{[^}]*position:\s*static;[^}]*width:\s*100%;/s);
    expect(styles).toContain('aspect-ratio: 480 / 800');
  });
});
