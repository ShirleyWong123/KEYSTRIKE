# KEYSTRIKE Browser Acceptance Checklist

## Execution record

Date prepared: 2026-09-04

Automated integration coverage is recorded separately from browser acceptance. No interactive browser run was performed while preparing this checklist, so no browser result is claimed here.

| Browser | Version | Tester | Overall status |
| --- | --- | --- | --- |
| Chrome (current desktop) | Not recorded | Not run | NOT RUN |
| Safari (current desktop) | Not recorded | Not run | NOT RUN |
| Firefox (current desktop) | Not recorded | Not run | NOT RUN |

### Supplemental local-browser run

On 2026-09-04, Codex In-app Browser (Chromium engine; exact version not exposed) was used against the debug URL. This is supporting evidence only and is not recorded as a Chrome, Safari, or Firefox pass.

- PASS: production boot, visible keyboard-first menu, arrow-key difficulty selection, mission launch, countdown/tutorial transition, live targets, correct-word scoring/combo, wrong-letter red feedback/combo reset, `Esc` pause, modal focus wrapping, `Esc` resume focus restoration, and shield progress value synchronization.
- PASS: non-overlapping HUD/battlefield layout at 1280×720 and 800×720. At 1280×720 the HUD occupied x=16–316 while Canvas occupied x=449.6–830.4; at 800×720 the HUD ended at y=105 and Canvas began at y=106.
- NOT RUN: named-browser matrix, audible balance, forced debug specials/breaches/level 12, hidden-tab/blur behavior, persisted high-score results, three-minute FPS sampling, and effect-peak missed-key measurement.
- Visual observation: the portrait battlefield, labels, ship, grid, HUD, red error edge, and menu remained readable in the tested sizes.

Allowed result values are `PASS`, `FAIL`, or `NOT RUN`. Replace `NOT RUN` only after executing the complete row in that browser and add concise evidence or a defect reference.

## Setup

1. Run `npm run dev -- --host 127.0.0.1`.
2. Use `http://127.0.0.1:5173/` for the ordinary player experience.
3. Use `http://127.0.0.1:5173/?debug=1` only for forced-state checks. This opt-in URL exposes `window.__KEYSTRIKE_DEBUG__` in DevTools; the ordinary URL and visible UI do not expose debug controls.
4. Use a desktop viewport. Include the normal viewport and at least one narrower and one shorter desktop window.
5. Start each browser from a fresh reload. Record its exact version before changing any status.

Debug helpers:

```js
const ks = window.__KEYSTRIKE_DEBUG__;
ks.snapshot();
ks.forceSpecial('repair');
ks.forceSpecial('pulse');
ks.forceSpecial('freeze');
ks.forceBreaches(1); // 20 shield damage; accepts 1..5
ks.forceLevel(12);
ks.injectTarget({
  id: 810001, word: 'PILOT', typed: 0,
  x: 80, y: 500, width: 94, height: 42,
  speed: 0, kind: 'normal'
});
```

## Cross-browser result matrix

| # | Acceptance flow | Chrome | Safari | Firefox | Evidence / defect |
| ---: | --- | --- | --- | --- | --- |
| 1 | Keyboard-only menu: Tab reaches difficulty, sound, reduced-motion, and Start; arrows change difficulty; Enter starts. | NOT RUN | NOT RUN | NOT RUN | — |
| 2 | Each difficulty shows a three-second countdown and fixed tutorial word: `NOVA`, `ORBIT`, `VECTOR`. | NOT RUN | NOT RUN | NOT RUN | — |
| 3 | Two same-initial targets lock the lower target; `P` types a word and never pauses. | NOT RUN | NOT RUN | NOT RUN | — |
| 4 | A correct letter changes immediately and launches a projectile; completion effects remain non-blocking; a wrong letter flashes red and resets combo. | NOT RUN | NOT RUN | NOT RUN | — |
| 5 | At maximum density, labels do not overlap and retain horizontal safety margins. | NOT RUN | NOT RUN | NOT RUN | — |
| 6 | Forced repair, pulse, and freeze targets obey eligibility/effect rules and remain visually distinct by label plus color. | NOT RUN | NOT RUN | NOT RUN | — |
| 7 | Forced breaches remove 20 shield each, reset combo, reach game over at zero, show all results, and persist a separate high score per difficulty. | NOT RUN | NOT RUN | NOT RUN | — |
| 8 | `Esc` pauses/resumes, focus enters Continue and returns to Canvas, blur/hidden tab auto-pauses, resize stays sharp, mute stops new sounds, and reduced motion removes shake/reduces effects. | NOT RUN | NOT RUN | NOT RUN | — |
| 9 | Forced levels reach 12 on the 45-second curve independently of score; pressure caps remain 44 px/s, 1.9 s spawn, and 5 targets. | NOT RUN | NOT RUN | NOT RUN | — |
| 10 | A normal live run remains near 60 FPS and no letter is missed during repeated projectile/explosion peaks. | NOT RUN | NOT RUN | NOT RUN | — |

## Detailed procedures

### 1. Menu and launch

- Reload the ordinary URL without touching the mouse.
- Confirm the initial difficulty has a visible focus indication.
- Use all four arrow keys and confirm wrapped difficulty selection.
- Tab through Sound, Reduced motion, and Start; confirm each focus indicator is visible.
- Toggle each setting, reload, and confirm it persists. Press Enter from a difficulty and click Start in a separate run; audio should unlock only from either user action.

### 2. Countdown and tutorial

- Start each difficulty from a reload and time the countdown with a stopwatch.
- Confirm combat movement/time begins after about three seconds, not during it.
- Confirm the first word and reduced tutorial speed match the matrix row.
- Complete or allow the tutorial target to breach; confirm the tutorial guidance no longer applies afterward.

### 3. Locking and `P`

- At the debug URL after combat begins, inject two words with the same first letter, with one at `y: 250` and one at `y: 520`.
- Type the initial and confirm the `y: 520` target locks. Continue typing it.
- Inject `PILOT`, press `P`, and confirm typed progress becomes 1 while phase remains `playing`.

### 4. Input feedback and effects

- Type one correct letter and visually confirm orange underlined progress plus a projectile immediately.
- Finish a word and immediately start another during its flash/ring/shard/particle effect.
- Build combo above zero, press a wrong alphabetic key, and confirm the short red edge warning, mild shake, preserved lock/progress, and zero combo.
- Repeat with Reduced motion enabled: no shake, fewer particles, and weaker flash.

### 5. Placement density

- Continue until the current level reaches its target cap, or inject legal stationary targets to inspect the maximum five-target field.
- Confirm every full label rectangle has at least 12 logical pixels from another and 16 logical pixels from the left/right edge.
- Confirm failed placement is delayed rather than overlapped or clipped.

### 6. Specials

- Repair: call `forceBreaches(2)` from 100 shield, then `forceSpecial('repair')`; type `REPAIR` and confirm shield returns from 60 to 80, capped at 100.
- Pulse: inject at least three normal targets at different `y` positions, call `forceSpecial('pulse')`, type `PULSE`, and confirm at most four lowest normal targets clear while combo changes only for completing `PULSE`.
- Freeze: call `forceLevel(3)`, inject two normal targets, call `forceSpecial('freeze')`, type `FREEZE`, and confirm movement is half speed for five active seconds; pause to confirm the duration does not decrease.

### 7. Breach, results, and records

- Build a combo, then call `forceBreaches(1)` and confirm 20 damage plus combo reset.
- Call `forceBreaches(4)` and confirm the battlefield freezes at zero shield and results gain focus.
- Confirm score, survival time, completed words, accuracy, WPM, max combo, misses, level, and selected-difficulty high score are present.
- Restart the same difficulty, then return to the menu and run another difficulty; confirm high scores remain independent.

### 8. Pause, focus, lifecycle, resize, sound, motion

- During combat press `Esc`; confirm time, targets, effects, freeze, and input stop and Continue receives focus.
- Press `Esc` again and separately activate Continue; confirm Canvas focus returns both ways.
- Blur the window and hide the tab during separate active runs; confirm each auto-pauses without background shield loss.
- Resize to narrow and short desktop windows and change browser zoom; confirm the Canvas remains proportional and crisp with no run reset.
- Mute and confirm no new sounds are scheduled. Confirm the system reduced-motion preference and saved override are honored.

### 9. Twelve levels

- Record score, call `forceLevel(12)`, and confirm the level indicator reaches 12 without changing score.
- Observe subsequent target generation and movement; confirm no pressure value exceeds the level-12 configuration.
- Continue past level 12 and confirm it remains capped.

### 10. Live performance

- Run normally for at least three minutes with DevTools performance/FPS instrumentation.
- During dense effects, type a known injected word quickly and compare visible progress with physical keystrokes.
- Record approximate FPS, viewport, hardware/browser version, any long frames, and any missing input in the evidence column.

## Design-specification audit before browser execution

| Design section | Automated/static evidence | Browser status / remaining evidence |
| --- | --- | --- |
| 1. Product goal | Model, UI, renderer, metrics, and integration suites cover the stated mechanics. | Cross-browser feel/readability remains NOT RUN. |
| 2. Technical approach | Vite/TypeScript, Canvas, Web Audio, fixed-step RAF, and DOM separation are implemented locally. | Production browser boot remains NOT RUN. |
| 3. Module boundaries | GameModel, TargetManager, renderer, audio, storage, AppShell, and runtime remain separate adapters. | Browser adapter interaction remains NOT RUN. |
| 4. Core rules | Automated model tests cover lifecycle, locking, score, combo, shield, pause, and countdown. | End-to-end visible/audio feedback remains NOT RUN. |
| 5. Progression | Automated configuration/model tests cover all 12 levels and active-time independence. | Perceived pressure and visible level cues remain NOT RUN. |
| 6. Specials | Automated tests cover eligibility, cooldowns, repair/pulse/freeze, scoring, freeze, and breach. | Forced visible effects remain NOT RUN. |
| 7. Visual design | Renderer tests cover draw order, labels, typed styling, effects, bounds, and reduced motion. | Appearance, readability, and flash comfort remain NOT RUN. |
| 8. Interface layout | AppShell tests cover semantic controls, HUD/results, keyboard focus, and desktop reflow CSS. | Actual desktop sizes and DPR sharpness remain NOT RUN. |
| 9. Audio | Audio tests cover unlock, mute, distinct envelopes, delayed hit, faults, and disposal. | Audible balance and autoplay behavior remain NOT RUN. |
| 10. Errors/boundaries | Tests cover invalid keys, pause, storage failures, no-overlap placement, word exclusion, resize, and catch-up cap. | Hidden-tab, blur, zoom, and dense layout remain NOT RUN. |
| 11. Test/acceptance | Automated checks are repeatable; this document defines all requested browser flows. | Chrome, Safari, Firefox, FPS, and live input checks remain NOT RUN. |
| 12. Out of scope | No touch, account, cloud, multiplayer, custom/localized bank, or external asset feature was added. | Confirm normal UI contains no debug controls during browser review. |

## Sign-off

Do not mark a browser `PASS` if any row is `FAIL` or `NOT RUN`. Record unresolved failures without weakening the design specification.
