# SenTynel — roadmap to a playable game

This project is a reimplementation of Geoff Crammond's **The Sentinel** (1986). Landscape generation is already 1:1 faithful (port of Simon Owen's `sentland`), and the viewer renders the 10,000 levels of the original. What's missing is *the game*: turn loop, energy economy, Sentinel AI, win/lose conditions, and a real UI. This document tracks the path there.

---

## Reference: original gameplay (what we're aiming for)

Authoritative reference: the "How To Play" section of <https://simonowen.com/spectrum/augmentinel/>. When anything here disagrees with that page, the page wins.

- First-person view through a **robot shell** (Synthoid) on a blocky landscape.
- **Starting energy**: each landscape begins with **10 energy**, shown as icons at the top of the screen. Icons: tree = 1, boulder = 2, robot head = 3, **golden robot head = 15**.
- **Energy values**: Tree = 1, Meanie = 1, Boulder = 2, Synthoid = 3, Sentry = 3, **Sentinel = 4**.
- **Create** a tree / boulder / synthoid on any **free flat tile** by spending its cost.
- **Absorb** any object whose **tile you can see**, recovering its cost — **except boulders, which can always be absorbed** regardless of whether their tile is visible.
- **Transfer** consciousness into another of your own synthoids (free). Move around by placing a new synthoid and transferring to it. The old shell remains and can be absorbed.
- **Stack boulders** to climb higher; a synthoid can be placed on a boulder or a stack of boulders to reach higher ground.
- **Pre-action grace period**: when you first enter a landscape, the Sentinel and sentries **remain inactive until you perform an action**, so you're free to look around.
- **Sentinel / sentries** rotate slowly, scanning the landscape for anything whose **energy value is greater than 1**. Any such object they see has its energy **slowly reduced toward 1** (i.e. ultimately a tree); the absorbed energy is **redistributed randomly across the landscape as new trees**.
- **If you're seen**: a warning sound plays and the display becomes fuzzy. You lose roughly **1 energy per second**; run out and you're dead. Move fast or break line of sight.
- If the display is only **slightly fuzzy**, the Sentinel/sentry can see you but **not the tile you're standing on** (so it can't absorb you directly). In that case, a **nearby tree is converted into a Meanie**, which slowly rotates to find you; when it sees you, it **forces you to hyperspace**.
- **Voluntary hyperspace**: creates a new robot shell at a random landscape position. Costs the same as placing a robot (**3 energy**).
- **Win a level**: once you're **high enough to see the top of the pedestal** the Sentinel stands on, you can absorb him. Then place a robot in his place, transfer to it, and hyperspace to advance. **After absorbing the Sentinel, you can no longer absorb anything** on the landscape (including your old shell or boulders).
- **Advancing**: your **remaining energy minus 3** (for the hyperspace) determines **how many landscapes you jump ahead**. Each new landscape restarts at 10 energy. Goal: complete all 10,000.
- **Lose**: energy runs out.
- **Level codes**: 4-digit alphanumeric codes let you jump to any landscape.

---

## Where we stand today

**Works**
- Terrain generation for all 10,000 levels (matches original game bitwise).
- Scene rendering: grid/surfaces/objects, per-level palette, title mesh.
- Free-flight camera (WASD + mouse look + FOV), rotating overview when not active.
- Manual object placement/removal via click (debug-level feature).
- Settings persisted to `localStorage` (dev settings gated behind `localStorage.debug`).
- Modern stack: Svelte 5 + runes, Vite 7, TS 5, Three.js 0.184, 0 audit findings.

**Doesn't work / broken / missing**
- No game loop. The "Start" menu item just `console.log`s. The render loop runs, but there's no notion of a game tick, turn, or state machine.
- No energy economy. Hard-coded `game.energy = 37`, nothing reads or writes it.
- No Sentinel/Sentry behavior beyond view-cone detection that calls no one.
- No Meanie or Synthoid behavior beyond placeholder stubs.
- No win/lose conditions.
- Menu is a debug tool: levelID picker, generator settings, display toggles. Missing a real main menu, pause menu, game-over screen.
- Pointer lock released unreliably: `canvas.focus` triggers `requestPointerLock`, but no handling of `pointerlockchange`/`pointerlockerror`, and `R` key is the only exit.
- **Z-up** coordinate convention (uncommon in Three.js; `sentland.ts` internally uses Y-up with `y` = height, and `MainView` remaps to Z-up — a split-brain situation).
- `dispose()` is a known leak (`TODO: actually mark objects for disposal`).
- `MainView.svelte` is a 640-line god-component: Three.js setup, render loop, input, scene building, raycast visibility, player movement, click handlers, all in one.
- `deltaTime` computation is quirky: only updated every 200 ms via a `Math.floor(t/200)` boundary check, which means physics uses a stale value most frames. Works by accident.
- TypeScript `strict` is off (we turned it off to defer ~98 latent issues at the v5 tsconfig bump).
- Scattered `TODO`s in `GameObject.ts`, `MainView.svelte` for behavior that isn't wired.
- No tests. For a rules-driven game, unit tests on LOS + energy + turn logic would be valuable.

---

## Phases

### Phase 1 — Technical foundation

Pay down debt so gameplay work sits on a sane base. No gameplay yet.

- [x] **Y-up conversion.** `position.y = height`, `position.z = row`, `camera.up` is default. `sentland.ts` internals untouched; boundary conversion in `engine/scene.ts`. `GameObject` constructor renamed to `(col, row, height)`. Terrain vertices, flat planes, slope triangles, sun, orbit camera, and Sentinel detection all converted. Flat planes now rotated `−π/2` on X to lie in the XZ plane.
- [x] **Split `MainView.svelte`** (104 lines). Extracted to:
  - `engine/renderer.ts` — WebGLRenderer + rAF loop.
  - `engine/scene.ts` — terrain mesh, object placement, palette. `addObjectToScene` / `removeObjectFromScene` exported for reuse.
  - `engine/input.ts` — keyboard state, mouse delta, pointer-lock lifecycle.
  - `engine/visibility.ts` — `isCellVisible` (Y-up, `userData.col/row`).
  - `engine/disposer.ts` — `Disposer` class, registered per `buildScene` call.
  - `engine/camera.ts` — `CameraController` (free-flight + orbit, FOV keys).
  - `engine/loop.ts` — `GameLoop` drives per-frame object play, sun, render, stat callbacks.
  - `engine/actions.ts` — `handleClick` (raycast, add/remove object dispatch).
- [x] **Fix pointer-lock lifecycle.** `InputManager` requests lock on explicit `input.requestLock()` call (triggered by first canvas click). Subscribes to `pointerlockchange` + `pointerlockerror`. Releases on `blur` and on `r` key. Key state is cleared on unlock.
- [x] **Fix `deltaTime`.** Physics uses `time - lastTime` per frame; `displayDelta` (FPS readout) is a separate 200 ms boundary sample. Already done as part of the `GameLoop` extraction.
- [x] **Fix `dispose()`**. All terrain materials + shared geometries registered with `Disposer` in `buildScene`. `GameObject.dispose()` traverses `object3D` and calls `geometry.dispose()` + `material.dispose()` on every mesh face. Loop calls `o.dispose()` on runtime removal; Effect 2 calls `allObjects.forEach(o => o.dispose())` before `disposer.disposeAll()` on level switch.
- [x] **Split oversized files.**
  - `GameObject.ts` → `world/objects/` (one file per class + `index.ts` barrel).
  - `models.ts` → `world/objects/models/` (one file per mesh data + `index.ts` with `getObject`).
  - `sentland.ts` → `world/terrain.ts` (no code change).
- [x] **Adopt proposed file layout.** UI files → `ui/`; fonts → `engine/fonts/`; `game/` placeholder created. `engine/actions.ts` stays in `engine/` (has Three.js imports; moves to `game/` once decoupled in Phase 2).
- [x] **Re-enable TypeScript `strict`.** 53 issues across 7 files. Fixes: `| null` on nullable fields, definite-assignment assertions (`!`) on fields always set in the constructor, type annotations on untyped terrain helper functions, `parent!` non-null assertions in the two parent-traversal loops, `as keyof typeof icons` in Hud, and a `.d.ts` sidecar for the font data JS file.
- [x] **Set up a test harness.** `vitest` (Vite-native, zero config). Not TDD, but a regression safety net. Seed tests:
  - `world/terrain.test.ts` — assert known level fingerprints (map, shapes, codes for levels 0000, 0001, and a few others) match the original values. Protects us against any future change silently breaking generation.
  - `engine/visibility.test.ts` — LOS check on synthetic landscapes with known topology.
  - `game/rules.test.ts` — once those exist, cover creation legality, stacking rules, absorb-from-above, transfer legality.
  - Co-locate tests with code (`foo.ts` ↔ `foo.test.ts`).

**Exit criteria**: `npm run check && npm run build && npm test` green. Visual parity with current behavior. `MainView.svelte` under 150 lines. No `TODO: actually mark objects for disposal` in the tree.

**Progress (2026-04-24)**: Phase 1 complete. All nine bullets done: Y-up, MainView split, pointer-lock lifecycle, deltaTime, dispose, file splits, layout adoption, strict mode, vitest harness. Exit criteria met: `npm run check && npm run build && npm test` green.

---

### Phase 2 — Game loop and core state

Introduce the concept of "a game" distinct from "a scene being viewed".

- [x] **Game state machine**. `game/state.svelte.ts` holds `phase: GamePhase` and `energy`. Transitions via `startGame()`, `pauseGame()`, `resumeGame()`, `endGame()`, `returnToMenu()`. Never string-typed assignments at call sites.
- [x] **Turn / tick system**. `game/turn.ts` — `TurnDriver` accumulates real-time ms and fires at 4 Hz. `GameLoop` calls `o.playTick(tick)` on each tick; `o.play(time, pos)` stays on render frames.
- [x] **Player state (energy)**. `game.energy` starts at 10 on `startGame()`. (Body reference / hyperspace cooldown deferred to Phase 3 when transfer mechanics land.)
- [x] **Initial level load**. Effect 3 in `MainView.svelte` reacts to `PLAYING` transition and resets the camera to the level's player-synthoid position.
- [x] **Object `playTick(tick)` vs `play(time, pos)`**. Base class has no-op `playTick`. `Sentinel` overrides it: counts down `timer` ticks then sets `turnQueued`. `play()` starts the visual animation when `turnQueued` is set, interpolates rotation each render frame.
- [x] **Escape → pause/resume**. `App.svelte` handles `Escape`: `PLAYING → PAUSED` (shows menu with Resume focused) and `PAUSED → PLAYING` (hides menu). Menu path auto-snaps to `resume` / `start` on phase change.

**Exit criteria met (2026-04-24)**: pressing "Start" transitions to `PLAYING`, resets camera to level-0000 synthoid position, energy = 10, Sentinel rotates at rate derived from its `timer` field (5–36 ticks = 1.25–9 s between turns).

---

### Phase 3 — Core gameplay mechanics

The game becomes actually playable.

- [x] **Energy economy**. `spendEnergy(n): bool`, `gainEnergy(n, cause)` in `game/state.svelte.ts`. Negative spends refused. Zero energy triggers `LOST`. Each landscape starts at 10 energy. `game/rules.ts` holds the `ENERGY_COST` table.
- [x] **Control scheme rework**. Keys only in PLAYING mode (pointer-locked). `R` / `B` / `T` / `U` / `Space` / `Enter` / `H` handled by `handleKeyActions` in `engine/actions.ts`, called from the game loop. Debug mouse clicks preserved in DEBUG mode only.
- [x] **Creation**. Slope check enforced; `addObjectToScene` enforces stacking validity (empty tile, atop Pedestal, atop all-boulder stack). No LOS requirement. Energy spent upfront, refunded if placement rejected.
- [x] **Absorption**. LOS-based (`isCellVisible`). Boulders always absorbable (no LOS check). Sentinel/Sentry on pedestal: LOS to pedestal top (yOffset=1). Pedestal itself unabsorbable. After Sentinel absorbed, `game.sentinelAbsorbed=true` locks further absorption; Sentinel absorption sets up win flow.
- [x] **Transfer**. Space/Enter targets a visible Synthoid; `beginTransfer(col, row)` sets `game.activeSynthoidCol/Row`, increments `transferCount`, switches to TRANSFER phase, auto-returns to PLAYING after 1 s. Effect 3c in MainView snaps camera to new body (correct height for boulder-stack case) and shows old body / hides new active body.
- [x] **Stacking**. Stacking rules consolidated in `addObjectToScene` (empty, Pedestal top, all-boulder stack). `resetToPosition` accepts `objectHeight?` to correctly place the camera eye when the active synthoid is on a boulder stack.
- [ ] **Sentinel / Sentry AI**.
  - **Dormant until the player's first action** (create / absorb / transfer / hyperspace). Give the player a free look-around on level entry.
  - Rotate `step/256` of a revolution per turn, timer-driven (values already come from level gen).
  - Field-of-view = `20/256 · 2π` cone (the existing detect code).
  - **Drain action, 1 Hz**: each watcher (Sentinel or sentry) performs **one** drain action per tick. It picks one visible item in its cone whose energy > 1 — trees are skipped, they have nothing left to lose — drains 1 energy from it, and **simultaneously spawns a new tree on a random free flat tile** to conserve total energy. Two hard caps apply:
    - ≤ 1 action per watcher per tick (if a watcher sees multiple items, only one is drained).
    - ≤ 1 energy lost per item per tick (if several watchers see the same target, only one drain lands; the others have no effect on that target that tick).
    - Different watchers looking at different targets drain in parallel, so N sentries can strip N distinct items per tick.
    - Selection order when a watcher sees multiple valid targets is an open detail; pick one that matches the original's behaviour when we have a reference to compare against.
  - **Non-player items transform visibly** when drained: synthoid (3) → boulder (2) → tree (1). Once at 1, they're inert to further drains.
  - **The player's active body counts as an item** and is a valid drain target, under the same per-item cap:
    - If the **player's tile is also visible**: warning sound + fuzzy view; the drain deducts 1 from the player's energy pool (HUD counter) instead of transforming the body. A tree still spawns elsewhere.
    - If the player's tile is **not visible** (standing on a boulder stack tall enough to hide the base): that watcher spends its action on the **Meanie conversion** described below instead of the drain. No pool drain that tick from that watcher.
  - Replace the current `scale.set(2,2,2)` detection marker with a subtler visual (the original showed a red pulse on the Sentinel).
- [ ] **Line-of-sight rules**. The existing `isCellVisible` raycast is a good base. Extract it, test it, use the same routine for player absorption, Sentinel scan of objects, the player-tile-visibility distinction, and Meanie detection.
- [ ] **Meanies**. Spawn condition: the Sentinel or a sentry sees the player's body but **not the tile it stands on**. Effect: a nearby tree (pick the one closest to the player) is **converted into a Meanie** in place. Behaviour: Meanie rotates toward the player; if it sees the player it **forces a hyperspace**. Forced hyperspace still charges the player the normal 3-energy cost.
- [x] **Voluntary hyperspace**. `H` key. Spends 3 energy, then: if the active body is on a pedestal, triggers the WON flow; otherwise picks a random unoccupied flat tile whose terrain height ≤ active synthoid's height, raises the bound by 1 if no candidate fits, places a Synthoid there and transfers. The old shell remains.

**Exit criteria**: a human can play a full level of landscape 0000 without intervention: walk around via transfer, avoid Sentinel's gaze, reach the pedestal, win.

---

### Phase 4 — Progression and meta

- [x] **Win flow** (mechanics). Hyperspace from a pedestal-mounted synthoid → spend 3 → WON phase for ~2 s → `settings.levelId += remainingEnergy` → MENU with the new landscape loaded. Visual/scripted camera move on WON itself is deferred (Phase 5/6); placeholder is the orbit camera.
- [x] **Lose flow** (mechanics). When `spendEnergy` would drop the player below 0, switch to LOST → ~2 s hold → bump `game.levelEpoch` (same `levelId`, scene rebuilds) → MENU. "Try again" comes for free since the menu's Start re-enters the freshly-rebuilt landscape. Themed LOST screen still TBD (Phase 5).
- [ ] **Level codes**. Use the 4-digit codes already produced by `generateLevel`. Menu accepts a code to jump to that landscape.
- [ ] **Unlocked-levels list**. `settings.levelIds` already exists; populate it as the player wins levels. Menu's "Level" picker iterates unlocked codes only.
- [ ] **Save / load checkpoint**. Autosave current-level state (player pos, energy, created objects) to `localStorage`. Allow resume from `MENU`.

**Exit criteria**: a player can progress through 3+ levels, quit and resume, and can input a code to jump to a specific landscape.

---

### Phase 5 — Real UI

The current `Menu.svelte` is a debug tree with arrow-key navigation. Replace with screens.

- [ ] **Main menu**. Start / Continue / Level Select / Settings / About. Start-screen visual: the rotating overview of level 0000 we already have, with a title treatment over it.
- [ ] **Pause menu** (triggered by Escape). Resume / Settings / Quit to main.
- [ ] **Level select screen**. Enter code; shows preview of the landscape.
- [ ] **In-game HUD polish**. Current `Hud.svelte` shows energy split and level code. Add: facing/compass, current body indicator, Sentinel-watching indicator (pulsing red border when in cone), low-energy warning, hyperspace cooldown bar.
- [ ] **Settings menu**. User-facing settings only: mouse sensitivity, sound volume, FOV default, controls. The existing dev toggles (grid/axis/position/FPS/generator params) stay behind `localStorage.debug` in a separate dev panel.
- [ ] **Win / Lose screens**. Simple, themed, keyboard-driven.
- [ ] **Help screen / keybind cheatsheet**.
- [ ] **Gamepad support (stretch)**. Pointer-lock + WASD translates cleanly to right-stick + left-stick.

**Exit criteria**: a first-time visitor can reach `PLAYING` without reading source code.

---

### Phase 6 — Polish

- [ ] **Audio**. Turn sound, create, absorb, error, hyperspace, alarm, ambient hum, win/lose stings. Web Audio API, no libraries needed. Respect `settings.soundVolume`.
- [ ] **Visual effects**. Particle on create/absorb (small shader or point sprites). Sentinel detection red pulse. Hyperspace warp effect.
- [ ] **Sky / background**. The current navy blue body color is the "sky". A gradient or starfield on high-energy levels feels right.
- [ ] **Shadows**. Optional; can pick `DirectionalLight` with shadow maps if we want sun-cast shadows. Currently the sun is a point light at fixed height.
- [ ] **Mobile touch controls** (stretch). Tap-to-create, long-press to absorb, on-screen d-pad.
- [ ] **Performance pass**. Terrain meshing recreates every material/geometry on level change. A pool / reuse strategy could help. Probably not needed until it's a problem.

---

## Proposed file layout

Rough target after Phase 1 splits. Not dogma — subject to change as we go.

```
src/
  main.ts
  App.svelte
  state.svelte.ts              # persistent settings (what settings.ts used to be)

  ui/
    MainView.svelte             # thin: owns <canvas>, forwards to engine/
    Hud.svelte
    menus/
      MainMenu.svelte
      PauseMenu.svelte
      SettingsMenu.svelte
      LevelSelect.svelte
      GameOver.svelte
      WinScreen.svelte
    icons.ts

  engine/                       # Three.js-specific rendering + input
    renderer.ts
    scene.ts
    camera.ts
    input.ts                    # keyboard, mouse, pointer lock
    visibility.ts               # ray-based LOS, shared by game logic
    disposer.ts
    fonts/
      Font.ts
      TextGeometry.ts
      fixed_v01_Regular_minimal.js
      ...

  game/                         # gameplay state + rules (no Three.js imports ideally)
    state.svelte.ts             # game state machine, player, energy
    rules.ts                    # creation/absorption/transfer predicates
    turn.ts                     # tick driver
    actions.ts                  # absorb, create, transfer, hyperspace

  world/
    terrain.ts                  # was sentland.ts
    objects/
      base.ts                   # was GameObject (base class)
      synthoid.ts
      sentinel.ts
      sentry.ts
      meanie.ts
      tree.ts
      boulder.ts
      pedestal.ts
      models/
        index.ts                # getObject(), ModelOptions
        sentinel.ts             # mesh data
        synthoid.ts
        tree.ts
        ...
```

`settings` (user prefs) and `game` (runtime state) remain separate and both live in `.svelte.ts` files so they can use `$state`.

---

## Conventions to lock in

Once Phase 1 lands, adopt these and enforce via types/PR review:

- **Y-up** throughout. `height` = `.y`.
- **Game logic doesn't import `three`.** `world/` and `game/` are pure TS. Only `engine/` and `ui/` touch Three.js. Unit-testable without WebGL.
- **No side effects at module top level** (except `$state` declarations). Initialization happens in explicit `init()` calls from `main.ts`.
- **Disposables are tracked**, not orphaned. Any code creating a `BufferGeometry`, `Material`, `Texture`, `WebGLRenderTarget` registers it with `engine/disposer.ts`.
- **TypeScript `strict` on** after Phase 1.
- **Tests co-located.** `foo.ts` ↔ `foo.test.ts`.
