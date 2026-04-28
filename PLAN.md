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

### Phase 2.5 — Code-quality cleanup

Pause before the remaining Phase 3 AI work to address layering drift, repeated patterns, and small smells found during the post-Phase-3-partial review. Each item is independently shippable.

**Trivial wins (no behaviour change)**
- [x] Drop `settings.mapSize`; map dimension is a fixed `MAP_SIZE = 32` constant. Removed the `Map size` menu entry, the `mapSize`/`dim` thread through engine/actions/loop/visibility callers, and `LandscapeOptions.dim`. (`isCellVisible` keeps `mapSize` as a parameter so its unit tests can use a synthetic 16×16 grid.)
- [x] Drop `eyeOffset` parameter from `CameraController`. `terrainHeightAt` returns ground level; callers add `EYE_HEIGHT = 0.875` themselves. `resetToCenter`/`resetToPosition`/`updateFlight` updated.
- [x] Boulder rotation is fixed at 0 (cleaner stacks); Synthoid spawns face the camera; Tree spawns still randomise.
- [x] `getObject(type, options)` returns `Group` (non-null) and throws on missing model. Removed the now-unreachable null check in `GameObject` constructor.
- [x] Replaced `!o.absorbedTime` with `o.absorbedTime !== null` everywhere (`actions.ts`, `scene.ts`, `MainView.svelte`, `base.ts`).
- [x] Deleted the dead `Synthoid.play` override.
- [x] String-literal-union types for `axis` (`'x' | 'z'`) and `system` (`Platform`) in `world/terrain.ts`.
- [x] Renamed root `state.svelte.ts` → `settings.svelte.ts` to disambiguate from `game/state.svelte.ts`.

**Picker + back-reference (replaces stringly-typed lookups)**
- [x] `GameObject.object3D.userData = { gameObject, col, row }`. Stringly-typed `type` is gone; col/row stay because `visibility.ts` uses them to skip target-cell hits without unwrapping the back-ref.
- [x] Added `objectsAt(allObjects, col, row)` and `topObjectAt(...)` helpers in `engine/scene.ts`. All inline `allObjects.filter(o => o.col === ... && o.row === ... && o.absorbedTime === null)` sites use them.
- [x] Extracted `pickTarget(camera, sceneData) → Pick | null` to `engine/picker.ts`. `Pick` is a discriminated union of `{ kind: 'object', gameObject }` and `{ kind: 'terrain', type: 'plane' | 'slope' }`. DEBUG `handleClick` and PLAYING `performTargetedAction` both use it.

**`addObjectToScene` ergonomics**
- [x] `addObjectToScene(sceneData, cls, spec)` and `removeObjectFromScene(sceneData, col, row, time, vis)` — `SceneData` is the context, `spec` is `{ col, row, rot, time, step?, timer? }`. Dropped `dim` from `GameObject` constructor (uses `MAP_SIZE`). Call sites in `actions.ts`, `MainView.svelte` (none needed there), and the level-init loop in `buildScene` all updated.

**Layering**
- [x] Split `engine/actions.ts` → `engine/picker.ts` (raycast only, already done in chunk B) + `game/actions.ts` (rules: create / absorb / transfer / hyperspace, no `three` import at runtime). `engine/actions.ts` is now the wire-up layer that builds an `ActionContext` per call and dispatches to game/actions.
- [ ] Sentry is no longer a subclass of Sentinel — both extend a `Watcher` base (or compose a shared rotation behaviour). Defer until AI lands.

**Phase scheduler + view events**
- [x] Pulled `setTimeout`s out of `triggerWon` / `triggerLost` / `beginTransfer`. Each has a `complete*` companion (`completeWon`, `completeLost`, `completeTransfer`). Timing constants live in `game/timing.ts`. The phase scheduler is an `$effect` in `App.svelte` that watches `game.phase` and schedules the matching `complete*` call. Effect cleanup cancels in-flight timers when the phase changes early.
- [ ] Move "view-event" counters (`startCount`, `debugCount`, `transferCount`, `levelEpoch`, `previousSynthoid*`) out of `game/state.svelte.ts` into a co-located `view-events.svelte.ts` near `MainView`. *Decision deferred*: keeping them in `game/state.svelte.ts` for now — the alternative requires either rules→view callbacks (layering inversion) or phase-edge inference from view-side (fragile for fast successive transitions). Revisit if `game/state.svelte.ts` grows further.
- [ ] Collapse `MainView` Effects 3a–3d into one phase-transition observer. Deferred to a separate pass — the effect-ordering invariants are subtle and worth a focused review when tackled.
- [x] Added `GameObject.faceTowards(col, row)` helper — `MainView` Effect 3c uses it instead of inlining the 256-step conversion.

**Action ergonomics**
- [x] `canPlace(col, row)` predicate on `ActionContext`; create flows now go `canPlace → spendEnergy → placeObject`. Refund-on-failed-placement removed. `placeObject` is `void`.
- [x] `gainEnergy(n)` refuses negative `n` (logs `gainNegativeRefused`) symmetrically with `spendEnergy`.

**Small cleanups**
- [x] Sentinel's animation state is `mode: 'idle' | 'queued' | 'turning'` + `turnStartTime`. Drop-on-collision behaviour: a tick fired while still `turning` is dropped instead of overlapping animations.
- [x] Extracted `applyMouseLook()` in `CameraController`, shared by `updateLook` (PLAYING/TRANSFER) and `updateFlight` (DEBUG).
- [x] Named constants: `SUN_HEIGHT`/`SUN_RADIUS`/`SUN_PERIOD_MS`/`SUN_PHASE_OFFSET` in `loop.ts`; `FPS_SAMPLE_PERIOD_MS`, `INITIAL_FRAME_DT_MS`; `CONE_HALF_ANGLE_256`, `TURN_DURATION_MS` in `sentinel.ts`; `VERT_CLAMP`, `FOV_MIN`/`MAX`, `ORBIT_*` in `camera.ts`; `TRANSFER_DELAY_MS`/`WIN_LOSS_DELAY_MS` in `game/timing.ts`.
- [ ] `sceneData.allObjects` → `sceneData.liveObjects`. *Decision*: skip — direct uses outside the centralised `objectsAt` helper specifically need fading objects too (per-frame play, addObjectToScene stacking check). The current name is correct; `objectsAt` is the live-only access pattern.
- [ ] `loop.lastTimestamp` returns `number | null`. *Decision*: skip — the `?? 0` fallback only fires on the impossible "no frame yet" path; null-typing the return value forces every caller to handle a case that can't occur in practice.

**Exit criteria**: `npm run check && npm run build && npm test` green. `MainView.svelte` back under 150 lines. `engine/` no longer imports from `game/state.svelte.ts` for rules functions; only the loop reads `game.phase` to gate behaviour. No stringly-typed `userData.type` in `actions.ts` paths.

---

### Phase 3 — Core gameplay mechanics

The game becomes actually playable.

- [x] **Energy economy**. `spendEnergy(n): bool`, `gainEnergy(n, cause)` in `game/state.svelte.ts`. Negative spends refused. Zero energy triggers `LOST`. Each landscape starts at 10 energy. `game/rules.ts` holds the `ENERGY_COST` table.
- [x] **Control scheme rework**. Keys only in PLAYING mode (pointer-locked). `R` / `B` / `T` / `U` / `Space` / `Enter` / `H` handled by `handleKeyActions` in `engine/actions.ts`, called from the game loop. Debug mouse clicks preserved in DEBUG mode only.
- [x] **Creation**. Slope check enforced; `addObjectToScene` enforces stacking validity (empty tile, atop Pedestal, atop all-boulder stack). No LOS requirement. Energy spent upfront, refunded if placement rejected.
- [x] **Absorption**. LOS-based (`isCellVisible`). Boulders always absorbable (no LOS check). Sentinel/Sentry on pedestal: LOS to pedestal top (yOffset=1). Pedestal itself unabsorbable. After Sentinel absorbed, `game.sentinelAbsorbed=true` locks further absorption; Sentinel absorption sets up win flow.
- [x] **Transfer**. Space/Enter targets a visible Synthoid; `beginTransfer(col, row)` sets `game.activeSynthoidCol/Row`, increments `transferCount`, switches to TRANSFER phase, auto-returns to PLAYING after 1 s. Effect 3c in MainView snaps camera to new body (correct height for boulder-stack case) and shows old body / hides new active body.
- [x] **Stacking**. Stacking rules consolidated in `addObjectToScene` (empty, Pedestal top, all-boulder stack). `resetToPosition` accepts `objectHeight?` to correctly place the camera eye when the active synthoid is on a boulder stack.
- [ ] **Sentinel / Sentry AI**. The original spec stays as written below. Implementation breakdown:

  **3.A — Foundations** (no visible behaviour change yet)
  - [x] Generalised `engine/visibility.ts:isCellVisible(camera, ...)` → `isCellVisibleFrom(eyePos, ..., fromCol?, fromRow?)`. The watcher form takes an arbitrary world-space eye + optional source cell to skip its own geometry. Player-side wrapper keeps its signature and delegates. Tests stay green.
  - [x] Added `game.firstActionTaken`, reset by `startGame()`, flipped by a new `markFirstAction()` called from each success path in `game/actions.ts`. Sentinel.playTick early-returns while dormant.
  - [x] Stub `runDrainPhase(sceneData)` in `engine/watcher.ts` exported `DRAIN_TICK_PERIOD = 4`. `GameLoop` calls it on `tick % DRAIN_TICK_PERIOD === 0` (1 Hz at the 4 Hz turn rate), gated by `game.firstActionTaken`.
  - [x] **Cone-of-sight visualization**. New `engine/cones.ts` builds a closed wedge geometry (apex at watcher's local origin, +Z forward, ± half-height vertical, range 12 cells, half-angle matched to `CONE_HALF_ANGLE_256 = 10`). Shared geometry+material live on `SceneData.coneAssets`, registered with the disposer. `addObjectToScene` parents an invisible cone mesh to every Sentinel/Sentry on creation. `Sentinel.setConeVisible(b)` flips it. `settings.showWatcherCones` toggle (debug-gated `Display` submenu) drives a MainView effect that walks `allObjects` and applies visibility — re-fires after scene rebuilds (level switch / LOST recovery) by also touching `settings.levelId` and `game.levelEpoch`.

  **3.B — Drain mechanics**
  - [x] `runDrainPhase(sceneData)` in `engine/watcher.ts` (gated on `firstActionTaken`). Iterates non-absorbed Sentinels (Sentry extends Sentinel so both match). Per watcher: eye at local y = 0.9, horizontal cone test (`facing.angleTo(toTarget) < CONE_HALF_ANGLE_RAD` with `toTarget.y = 0`, matching the existing in-cone scale marker), then `isCellVisibleFrom(...)` with the target's actual foot height as `yOffset` (handles synthoids on boulder stacks). Closest visible candidate wins (TODO: cross-check vs original).
  - [x] **Per-cell drain target** (`findDrainTarget`): top-of-stack Synthoid or Boulder is the target; a Tree is the target *only* when sitting directly on a Boulder. Lone trees on terrain are inert. Anything stacked under the chosen target is shielded — so a boulder under the player synthoid is the synthoid's "underside", not a separate candidate. `[Boulder, Boulder, Tree]` drains over three ticks: tree → top-boulder → bottom-boulder, each producing a tree elsewhere via the conservation spawn.
  - [x] **Tree drain has no in-place replacement** (`removeInPlace`): a drained tree just vanishes. The conservation tree spawn elsewhere still fires. Synthoid→Boulder and Boulder→Tree morphs still happen in-place.
  - [x] **Rotation lock during drain** (matches the original game): `Sentinel.drainLocked` is set after each drain phase based on whether the watcher consumed an action. `playTick` keeps decrementing `ticksUntilTurn` (into negatives if needed) but holds the queued turn while locked, so the rotation fires immediately on the first unlocked tick after the watcher had nothing to drain.
  - [x] Drain transforms: `Synthoid → Boulder` and `Boulder → Tree` via an instant in-place swap (`morphInPlace`) — no fade animation, deliberately distinct from the player-action absorb fade. Stacking-rejected replacements (e.g. `Tree` on a boulder stack) are logged and skipped.
  - [x] Conservation: every successful drain spawns a fresh Tree on a random empty flat tile. Skipped + logged if no eligible tile.
  - [x] Caps: `Set<watcher>` ensures ≤ 1 action per watcher per tick; `Set<gameObject>` ensures ≤ 1 drain per item per tick.

  **3.C — Player-as-target distinction**
  - [x] Player active body branches: tile visible → `drainEnergy(1, 'watcher-pool')` (new function — passive, pushes below 0 into LOST instead of refusing like `spendEnergy`) + 200 ms canvas red flash via `game.drainPulseAt` timestamp. Tile occluded → `'meanieConversionTrigger'` log, watcher's action consumed (actual Meanie placement lands in 3.D).
  - [x] Sentinel in-cone marker reduced from `scale.set(2, 2, 2)` to `1.15` — keeps the visual hint without the goofy giant-watcher.
  - [ ] Optional head-colour swap as a future polish (kept the simple scale path for now).

  **3.D — Meanies**
  - [x] On a watcher's "body visible, tile occluded" event, `triggerMeanieConversion` (in `engine/meanie.ts`) finds the closest live tree to the player's body and animates a tree → Meanie morph at the same drain pacing (500 ms absorb + 500 ms deferred spawn at `animationScale=2`). Energy conserved by the conversion itself (tree 1 → meanie 1), so no separate conservation tree spawns.
  - [x] `runMeaniePhase` runs every 4 Hz tick during PLAYING. Each ready Meanie rotates by up to `MEANIE_ROT_STEP_PER_TICK = 16` (~22.5°) toward the player — ~90°/s, so half a rotation takes ~2 s. Once aimed, an LOS check from the meanie's eye to the player's actual foot height (handles synthoid-on-boulder-stack) decides whether it fires.
  - [x] `forceHyperspace`: `drainEnergy(3, 'meanie-forced-hyperspace')` (passive — pushes to LOST if can't pay), then reuses `pickHyperspaceTile` and `addObjectToScene` + `beginTransfer` to teleport. The triggering Meanie remains; if it still has LOS at the new spot, the cycle re-fires next tick (Meanies re-aim from their current rotation, so there's a brief window of safety while they swivel).

  **Spec (authoritative)**
  - **Dormant until the player's first action** (create / absorb / transfer / hyperspace). Give the player a free look-around on level entry.
  - Rotate `step/256` of a revolution per turn, timer-driven (values already come from level gen).
  - Field-of-view = `20/256 · 2π` cone (the existing detect code).
  - **Drain action, 1 Hz**: each watcher performs **one** drain action per tick. It picks one visible item in its cone whose energy > 1 — trees are skipped, they have nothing left to lose — drains 1 energy from it, and **simultaneously spawns a new tree on a random free flat tile** to conserve total energy. Two hard caps apply:
    - ≤ 1 action per watcher per tick (if a watcher sees multiple items, only one is drained).
    - ≤ 1 energy lost per item per tick (if several watchers see the same target, only one drain lands; the others have no effect on that target that tick).
    - Different watchers looking at different targets drain in parallel, so N sentries can strip N distinct items per tick.
  - **Non-player items transform visibly** when drained: synthoid (3) → boulder (2) → tree (1). Once at 1, they're inert to further drains.
  - **The player's active body counts as an item** and is a valid drain target, under the same per-item cap:
    - If the **player's tile is also visible**: warning sound + fuzzy view; the drain deducts 1 from the player's energy pool (HUD counter) instead of transforming the body. A tree still spawns elsewhere.
    - If the player's tile is **not visible** (standing on a boulder stack tall enough to hide the base): that watcher spends its action on the **Meanie conversion** described below instead of the drain. No pool drain that tick from that watcher.
- [x] **Line-of-sight rules**. `isCellVisibleFrom(eyePos, ...)` (3.A) is the shared primitive: player absorption + transfer pickability use the picker's raycast (no extra LOS), Sentinel/Sentry scan + player-tile-visibility distinction + Meanie detection all call `isCellVisibleFrom` with the appropriate eye + target.
- [x] **Meanies**. See 3.D. Spawn condition: a Sentinel/Sentry sees the player's body but not the tile it stands on. Effect: closest tree to the player → animated Meanie morph. Behaviour: Meanie rotates toward player at ~90°/s; on LOS it forces a hyperspace (drainEnergy 3, then teleport).
- [x] **Voluntary hyperspace**. `H` key. Spends 3 energy, then: if the active body is on a pedestal, triggers the WON flow; otherwise picks a random unoccupied flat tile whose terrain height ≤ active synthoid's height, raises the bound by 1 if no candidate fits, places a Synthoid there and transfers. The old shell remains.

**Exit criteria**: a human can play a full level of landscape 0000 without intervention: walk around via transfer, avoid Sentinel's gaze, reach the pedestal, win.

---

### Phase 3.5 — Action cadence and detection-marker cleanup

Two small gameplay tweaks. Held back during 3.A–3.D so feature-testing was friction-free; now that the AI loop is in place, the cap matches the game's natural 1 Hz tempo and the debug detection cue can come off.

- [ ] **Player action cap: 1 per second.** Pressing R / B / T / U / Space / Enter / H or any mouse action is gated by a cooldown matching the watchers' 1 Hz cadence. While an action's animation (spawn, absorb, transfer, hyperspace) is still playing, no further action is accepted. Implementation: `game.lastActionAt` (rAF time) — refuse new actions when `time - lastActionAt < 1000`. Transfer + hyperspace already block via the TRANSFER phase, so the cap mostly affects R/B/T/U and the equivalent mouse buttons. No new HUD cue — the silence is the cue.
- [ ] **Drop the in-cone scale pulse on Sentinel/Sentry.** It's a debug aid we kept too long; the original game has no such indicator and the watcher's facing direction is already obvious from a glance. Remove the `mode !== 'turning'` cone check + `scale.set(1.15, …)` block from `world/objects/sentinel.ts:play`. The cone-overlay debug toggle remains for development.

**Exit criteria**: actions can't fire faster than once per second; absorption-then-creation chain plays at the same tempo as a watcher drain. Sentinels never visibly pulse.

---

### Phase 4 — Progression and meta

- [x] **Win flow** (mechanics). Hyperspace from a pedestal-mounted synthoid → spend 3 → WON phase for ~2 s → `settings.levelId += remainingEnergy` → MENU with the new landscape loaded. Visual/scripted camera move on WON itself is deferred (Phase 5/6); placeholder is the orbit camera.
- [x] **Lose flow** (mechanics). When `spendEnergy` would drop the player below 0, switch to LOST → ~2 s hold → bump `game.levelEpoch` (same `levelId`, scene rebuilds) → MENU. "Try again" comes for free since the menu's Start re-enters the freshly-rebuilt landscape. Themed LOST screen still TBD (Phase 5).
- [x] **Unlocked-levels list**. `completeWon` pushes the new `settings.levelId` into `settings.levelIds` (sorted ascending) and `save()`s it. Menu's "Level" entry traverses `settings.levelIds` via `indexOf` so the picker is naturally limited to unlocked landscapes.
- ~~**Save / load checkpoint**~~. Dropped: persisting all created objects + positions + states is non-trivial, and the loss path (LOST → MENU → Start re-enters the rebuilt landscape at full energy) is already low-friction. Keeping save/load out preserves the per-level tension.
- ~~**Level codes**~~ — moved to Phase 5 (depends on the level-select screen).

**Exit criteria met**: a player can progress through multiple levels via the unlocked-levels picker. Level-code jump is intentionally deferred.

---

### Phase 5 — Real UI

The current `Menu.svelte` is a debug tree with arrow-key navigation. Replace with the proper UI surfaces. The orbiting overview of the selected level remains visible across MENU, PAUSED, WON, LOST — overlays sit on top of it.

- [ ] **Pause overlay (no menu).** Pressing Escape during PLAYING freezes time, releases the pointer lock (already happens via `onLockLost` → `pauseGame()`), dims the scene (CSS overlay or a quick lighting reduction), and shows a centred "Paused" caption. Any key resumes (re-acquires the pointer lock and goes back to PLAYING). The pause menu / Settings / Quit-to-main entries are gone — pause is purely a breath, not a navigation surface.
- [ ] **In-game ESC = give up.** From PLAYING, Escape returns to the main menu and rebuilds the landscape (bumps `game.levelEpoch`, same code path as LOST). Replaces the current PLAYING → PAUSED → menu flow.
- [ ] **Main menu (replaces the debug tree).** Top-level entries:
  - **Start**
  - **Level: NNNN** — left/right cycle through `settings.levelIds` (unlocked landscapes).
  - **Input level code** — opens an inline 8-hex-digit input. On a valid code, jump to the matching `levelId`. Code → levelId mapping is built lazily on first use (iterate level numbers, generate, cache). Codes are taken from `level.codes` (the engine system varies, pick one as canonical — likely BBC/C64).
  - **Settings**.
  Visually: the menu is bigger than the current debug tree but stays anchored to one side (probably right) so the orbiting overview reads as the dominant element. No dedicated level-select screen — the main menu's `Level` + `Input level code` cover both cases.
- [ ] **Settings menu.** User-facing entries: mouse sensitivity, sound volume, animation style (fade/squash). Debug-gated subgroup (`localStorage.debug`): Free roam, display toggles (grid / surfaces / axis / position / FPS / watcher cones), generator toggles (smooths / despikes).
- [ ] **Minimal in-game HUD.** `Hud.svelte` shows only the energy icons. No compass, no level code, no current-body indicator. **Hidden in MENU** (only shown during PLAYING / TRANSFER / PAUSED). **Low-energy warning**: when `game.energy <= 3`, the energy icons pulse opacity at ~1 Hz between roughly 0.3 and 1.0 (sine on a clock — never fully invisible).
- [ ] **Help line.** Two short lines pinned to the bottom of the screen during PLAYING:
  1. Key bindings (`R Synth · B Bldr · T Tree · U absorb · Space transfer · H hyperspace · Esc give up`).
  2. Mouse bindings (`L absorb · M Synth · R Bldr`).
  Hidden in MENU and during animations if they get in the way; can be a small toggleable affordance later.
- [ ] **Win / Lose screens.** Themed overlays during the WON / LOST holds. Keyboard-driven exit. No menu-tree — single "press any key to continue" affordance.
- [ ] **Gamepad support (stretch)**. Pointer-lock + WASD translates cleanly to right-stick + left-stick.

**Exit criteria**: a first-time visitor can reach PLAYING without reading source code; the in-game UI holds nothing but the energy bar + a help line.

---

### Phase 6 — Polish

- [ ] **Audio**. Turn sound, create, absorb, error, hyperspace, alarm, ambient hum, win/lose stings. Web Audio API, no libraries needed. Respect `settings.soundVolume`.
- [ ] **Visual effects**. Particle on create/absorb (small shader or point sprites). Sentinel detection red pulse. Hyperspace warp effect.
- [ ] **True volumetric watcher cones (stretch)**. The 3.A debug visualization is a closed wedge mesh — fast and reads as a beam, but it's a polygon. A `ShaderMaterial` raymarching through a synthetic density field (procedural noise + falloff at the cone surface) would give actual fog-volume scattering, dust motes, soft edges. Worth considering as a tutorial overlay or as the in-game "you are being watched" indicator if we want something more atmospheric than a HUD border.
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
