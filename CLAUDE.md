# SenTynel

Personal, educational reimplementation of Geoff Crammond's *The Sentinel* (1986) in the browser. Currently a terrain-generation + rendering proof-of-concept — the goal is a playable game. Full roadmap and decisions live in `PLAN.md`; read it before any significant work.

See `README.md` for the pitch, preview screenshot, and credits (terrain generation is ported from Simon Owen's Python `sentland`).

## Tech stack

- **Svelte 5** (runes) + **TypeScript 5.9** — `@tsconfig/svelte` v5 as base, `"strict": true`.
- **Vite 7** build (`vite.config.ts`), dev server with HMR, outputs to `dist/` (not committed).
- **Three.js 0.184** — latest; color management at the sRGB default, specular values re-tuned to compensate (see *Three.js notes* below).
- **`@sveltejs/vite-plugin-svelte` v6** with `vitePreprocess` (handles TS in `<script lang="ts">`).
- **vitest 4** — test runner, co-located tests (`foo.ts` ↔ `foo.test.ts`). Not TDD; used as a regression safety net.
- Formatting: Prettier (`.prettierrc`: tabs, 120 cols, single quotes, trailing commas `es5`, `svelteSortOrder: scripts-markup-styles`). No linter beyond `svelte-check`.
- Zero npm audit findings.

## Run / build

```
npm ci              # install
npm run dev         # Vite dev server with HMR
npm run build       # production bundle to dist/
npm run preview     # serve the built dist/ locally
npm run check       # svelte-check
npm test            # vitest run (all *.test.ts)
npm run test:watch  # vitest watch mode
```

`dist/` is gitignored. There is no committed build output.

## Source layout (`src/`)

```
src/
  main.ts               Svelte entry — mount() App to document.body
  App.svelte            Top-level; composes MainView, Hud, and a phase-keyed overlay
                        (HelpLine/MainMenu/PauseOverlay/WinScreen/LoseScreen); calls
                        load() from settings; owns the phase scheduler ($effect that
                        drives complete{Transfer,Won,Lost}).
  settings.svelte.ts    Runes-based persistent settings (load/save to localStorage)

  ui/
    MainView.svelte     Canvas host; wires engine modules together. ~265 lines: Effect 1
                        (engine lifecycle), Effect 2 (scene rebuild), Effects 3a–3d
                        (game-start/debug-entry camera snap, post-transfer choreography,
                        pointer-lock acquire/release, watcher-cone visibility toggle).
    Hud.svelte          Energy icons only. Self-gates visibility to PLAYING/TRANSFER/
                        PAUSED; rAF-driven sine pulse on the icons when energy <= 3.
                        Also owns the action-cooldown bar (PLAYING + TRANSFER — a
                        successful transfer starts the cooldown and must keep showing
                        it through the ~1s camera move, unlike PAUSED which excludes
                        it): an 80px borderless white bar at ~2/3 screen width, that
                        reads lastActionAt/ACTION_COOLDOWN_MS via its own rAF loop and
                        shrinks right-to-left (anchored by `left`, not `right`, so the
                        shrinking width recedes toward the fixed left edge) to nothing
                        over the 1s cooldown.
    MainMenu.svelte      Arrow-key-driven menu tree (was Menu.svelte). Only mounted
                        during MENU: Start / Level: N, code: XXXXXXXX / Input level
                        code / Settings (Settings nested in the same tree). condition()
                        filters both rendering AND keyboard nav/dispatch via
                        visibleMenu/focusedName/currentEntry. "Input level code" swaps
                        the tree view for a hex input backed by game/levelCodes.ts.
                        Settings' last entry, "Reset progress" (always visible, not
                        debug-gated), uses the same local-mode pattern (confirmingReset)
                        to show a confirm/cancel line before calling
                        game/state.svelte.ts's resetProgress().
    PauseOverlay.svelte  Shown during PAUSED. Dims the canvas, "Paused" caption. Own
                        keydown: Escape -> giveUp() (second Escape, see Game phases),
                        any other non-modifier key -> resumeGame(). Bare Alt/Control/
                        Shift/Meta/AltGraph/OS are ignored — they're the leading half
                        of an OS window-switch shortcut, not a deliberate resume.
    WinScreen.svelte     Shown during WON. Own keydown calls completeWon() directly
                        (App.svelte's timeout effect cleans itself up when phase changes).
                        Three branches: normal ("Landscape Complete" + jump/next line),
                        capped (next would exceed 9999 — capped-at-9999 message plus an
                        encouraging line), final (settings.levelId === 9999 — "Game
                        Completed" title, a stats.svelte.ts-driven summary instead of a
                        next-landscape line: landscapes unlocked, per-type absorb counts,
                        transfers, hyperspace jumps, deaths, completion count).
    LoseScreen.svelte    Shown during LOST. Same pattern, calls completeLost().
    HelpLine.svelte      Two static lines of key/mouse bindings, mounted only during
                        PLAYING.
    icons.ts            Base64 PNGs for HUD energy icons.

  engine/                              # Three.js-backed render + game-loop layer
    renderer.ts         WebGLRenderer + rAF loop (RendererManager)
    scene.ts            buildScene + addObjectToScene/removeObjectFromScene/canPlaceAt/
                        objectsAt/topObjectAt. Owns SceneData (incl. coneAssets and
                        deferredSpawns queue) and the boulder-rotation alternation rule.
                        Terrain is merged into 4 meshes (per material — planeEven/Odd,
                        slopeEven/Odd) via BufferGeometryUtils.mergeGeometries; debug grid
                        is one LineSegments. Picker/visibility derive (col, row) from the
                        world-space hit point for terrain hits (kind:'terrain' on userData).
    camera.ts           CameraController — free-flight (DEBUG), look-only (PLAYING),
                        transfer glide (TRANSFER), orbit (MENU/WON/LOST), and bird's-eye
                        (BIRDSEYE). EYE_HEIGHT = 0.875 above feet/terrain.
                        enterBirdsEye/exitBirdsEye/cancelBirdsEye/updateBirdsEye drive a
                        scripted 1s ease-in-out fly to/from a fixed absolute height
                        (BIRDSEYE_HEIGHT=20) and pitch (-60°) — yaw carries through
                        unmodified during the scripted move (only height/pitch/FOV
                        interpolate; see lerpAngle for the shortest-path wraparound used on
                        the return leg). Free mouse-look resumes once settled at the top;
                        birdsEyeExitComplete is a one-shot flag GameLoop consumes to flip the
                        phase back to PLAYING once the fly-down finishes.
                        beginTransferAnim/updateTransfer (see Transfer under Engine / rules
                        summary) ease posCol/posRow/posHeight from the old body to the new
                        one over TRANSFER_DELAY_MS via the shared eyeHeightFor helper
                        (also used by resetToPosition); direction/vertical/fov are never
                        touched. `elapsed` accumulates via dt rather than an absolute start
                        timestamp, so it's only called (engine/loop.ts) while phase ===
                        'TRANSFER' and naturally freezes during PAUSED (no pointer lock)
                        instead of needing explicit pause handling.
    input.ts            InputManager — keyboard state, mouse delta, pointer-lock lifecycle.
                        onLockLost fires on both an actual lock loss AND a failed
                        (re)acquisition (pointerlockerror) — callers must not assume
                        "was locked" before reacting.
    loop.ts             GameLoop — per-frame play(), 4 Hz TurnDriver, 1 Hz drain phase via
                        watcher.ts, per-tick meanie phase via meanie.ts, deferredSpawns,
                        sun orbit, render, stat callbacks. BIRDSEYE calls
                        cc.updateBirdsEye() instead of updateLook(), and calls
                        completeBirdsEyeExit() once cc.birdsEyeExitComplete flips true.
                        TRANSFER calls cc.updateTransfer(dt) instead of updateLook(), and
                        calls completeTransfer() once it returns true (the glide reached the
                        target) — replacing the old App.svelte setTimeout, the same
                        camera-drives-the-phase pattern as BIRDSEYE.
    picker.ts           pickTarget(camera, sceneData) → discriminated Pick: 'object' (with
                        gameObject back-ref) or 'terrain' ('plane'/'slope'). Skips
                        userData.skipRaycast meshes (the cone overlays).
    visibility.ts       isCellVisibleFrom(eyePos, …, fromCol?, fromRow?) — raycast LOS.
                        isCellVisible(camera, …) is a thin wrapper. Skips skipRaycast meshes.
    actions.ts          Engine wire-up: builds an ActionContext from sceneData + camera,
                        calls into game/actions.ts for player-driven actions. Holds
                        handleKeyActions, handleMouseAction, and the DEBUG handleClick.
                        isBirdsEyeTrigger(camera, sceneData, cameraVertical) is the bird's-eye
                        gate — a steep look (>30°) combined with pickTarget() returning null
                        (true empty sky, not just "nothing absorbable"); MainView.svelte
                        checks it before dispatching a PLAYING left-click to handleMouseAction.
    cones.ts            Watcher view-cone debug overlay — closed wedge geometry, shared
                        material. createConeAssets, attachConeMesh.
    particles.ts        Create/absorb particle burst — 30 tiny cubes on one shared
                        InstancedMesh (one draw call) per burst. createParticleAssets
                        builds the shared cube geometry+material once per buildScene() call
                        (Disposer-registered, same pattern as coneAssets). spawnParticleBurst
                        scatters particles along verticalExtent(mesh) (the object's own
                        bounding-box height, not a guessed constant): 'absorb' starts them on
                        the segment and drifts them outward up to 1 cell over 900ms at a flat,
                        constant pace (no easing — nothing at the far end to mask an eased
                        curve's faster middle section, so any acceleration there reads as a
                        burst rather than a drift) while shrinking to nothing (smokeColors —
                        uniform whitish, type-independent); 'create' is the exact reverse
                        (scattered → converge onto the segment) using an ease-out distance
                        curve instead (1 - easeOutCubic(t), i.e. (1-t)^3 — particles rush in
                        from their scattered start and decelerate into a gentle stop), anchored
                        only across the lower third of the segment (CREATE_ANCHOR_SPAN = 1/3 —
                        the 'squash' spawn animation grows the model from the base up over
                        roughly the same span as the burst, so anchoring across the full
                        eventual height made particles converge into still-empty air above the
                        still-growing silhouette), colored via sampleMeshColors (sampled
                        straight from the object's own merged-mesh vertex-color attribute, so
                        the burst matches whatever's materializing for free). See PLAN.md's
                        Phase 7 for the retuning notes and
                        the frustumCulled=false fix (keypress-triggered bursts were rendered
                        once at their pre-update() identity-matrix pose before Three.js could
                        ever see their real positions, permanently caching a wrong
                        InstancedMesh.boundingSphere and silently culling them thereafter).
                        Both trigger sites additionally check settings.particleEffects
                        (Settings → Game → Particle effects, default on). Triggered from
                        engine/scene.ts's addObjectToScene (gated on time>0, mirroring
                        GameObject's own spawn-animation gate) and removeObjectFromScene;
                        ticked every frame in engine/loop.ts alongside deferredSpawns.
    watcher.ts          1 Hz drain phase (Sentinel + Sentry). Per-cell drain target,
                        animated absorb-then-spawn (animationScale=2, deferredSpawns),
                        meanie-conversion trigger, conservation-tree spawn, rotation lock.
    meanie.ts           triggerMeanieConversion (closest tree → animated meanie spawn) +
                        runMeaniePhase (per game tick during PLAYING: rotate toward
                        player, on LOS force a hyperspace via drainEnergy + teleport).
    disposer.ts         Disposer class — GPU resource registry, disposeAll()
    fonts/
      Font.ts           Vendored+trimmed from Three.js examples
      TextGeometry.ts   Vendored+trimmed from Three.js examples
      fixed_v01_Regular_minimal.js   Glyph data (only glyphs we use); .d.ts sidecar present
    visibility.test.ts  LOS unit tests (height check, blocker mesh)

  game/                                # Pure game rules — no `three` value imports at runtime
    state.svelte.ts     game phase state machine, energy economy. Functions:
                        startGame/pauseGame/resumeGame/enterDebug/returnToMenu/endGame,
                        beginTransfer/completeTransfer, triggerWon/completeWon,
                        triggerLost/completeLost, giveUp (second-Escape quit from
                        PAUSED), spendEnergy/gainEnergy/drainEnergy,
                        canPerformAction (1 Hz action cadence gate),
                        markFirstAction (watcher dormancy gate),
                        markSentinelAbsorbed (per-level absorb lock),
                        resetProgress (relocks levels, delegates to stats.svelte.ts's
                        resetStats). completeWon() caps the jump at landscape 9999 and
                        skips the unlock step entirely when 9999 itself was just won —
                        there's nowhere further to jump. triggerWon()/triggerLost() also
                        bump stats.victories/deaths (and, on a 9999 win,
                        stats.gameCompletions — once per run, see stats.svelte.ts).
                        enterBirdsEye() (PLAYING → BIRDSEYE) and completeBirdsEyeExit()
                        (BIRDSEYE → PLAYING, called only once the camera's fly-down
                        finishes — see engine/camera.ts) gate the bird's-eye view.
                        completeTransfer() (TRANSFER → PLAYING) is likewise only called once
                        the camera's transfer glide finishes (engine/loop.ts, driven by
                        CameraController.updateTransfer). pauseGame() also accepts BIRDSEYE
                        and TRANSFER as source phases, recording which one in
                        game.pausedFrom ('PLAYING' | 'TRANSFER' — BIRDSEYE maps to
                        'PLAYING', its camera state is already reset to ground by the time
                        pauseGame() runs) so resumeGame() restores the right phase — a
                        still-in-flight transfer glide (frozen while PAUSED, since
                        updateTransfer isn't called without pointer lock) resumes back into
                        TRANSFER rather than PLAYING, so it keeps blocking input until it
                        actually finishes.
    stats.svelte.ts     Lifetime stats, persisted to their own localStorage key ('stats'),
                        same load/save shape as settings.svelte.ts. deaths, victories,
                        transfers, hyperspaceCount (voluntary H-key only — Meanie-forced
                        hyperspace is excluded), absorbed.{tree,sentry,sentinel,meanie}
                        (boulder/synthoid excluded), gameCompletions, and the
                        completedGameThisRun guard (caps gameCompletions at +1 per run
                        even if landscape 9999 is replayed without a reset).
                        recordAbsorb(type) is the single choke point for absorb counting
                        (mirrors rules.ts's ENERGY_COST/energyCostOf pattern).
                        resetStats() clears everything except gameCompletions, which a
                        "Reset progress" is meant to preserve.
    actions.ts          performTargetedAction + performHyperspace + pickHyperspaceTile.
                        Operates through an ActionContext interface — engine/actions.ts
                        injects place/remove/visibility callbacks so this module never
                        loads three. Per-action canPlace gate replaces the older
                        spend → place → refund pattern. Also the choke point for three
                        lifetime stats (stats.svelte.ts): recordAbsorb() on a successful
                        absorb, stats.transfers++ on a successful transfer,
                        stats.hyperspaceCount++ in performHyperspace() (voluntary H-key
                        only, excluding the pedestal/WON path — Meanie-forced hyperspace
                        in engine/meanie.ts is deliberately not counted).
    levelCodes.ts       findLevelByCode(code) — scans generateLevel(0..9999) for a
                        PC/ST (Atari ST) code match, async-chunked + cancellable
                        (AbortSignal) since a miss means the full range.
                        startBackgroundCodeIndexing/stopBackgroundIndexing fill a
                        shared cache while idling at MainMenu so most lookups hit
                        instantly instead of scanning. getLevelCode(id) is the cheap
                        single-level lookup MainMenu uses to show "Level: N, code: ...".
    rules.ts            ENERGY_COST table and energyCostOf().
    turn.ts             TurnDriver — accumulator-based 4 Hz tick over rAF dt.
    timing.ts           TRANSFER_DELAY_MS = 1000, ACTION_COOLDOWN_MS = 1000. WON/LOST
                        have no timer — WinScreen/LoseScreen dismiss on keypress only.
    log.ts              Lightweight console.debug-based event logger.
    stats.test.ts       Unit coverage for recordAbsorb/resetStats/load-save round-trip.
    state.test.ts       Unit coverage for completeWon's 9999 cap + final-level skip and
                        the once-per-run gameCompletions guard.

  world/                               # Pure landscape + GameObject classes
    terrain.ts          Landscape generator — 1:1 port of Simon Owen's sentland Python.
                        BigInt 40-bit RNG, smoothing, despiking, object placement, codes.
                        Exports MAP_SIZE = 32 (fixed throughout the engine).
                        DO NOT touch casually: terrain.test.ts guards fingerprint parity.
    terrain.test.ts     Snapshot regression tests for levels 0 and 1 + structural checks
    objects/
      index.ts          Barrel re-export of all object classes
      base.ts           GameObject base class. Owns spawn/absorb animations (playFade
                        drives the shader fadeMode/fadeProgress uniforms for both 'fade'
                        and 'dissolve' styles; playSquash animates scale.y for 'squash'),
                        animationScale multiplier (watcher drains use 2×), faceTowards
                        helper, and the userData = { gameObject, col, row } back-reference.
                        object3D is the merged Mesh returned by getObject (was: a Group
                        of per-face Meshes, pre-Phase-4.5).
      watcher.ts        Watcher base class — periodic turn animation gated on
                        game.firstActionTaken and drainLocked, cone-mesh visibility.
                        Sentinel and Sentry both extend this directly (siblings, not a
                        Sentry-extends-Sentinel chain) so `instanceof Watcher` reads as
                        the intended "either kind of watcher" check. Rotation period is
                        computed per-instance at construction from stats.svelte.ts's
                        gameCompletions — compounds 5% faster per completed game
                        (turnPeriodTicks = TURN_PERIOD_TICKS × 0.95^gameCompletions), a
                        replayability incentive. Meanie rotation (engine/meanie.ts) is
                        unaffected.
      sentinel.ts       Sentinel — thin Watcher subclass, static type = SENTINEL.
      sentry.ts         Sentry — thin Watcher subclass, static type = SENTRY.
      synthoid.ts       Synthoid stub
      boulder.ts        Boulder stub
      tree.ts           Tree stub
      pedestal.ts       Pedestal stub
      meanie.ts         Meanie stub (behaviour lives in engine/meanie.ts, since it needs
                        scene access for LOS).
      models/
        index.ts        Model registry — getObject(type, options) returns a single Mesh
                        per object (merged BufferGeometry with per-vertex color +
                        fadeOffset attributes; one MeshPhongMaterial whose shader is
                        patched via onBeforeCompile to drive the fade animation through
                        the FadeUniforms exposed on material.userData.uniforms). Face/Model
                        interfaces and the FADE_MODE_* constants live here too.
        sentinel.ts     Raw vertex/face data
        sentry.ts       Raw vertex/face data
        synthoid.ts     Raw vertex/face data
        boulder.ts      Raw vertex/face data
        tree.ts         Raw vertex/face data
        pedestal.ts     Raw vertex/face data
        meanie.ts       Raw vertex/face data
```

`utils/obj-shrink.js` is a one-off ESM Node script to deduplicate vertices in `.obj` exports (not part of the build).

`public/` holds only `favicon.png` — Vite copies it to `dist/` at build time.

## State / reactivity conventions

Svelte 5 runes are used throughout:

- Component-local reactive values: `let x = $state(...)`.
- Derivations: `const y = $derived(...)` or `$derived.by(() => {...})`.
- Side effects: `$effect(() => {...})` (replaces Svelte 4 `$:`).
- DOM refs: `let el: HTMLCanvasElement | null = $state(null)` + `bind:this={el}`.
- Event handlers: modern `onclick={handler}` style. Call `e.preventDefault()` inside the handler — no `|preventDefault` modifier.
- Module-level `$state` requires the file to end in `.svelte.ts` (or `.svelte.js`). Regular `.ts` files cannot use runes.
- Don't read a `$state` variable in the same `$effect` that writes it — this schedules infinite re-runs. Keep engine lifecycle (canvas-only Effect 1) separate from scene rebuilds (settings-driven Effect 2) as in `MainView.svelte`.

Don't reintroduce `svelte/store`. Writable stores still work in Svelte 5, but new code goes through runes.

## Three.js notes

- **Y-up**: `position.x = col`, `position.y = height`, `position.z = (MAP_SIZE-1) - row`. Camera default up vector (`0,1,0`). All scene code uses this convention — do not reintroduce Z-up.
- World Z range is `[0, MAP_SIZE-1]` (non-negative). Moving "north" (row decreasing) increases world Z.
- Map is a flat `number[]` of size `MAP_SIZE*MAP_SIZE`; index with `row*MAP_SIZE + col`. `MAP_SIZE` is a fixed constant (32) exported from `world/terrain.ts`; never thread it as a parameter outside that module's internals.
- Heights are integers 1–11. Tile shape codes are 4-bit (see `tileShape` in `world/terrain.ts`).
- Rotations stored as 0–255 (original game's 256-step circle); `angle256ToRad` in `world/objects/base.ts` converts. Models face +Z locally: world forward = `(sin(θ), 0, cos(θ))`.
- Stacking: only a single `Pedestal` (one item allowed on top) or an all-`Boulder` stack (one item — boulder, tree, or synthoid — allowed on top). `engine/scene.ts:canPlaceAt` is the predicate; `addObjectToScene` re-applies the same rule. `canPlaceAt` additionally takes the `GameObjType` being placed and rejects anything but a Synthoid on a bare (item-less) Pedestal — once the Sentinel is absorbed, absorb is locked for the rest of the level, so a Boulder or Tree placed there instead would be a permanent, unrecoverable dead end. This type gate only applies to the player-action path (`game/actions.ts`'s `create-*` handlers); level loading and DEBUG free placement call `addObjectToScene` directly and are unaffected. Boulders alternate orientation through a stack: every odd-positioned boulder is rotated 45° (detected via fractional altitude). `isCellVisibleFrom` (raycast from arbitrary eye) is the LOS primitive shared by player absorption, watcher detection, and meanie LOS.
- **Color space & lighting**: Three.js 0.184 defaults to sRGB output with linear lighting math. The scene was tuned to preserve the original look **without legacy flags**:
  - `AmbientLight` intensity `0.7` compensates for the linear darkening.
  - `PointLight(color, 0.4, 0, 0)` — `distance=0, decay=0`. `decay=0` is critical: the physical inverse-square default would collapse the sun's contribution to near-zero at its ~30-unit distance.
  - `MeshPhongMaterial.specular` values were doubled-ish: `0x404040` → `0x808080`, `0xa0a0a0` → `0xcfcfcf`. The specular hex is sRGB-interpreted and converted to linear, approximately squaring the effective value. Keep this compensation in mind when touching materials.

## Current state / known unfinished bits

Phases 1–4 complete (Phase 4's save/load checkpoint deliberately dropped). Phase 4.5 (3D rendering optimization) complete: terrain merged to 4 meshes, game objects merged to 1 mesh each via shader-driven fade, debug grid merged to 1 LineSegments — orbit went from 40 FPS / 2393 draws to 60 FPS / 24 draws. Phase 3.5 (1 Hz player action cap + remove the in-cone scale pulse) complete. Phase 5 (real UI: pause/give-up, main menu + level codes, minimal HUD, help line, win/lose screens) implemented, pending a full manual playtest. Phase 8 (endgame content: level-9999 cap, lifetime stats, "Game Completed" screen, "Reset progress", per-completion rotation speedup) implemented, pending manual visual confirmation of the new WinScreen variants and reset flow (reaching landscape 9999 legitimately takes a full playthrough — see PLAN.md's Phase 8 section for a `localStorage`-based shortcut). Phase 6 (mobile/touch design pass) and Phase 7 (polish) remain open. Authoritative list is `PLAN.md`.

Engine / rules summary:
- `game/state.svelte.ts`: state machine, energy economy (`spendEnergy`, `gainEnergy`, `drainEnergy`, `floorEnergyForPedestalHyperspace`), watcher dormancy flag (`firstActionTaken` + `markFirstAction`), action cadence gate (`lastActionAt` + `canPerformAction`, `ACTION_COOLDOWN_MS = 1000` in `game/timing.ts`), Sentinel absorb lock, transfer/win/lost trigger + complete pairs. `levelEpoch` counter forces a same-`levelId` scene rebuild after LOST.
- `game/actions.ts`: pure rules layer. `performTargetedAction`, `performHyperspace`, `pickHyperspaceTile`. Operates through an `ActionContext` interface so the rules code carries no `three` value imports at runtime — `engine/actions.ts` builds the context from sceneData + camera per action.
- Action cadence cap: `engine/actions.ts`'s `handleKeyActions`/`handleMouseAction` check `canPerformAction(time)` (pure, `game/state.svelte.ts`) once a valid target/key is identified, matching the watchers' 1 Hz tempo. `performTargetedAction`/`performHyperspace` (`game/actions.ts`) now return whether the action actually took effect; only a `true` result calls `markActionPerformed(time)` to start the cooldown. A failed attempt (no target, blocked placement, insufficient energy) leaves `lastActionAt` untouched, so it can be retried immediately — only real actions are rate-limited. Transfer/hyperspace are additionally self-limiting via the TRANSFER phase. `Hud.svelte`'s cooldown bar visualizes the same `lastActionAt`/`ACTION_COOLDOWN_MS` window.
- `engine/picker.ts`: shared raycaster — returns a discriminated `Pick` ('object' with a `gameObject` back-ref, or 'terrain' with 'plane'/'slope'). Cone overlays carry `userData.skipRaycast` and are filtered out.
- `engine/visibility.ts:isCellVisibleFrom`: optimistic — corner is reached unless a non-skipped hit is closer than `target − EPS`. Skips invisible objects (the player's hidden active body), target-cell + source-cell hits, and skipRaycast meshes.
- `engine/watcher.ts:runDrainPhase`: 1 Hz drain phase over Sentinel + Sentry. Per cell, the topmost Synthoid/Boulder is the drain target — a tree shields nothing, but a tree on a boulder is itself drainable. Synthoid → Boulder and Boulder → Tree morph in-place via a 500 ms absorb + 500 ms deferredSpawn at `animationScale=2`. Tree drain just removes; conservation tree spawns elsewhere on every successful drain. Caps: ≤1 action per watcher and ≤1 drain per item per tick. `Watcher.drainLocked` freezes the rotation timer while the watcher has something to drain (rotation resumes on the first idle tick).
- `engine/meanie.ts`: per-game-tick rotation toward the player; on LOS, `forceHyperspace` (drains 3, teleports to a random eligible tile via `pickHyperspaceTile` + `beginTransfer`). `triggerMeanieConversion` runs on a watcher seeing the body but not the tile — closest tree → animated Meanie at the same drain pacing.
- Player-pool drain: when a watcher targets the active body and the tile is visible, `drainEnergy(1, 'watcher-pool')` + a 200 ms red-border canvas flash (driven by `game.drainPulseAt`).
- Active body is hidden (`visible=false`) on game start and each transfer. Old body becomes visible again on transfer and faces the new body via `GameObject.faceTowards`.
- Transfer: `beginTransfer` sets phase=TRANSFER and `MainView.svelte`'s Effect 3b calls `CameraController.beginTransferAnim(col, row, objectHeight?)`, which eases the camera's position (not orientation/FOV) from wherever it currently is to the new body's eye position (correct height for the boulder-stack case, via the same `eyeHeightFor` helper `resetToPosition` uses) over `TRANSFER_DELAY_MS` (1 s, `easeInOutCubic`). The old body crossfades transparent→solid and the new body solid→transparent in lockstep with the glide (`camCtrl.transferProgress`, consumed by `MainView`'s per-frame `onStats` callback via `GameObject.setViewOpacity` — the same fade shader bird's-eye uses), and the old body's model still rotates to face the new one (`faceTowards`) — but the camera itself is never re-aimed at it (the old "look back" `lookAtCell` call is gone: direction/vertical/fov stay exactly as they were before the transfer). Mouse-look and all actions are blocked for the whole glide (`updateTransfer` drains mouse delta without applying it; `TRANSFER` is its own branch in `engine/loop.ts`, no longer sharing `updateLook` with PLAYING). `engine/loop.ts` calls `completeTransfer()` (TRANSFER → PLAYING) once `updateTransfer` reports the glide finished — no separate timer. Pausing mid-glide freezes it exactly like the rest of the game (`updateTransfer` only runs while pointer-locked, so it's simply not called during PAUSED) and resuming continues it from exactly where it left off — see `pausedFrom` under Game phases below.
- Hyperspace: spends 3, then either triggers WON (active body on a pedestal) or places a fresh synthoid on a random eligible tile and transfers. Forced hyperspace (Meanie) uses `drainEnergy` instead of `spendEnergy` so it can push to LOST. The pedestal/WON path is let through even when the 3-energy spend is refused, and also floors the exact-3 case (spend succeeds, 0 left) — `game/state.svelte.ts`'s `floorEnergyForPedestalHyperspace()` sets `game.energy` to 1 so `completeWon()`'s jump is never zero. Without the first part, a player who reaches the pedestal on fewer than 3 energy would be permanently stuck (absorb is already locked post-Sentinel, so there'd be no way left to earn the energy back); without the second, arriving with exactly 3 energy would jump 0 landscapes while arriving with less (floored to 1) jumps 1 — a worse arrival outjumping a better one.
- LOST: any `spendEnergy`/`drainEnergy` driving energy strictly below 0 → LOST → 2 s hold → `levelEpoch++` → MENU. Same level rebuilds.
- WON: hyperspace-from-pedestal → keypress-only (no timer) → `completeWon()` caps the jump at landscape 9999 (`Math.min(settings.levelId + remainingEnergy, 9999)`) and skips the jump/unlock step entirely when 9999 itself was just won (nothing further to unlock); otherwise appends the new `settings.levelId` to `settings.levelIds` (unlocked list) and `save()`s → MENU. `triggerWon()` also bumps `stats.victories` (and, on a 9999 win, `stats.gameCompletions` — once per run) before the phase flips to WON; see `stats.svelte.ts`.
- WON/LOST release pointer lock; the orbit camera takes over under the themed `WinScreen`/`LoseScreen` overlay. Scripted camera movement (vs. the current plain orbit) is still future Phase 7 polish.
- Bird's-eye view: the first scripted (non-cut) camera transition in the codebase — `CameraController`'s `enterBirdsEye`/`exitBirdsEye`/`updateBirdsEye` ease height/pitch/yaw/FOV over 1s via `lerp`/`lerpAngle` (shortest-path) + `easeInOutCubic`, fully overriding mouse input for the duration so it can't fight the script. Free look resumes only once settled. See "BIRDSEYE" under Game phases below for the full flow.
- Three animation styles for spawn/absorb, cycled via Settings → Game → Animation: `fade` (per-vertex bottom-up reveal / top-down absorb, driven by the merged mesh's shader patch via per-vertex `fadeOffset` attribute + `fadeMode`/`fadeProgress` uniforms), `squash` (stepped vertical scale, easeIn — default), `dissolve` (uniform body opacity ramp through the same shader patch). Watcher drains run at `animationScale=2` regardless of style.
- Create/absorb particle burst (`engine/particles.ts`), independent of the animation style above: 30 tiny cubes on one `InstancedMesh`, scattered along the object's actual height (`verticalExtent`), up to 1 cell out over 900ms while shrinking to nothing. Absorb bursts drift outward at a flat, constant pace (whitish smoke — no easing, a fast launch there would have nothing to mask it); creation bursts start scattered and converge inward on an ease-out curve (rush in, decelerate into place), colored from the object's own vertex-color palette. Fires from `engine/scene.ts`'s `addObjectToScene`/`removeObjectFromScene`, gated the same way as the body animation (`time > 0`, i.e. not on initial level population) and additionally on `settings.particleEffects` (Settings → Game → Particle effects, default on — players who want the original game's unadorned look can turn it off entirely).
- Watcher cone debug overlay: closed wedge mesh, additive transparent. Toggle via Settings → Display → Show watcher cones (debug-gated). Apex at the watcher's eye line; bottom extended below ground and clipped visually by terrain depth-test.

## Controls

**PLAYING mode** (pointer locked):
- Mouse: look around.
- Left-click: absorb targeted object (same as `U`).
- Middle-click: create Synthoid (same as `R`).
- Right-click: create Boulder (same as `B`).
- `R`: create Synthoid on targeted tile (−3 energy).
- `B`: create Boulder on targeted tile (−2 energy).
- `T`: create Tree on targeted tile (−1 energy).
- `U`: absorb targeted object (gain its energy value). Synthoids and boulders absorb without an extra LOS check — picker resolution is enough. Items on a pedestal (Sentinel) still require LOS to the pedestal top. Locked for the rest of the level after the Sentinel is absorbed.
- `Space` / `Enter`: transfer to targeted Synthoid. Free. No LOS check beyond picker resolution.
- `H`: hyperspace (−3 energy). Random flat tile at ≤ current height; on a pedestal, triggers WON — always succeeds even below 3 energy, flooring energy to 1 so the level jump is never zero (see Hyperspace under Engine / rules summary).
- Left-click on empty sky while looking up more than 30°: bird's-eye view → BIRDSEYE. Free (no energy cost, no cooldown).
- ESC / focus loss → PAUSED.

**BIRDSEYE** (pointer locked, no game actions): a scripted ~1s camera flight to a fixed overview (absolute height 30, looking straight down 60°, same yaw/FOV as on trigger), then free mouse-look (both axes) until dismissed. Left-click anywhere → scripted ~1s flight back to the *exact* pose captured at trigger time (position, yaw, pitch, FOV), then → PLAYING. Interruptible mid-flight in either direction. ESC / focus loss → PAUSED (camera snaps back to ground instantly first, so it can't strand mid-air — see `MainView.svelte`'s `onLockLost`).

**DEBUG mode** (pointer locked, free flight):
- WASD + Shift (2× speed), `[`/`]` FOV, mouse look.
- Left-click: remove top object on targeted cell.
- Middle-click: add Synthoid (+Ctrl=Sentinel, +Shift=Meanie). **Debug-only.**
- Right-click: add Boulder (+Ctrl=Sentry, +Shift=Tree). **Sentry placement debug-only.**
- ESC / focus loss → MENU.

**PAUSED** (`PauseOverlay.svelte`, no menu tree): Escape → `giveUp()` → rebuild + MENU. Any other key → `resumeGame()` → back to PLAYING.

**MENU** (`MainMenu.svelte`): arrows navigate, Enter/Space selects, Left/Right adjusts, Backspace goes back. `localStorage.debug=1` unlocks Free Roam + the `Display` and `Level generator` submenus.

**WON / LOST** (`WinScreen.svelte` / `LoseScreen.svelte`): no timer — dismissed by keypress only, which calls `completeWon()`/`completeLost()` directly.

## Game phases

The game has a state machine whose state is stored in "game.phase". The existing states are:
- "MENU"
  The camera view is orbiting the landscape of the last selected level. The pointer is not locked. `MainMenu.svelte` is displayed. Key presses allow menu manipulation (up/down/left/right/enter/backspace). Selecting "Start" switches state to "PLAYING". Selecting "Free roam" (debug-gated) switches state to "DEBUG". Game clock is stopped.
- "PLAYING"
  The camera view is subjective at the current position of the active synthoid (which must NOT be displayed, to avoid the view being blocked by the inside of the model). The pointer is locked so that mouse movements update the camera orientation. Mouse clicks act on the item pointed by the camera (detected by ray cast). Key presses are for game actions (hyperspace, robot, boulder, tree, transfer). `HelpLine.svelte` shows key/mouse bindings. ESC (or losing focus) switches state to "PAUSED". Game clock is running. Game rules can trigger state switch to "TRANSFER", "BIRDSEYE", "WON" and "LOST".
- "BIRDSEYE"
  Entered from PLAYING via `engine/actions.ts`'s `isBirdsEyeTrigger` (a left-click that hits nothing while looking up >30°) — see `MainView.svelte`'s `onMouseDown`. Pointer stays locked. `CameraController` runs a scripted ~1s ease-in-out flight from the current pose to a fixed overview (absolute height 30, pitch -60°, same yaw/FOV as on trigger — `enterBirdsEye`/`updateBirdsEye`); once settled, mouse look (both axes) is free but no action keys or WASD apply. `HelpLine.svelte` swaps to "Click to return". A left-click starts the scripted flight back to the *exact* pose captured at entry (`exitBirdsEye`) — interrupting an in-progress flight in either direction is fine, it just re-targets from wherever the camera currently is. The phase only flips back to PLAYING once that return flight finishes (`completeBirdsEyeExit()`, called from `engine/loop.ts` when `CameraController.birdsEyeExitComplete` goes true), so actions stay blocked for the whole round trip, not just the outbound leg. Game clock is stopped throughout (BIRDSEYE is absent from `GameLoop`'s ticking phase list) — Sentinel/Sentry/Meanie are fully frozen, this is a free peek. ESC / focus loss → PAUSED, with `CameraController.cancelBirdsEye()` snapping the camera back to ground first so alt-tabbing mid-flight can't strand it in the air (mirrors the alt-tab fix from Phase 5's `PauseOverlay`).
- "PAUSED"
  The camera view is the same as for "PLAYING" (frozen — `loop.ts` already gates ticks/camera on phase, no dedicated freeze logic needed; a body-transfer glide interrupted mid-flight freezes the same way, since `CameraController.updateTransfer` is only called while pointer-locked), pointer is not locked, mouse clicks do not act on game items. `PauseOverlay.svelte` dims the canvas and shows "Paused" + a hint. No menu tree: Escape calls `giveUp()` (bumps `levelEpoch`, rebuild, → MENU); any other non-modifier key calls `resumeGame()` (→ `game.pausedFrom`, re-acquires pointer lock — PLAYING in the ordinary case, or TRANSFER if pausing interrupted a still-in-flight body-transfer glide, so it keeps blocking input and picks the glide back up exactly where it left off). Bare Alt/Control/Shift/Meta are ignored (see `ui/PauseOverlay.svelte`) so alt-tabbing away doesn't silently resume. If the re-acquired lock then fails (e.g. the window is still losing focus), `engine/input.ts`'s `onLockLost` fires anyway and drops back to PAUSED rather than getting stuck. Game clock is stopped.
- "WON"
  `WinScreen.svelte`: themed overlay showing the completed landscape and the energy-driven jump to the next one. Camera is controlled (orbit), pointer not locked. No timer — stays until any key calls `completeWon()`, which advances `settings.levelId`, appends to `settings.levelIds`, saves, → MENU. Game clock is stopped.
- "LOST"
  `LoseScreen.svelte`: themed overlay ("Energy Depleted" + the landscape number). Camera is controlled (orbit), pointer not locked. No timer — stays until any key calls `completeLost()`, which bumps `levelEpoch` (same `levelId` rebuilds) → MENU. Game clock is stopped.
- "DEBUG"
  Camera is set on the last active synthoid (or the first found is no active one, or center of the map if none). Pointer is locked and rotates camera, key presses (W/A/S/D) move the camera around, staying a fixed height above the curent position. ESC (or losing focus) switches the state back to "MENU". Game clock is stopped.
- "TRANSFER"
  used when the player selects a new synthoid or as a result of Hyperspace (by key press or meanie). `CameraController.beginTransferAnim`/`updateTransfer` ease the camera's position from wherever it was to the target's eye position over `TRANSFER_DELAY_MS` (1 s, `easeInOutCubic`) — orientation and FOV are left exactly as they were, the camera is never re-aimed. Pointer stays locked but neither mouse-look nor any action key has any effect during the glide (mouse delta is drained, not applied). The old body crossfades transparent→solid and the new body solid→transparent in lockstep with the glide. State changes to "PLAYING" only once the glide reaches the target (`engine/loop.ts` calls `completeTransfer()`), not on a fixed timer. Game clock is running. Pausing (ESC) freezes the glide in place (see PAUSED) and resuming continues it from there.


## Coding conventions

- Tabs for indentation, single quotes, 120-col width (`.prettierrc`). Svelte files order: `<script>`, markup, `<style>`.
- `.ts` for source, `.svelte.ts` for shared runes modules, `.svelte` for components. No new `.js` in `src/` outside `engine/fonts/` data files.
- Package.json has `"type": "module"` — any Node utility under `utils/` must be ESM.
- **`game/` code must not load `three` at runtime.** Type-only imports (`import type`) are fine — the compiler elides them — so `game/actions.ts` happily uses `import type { GameObject } from '../world/objects/base'`. Value imports in `game/` must come from three-free modules (`world/terrain.ts`, sibling `game/*.ts`, etc.). The aim is testability: vitest can exercise `game/actions.ts` against a mocked `ActionContext` without bundling Three.js. `world/terrain.ts` is also three-free (the bit-faithful generator). `world/objects/*` does use Three.js — the GameObject classes own meshes/geometries/materials by design. Engine glue (raycasts, scene mutation, watcher loops) lives in `engine/` and `ui/`.
- When touching level generation (`world/terrain.ts`), the output must remain bit-identical to the original game. `world/terrain.test.ts` has snapshot fingerprints for levels 0 and 1 — run `npm test` after any change.

## Working style

See also the user-prefs captured in `~/.claude/projects/-home-thomas-tmp-SenTynel/memory/`:

- Propose → confirm → execute for anything that changes rendering. The user smoke-tests in a browser; Claude can't see the result, so don't claim visual parity without confirmation.
- always update PLAN.md when we complete a task defined in it. Keep the file tidy, add things that you cannot complete yet at the end of the current phase.
- review and update CLAUDE.md file when we achieve something, so that it correctly describes the current state of the project.
- do NOT issue Git commands that change the repository. Read only is ok, committing is forbidden. Ask explicit permission.
