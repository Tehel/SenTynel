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
- [x] Sentry is no longer a subclass of Sentinel — both extend a `Watcher` base (`world/objects/watcher.ts`) holding the shared rotation/drain-lock behaviour. `Sentinel`/`Sentry` are now thin siblings differing only in `static type`. Call sites that relied on `instanceof Sentinel` matching Sentry via inheritance (`engine/watcher.ts`, `engine/scene.ts`, `MainView.svelte`) now check `instanceof Watcher` explicitly.

**Phase scheduler + view events**
- [x] Pulled `setTimeout`s out of `triggerWon` / `triggerLost` / `beginTransfer`. Each has a `complete*` companion (`completeWon`, `completeLost`, `completeTransfer`). Timing constants live in `game/timing.ts`. The phase scheduler is an `$effect` in `App.svelte` that watches `game.phase` and schedules the matching `complete*` call. Effect cleanup cancels in-flight timers when the phase changes early.
- [x] Move "view-event" counters (`startCount`, `debugCount`, `transferCount`, `levelEpoch`, `previousSynthoid*`) out of `game/state.svelte.ts` into a co-located `view-events.svelte.ts` near `MainView`. *Final decision (2026-07-05): skip.* Revisited post Phase 3/4/4.5 — `game/state.svelte.ts` only grew by two small fields (`drainPulseAt`, `lastActionAt`), not the view-event group, so the growth concern that motivated "revisit" didn't materialize. The original tradeoff still holds: splitting these out means either rules→view callbacks (layering inversion) or fragile phase-edge inference from the view side. Leaving them where they are.
- [x] Collapse `MainView` Effects 3a–3d into one phase-transition observer. *Partial, by design*: merged the pointer-lock pair (old 3b acquire-on-PLAYING/DEBUG + 3d release-on-WON/LOST) into one effect — both read only `game.phase`, are mutually exclusive, and had no ordering dependency, so this was a pure simplification. Left the camera-snap effects (start/debug-entry vs. post-transfer) and the cone-visibility toggle separate: they react to different counters/settings and do materially different work (body visibility, facing, LOS-cone toggling); forcing them into one "phase-transition observer" would trade today's single-purpose effects for a branchier one keyed on manually-diffed phase transitions — more fragile, not less. Effects renumbered 3a–3d in file order.
- [x] Added `GameObject.faceTowards(col, row)` helper — `MainView` Effect 3c uses it instead of inlining the 256-step conversion.

**Action ergonomics**
- [x] `canPlace(col, row)` predicate on `ActionContext`; create flows now go `canPlace → spendEnergy → placeObject`. Refund-on-failed-placement removed. `placeObject` is `void`.
- [x] `gainEnergy(n)` refuses negative `n` (logs `gainNegativeRefused`) symmetrically with `spendEnergy`.

**Small cleanups**
- [x] Sentinel's animation state is `mode: 'idle' | 'queued' | 'turning'` + `turnStartTime`. Drop-on-collision behaviour: a tick fired while still `turning` is dropped instead of overlapping animations.
- [x] Extracted `applyMouseLook()` in `CameraController`, shared by `updateLook` (PLAYING/TRANSFER) and `updateFlight` (DEBUG).
- [x] Named constants: `SUN_HEIGHT`/`SUN_RADIUS`/`SUN_PERIOD_MS`/`SUN_PHASE_OFFSET` in `loop.ts`; `FPS_SAMPLE_PERIOD_MS`, `INITIAL_FRAME_DT_MS`; `TURN_DURATION_MS` (now in `watcher.ts`, see Phase 3.5); `VERT_CLAMP`, `FOV_MIN`/`MAX`, `ORBIT_*` in `camera.ts`; `TRANSFER_DELAY_MS` in `game/timing.ts` (`WIN_LOSS_DELAY_MS` since removed — see Phase 5, Win/Lose screens are keypress-only now).
- [ ] `sceneData.allObjects` → `sceneData.liveObjects`. *Decision*: skip — direct uses outside the centralised `objectsAt` helper specifically need fading objects too (per-frame play, addObjectToScene stacking check). The current name is correct; `objectsAt` is the live-only access pattern.
- [ ] `loop.lastTimestamp` returns `number | null`. *Decision*: skip — the `?? 0` fallback only fires on the impossible "no frame yet" path; null-typing the return value forces every caller to handle a case that can't occur in practice.

**Exit criteria**: `npm run check && npm run build && npm test` green. `MainView.svelte` back under 150 lines. `engine/` no longer imports from `game/state.svelte.ts` for rules functions; only the loop reads `game.phase` to gate behaviour. No stringly-typed `userData.type` in `actions.ts` paths.

---

### Phase 3 — Core gameplay mechanics

The game becomes actually playable.

- [x] **Energy economy**. `spendEnergy(n): bool`, `gainEnergy(n, cause)` in `game/state.svelte.ts`. Negative spends refused. Zero energy triggers `LOST`. Each landscape starts at 10 energy. `game/rules.ts` holds the `ENERGY_COST` table.
- [x] **Control scheme rework**. Keys only in PLAYING mode (pointer-locked). `R` / `B` / `T` / `U` / `Space` / `Enter` / `H` handled by `handleKeyActions` in `engine/actions.ts`, called from the game loop. Debug mouse clicks preserved in DEBUG mode only.
- [x] **Creation**. Slope check enforced; `addObjectToScene` enforces stacking validity (empty tile, atop Pedestal, atop all-boulder stack). No LOS requirement. Energy spent upfront, refunded if placement rejected. *Fixed post-playtest (2026-07-06):* `canPlaceAt` now also gates by object type — a bare (item-less) Pedestal only accepts a Synthoid, since a Boulder or Tree placed there instead was an unrecoverable dead end (absorb locks for the rest of the level once the Sentinel is down, and the stacking rule blocks a second item on top).
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

- [x] **Player action cap: 1 per second.** `game.lastActionAt` (rAF time) + `canPerformAction(time)` in `game/state.svelte.ts`, gated against `ACTION_COOLDOWN_MS = 1000` (`game/timing.ts`). Wired into `engine/actions.ts`'s `handleKeyActions`/`handleMouseAction`: the cooldown is checked once a valid target/key is identified (so aiming at nothing doesn't burn the slot). *Revised post-playtest (2026-07-06):* originally stamped `lastActionAt` on every accepted attempt, even ones the underlying rule then refused (insufficient energy, blocked placement) — invisible while there was no HUD cue, but once the cooldown bar shipped, failed clicks visibly (and confusingly) started the timer anyway. `performTargetedAction`/`performHyperspace` (`game/actions.ts`) now return whether the action actually took effect; `canPerformAction` is a pure check and the new `markActionPerformed(time)` is called only on a `true` result, so a failed attempt costs nothing and can be retried immediately. Transfer + hyperspace still additionally block via the TRANSFER phase. *Originally shipped with no HUD cue ("the silence is the cue"); reversed post-playtest — see the Hud.svelte cooldown bar under Phase 7 comfort tweaks below.*
- [x] **Drop the in-cone scale pulse on Sentinel/Sentry.** Removed the dead commented-out `scale.set(1.15, …)` block (had already been disabled, never deleted) from what's now `world/objects/watcher.ts:play`. The cone-overlay debug toggle remains for development.

**Exit criteria met (2026-07-05)**: `npm run check && npm run build && npm test` green. Actions can't fire faster than once per second (`game.lastActionAt` gate). Watchers never visibly pulse — the dead scale-pulse code is gone, only the rotation interpolation remains gated on `ready`/`absorbedTime`.

---

### Phase 4 — Progression and meta

- [x] **Win flow** (mechanics). Hyperspace from a pedestal-mounted synthoid → spend 3 → WON phase for ~2 s → `settings.levelId += remainingEnergy` → MENU with the new landscape loaded. Visual/scripted camera move on WON itself is deferred (Phase 5/6); placeholder is the orbit camera. *Fixed post-playtest (2026-07-06):* a player who reached the pedestal with less than 3 energy was permanently stuck — absorb is locked for the rest of the level once the Sentinel is down, so there was no way left to earn the shortfall back. Hyperspace-from-pedestal now always succeeds; `floorEnergyForPedestalHyperspace()` (`game/state.svelte.ts`) floors energy to 1 on a refused spend, and also on the exact-3 case (spend succeeds, 0 left) so that arriving with exactly 3 energy can't jump fewer landscapes than arriving with less.
- [x] **Lose flow** (mechanics). When `spendEnergy` would drop the player below 0, switch to LOST → ~2 s hold → bump `game.levelEpoch` (same `levelId`, scene rebuilds) → MENU. "Try again" comes for free since the menu's Start re-enters the freshly-rebuilt landscape. Themed LOST screen still TBD (Phase 5).
- [x] **Unlocked-levels list**. `completeWon` pushes the new `settings.levelId` into `settings.levelIds` (sorted ascending) and `save()`s it. Menu's "Level" entry traverses `settings.levelIds` via `indexOf` so the picker is naturally limited to unlocked landscapes.
- ~~**Save / load checkpoint**~~. Dropped: persisting all created objects + positions + states is non-trivial, and the loss path (LOST → MENU → Start re-enters the rebuilt landscape at full energy) is already low-friction. Keeping save/load out preserves the per-level tension.
- ~~**Level codes**~~ — moved to Phase 5 (depends on the level-select screen).

**Exit criteria met**: a player can progress through multiple levels via the unlocked-levels picker. Level-code jump is intentionally deferred.

---

### Phase 4.5 — 3D rendering optimization

The scene is small (a 32×32 landscape with ~10 game objects) but framerate is well below 60 FPS even on midrange hardware (Ryzen 9 5900HX + RTX 3050 Laptop, Chrome). Diagnosis: **CPU-side draw-call overhead**, not GPU shading. The current rendering layer issues thousands of tiny draw calls per frame because every face of every model and every terrain tile is its own `Mesh` + `BufferGeometry` + `Material`. WebGL has fixed per-draw-call cost regardless of geometry size, and JavaScript pays it on every call. With the current scene, frames spend most of their time in the rAF/render path rather than on the GPU.

**Findings (2026-04-30)**

- **Per-face mesh explosion in `world/objects/models/index.ts:45-63`.** `getObject()` creates one `Mesh` + `BufferGeometry` + `MeshPhongMaterial` per face of the model. Face counts: sentinel 55, synthoid 43, sentry 39, meanie 32, tree 23, pedestal 19, boulder 13. A single Sentinel costs **55 draw calls**. A typical level (Sentinel + a few sentries + your synthoid + trees + pedestal) easily reaches 300–500 draw calls just for game objects.
- **Per-tile terrain meshes in `engine/scene.ts:178-220`.** Each landscape cell is its own `Mesh`; sloped cells become two triangle meshes. With `MAP_SIZE = 32`, that's 31×31 = 961 cells → **~1000–1900 terrain draw calls per frame**.
- **Universally `transparent: true` + `side: DoubleSide` materials** (`models/index.ts:48-55`). Every model face is allocated as a transparent material, even when fully opaque (i.e. on objects that aren't currently fading). `transparent: true` forces the slow path: depth-sorted, no early-z, no batching/instancing. `DoubleSide` doubles fragment-shader work for every pixel covered.
- **`MeshPhongMaterial` everywhere.** Phong is the heaviest of the standard non-PBR materials (specular term, normal recomputation). On flat-shaded faceted geometry the specular highlight is barely visible. `MeshLambertMaterial` would render almost identically at lower cost.
- **Grid (debug only) is ~2000 separate `Line` objects** when enabled (`scene.ts:155-174`). Not on the hot path for normal play, but worth fixing alongside terrain.
- **Per-face `BufferGeometry` is wasteful** beyond just draw-call count: each holds a 3-vertex position attribute with its own GPU buffer binding and attribute setup state.
- **Renderer config is reasonable.** `WebGLRenderer({ antialias: true, alpha: true })`, no `setPixelRatio` call (defaults to 1) — this is fine; `image-rendering: pixelated` on the canvas keeps it visually consistent at any DPR.

Estimated current draw call budget (rough, observable via `WebGLRenderer.info`): **~1500–2500 calls/frame**. Modern integrated GPUs start CPU-bottlenecking around 1000 draw calls; above 2000, the JS/driver overhead alone consumes most of a 16 ms frame. After the changes below, the scene should sit comfortably below 50 draw calls/frame — pushing the bottleneck firmly back onto the GPU, where on a scene this small it is essentially idle.

**Suggested changes, in priority order**

- [x] **Step 0 — Measurement scaffold.** `renderer.info.render.calls` and `.triangles` are wired through `FrameStats` to the `Show FPS` debug overlay. Baseline (level 0000): orbit cam **40 FPS, 2393 draws, 2866 tris**; PLAYING **60–120 FPS, 1117 draws, 1382 tris** (depends on view orientation via per-mesh frustum culling).

- [x] **Step 1 — Drop `transparent: true` from object materials when not actively fading.** Object materials in `getObject` now default to `transparent: false, opacity: 1`; `base.ts` flips `material.transparent = true` only while a spawn/absorb fade is running and back to `false` when it completes. `DoubleSide` left in place on slope-terrain and game-object materials (orbit cam sees slope undersides; fade animations reveal object interiors). Flat-plane materials never had `DoubleSide` — turned out to be a non-issue.
  - **Result**: orbit went from **40 → 60 FPS, 2393 → 1927 draws** (-466). The cause: `transparent + DoubleSide` was forcing two draw calls per object face (back then front, blended) instead of one. Per-face mesh count was unchanged; the win came from the renderer dropping its second pass per face.

- [x] **Step 2 — Merge terrain geometry.** Replaced ~961 per-cell meshes with **4 merged meshes** — one per terrain material (planeEven/Odd, slopeEven/Odd) — via `BufferGeometryUtils.mergeGeometries` from `three/examples/jsm/utils/BufferGeometryUtils.js`. Each cell's triangles are now built directly in world coordinates and merged into the appropriate batch; intermediate per-cell `BufferGeometry` instances are disposed after merge. `engine/picker.ts` and `engine/visibility.ts` derive `(col, row)` from the world-space hit point (`floor(x)`, `MAP_SIZE - 2 - floor(z)`) when the hit lands on a merged terrain mesh; game-object groups still use their per-Group `userData.col/row`. Merged meshes carry `userData = { kind: 'terrain', type: 'plane' | 'slope' }`.
  - **Result**: orbit **60 FPS, 1927 → 471 draws (-1456)**, PLAYING **946 → 176 draws**. With only terrain in view, draws bottoms out at ~10 (4 terrain + skybox + sun + 2–3 cone overlays).

- [x] **Step 3 — Merge per-object faces, with per-vertex colour.** `getObject` now returns a single `Mesh` per game object: one `BufferGeometry` whose `position` attribute concatenates all face vertices (3 per face — vertices duplicated per face so each face stays a flat solid colour), one per-vertex `color` attribute carrying the face colour, and one `MeshPhongMaterial({ vertexColors: true, flatShading: true })`. Sentinel: 55 → 1 draw call.
  - **Fade animation rework**: initially shipped as a uniform body-fade (Step 3 first pass) — single `material.opacity` ramp, lost the bottom-up reveal. Restored in **Step 3.5** via shader patch (see below).
  - **Result**: orbit **60 FPS, 471 → 24 draws (-447)**, PLAYING **176 → 13 draws** (down to ~5 looking at sky). Triangle count unchanged (~2400) — same geometry, just merged.

- [x] **Step 3.5 — Restore per-face bottom-up fade via shader patch; add `dissolve` as third style.** Each merged geometry carries a per-vertex `fadeOffset` attribute (face rank by max-Y, normalised to [0, 1]). `MeshPhongMaterial.onBeforeCompile` injects vertex+fragment shader chunks that compute per-vertex alpha based on `fadeMode` (5 modes: READY, PER_VERTEX_IN, PER_VERTEX_OUT, UNIFORM_IN, UNIFORM_OUT) and `fadeProgress` (0–1). Each material owns its own uniforms (exposed via `material.userData.uniforms`). `Settings → Game → Animation` now cycles `fade` (per-face bottom-up reveal, restored) / `squash` (vertical stretch, unchanged) / `dissolve` (uniform body fade, the Step-3 first-pass behaviour, kept as a third style).

- ~~**Step 4 — Switch to `MeshLambertMaterial`**~~. Tried and reverted. Lambert's lack of specular flattened the terrain visibly — the orbiting sun's highlight on slopes is part of the look the user wants. Phong stays for both terrain and game objects (kept consistent across both for visual coherence). Specular tuning notes in `CLAUDE.md` remain valid.

- ~~**Step 5 — Instancing for repeated object types**~~. Skipped. Step 3 brought the scene well below the draw-call budget (24 orbit / 13 game) — there's no draw-call ceiling left to hit.

- [x] **Step 6 — Grid debug overlay merge.** All 1984 grid segments (2×31×32) now live in one `LineSegments` with a single `BufferAttribute` of positions; toggling `Settings → Display → Show grid` adds **1** draw call instead of ~2000. Built once per scene rebuild, registered with the disposer.

**Final numbers (level 0000, Ryzen 9 5900HX + RTX 3050 Laptop, Chrome, 1080p)**

| | Baseline | After 4.5 | Reduction |
|---|---|---|---|
| Orbit FPS | 40 | **60 (vsync)** | — |
| Orbit draws | 2393 | **24** | ~99% |
| PLAYING draws | 1117 | **5–13** | ~99% |
| Triangles | 2866 | 2400 | unchanged structurally |
| Grid-on draws | ~4400 | ~25 | merged in Step 6 |

The system is now firmly GPU-bound (vsync-capped) on a scene this small; CPU-side draw-call overhead is no longer the bottleneck.

**Exit criteria met**: 60 FPS locked on the reference machine. `renderer.info.render.calls` reads under 30 per frame in normal play, single-digit when looking at sky. No visual regression — `fade`, `squash`, and the new `dissolve` animation styles all behave correctly; specular highlights on terrain preserved (Phong kept).

---

### Phase 5 — Real UI

The old `Menu.svelte` was a debug tree with arrow-key navigation. Replaced with the proper UI surfaces below. The orbiting overview of the selected level remains visible across MENU, PAUSED, WON, LOST — overlays sit on top of it.

- [x] **Pause overlay + give-up, resolved via double-Escape.** The original two bullets here ("Escape pauses" and "Escape gives up") were contradictory as written. Resolved as: first Escape (PLAYING → PAUSED, unchanged — already worked via `onLockLost` → `pauseGame()`) shows `PauseOverlay.svelte` (dims the canvas, "Paused" caption + "Press ESC again to return to main title, or any other key to resume"). From PAUSED, a second Escape calls the new `giveUp()` in `game/state.svelte.ts` (bumps `game.levelEpoch`, phase → MENU — same rebuild as `completeLost()` minus the LOST hold/screen, since quitting isn't dying); any other key calls the existing `resumeGame()`. `loop.ts` already froze ticks/camera during PAUSED, so no engine changes were needed — this was purely a new presentational component + one state function.
  - **Bug found post-playtest (2026-07-06): alt-tabbing away from PAUSED could brick the game.** `PauseOverlay`'s "any other key resumes" treated a bare Alt/Cmd/Win press — the leading half of an OS window-switch shortcut — as a resume. That flipped phase to PLAYING and re-requested pointer lock an instant before the window actually lost focus; the request then failed, but nothing told the game so — it sat in PLAYING with no lock, no camera movement, no action handling, and (since `MainView`'s `onMouseDown` only acts when already locked) no way to click back in either. Only an F5 reload (losing state) recovered. Two fixes: `PauseOverlay.svelte` now ignores bare modifier keys (Alt/Control/Shift/Meta/AltGraph/OS) entirely; `engine/input.ts`'s `onPointerLockError` now routes through the same `onLockLost` callback a real lock loss uses, so *any* failed (re)acquisition falls back to PAUSED/MENU instead of leaving PLAYING/DEBUG stuck with a dead lock.
- [x] **Main menu (replaces the debug tree).** `MainMenu.svelte` (was `Menu.svelte`), only mounted during MENU. Top-level: **Start / Level: N, code: XXXXXXXX / Input level code / Settings**, keeping Settings nested in the same tree/keyboard-nav engine rather than splitting into its own file (less restructuring, tree already handled nesting fine). Fixed a real bug found in review: `condition()` now filters the list used for keyboard navigation and dispatch (`visibleMenu`/`focusedName`/`currentEntry`), not just rendering — previously a hidden entry (e.g. `levelId` while PAUSED, back when this tree still showed during PAUSED) could still be focused and triggered by arrow-key cycling. The `Level` line also displays the current landscape's code (`getLevelCode`) so codes are actually discoverable, not just enterable.
  - **Input level code**: local `codeInput`/`codeStatus` state in `MainMenu.svelte` swaps the tree view for a hex-digit entry line. Lookup lives in three-free `game/levelCodes.ts` (`findLevelByCode`/`getLevelCode`), canonicalized to the **`PC/ST`** code system (Atari ST — the platform the author actually played the original on) with fixed smooths=2/despikes=2 (ignores the user's debug generator settings, so codes stay stable). `generateLevel` is not cheap — timing `utils/all-levels.js`'s 10,000 sequential calls came in at ~14.5s in Node — so a miss can't be a single blocking loop. Two mitigations: (1) `findLevelByCode` scans in async chunks (yielding via `setTimeout`, cancellable via `AbortSignal`) so a bad code shows "Looking for your level..." and stays responsive instead of freezing the tab; (2) a shared cache is filled by a low-priority background trickle (`startBackgroundCodeIndexing`/`stopBackgroundIndexing`, `setInterval`-driven) that `MainMenu.svelte` starts on mount and stops on unmount, so it only ever runs while idling at the menu, never during play. A found code is added to `settings.levelIds` like any other unlocked level.
- [x] **Settings menu.** User-facing entries unchanged (mouse sensitivity, sound volume, animation style, rotation interval). Debug-gated subgroup, now consistently gated on `localStorage.debug` via `debug()`: Free roam (previously only gated on `game.phase === 'MENU'` — a gap closed as part of this rewrite), display toggles, generator toggles.
- [x] **Minimal in-game HUD.** `Hud.svelte` dropped the `#levelId` display (redundant now that the main menu shows it) and self-gates visibility to PLAYING/TRANSFER/PAUSED via a `$derived`. Low-energy warning implemented as a `requestAnimationFrame`-driven sine pulse (~1 Hz, 0.3–1.0 opacity) on the energy icons when `game.energy <= 3`.
- [x] **Help line.** New `HelpLine.svelte`, mounted from `App.svelte` only during PLAYING: key bindings (`R Synth · B Bldr · T Tree · U absorb · Space transfer · H hyperspace · Esc pause` — "give up" text corrected to "pause" per the double-Escape resolution above) and mouse bindings (`L absorb · M Synth · R Bldr`). The "hide during animations" nuance from the original bullet was skipped as premature per its own "can be a small toggleable affordance later" wording.
- [x] **Win / Lose screens.** `WinScreen.svelte` / `LoseScreen.svelte`, mounted for WON/LOST. **No timer** — after playtesting, the original 2s auto-advance (`WIN_LOSS_DELAY_MS`) felt like the screen vanished before it could be read, so it was dropped entirely; each screen's own `<svelte:window onkeydown>` calling `completeWon()`/`completeLost()` directly is now the *only* way to dismiss it (`WIN_LOSS_DELAY_MS` removed from `game/timing.ts`, `App.svelte`'s phase scheduler only still times TRANSFER). WinScreen reads `settings.levelId` + `game.energy` before `completeWon()` mutates them (the hyperspace's `spendEnergy(3)` already ran before `triggerWon()`, so `game.energy` at display time already IS the jump amount).
- [ ] **Gamepad support (stretch)**. Pointer-lock + WASD translates cleanly to right-stick + left-stick. Not attempted this pass.

**Exit criteria met (2026-07-05)**: `npm run check && npm run build && npm test` green. A first-time visitor can reach PLAYING without reading source code; the in-game UI holds nothing but the energy bar + a help line. Manual playthrough pending user confirmation (pause/resume/give-up, level cycling, level-code entry, debug-gated settings, WON/LOST screens).

---

### Phase 6 — Mobile / touch version

Superseded by [`PLAN-MOBILE.md`](./PLAN-MOBILE.md) (2026-07-07). The design pass that originally lived
here surfaced enough platform-specific complexity — pointer lock doubling as the phase machine's "am I in
control" signal with no touch equivalent, Android back-gesture data loss, iOS orientation-lock limits,
touch targeting precision on a 32×32 grid — to warrant a full roadmap of its own rather than one phase.
All of this section's content moved there, expanded into phases M0–M7, with the Galaxy Tab S6 Lite as
primary hardware target, broad Android as the general target, and iOS gated as an explicitly droppable
stretch goal.

---

### Phase 7 — Polish

Reviewed 2026-07-06 against the now-playable (probably completable) game.

- [x] **Action-cadence HUD cue**. Comfort tweak found during playtest: the player had no way to tell when the next create/absorb/transfer/hyperspace would be accepted. Added an 80px white borderless bar to `Hud.svelte`, fixed at ~2/3 screen width, shown during PLAYING **and** TRANSFER (a successful transfer starts the cooldown and phase immediately flips to TRANSFER for its ~1s camera move — the bar has to keep counting down through that or it looks like the cooldown never started; found and fixed post-playtest). It reads `game.lastActionAt`/`ACTION_COOLDOWN_MS` (the same clock `canPerformAction` gates on) via its own rAF loop and shrinks right-to-left (fixed `left`, shrinking `width`) from full to nothing over the 1 s cooldown — reads as a countdown to zero rather than a bar growing from a fixed right edge. Reverses the Phase 3.5 "no new HUD cue" call.
- [x] **Bird's-eye view** (2026-07-06, unplanned — a feature from later versions of the original game). A new `BIRDSEYE` phase, entered from PLAYING by left-clicking empty sky while looking up more than 30° (`engine/actions.ts:isBirdsEyeTrigger` — requires `pickTarget()` to return `null`, so a steep click that actually hits something still absorbs normally). `CameraController` runs the codebase's first scripted (non-cut) camera transition: a 1s ease-in-out flight to a fixed absolute overview (height 30, pitch −60°, yaw/FOV unchanged) with mouse input fully overridden for the duration, then hands back free two-axis look once settled. A left-click starts the same kind of flight back to the *exact* pre-trigger pose (position/yaw/pitch/FOV), discarding any look-around done at the top; either flight is interruptible by clicking again mid-transition. The game clock is paused for the entire round trip (`BIRDSEYE` is absent from `GameLoop`'s ticking phase list — Sentinel/Sentry/Meanie fully freeze), and the phase only returns to PLAYING once the fly-down completes (`completeBirdsEyeExit()`), not on the return click itself. Losing pointer lock mid-flight (alt-tab) snaps the camera back to ground before pausing, so it can't strand the view mid-air (same fix philosophy as the Phase 5 `PauseOverlay` alt-tab bug). `HelpLine.svelte` hints the new binding during PLAYING and swaps to "Click to return" during BIRDSEYE. Verified end-to-end with a headless Playwright smoke test (steep look-up → click → confirmed height/pitch/HUD text at settle → click → confirmed exact pose restored, zero console errors) plus visual screenshot review.
- [ ] **Audio**. Turn sound, create, absorb, error, hyperspace, alarm, ambient hum, win/lose stings. Web Audio API, no libraries needed. Respect `settings.soundVolume` — the setting exists in the menu today but has no effect yet.
- [x] **Visual effects**. Two priorities identified during the 2026-07-06 review, both done:
  - [x] **Body-transfer animation** (2026-07-06). `CameraController.beginTransferAnim`/`updateTransfer` ease the camera's position (col/row/height) from the old body to the new one over `TRANSFER_DELAY_MS` (1s, `easeInOutCubic`) — direction/vertical/FOV are never touched, so the camera keeps looking exactly the way it was (the old "look back at the previous synthoid" `lookAtCell` call is gone). The old body crossfades transparent→solid and the new body solid→transparent in lockstep (`camCtrl.transferProgress`), reusing the existing per-vertex fade shader via `setViewOpacity` — the same mechanism as the bird's-eye body reveal. `TRANSFER`'s return to `PLAYING` is now driven by the glide finishing (`engine/loop.ts` calls `completeTransfer()` once `updateTransfer` returns true), the same pattern as `completeBirdsEyeExit()` — replacing the old `App.svelte` `setTimeout`. No action or mouse-look is possible during the glide (`updateTransfer` drains mouse input without applying it; `TRANSFER` is its own branch in `loop.ts`, no longer sharing `updateLook` with `PLAYING`). Pausing mid-glide freezes it exactly like the rest of the game (`updateTransfer` is only called while pointer-locked, so it simply isn't called during `PAUSED`) and resuming continues it from exactly where it left off — `game.pausedFrom` (`'PLAYING' | 'TRANSFER'`) tracks which phase `resumeGame()` should restore, since a still-in-flight transfer must resume to `TRANSFER` (still blocking input) rather than `PLAYING`.
  - [x] **Particle effect on create/absorb** (2026-07-06, retuned twice same day post-playtest). New `engine/particles.ts`: a one-shot burst of small cubes rendered via a single `InstancedMesh` (one draw call), scattered along the object's own vertical bounding segment (`verticalExtent`, read from the merged mesh's bounding box — scales to each model's actual height rather than a guessed constant). `absorb`: cubes start on the segment and drift outward up to `BURST_RADIUS` while shrinking to nothing over `BURST_DURATION_MS` — colors are a uniform whitish "smoke" (`smokeColors`), independent of the absorbed type. `create` is the exact reverse: cubes start scattered out and converge onto the segment while shrinking — colors are sampled straight from the object's own merged-mesh vertex-color attribute (`sampleMeshColors`), so the burst matches whatever's materializing (tree greens/browns, synthoid yellow/black, ...) for free, no invented palette. *Retuned*: the first pass (16 particles, 0.12 cube size, 450ms, 2-cell radius, ease-out/ease-in distance curve) read as a cartoonish explosion/implosion, at odds with the Sentinel universe's more majestic, fearsome tone — playtest feedback asked for something evaporating/coalescing instead. First revision: 30 particles, 0.06 cube size, 900ms, 1-cell radius, ease-**in-out** distance curve for both modes. Second revision: `create` (already approved) kept the ease-in-out curve, but `absorb` still read as too fast/accelerating — its fast middle section has nothing at the far end to mask it (unlike `create`, where the fast middle is hidden by particles converging on and shrinking into the object), so `absorb`'s distance factor is now flat/linear (`t`, no easing) for a constant, unhurried drift. Geometry+material are shared per level build (`createParticleAssets`, registered with that build's `Disposer`), the same pattern as `engine/cones.ts`'s `coneAssets` — only the per-burst `InstancedMesh` itself (with its own `instanceColor`/`instanceMatrix`) is created/torn down per burst. Triggered from `engine/scene.ts`: `addObjectToScene` (creation burst, gated on `time > 0` — matches `GameObject`'s own date>0 spawn-animation gate, so initial level population stays instant) and `removeObjectFromScene` (absorb burst, on a successful removal), both additionally gated on `settings.particleEffects` (**Settings → Game → Particle effects**, default on) so players who want the original game's unadorned look can turn the whole thing off. Ticked once a frame in `engine/loop.ts` alongside `deferredSpawns`, unconditionally (real-time driven, not phase-gated — same as the existing body fade/squash animations). *Bug fixed*: creation bursts triggered by a keypress (R/B/T) never rendered, while mouse-triggered ones always did. Root cause: Three.js computes `InstancedMesh.boundingSphere` lazily on first render and never invalidates the cached value on later `setMatrixAt` calls; every instance starts at the identity matrix (all cubes stacked at world origin) until the burst's first `update()` call. Mouse clicks fire from a DOM handler between animation frames, so the particle-burst update loop in `engine/loop.ts` always runs before that frame's `render()` — first render sees real (already-positioned) matrices, so the cached sphere is correct. Keypresses are handled by `handleKeyActions`, which runs *after* that same update loop within one `tick()` — a burst spawned this way gets rendered once while still at the identity matrix, Three.js caches a tiny bounding sphere at world origin, and the mesh is silently frustum-culled for the rest of its life regardless of later `update()` calls repositioning it correctly. Fixed by setting `mesh.frustumCulled = false` in `spawnParticleBurst` — these bursts are tiny/short-lived/few at once, so skipping culling entirely is simpler and cheaper than keeping a manual bounding volume in sync every frame. *Third revision*: `create`'s ease-in-out (ramp up, then back down) still didn't feel right — asked to have particles start fast and slow down instead. `create`'s distance factor is now ease-**out** (`1 - easeOutCubic(t)`, i.e. `(1-t)³`): particles rush in from their scattered starting point and decelerate into a gentle stop at the object, rather than ramping up mid-flight. `absorb` is unchanged (still flat/linear). *Fourth revision*: with the 'squash' animation style (the default), the model grows from nothing at the base up to full height over roughly the same span as the burst — anchoring `create`'s particles across the *full* eventual height made them visibly converge into still-empty air above the currently-short, still-growing silhouette, which read as unnatural. `create`'s anchor points are now confined to the lower third of the segment (`CREATE_ANCHOR_SPAN = 1/3`), staying close to where the object actually has geometry for most of the animation. `absorb` still anchors across the full segment (the object is at full height when it starts departing).
  - Stretch, unprioritized: Sentinel detection red pulse, hyperspace warp effect.
- ~~**True volumetric watcher cones**~~. *Decision (2026-07-06): won't do.* The cones are a debug/dev feature (toggled via `localStorage.debug`), not a player-facing element — the current closed-wedge mesh already fills that role. Not worth the shader complexity for something players don't see.
- [x] **Sky / background**. Done — skybox textures per theme (`engine/skybox.ts`, the "Skybox <3" commit), superseding the plain navy body color this bullet was written against.
- ~~**Shadows**~~. *Decision (2026-07-06): won't do.* The sun orbits fast enough (`SUN_PERIOD_MS = 6000` in `loop.ts`) that cast shadows would sweep visibly within seconds — likely to read as a bug rather than atmosphere.
- [x] **Performance pass**. Done in Phase 4.5 — terrain merged to 4 draw calls, game objects to 1 mesh each, orbit went from 40 FPS/2393 draws to 60 FPS/24 draws. No further pass needed at this scene scale.

---

### Phase 8 — Endgame content & stats

The generator supports exactly 10,000 landscapes (0..9999) but nothing recognized reaching the end, tracked lifetime progress, or let a player intentionally start over. This phase closes the loop.

- [x] **Level-9999 cap**. `completeWon()` (`game/state.svelte.ts`) skips the jump/unlock step entirely when the landscape just won was 9999 (nowhere further to go); otherwise the jump is clamped with `Math.min(settings.levelId + jump, 9999)`.
- [x] **Lifetime stats module**. New `game/stats.svelte.ts`, persisted to its own `localStorage` key (`'stats'`), mirroring `settings.svelte.ts`'s `load`/`save` pattern. Tracks `deaths`, `victories`, `transfers`, `hyperspaceCount` (voluntary H-key hyperspace only — Meanie-forced teleports are deliberately excluded), `absorbed.{tree,sentry,sentinel,meanie}` (boulder/synthoid excluded), `gameCompletions`, and the `completedGameThisRun` guard (a win on 9999 only bumps `gameCompletions` once per run — replaying 9999 without resetting doesn't inflate it).
- [x] **"Game Completed" win screen**. `WinScreen.svelte` branches three ways: normal (unchanged), capped-jump (an encouraging line when a jump would have overshot 9999), and final-level (title "Game Completed", no next-landscape line, a stat block: landscapes unlocked as a proxy for jumps taken, per-type absorb counts, transfers, hyperspace jumps, deaths, completion count).
- [x] **"Reset progress" menu item**. `MainMenu.svelte`, always visible under Settings (not debug-gated). Confirm-before-acting, same local-mode pattern as the existing "Input level code" flow. Calls `resetProgress()` (`game/state.svelte.ts`), which relocks levels (`levelId`/`levelIds` back to `[0]`) and calls `resetStats()` — which clears every stat **except** `gameCompletions`, intentionally preserved across resets.
- [x] **Replayability scaling**. Sentinel/Sentry rotation period compounds 5% faster per game completion (`world/objects/watcher.ts`: `turnPeriodTicks = TURN_PERIOD_TICKS * 0.95^gameCompletions`, computed per-instance at construction). Meanie rotation speed is unaffected.

**Exit criteria**: `npm run check && npm test && npm run build` green (new coverage in `game/stats.test.ts` and `game/state.test.ts` for the cap, the final-level branch, and the once-per-run completion guard). **Pending**: manual browser confirmation of the two new `WinScreen` variants and the "Reset progress" confirm flow — see the note below for the fastest way to reach landscape 9999 without a real 10,000-level playthrough.

**Manual test shortcut**: reaching level 9999 legitimately takes a long time. Fastest path: in devtools, `localStorage.setItem('state', JSON.stringify({...JSON.parse(localStorage.getItem('state')), levelId: 9999, levelIds: [0, 9999]}))`, reload, Start, then win the level (absorb Sentinel → place Synthoid on pedestal → transfer → hyperspace) to see the "Game Completed" screen. Use `levelId: 9990`-ish with a big energy pool for the capped-jump message.

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
