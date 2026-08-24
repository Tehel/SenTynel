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
  App.svelte            Top-level; composes MainView, Hud, a phase-keyed overlay
                        (HelpLine/MainMenu/PauseOverlay/WinScreen/LoseScreen), and the
                        always-mounted PortraitOverlay; calls load()/loadStats()/
                        loadDemoProgress(); owns the demo supervisor ($effect, demo-gated:
                        holds WON/LOST for DEMO_{WIN,LOSS}_HOLD_MS then advanceDemo() or
                        exitDemo() — see DEMO below; human WON/LOST stay keypress-only) and
                        the Android back-gesture/back-
                        button guard (PLAN-MOBILE.md Phase M0): pushes a history entry for
                        the duration of any phase past MENU, and a popstate handler routes
                        the gesture into the same pause flow ESC already uses
                        (pauseGame()/returnToMenu()/giveUp()) instead of letting the
                        browser navigate away and silently discard level progress.
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
                        Demo is labelled with the BOT's landscape (game/demo.svelte.ts),
                        which is the one it resumes — not the Level: N below, which steps the
                        player's own unlocked list. Settings' last two entries, "Reset
                        progress" and "Reset demo progress" (both always visible, not
                        debug-gated), use the same local-mode pattern (`confirming`, a
                        'player' | 'demo' | null) to show a confirm/cancel line before
                        calling game/state.svelte.ts's resetProgress()/resetDemoRun().
    PauseOverlay.svelte  Shown during PAUSED. Dims the canvas, "Paused" caption. Own
                        keydown: Escape -> giveUp() (second Escape, see Game phases),
                        any other non-modifier key -> resumeGame(). Bare Alt/Control/
                        Shift/Meta/AltGraph/OS are ignored — they're the leading half
                        of an OS window-switch shortcut, not a deliberate resume.
    WinScreen.svelte     Shown during WON. Own keydown calls completeWon() directly — or,
                        in demo mode, exitDemo(): a demo win advances by itself after a beat
                        (App.svelte's supervisor), so a keypress there is someone asking the
                        demo to stop, not to bank the landscape into their own progress. The
                        guard is explicit rather than relying on MainView's window handler
                        winning the registration race. Reads currentLevelId() and
                        activeStats(), so a demo win reports the run being watched.
                        Three branches: normal ("Landscape Complete" + jump/next line),
                        capped (next would exceed 9999 — capped-at-9999 message plus an
                        encouraging line), final (landscape 9999 — "Game
                        Completed" title, a stats.svelte.ts-driven summary instead of a
                        next-landscape line: landscapes unlocked, per-type absorb counts,
                        transfers, hyperspace jumps, deaths, completion count).
    LoseScreen.svelte    Shown during LOST. Same pattern, calls completeLost() (or exitDemo()
                        in demo mode). Titles off game.lostReason: "Energy Depleted", or
                        "Nowhere To Go" when the demo watchdog wrote the landscape off, since
                        the bot usually still has energy in hand at that point.
    HelpLine.svelte      Two static lines of key/mouse bindings, mounted only during
                        PLAYING.
    ScanVignette.svelte  THE "YOU ARE SEEN" CUE (RULES-FIDELITY.md C6). Always mounted in
                        App.svelte, self-gating on phase and game.scanState. A screen-edge
                        vignette: steady dim amber while a watcher sees your body but not your
                        square (it can take nothing — a Meanie is coming), and amber ramping to
                        red as the lock-on stall runs down, reaching full saturation exactly as
                        the drain starts. THE RAMP IS THE COUNTDOWN, which is what turns "you
                        are seen" into "you have about this long". More watchers deepens the
                        colour rather than widening the frame, since drains cumulate.
                        Deliberately unlike MainView's #drainFlash (a hard 200 ms spike at an
                        80 px inset, sitting above this in z-order): different speed, spread
                        and intensity is what keeps "act now" and "you already paid" from
                        reading as one event. Own rAF, because the ramp has to be smooth
                        between the 1 Hz drain ticks that update the state behind it.
    PortraitOverlay.svelte  CSS-only "rotate your device" screen (PLAN-MOBILE.md Phase
                        M0). Always mounted in App.svelte; visibility is driven purely by
                        an `@media (orientation: portrait)` query, no JS/game-phase
                        involvement — covers the moment before Start's fullscreen/
                        orientation-lock engages and any browser where the lock silently
                        fails.
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
                        aimAnglesFor(col,row,y) aims at a cell CENTRE; aimAnglesForPoint takes
                        FRACTIONAL grid coordinates, which is what lets the demo bot name a point
                        on a tile rather than a tile (engine/bot.ts's aimCandidates) — a cell is a
                        square and the crosshair is one ray.
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
                        userData.skipRaycast meshes (the cone overlays). pickAlong(origin,
                        point, sceneData) is the same ray, filters and resolution aimed
                        somewhere the camera isn't pointed yet — the demo bot uses it to
                        test a shot before spending a second of its 1 Hz budget turning to
                        take it. Note this is a stricter question than
                        engine/visibility.ts's: that asks whether any CORNER of a cell is
                        reachable, this is the single centre ray the game actually resolves
                        an action against, and a tree can swallow one while leaving the
                        other open. That gap cost the bot whole landscapes until 2026-08-24
                        — see engine/bot.ts's aimCandidates, which closes it by aiming at the
                        part of the cell the ray does reach rather than at the centre.
    visibility.ts       isCellVisibleFrom(eyePos, …, fromCol?, fromRow?) — raycast LOS.
                        isCellVisible(camera, …) is a thin wrapper. Skips skipRaycast meshes.
    actions.ts          Engine wire-up: builds an ActionContext from sceneData + camera,
                        calls into game/actions.ts for player-driven actions.
                        performEngineAction/performEngineHyperspace are the single entry
                        point behind all three drivers (keyboard, mouse, demo bot):
                        pickTarget -> canPerformAction -> rules -> markActionPerformed,
                        with the cooldown started only on a real effect.
                        performEngineActionOn takes an already-resolved target instead, for
                        the bot: it must compare what the crosshair actually found against
                        what it aimed at, since acting on a blind pick means building on
                        whatever hillside was in the way. Holds
                        handleKeyActions, handleMouseAction, and the DEBUG handleClick.
                        isBirdsEyeTrigger(camera, sceneData, cameraVertical) is the bird's-eye
                        gate — a steep look (>30°) combined with pickTarget() returning null
                        (true empty sky, not just "nothing absorbable"); MainView.svelte
                        checks it before dispatching a PLAYING left-click to handleMouseAction.
    bot.ts              Demo-mode BotDriver (see game.demo) — the engine half of the bot;
                        the decisions live in a game/botWorld.ts BotPlanner, which the
                        constructor takes (defaulting to game/bot.ts's LadderPlanner) so a
                        challenger can be run against the same engine, scene and rules.
                        Snapshots the scene into a BotWorld (the planner's injected view,
                        same pattern as ActionContext), calls the planner's once-per-
                        landscape survey(), caches the per-decision exposure answers behind
                        a shared per-(watcher, cell) line-of-sight cache — used by
                        isWatched, isInSight and ticksUntilSeen alike — and executes the
                        step it gets back. It holds no plan of its own any more; the only
                        planner state it tracks is the intention() key, for the
                        MAX_PLAN_DECISIONS staleness backstop. A virtual *player*, not an AI
                        opponent: it eases the real camera toward its target at
                        TURN_RATE_RAD_PER_SEC (a 180° U-turn in 0.5s) and then calls
                        performEngineAction, so every energy / placement / LOS / 1 Hz
                        cadence rule applies to it exactly as to a human. Planning is
                        omniscient (reads sceneData directly, no fog of war); execution
                        is not. Acts only after SETTLED_FRAMES_REQUIRED = 2 settled
                        frames — Three refreshes camera.matrixWorld inside render(), so
                        an aim set on frame N isn't raycastable until frame N+1, and
                        acting sooner picks along the previous orientation.
                        WHERE IT AIMS is aimCandidates(col,row,startY): every point on a cell the
                        crosshair could sensibly be pointed at, best first, PRE-FLIGHTED with
                        pickAlong so the first shot is one that arrives rather than one discovered
                        to miss a second later. Two shapes — an object is walked up its own
                        silhouette (AIM_FRACTIONS = [0.5, 0.85, 0.2]), bare ground across its own
                        surface (AIM_OFFSETS, corners first at inset 0.4, since corners are what
                        engine/visibility.ts's reachability test believes). BotWorld.canHit answers
                        from the SAME list, which is the load-bearing part: the planner's idea of
                        what can be hit is exactly what the driver can deliver, and while the two
                        disagreed one of them was wrong every time. Both halves were found by
                        watching, 2026-08-24 (PLAN-BOT2.md postscript 9): a tile whose centre sat
                        behind a fold of ground was written off though most of its surface was in
                        plain view (landscape 35, where the opening is tight enough to make it
                        fatal), and canHit's single mid-silhouette ray passed through the HOLLOW in
                        the Meanie model — a head floating over a tripod foot — so the rung that
                        exists to absorb Meanies on sight had never once fired in 1000 landscapes.
                        861 -> 888/1000 on the 6000-6999 block, with EVERY loss bucket down.
                        The failure blacklist clears when the body moves OR when an action at that
                        cell succeeds. The second is newer and deletes a false invariant: "every
                        reason a step can fail is a function of where we're standing" holds for an
                        aim miss and NOT for a rules refusal, since canPlace turns on the cell's
                        CONTENTS — which the bot rearranges itself (landscape 233: a conservation
                        tree landed on its half-built assault pile, the create was refused, the bot
                        ate that tree a decision later and went on treating its own assault tile as
                        impossible). Measured neutral over 1000 landscapes; fires ~3 times in 60.
                        Ticked from
                        GameLoop before the camera block (it writes direction/vertical,
                        updateLook flushes them the same frame). Also owns the demo watchdog:
                        checkWatchdog tracks time since the last action the rules *accepted*
                        (read off game.lastActionAt, which a refused or mis-aimed step
                        deliberately doesn't move) plus a per-landscape ceiling, and on
                        breaching either DEMO_NO_PROGRESS_MS or DEMO_LEVEL_LIMIT_MS calls
                        triggerLost('stalled') so stall and death share one exit path. Its
                        clocks re-seed on game.startCount rather than at construction — a
                        demo restarted on the landscape it was already showing doesn't
                        rebuild the scene, so it keeps the same driver, whose clocks would
                        otherwise still be running from last time and expire at once.
                        Supplies BotWorld.targetJump (game/route.ts) only while
                        game.demo && game.sentinelAbsorbed. D1-D4 done: the bot wins
                        heightGap 0 and 1 landscapes end to end (survey, travel, climb,
                        pile, Sentinel, pedestal, hyperspace) and plays them back to back
                        as an attract mode. Steeper ground still isn't reliable — route
                        steering skips heightGap 3 rather than solving it.
    bot.harness.test.ts Headless bot observatory, and the only practical way to debug the
                        demo: drives the *real* GameLoop over a real scene with real
                        raycasts, stubbing only the renderer (its render() just does the
                        updateMatrixWorld that pickTarget depends on) and the InputManager.
                        Three.js raycasting is pure CPU, so nothing the bot touches needs
                        WebGL or a DOM. Replicates the two MainView effects the bot can't
                        live without — Effect 3a (seat the camera, hide the body from
                        itself) and Effect 3b (start the transfer glide, or updateTransfer
                        never completes and the phase machine wedges in TRANSFER) — and, for
                        the chain case, App.svelte's demo supervisor. Seeds the run from
                        game/demo.svelte.ts's cursor via startDemo(), deliberately leaving
                        settings.levelId elsewhere: if this file ever starts depending on the
                        player's landscape, the demo sandbox has regressed.
                        Reports per-run tallies (steps chosen/failed, aim misses and what
                        the crosshair hit instead, energy floor, objects left);
                        BOT_TRACE=1 dumps every decision, BOT_SECONDS overrides the run
                        length, BOT_LEVELS replays arbitrary landscapes (how a report from
                        watching the demo gets reproduced), BOT_PLANNER picks the strategy
                        and BOT_FRAME_MS the simulated frame time — outcomes on marginal
                        landscapes depend on how the 1 Hz cadence aligns with the 4 Hz
                        drain, so one frame time is one sample. Its wall-clock time is itself a signal — a healthy run is
                        ~1s per landscape, and a bot stuck retrying re-plans every third
                        frame and drags the whole suite to a minute. The BOT_SWEEP=1 sweep
                        plays every landscape with each entry in its PLANNERS list (v1 and
                        v2) and prints a summary per planner: wins, mean jump banked
                        against the mean maxJump those landscapes could have funded
                        (maxJumpOf, a port of utils/all-levels.js pinned by its own test),
                        the trade — which landscapes each planner gained and lost against
                        the first, since two configurations can score the same total while
                        winning different landscapes — and a **loss-bucket histogram**.
                        bucketOf() labels every loss won / died-in-opening / bled-out /
                        never-reached-assault-position / burned-purse /
                        died-after-the-Sentinel / watchdog-stalled / out-of-clock, all from
                        data already logged: game.lostReason, the [energy] spend/gain/drain
                        events, the [bot] watchdog event, and planEndgame's own step labels
                        as a planner-agnostic "did it ever reach a winning position" signal.
                        Diff two histograms rather than two totals — a change that trades one
                        bucket for another at an unchanged win rate is a real finding, and was
                        invisible for the whole of B1-B3. bled-out is a deliberately strict
                        hypothesis bucket (see its comment): treat a low count as evidence
                        against the flee argument, not as a threshold to loosen.
                        Landscapes 106, 600, 246, 16, 35 and 233 are pinned as v2 wins at BOTH 15
                        and 16 ms; 35 and 233 additionally have tests of their own. 35 asserts ZERO
                        aim misses and a MEANIE among the things absorbed (the fixture for
                        engine/bot.ts's aimCandidates rather than for a strategy); 233 asserts the
                        TRANSFER COUNT, because its bug was a busy loop — 34 transfers going nowhere
                        — and a win/loss assertion cannot see one.
                        There is a v2 twin of the determinism test — the original runs v1,
                        and v2 latches state where iteration order could leak.
    exposure.harness.test.ts  Validation rig for game/exposure.ts's analytic line of sight
                        against the engine's own raycaster, over real landscapes. The map is
                        only worth anything if the two agree, and the older terrainVisible
                        disagreed by ~20% in the unsafe direction. Samples every (watcher, cell)
                        at five target heights, so it tests the height WINDOW rather than a
                        boolean, and counts the two directions separately: UNSAFE (map says
                        hidden, engine can see — bounded, 0.0064% over 50 landscapes) versus
                        safe-side (map says exposed, engine says hidden — ~2%, mostly object
                        occlusion the terrain-only sweep does not model, and the direction that
                        costs the bot caution rather than its life). EXPOSURE_LEVELS replays a
                        block, EXPOSURE_MARGIN re-runs the SIGHTLINE_MARGIN trade-off table in
                        its header, EXPOSURE_VERBOSE prints per landscape.
                        The unsafe bound is deliberately NOT zero, and the header records why
                        so nobody tries to drive it there: traced on landscape 390, a sightline
                        entering a hill tangentially is missed by the raycaster, after which the
                        ray travels three whole levels INSIDE the hill unregistered — the exit
                        faces are back-facing and flat planes are FrontSide. The same ray cast
                        backwards hits the blocker cleanly. In those cases the ENGINE is the
                        permissive one, and no analytic model reproduces a face-culling artifact.
    exposureSensor.ts   The LIVE half of the exposure map, and the seam that matters: game/
                        exposure.ts is pure and three-free, this owns the once-per-landscape build
                        and turns the engine's live Watcher objects into the snapshots it wants,
                        and exposureOverlay.ts only DRAWS. Anything that needs to KNOW about
                        exposure reads this — so a planner can consume the map without importing a
                        visualisation, and switching the overlay off costs the sensor nothing.
                        ExposureSensor.view(live) returns an ExposureView: the map plus the
                        watchers' clocks resolved once, with cheap per-cell read(col,row,height)
                        and aboveEveryEye(height) on top. Resolving costs a short search per
                        watcher, so doing it once per view is what makes a whole-map sweep (the
                        overlay) and a many-cell decision (a planner) equally cheap. A view is a
                        SNAPSHOT — take a fresh one when the clocks may have moved, i.e. per tick.
                        The build is lazy (~58 ms mean, 233 ms worst): free in the frozen window
                        before the player's first action, but not worth spending on a scene rebuild
                        nobody asks a question of. Owned by SceneData as `exposure`.
                        liveWatchersOf() KEEPS absorbed watchers in the list rather than filtering
                        them: clocksFor matches the map's own list by tile and must see the tile is
                        now empty (-> null clock -> alive:false) rather than have the match fall
                        through to whatever else is standing there.
    exposureSensor.test.ts  What the overlay used to own and no longer does: the map built once and
                        reused across views, the live facing re-syncing without touching it, an
                        absorbed watcher dropping out at READ time rather than by a rebuild, and the
                        above-every-eye ceiling. Plus liveWatchersOf taking watchers and leaving
                        everything else.
    exposureOverlay.ts  Debug visualisation of game/exposure.ts (PLAN-EXPOSURE.md). DRAWING ONLY —
                        it takes an ExposureView from exposureSensor.ts and paints it; it owns no
                        map and no clocks. One small
                        square per FLAT cell floating HOVER_HEIGHT above the ground, on a single
                        InstancedMesh with per-instance colour — one draw call, skipRaycast,
                        Disposer-registered. Toggled by settings.showExposureMap (Settings ->
                        Display -> Show exposure map, debug-gated: it is an oracle, and a player
                        who can see it is not really playing).
                        EVERY TUNING CONSTANT IS EXPORTED IN ONE BLOCK AT THE TOP: SQUARE_SIZE
                        (2/3 cell), HOVER_HEIGHT (0.1), RAMP_HORIZON_TICKS (120 = 30 s) and the
                        HELD_OPACITY and the five colours. Five states, so that "safe" is never one
                        undifferentiated colour: in sight now (red), exposed within the ramp
                        (red->amber->green), exposed but past the horizon (green), no sightline at
                        this height (blue), and at-or-above EVERY live watcher's eye (violet —
                        permanently undrainable, the PLAN-BOT3 "build a tower out of reach" case
                        made visible).
                        Plus one ORTHOGONAL channel: a cell waiting on a HELD turn (its watcher has
                        stopped rotating to eat) keeps its ramp colour and is MARKED rather than
                        recoloured. Colour says WHEN, the marking says WHETHER THE CLOCK IS RUNNING.
                        A held watcher pauses its whole future schedule, so every cell it will ever
                        reach is technically held — the first version flagged them all one dark red,
                        which was correct and useless, since "red once it stops" and "green once it
                        stops" are what a plan is built from. The marking is world-space diagonal
                        HATCHING — gaps cut through the square with discard, so the ground shows
                        through and adjacent held cells form continuous bands, readable at range on
                        any theme. Half-opacity was tried first and rejected: at 0.5 on a saturated
                        theme it mostly read as "slightly darker".
                        InstancedMesh offers no per-instance pattern (colour is per instance, this
                        is material-level), so it arrives as an instanced `held` attribute acted on
                        at the same #include <dithering_fragment> point world/objects/models/
                        index.ts patches, with the world-space stripe coordinate as a second
                        varying. Still one draw call.
                        The material is OPAQUE, not transparent, and that line is load-bearing: it
                        is what fixed a flicker where the squares vanished for a fraction of a
                        second, most often during a body transfer. Transparency put the mesh in the
                        sorted pass, where Three orders by the OBJECT'S ORIGIN depth — world
                        (0,0,0), the map corner, while its instances cover the whole landscape, so
                        the sort key is meaningless and swings as the camera moves, sharing that
                        pass with a transfer's two crossfading bodies and any live particle burst.
                        Since the hatching is cut with discard every surviving fragment is fully
                        opaque, so the opaque pass is also simply where it belongs.
                        frustumCulled = false too (Three caches an InstancedMesh's bounding sphere
                        and never invalidates it — see engine/particles.ts — and this object spans
                        the whole map, so the test can never pay off), and customProgramCacheKey is
                        set because Three's program cache ignores onBeforeCompile, so a material
                        with matching parameters could silently share an unpatched program.
                        polygonOffset was tried against that flicker first and made it WORSE — the
                        artifact tracked the camera, but because transparent draw order depends on
                        camera position, not because depth precision does. Do not re-try it; the
                        hover height is a visual choice, not a workaround. See PLAN-EXPOSURE.md. Opaque by design: the level themes are saturated and vary per
                        landscape, so a translucent overlay would take its hue from the theme and
                        the same exposure would read differently level to level.
                        The ramp horizon is deliberately far shorter than a watcher's 12.8-minute
                        cycle — scaled to the cycle nearly every cell with a sightline would sit
                        mid-gradient and say nothing; scaled to a decision it answers "can I
                        finish what I am doing here before the cone arrives".
                        Repainted on the 4 Hz game tick (engine/loop.ts), never per frame: the
                        watchers' clocks are the only thing that can change a colour. That makes a
                        drain-locked watcher's frozen sector visible for free — its clock stops,
                        so its colours stop with it. MainView's Effect 3e paints once more when the
                        overlay is switched on or the scene rebuilt, since the tick doesn't run in
                        MENU/PAUSED/BIRDSEYE or before the first action — which is exactly when
                        you'd want to study it.
                        ExposureView.read() is the accessor behind BOTH the colouring and MainView's
                        crosshair readout, so the picture and the number cannot drift apart; both
                        go through game/exposure.ts's readExposure().
                        HEIGHT STEPPER: the overlay answers for a body standing on `pileBoulders`
                        boulders (BOULDER_HEIGHT = 0.5, MAX_PILE_BOULDERS = 10), stepped with
                        PageUp/PageDown and Home to reset — named keys, not punctuation, since
                        input.ts tracks KeyboardEvent.key and `,`/`.` move on an AZERTY layout.
                        The squares RISE with it: you are looking at the plane being asked about,
                        and cells flipping blue->red as boulders go under them is the map's height
                        WINDOW made visible, which is the one thing a ground-level picture cannot
                        show. assumedHeight() is the single helper behind the square positions, the
                        colouring and the readout. Handled in engine/loop.ts outside
                        handleKeyActions (no energy, no cooldown) and allowed in BIRDSEYE as well as
                        PLAYING; handleExposureKeys/setExposurePile report whether anything moved
                        and leave the repaint to the caller, which is the one holding a view — and
                        which must repaint, since the 4 Hz tick does not run in BIRDSEYE or before
                        the first action, exactly when someone steps through heights.
                        liveWatchersOf() keeps absorbed watchers IN the list rather than filtering
                        them: clocksFor matches the map's own list by tile, and it must see that
                        the tile is now empty (-> a null clock -> alive:false) rather than have the
                        match fall through to whatever else is standing there.
    exposureOverlay.test.ts  The two things in the overlay that fail SILENTLY. The shader patch is
                        a string replace, so a Three.js chunk rename would no-op it and ghosted
                        cells would render solid, looking exactly like watched ones — the chunk
                        names are asserted against Three's own ShaderLib, and the patch is run over
                        the real ShaderLib.basic source to prove it rewrites something. Plus a
                        headless end-to-end pass (no renderer, no DOM, no WebGL): flat cells get
                        squares and slopes do not, a drain-locked watcher ghosts its pending
                        sectors but NOT the one it is looking at, and an absorbed watcher stops
                        being painted without the map object being rebuilt.
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
                        The burst mesh carries userData.skipRaycast — cosmetic geometry must not
                        answer a rules question. engine/visibility.ts treats any hit it cannot place
                        on a cell as a PURE BLOCKER (that branch exists for visibility.test.ts's
                        synthetic wall), so unflagged these cubes were opaque to watcher detection,
                        the surface rule, meanie LOS and every bot exposure query, while
                        engine/picker.ts ignored them — the crosshair and the sightlines disagreeing,
                        the worst shape a bug can have. Flagged for the CLASS, not the incidence:
                        0.06 cubes against a four-corner-optimistic test make an actual block freak
                        luck, but the positions come from Math.random, so the residue would have been
                        an unreproducible sightline anomaly in a game otherwise seeded to replay
                        exactly. The version that did bite is the absorb animation — see
                        world/objects/base.ts's remove().
                        Both trigger sites additionally check settings.particleEffects
                        (Settings → Game → Particle effects, default on). Triggered from
                        engine/scene.ts's addObjectToScene (gated on time>0, mirroring
                        GameObject's own spawn-animation gate) and removeObjectFromScene;
                        ticked every frame in engine/loop.ts alongside deferredSpawns.
    watcher.ts          1 Hz drain phase (Sentinel + Sentry). Per-cell drain target,
                        animated absorb-then-spawn (animationScale=2, deferredSpawns),
                        meanie-conversion trigger, conservation-tree spawn, rotation lock.
                        Owns THE LOCK-ON RULE (see Engine / rules summary): drainPriority()
                        sorts synthoid < boulder < tree then by distance, one exclusive slot
                        per watcher, a WATCHER_GRACE_MS stall on synthoids only, cumulative
                        player drains, and the scan-warning tally it publishes through
                        setScanState().
    watcher.test.ts     The four lock-on rules over the real runDrainPhase on a flat map:
                        priority (a far synthoid before a near boulder — the case distance
                        alone cannot explain), the stall applying to synthoids and not
                        boulders, rotation freezing on draining rather than on locking, and
                        drains cumulating across watchers. Plus the transfer window.
    meanie.test.ts      One Meanie at a time, sweeping not homing, reverting to a tree after a
                        full turn, and testing the SQUARE not the body. That last one needs a
                        wall fixture with tight margins — read its comment before touching it,
                        the first version hid the body too and passed vacuously.
    scene.test.ts       The surface rule matrix (canTargetTopObject) — 15 cases covering what
                        may be absorbed or transferred into, and from where.
    meanie.ts           triggerMeanieConversion (ONE at a time; closest tree → animated spawn) +
                        runMeaniePhase (per game tick during PLAYING: rotate toward
                        player, on LOS force a hyperspace via drainEnergy + teleport).
    disposer.ts         Disposer class — GPU resource registry, disposeAll(). Registers anything
                        structurally { dispose(): void } rather than a union of three Three.js
                        types: an InstancedMesh owns its instance matrix/colour buffers and needs
                        the same treatment (exposureOverlay.ts).
    platform.ts          Browser/platform plumbing not tied to any one engine subsystem
                        (PLAN-MOBILE.md Phase M0): isTouchCapable() (an interim
                        navigator.maxTouchPoints/ontouchstart heuristic, ahead of Phase
                        M4's real settings.inputMode) and enterFullscreenLandscape()
                        (fullscreens document.documentElement — not just the canvas, since
                        HUD/menu/overlays are canvas siblings — then attempts
                        screen.orientation.lock('landscape'); both failures are swallowed,
                        the portrait fallback overlay covers the rest). Called from
                        MainMenu.svelte's Start entry only.
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
                        resetStats), startDemo/exitDemo/advanceDemo/resetDemoRun.
                        beginLevel() is the shared per-landscape reset, split out of
                        startGame() so the game.demo flag and the stats target can be pinned
                        *before* it runs — it seeds game/random.ts from currentLevelId(),
                        which needs to know who is driving. currentLevelId() is the single
                        answer to "which landscape is being played": the bot's own cursor
                        (game/demo.svelte.ts) while game.demo, the player's settings.levelId
                        otherwise. Every gameplay consumer goes through it — MainView's
                        Effects 2 and 3d, the seed above, both end screens — and the menu
                        deliberately does not, since it steps the player's own unlocked list.
                        advanceDemo() is the demo's win-and-continue: it moves the bot's
                        cursor by the leftover energy and calls startDemo() straight away, so
                        the next landscape begins without a trip through MENU, and it never
                        touches settings or save(). It also records demoProgress.cameFrom and clears
                        the strike count — a win is what has to break "three in a row", not merely
                        moving on.
                        failDemo() is its counterpart and the demo's FAILURE path (2026-08-24,
                        landscape 482). A loss used to call exitDemo() and stop the demo dead, on the
                        argument that skipping a landscape the bot can't win would be cheating and that
                        leaving the cursor put is how its weakest landscape makes itself known. Both
                        halves still hold — they just needed somebody watching, and an unattended run
                        stopped at the first failure and told nobody. Now the landscape is RETRIED IN
                        PLACE and the third consecutive failure blacklists it and rewinds the cursor to
                        cameFrom. The rewind is the load-bearing part, not the list: the landscape it
                        goes back to is one the bot actually won, and route.ts's blacklist check makes
                        that same win buy a DIFFERENT landing, so every landing stays earned and there
                        is no new steering code (planSurplusBurn already did it). A retry MUST bump
                        levelEpoch, for two independent reasons: MainView's Effect 2 rebuilds the scene
                        on it (without a bump the bot restarts on the wreckage it just left) and
                        game/random.ts seeds from (levelId, levelEpoch), so without a bump three strikes
                        would be three copies of ONE run rather than three attempts. A rewind does not
                        bump — the cursor itself moves, and replaying the target from the same seed is
                        the point, since only the steer should differ. cameFrom is cleared ON USE, which
                        bounds the mechanism: a second rewind would need where the TARGET was reached
                        from, which nothing records, so a rewind target must be won again before the
                        chain continues. Two cases hand back to the menu instead, both deliberately: no
                        cameFrom at all (the demo's origin, a fresh reset, or the 9999 wrap — checked
                        BEFORE the strike is counted, since a landscape that can't be rewound away from
                        can't be blacklisted either, and half-counting towards an unreachable verdict is
                        misleading state) and a rewind target that is itself blacklisted.
                        exitDemo() bumps levelEpoch for the same
                        reason completeLost()/giveUp() do — the landscape the menu orbits
                        behind should be clean, and reverting currentLevelId() only forces a
                        rebuild when the two cursors differ.
                        completeWon() (the player's path only) caps the jump at landscape
                        9999 and skips the unlock step entirely when 9999 itself was just
                        won — there's nowhere further to jump; the demo equivalent wraps its
                        cursor back to 0 instead. triggerWon()/triggerLost() bump
                        victories/deaths through stats.svelte.ts's recorders, so they land on
                        whichever record is playing. triggerLost() takes a reason ('energy',
                        or 'stalled' from the demo watchdog) and stores it in game.lostReason
                        for LoseScreen's caption.
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
    stats.svelte.ts     Lifetime stats, in TWO records of identical shape: `stats` (the
                        player's, localStorage key 'stats') and `demoStats` (the demo bot's,
                        key 'demoStats'), both built by the emptyStats() factory and both
                        loaded by loadStats(). Fields: deaths, victories, transfers,
                        hyperspaceCount (voluntary H-key only — Meanie-forced hyperspace is
                        excluded), absorbed.{tree,sentry,sentinel,meanie} (boulder/synthoid
                        excluded), gameCompletions, and the completedGameThisRun guard (caps
                        gameCompletions at +1 per run even if landscape 9999 is replayed
                        without a reset).
                        setStatsTarget('player'|'demo') picks which record every recorder
                        writes and activeStats() reports; game/state.svelte.ts sets it as a
                        level begins (startGame/startDemo/returnToMenu). EVERY mutation goes
                        through a recorder — recordAbsorb/recordTransfer/recordHyperspace/
                        recordVictory/recordDeath — precisely so that gate has no holes: an
                        unattended attract-mode run would otherwise inflate the player's
                        history, and a demo reaching landscape 9999 would bump their
                        gameCompletions and permanently speed up their watchers.
                        resetStats() clears the current record except gameCompletions, which
                        a "Reset progress" is meant to preserve.
    demo.svelte.ts      The demo bot's own saved progress — levelId (the landscape it plays
                        next) and levelIds (everywhere it has reached), persisted to
                        localStorage key 'demoState' in settings.svelte.ts's load/save shape.
                        The other half of the sandbox described above, and what lets the demo
                        *resume* rather than restart. Data and persistence only, with no
                        import of state.svelte.ts, which imports this — currentLevelId() is
                        where the two meet.
                        Also THE THREE-STRIKE BLACKLIST (2026-08-24): `blacklist` (landscapes
                        failed STRIKES_BEFORE_BLACKLIST = 3 times in a row), `strikes` +
                        `strikeLevelId` (the consecutive count, two scalars rather than a map so
                        "in a row" resets itself the moment the cursor moves) and `cameFrom` (the
                        landscape whose win paid for the current one — what gives a dead end
                        somewhere honest to rewind TO). recordDemoStrike/clearDemoStrikes/
                        blacklistDemoLevel/isDemoBlacklisted are data operations only; the
                        orchestration is state.svelte.ts's failDemo(). loadDemoProgress copies
                        whatever keys the saved JSON has, so an older 'demoState' needs no
                        migration. resetDemoProgress clears the list wholesale — deliberately the
                        ONLY thing that does, since the list is a verdict on THIS bot and an
                        improved one deserves to disagree with all of it.
    route.ts            Which landscape the demo plays next. heightGapOf(level) is a port of
                        utils/all-levels.js's heightGap (so the runtime rule and the route
                        CSVs mean the same thing by it); isPlayableLanding(id) rejects a
                        heightGap above 2 (untested seven-boulder piles — just 2497 and 9306)
                        and an enclosed start, where nothing sits below the starting eye so
                        the only legal opening move is the 3-energy hyperspace hatch (372 of
                        the 10000, and line of sight does most of that work — only 20 have no
                        low-enough flat tile at all) — plus, since 2026-08-24, anything on
                        demo.svelte.ts's BLACKLIST. That check sits deliberately OUTSIDE the memo:
                        the two terrain tests are properties of the landscape's geometry, true
                        before the demo starts and free to cache forever, while the blacklist is a
                        property of this run's history and GROWS while the demo plays — caching it
                        would pin a stale "playable" for the session. It also keeps the two claims
                        separable: terrain is a claim about the GAME, the blacklist about the BOT.
                        chooseDemoLanding(from, maxJump) scans
                        DOWNWARD from the furthest affordable jump and stops at the first
                        landing that passes: 96% do, so it averages ~1.04 generateLevel calls
                        (~3 ms) rather than surveying the window. Memoised per id. No
                        precomputed table, so nothing to keep in sync with terrain.ts.
                        Its "nothing playable, take the longest jump anyway" FALLBACK now prefers a
                        non-blacklisted landing, and that is not decoration: at 96% playable the
                        branch was near-unreachable, but the blacklist grows towards it — every
                        rewind returns the bot to the same landscape, whose window loses one more
                        candidate each time round. Landing on a blacklisted landscape from there
                        would earn it three fresh strikes and another rewind to the same place, a
                        loop that ACTS every second so no watchdog limb ever sees it. With
                        genuinely nothing left it logs allLandingsBlacklisted rather than turning a
                        stuck journey into a silent zero. The
                        strategy is "maximise the jump" — deliberately NOT
                        utils/path-no-tower.csv's heightGap-0 route (the bot handles gaps of 1
                        and 2 fine, and that route's 221-hop optimum assumes a maxJump purse
                        the bot never actually reaches). Room is noted for the
                        "fastest/easiest/…" strategy setting; the setting itself is unbuilt.
    actions.ts          performTargetedAction + performHyperspace + pickHyperspaceTile.
                        Operates through an ActionContext interface — engine/actions.ts
                        injects place/remove/visibility callbacks so this module never
                        loads three. Per-action canPlace gate replaces the older
                        spend → place → refund pattern. performHyperspace resolves the LANDING
                        BEFORE the spend (RULES-FIDELITY.md E6) — see the Hyperspace bullet under
                        Engine / rules summary for why an impossible jump is refused rather than
                        billed.
    actions.test.ts     pickHyperspaceTile's ceiling: generous (the body's altitude, boulders
                        included) and absolute (never raised when nothing fits) — two properties
                        that look contradictory and are not. Plus describe('performHyperspace with
                        nowhere to land'), landscape 482 in miniature: a floor-level pocket whose
                        every flat tile is occupied, asserting the refusal charges nothing and
                        places nothing, and that the same fixture with one tile freed still jumps.
                        The premise (pickHyperspaceTile returning null) is asserted inside the
                        test, so the fixture cannot quietly stop being the case it claims to be. Also the choke point for three
                        lifetime stats (stats.svelte.ts): recordAbsorb() on a successful
                        absorb, recordTransfer() on a successful transfer,
                        recordHyperspace() in performHyperspace() (voluntary H-key
                        only, excluding the pedestal/WON path — Meanie-forced hyperspace
                        in engine/meanie.ts is deliberately not counted).
    levelCodes.ts       findLevelByCode(code) — awaits ensureIndexReady() then deciphers the
                        persisted index block-by-block (codeCipher.ts's decipherStream) and
                        stops at the first match, rather than keeping a fully-decoded code->id
                        Map resident for the session: only the ciphertext (indexCipher, same
                        opaque bytes already sitting in localStorage) is cached between lookups,
                        so a heap snapshot taken between — or even mid — lookups never shows more
                        than the single 4-byte block currently being checked, not a permanent
                        plaintext table. ensureIndexReady() is memoized: it loads indexCipher
                        from localStorage if present, or (first-ever visit only) calls
                        buildIndex(), which shards 0..MAX_LEVEL_ID across a pool of
                        codeIndexer.worker.ts instances (one per navigator.hardwareConcurrency)
                        so the full generateLevel sweep runs at full speed off the main thread —
                        no main-thread throttling needed (the old background trickle capped
                        itself at 20 levels/sec, ~8 minutes for the full range, specifically to
                        avoid competing with the render loop; a Worker has no such conflict).
                        The assembled code->id table is cumulative-XOR "ciphered"
                        (codeCipher.ts) before being persisted; the transient plaintext array
                        built during buildIndex() is local to that function and falls out of
                        scope once ciphered. None of this is real security (the generation
                        algorithm is public and the sweep is replayable by anyone in seconds
                        regardless) — it just avoids leaving a readable table sitting around,
                        whether in localStorage or in memory, for a casual look to find.
                        getLevelCode(id) is the cheap single-level lookup MainMenu uses to show
                        "Level: N, code: ...", uncached (one generateLevel() call).
    codeCipher.ts       Pure cumulative-XOR cipher for the persisted code index: each 4-byte
                        PC/ST code is XORed against the previous block's plaintext (the first
                        against a fixed 'SNTL' key). decipherStream() is a generator yielding one
                        decoded code at a time (two small fixed buffers reused across iterations,
                        no growing array) so a consumer can stop at the first match without ever
                        materializing the rest — see findLevelByCode. decipherCodes() (batch,
                        `Array.from(decipherStream(...))`) exists for the cipher/decipher
                        round-trip and tests only. Also the base64<->bytes helpers used to store
                        the cipher output as a single localStorage string.
    codeIndexer.worker.ts  Computes one shard's generateLevel(id).codes['PC/ST'] values in a
                        dedicated Worker; see levelCodes.ts's buildIndex().
    codeCipher.test.ts  Round-trip, "changing one code changes every later block", and
                        decipherStream's stop-early-without-computing-the-rest coverage for the
                        cumulative-XOR chain.
    levelCodes.test.ts  Coverage for ensureIndexReady/findLevelByCode's own orchestration
                        (sharding, persistence, cache-hit-skips-rebuild, case-insensitivity) —
                        stubs Worker/localStorage/navigator and fabricates cheap per-id codes
                        rather than exercising the real (expensive, separately-tested by
                        terrain.test.ts) generateLevel.
    exposure.ts         The exposure map (PLAN-EXPOSURE.md): for every cell, when each watcher
                        will next be able to drain what stands there. Pure and three-free.
                        Built ONCE per landscape by buildExposureMap, in the window before the
                        player's first action where the watchers are frozen — 58 ms mean, 233 ms
                        worst, against a budget with nothing to lose. Then never mutated: a
                        watcher's rotation AND its drain-lock stall are read out of its live
                        clock at query time (resolveClocks derives the mask offset back out of
                        `rot`, so the map self-synchronises and there is no turn counter to
                        drift), which is why there is no incremental update, nothing to
                        invalidate, and no staleness bug class.
                        Stores per (watcher, cell): a 64-bit CONE MASK (bit k = the facing k
                        turns from now covers this cell's bearing — orientation-dependent,
                        height-INdependent, exact) and a HEIGHT WINDOW [minVisibleHeight,
                        eyeY) (orientation-INdependent, height-dependent, analytic). That
                        factorisation is the whole trick: "the cells a watcher can drain in
                        each of its 64 orientations" is ONE line-of-sight sweep intersected
                        with 64 cone masks, never 64 sweeps.
                        The window, not a boolean, because the drain phase tests line of sight
                        to the target's FOOT height (engine/watcher.ts:132) — so a cell hidden
                        at ground level becomes exposed once a pile is built on it, and a pile
                        whose foot reaches the watcher's eye becomes untouchable. Both are
                        invisible to a "is this cell watched" map, and both matter most exactly
                        where the bot builds.
                        Line of sight is an analytic march over the height field, not a raycast,
                        and it returns the threshold NATIVELY: clearing a blocker at sample t
                        needs targetY >= eyeY + (terrain(t) - eyeY)/t, so the threshold is the
                        max over samples — one march, one number, any target height. Faithful to
                        engine/visibility.ts on the two counts the older terrainVisible got
                        wrong (eye at the cell centre WATCHER_EYE_HEIGHT up; any of the four
                        corners reachable, so per-corner minimum). SIGHTLINE_MARGIN = 0.1
                        resolves the model's own uncertainty band towards "exposed"; its value
                        came from a measured trade-off, see the harness.
                        resolveClocks accepts null for a watcher absorbed since the map was built
                        and marks it alive:false — the ONE thing about a landscape that genuinely
                        changes, handled at read time so the map itself stays immutable and the
                        ~58 ms rebuild never lands mid-run.
                        readExposure() returns { ticks, by, inSightNow, held } because "how long
                        until this is watched" has THREE answers that must not collapse into one
                        number. A drain-locked watcher holds its turn while ticksUntilTurn keeps
                        decrementing into negatives, so flooring firstTurn at 0 made the sector it
                        was ABOUT to turn into report 0 ticks — identical to the sector it was
                        actually looking at, which is the opposite situation to stand in. firstTurn
                        now floors at 1, reserving 0 for "the current facing covers this cell", and
                        WatcherClock carries drainLocked so a paused schedule is distinguishable
                        from a merely overdue one. `ticks` stays conservative (earliest it could
                        possibly happen — the lock breaks the moment the watcher runs out of food);
                        only the label says it is paused. Found by watching the overlay, 2026-08-16.
                        game/cone.ts still floors at 0 deliberately: no drain-lock signal, its
                        caller only wants a conservative number, and changing it would move the
                        existing planners for nothing.
                        Same class of bug, found the same way a day later: while a turn is IN FLIGHT
                        (queued or animating) playTick has already reset ticksToTurn to a full
                        period but `rot` is not committed until the animation ends, so the clock is
                        fresh while the facing is stale and the sector being rotated INTO reads a
                        whole period out. WatcherClock.turning (world/objects/watcher.ts's `turning`
                        getter) shifts the schedule by one for the duration: j=1 is arriving now,
                        j=2 inherits j=1's countdown. Both bugs are the same mistake — two fields
                        describing different moments, read as one — which is worth remembering
                        before adding a third signal.
    exposure.test.ts    The cone half against game/cone.ts's independently-verified closed form
                        on open ground (mask build, 64-bit packing, turn-index resolution and
                        read arithmetic in one differential test), the live-facing re-sync, an
                        overdue turn treated as due now, and the height half: a ridge that hides
                        the ground but not a pile built on it, the eye ceiling, and a wall no
                        height sees past.
                        Plus the absorbed-watcher path: a null clock reads as alive:false, the
                        map object is reused untouched, and with every watcher gone the whole
                        landscape reads as permanently safe.
    botWorld.ts         The contract between a planner and the driver, split out of bot.ts
                        (PLAN-BOT2.md B2) so a challenger planner can be written against
                        the same seam without importing the incumbent: BotObject/BotBody/
                        BotStep/BotAction, the BotWorld interface (the ActionContext
                        pattern — line of sight, watcher exposure and cone prediction all
                        arrive as callbacks), and BotPlanner. A planner is a *stateful
                        object*: survey() once per landscape, decide() per 1 Hz decision,
                        and intention()/abandon() purely so the driver can apply its
                        staleness backstop without knowing what the memory looks like.
    botGeometry.ts      The arithmetic and terrain analysis every planner needs, whatever
                        strategy it plays: bouldersToSee/bouldersToOutrank/eyeHeightOn/
                        endgameCost, terrainVisible, computeHopField, findAssaultTile.
                        What is true of *the game* lives here; what a planner has decided
                        to do about it lives in the planner. Also imported by route.ts.
                        PedestalTarget (pedestal col/row/height) is split out of AssaultPlan,
                        which extends it, because canAssaultFrom and planEndgame need only the
                        pedestal — the finish is pedestal-driven, so a planner that has not yet
                        decided where to build can still answer every question the endgame asks
                        (findPedestal is an objects.find and one map read, no LOS sweep).
                        computeHopField takes one goal or MANY (multi-source reverse BFS), and
                        seeds its frontier explicitly rather than by looking the goal up among the
                        flat tiles — a non-flat or out-of-range goal used to yield a one-entry
                        field where every hop count is Infinity and the walk silently degraded to
                        straight-line scoring. Since every edge needs the target under an eye at
                        tileHeight + 1.375 against integer terrain, no edge climbs more than one
                        whole level: a hop count is a level count, which is what lets a
                        band-seeded field read as "levels below the summit".
                        assaultCandidates (every flat tile scored by the pile it needs, row-major
                        and stable-sort-critical) + assaultBand (the subset whose pile-top eye can
                        see the pedestal TOP by terrain alone, bounded by MAX_ASSAULT_BOULDERS = 5
                        = heightGap 2) are v2's survey inputs. findAssaultTile takes an
                        AssaultSearch options object (exclude / candidates / from / sightlines /
                        prefer); every v1 call site passes one argument, so v1 is untouched.
                        `prefer` is the exposure gate added 2026-08-24: the assault tile is the LARGEST
                        commitment in a run — up to five boulders and a body, six seconds of the 1 Hz
                        cadence — and it was the one destination chosen with no reference to watchers
                        at all, while the ordinary walk two rungs below refuses a tile a cone is on
                        outright. Measured at 9% of adopted assault piles standing somewhere that would
                        be watched before the pile could be finished, against 1% for the graded walk.
                        Consulted only AFTER the sightline test and never used to sort — grading is a
                        line-of-sight sweep per watcher per tile and the candidate list runs to the
                        hundreds — and it falls back to the refused tile when every viable one is
                        watched, so it can change WHICH tile is aimed at but never whether there is one.
                        Declared structurally rather than importing TilePreference (botMovement imports
                        this module, not the other way round), which also states the narrower contract:
                        only `avoid` is read, never `reject`. The sightlines
                        cache is sound for a whole landscape because a tile's view of the pedestal
                        top depends only on the height map.
    cone.ts             Watcher cone prediction, pure (PLAN-BOT2.md B1). The cone is 20 of
                        the 256 rotation units wide and every watcher steps ±20 units per
                        period, so a cone advances by exactly its own width each turn —
                        adjacent sectors, no overlap and no gap — which makes the full
                        future schedule closed-form rather than something to simulate.
                        bearingUnits/coversBearing/ticksUntilBearingCovered; engine/bot.ts
                        pairs them with a line-of-sight test to answer
                        BotWorld.ticksUntilSeen. Two documented approximations, both erring
                        towards predicting exposure early: a drain-locked watcher's clock
                        is assumed to run, and `rot` commits ~2 ticks after the turn fires.
    botMovement.ts      How the bot moves, shared by every planner: the BotPlan intention,
                        isPlanViable, planStep, chooseDestination and its candidate
                        scoring. Not strategy — it is what the game makes possible (a tile
                        above the eye can never be targeted, so height is only ever gained
                        by piling boulders and transferring up). What a planner *does*
                        choose is where it would rather stand, which arrives as a
                        TilePreference: v1 grades by present exposure, v2 by how long the
                        cover lasts.
    botEndgame.ts       The finish, shared: inAssaultPosition, planEndgame (Sentinel ->
                        body on the pedestal -> transfer -> surplus burn -> hyperspace) and
                        route steering's planSurplusBurn. However a planner gets to the
                        assault tile, the last five actions are identical and unforgiving —
                        absorption locks the instant the Sentinel goes.
    bot.ts              The v1 planner: a priority ladder, pure and three-free, plus
                        LadderPlanner (the BotPlanner wrapper that holds its plan and its
                        survey). Testable against a synthetic landscape with no renderer.
                        planNextStep() is a priority ladder — endgame, transfer onward,
                        reclaim the body just left (+3), take any Sentry in range, harvest
                        to cover endgameCost, else walk — returning a BotDecision: the
                        action to take now, plus the BotPlan it means to be pursuing next
                        tick. planSurplusBurn() is the tail of the endgame rung and the
                        planner's half of route steering: standing on the pedestal with the
                        purse final, it spends the difference between the affordable jump and
                        BotWorld.targetJump (game/route.ts, injected by the driver) on creates,
                        which are never refunded once absorption locks — biggest denomination
                        first, since each costs a whole second of the 1 Hz cadence. Null
                        targetJump means don't steer, which is every non-demo run. If nothing
                        can be placed it wins and overshoots rather than standing there.
                        LadderPlanner holds that plan between decisions; the ladder
                        functions themselves stay pure and take it as an argument. The plan
                        machinery below (BotPlan, isPlanViable, planStep, chooseDestination)
                        now lives in game/botMovement.ts, shared with v2.
                        A plan is an INTENTION ("occupy tile T standing on N boulders"), not
                        a recorded list of actions: the next action is re-derived from it
                        every tick, so a boulder a watcher steals mid-sequence is simply
                        rebuilt where a script would march on. It exists because deciding
                        afresh each tick means inferring past intent from present world
                        state, and the world does not record intent — boulders on a tile are
                        equally a pile being built or one half eaten. Every loop of note came
                        from that gap, and each was patched with a heuristic constant until
                        the plan replaced them (COMMITMENT and the halfBuilt scoring bonus
                        are both gone). isPlanViable() holds the give-up conditions:
                        achieved, fouled by a drain, overbuilt, out of reach, out of sight,
                        or already refused by the crosshair — that last one matters, since
                        commitment without it is stubbornness, pinning the bot to a tile it
                        has proved it cannot hit. Staleness is the driver's job
                        (MAX_PLAN_DECISIONS): a watcher eating a pile as fast as it is laid
                        looks tick-by-tick exactly like progress, so only elapsed time
                        reveals it.
                        The last rung is a hyperspace: with nothing else affordable or
                        legal the bot jumps out rather than stand still. That is a real
                        position, not a safety net — on the map's floor with every
                        neighbour higher there is no legal move at all, since nothing above
                        the eye can be targeted and absorbing needs the same clearance.
                        Every rung that targets an object must honour isBlocked: the
                        transfer rung didn't, so a Synthoid whose midriff sat behind a tree
                        was re-chosen every decision forever, the bot aiming at the obstacle
                        and never moving again.
                        The endgame rung (absorb the Sentinel -> body onto the pedestal ->
                        transfer -> hyperspace, which game/actions.ts turns into the win)
                        takes over once inAssaultPosition(), and MUST stay in charge for the
                        rest of the run once game.sentinelAbsorbed: otherwise stepping onto
                        the pedestal stops counting as "in position", the walk takes back
                        over and transfers the bot straight off it, one action from winning. The
                        transfer rung MUST outrank the reclaim rung: game.previousSynthoid
                        Col/Row is never cleared, so a cell the bot once left stays flagged
                        as "a body of ours" forever, and reclaiming first made it build a
                        body at its destination then immediately absorb it as though it
                        were the old one, forever.
                        computeHopField() is the navigator: a reverse BFS from the assault
                        tile over every flat tile, edges tested with terrainVisible() — a
                        cheap analytic line of sight over the height map alone (no scene,
                        no raycast), which is the only reason an O(tiles²) sweep is
                        affordable. Built once per landscape by the driver. Destinations
                        are then scored lexicographically by (hops, distance): hops alone
                        stops the bot strolling into a pocket that is near the goal but not
                        connected to it (the old straight-line greedy did exactly that,
                        then looped until the Sentinel killed it), while the distance
                        tiebreak keeps it moving within a hop band — on open ground every
                        tile in sight of the goal is 1 hop away, so hops alone would accept
                        only the goal tile and freeze the moment it was watched.
                        bouldersToSee(tileHeight, targetHeight) is the geometry the whole
                        movement model rests on: engine/visibility.ts refuses any target
                        at or above the eye, so a tile higher than the bot's feet can
                        never be aimed at, and height is only ever gained by piling
                        boulders on a tile already in view (bouldersToOutrank). The same
                        formula against the pedestal top reproduces utils/all-levels.js's
                        n = 2*gap + 1 pile rule. bouldersToOutrank returns the SMALLEST
                        pile that lifts the feet above our own: one boulder too many puts
                        the new body above our eye line, where it can't be seen and so
                        can't be transferred into — 3 energy spent on an unreachable body.
                        Zero is a valid answer (a tile already above our feet is a climb by
                        itself).
    bot2.ts             The v2 planner (PhasePlanner), built from the human strategy that
                        completed the game — see PLAN-BOT2.md.
                        THE GO-HOME RUNG (2026-08-24, landscape 7632): off the perch with the errand
                        list empty, transfer into the body standing on the perch. It exists because
                        rung 1 cannot do it — chooseTransfer filters out previousBody to stop a
                        two-body oscillation, and THE PERCH *IS* previousBody whenever the bot went
                        out to an errand destination it transferred into, while rung 2 protects that
                        same body as the way back up and the walk cannot rebuild a way home because
                        the perch tile is occupied by the very body it wants. Nothing but a transfer
                        clears previousBody (game.previousSynthoidCol/Row is never cleared), so the
                        state is PERMANENT and deterministic — 7632 failed three times identically,
                        with seven Sentries absorbed and 37 energy against a maxJump of 44. Two rules
                        that are each correct, in the wrong order: chooseTransfer's own comment
                        already lists "the perch we are coming home to" as a reason to transfer, and
                        the filter simply runs before the predicate. PLACED AFTER THE HARVEST
                        DELIBERATELY, not as an exemption inside that filter: at rung 1 the outbound
                        leg of a perch/body pair can be taken on o.height > body.height while the
                        return leg is always allowed by goingHome, so the two are a cycle with no
                        asymmetry to break it — which is what the filter is for. After the harvest
                        has declined and the errand list is empty there is nothing to oscillate
                        with, and the finish is taken on the next decision. Falls through to the walk
                        when a watcher has eaten the perch body (the tile is empty, so building on it
                        works) or the crosshair cannot reach it. Measured byte-identical on the
                        verdict block — 909, same buckets, same 91 losses, nothing flipped — as
                        PREDICTED: all fifteen watchdog-stalled losses there idle in ASCEND, so this
                        deadlock occurs nowhere in 6000-6999, which is why no win-rate measurement
                        could have found it.
                        RUNG 3C, FINISH UNDER A DRAIN (2026-08-24, reported from watching): on the
                        perch and in a watcher's sight, absorb the Sentinel instead of harvesting.
                        THE PURSE CANNOT GROW WHILE A WATCHER IS DRAINING YOU — a tree is +1 against
                        -1 a second, and a draining watcher never rotates away (drainLocked) — so
                        grazing there is not slow progress towards a bigger jump but exactly zero,
                        and negative once a second watcher joins. No threshold to tune. Worse, every
                        drain spawns a conservation tree, so the watcher restocks the shelf being
                        eaten from: HARVEST_BUDGET's comment names this loop and treats 80 decisions
                        as an adequate backstop, which on flat ground is the only thing that ever
                        ends it — 80 seconds of the 1 Hz cadence, most of DEMO_LEVEL_LIMIT_MS, so a
                        landscape already won is recorded out-of-clock and now blacklisted on the
                        third run. It is the rule rung 3b already STATED ("from the perch the answer
                        to being seen is to finish, not to wander") with only the not-wandering half
                        implemented. Fires for EXACTLY ONE DECISION per landscape: its first step is
                        always 'absorb the Sentinel', and that lands sentinelAbsorbed, which hands
                        the run to the unconditional guard at the top of decide() — a one-shot
                        trigger pulling the finish forward, not a second regime beside the harvest.
                        Not gated on affording the endgame (grazing cannot make us richer, and the
                        Sentinel is +4 and stops that watcher for good), and scoped to standing ON
                        the perch, since planEndgame does not test reachability and firing it
                        elsewhere would aim at a pedestal the bot cannot see. Measured 908 -> 909 on
                        the verdict block with every bucket flat and mean jump 35.6 -> 35.3: THE
                        AGGREGATE DID NOT MOVE, and out-of-clock stayed at 8, so the standoff was
                        not costing landscapes on that block. Kept for removing an
                        unbounded-in-principle loop at a small bounded price, not as a win-rate
                        change — see PLAN-BOT2.md postscript 13.
                        THE AIM NEVER NAMES THE TILE UNDERFOOT. aimAt is re-derived every decision and
                        tie-broken by nearest-to-the-body, so the tile being stood on could win it —
                        and control only reaches that line uncommitted, i.e. canAssaultFrom has just
                        refused that tile. A tile you stand on but cannot assault from is the one
                        place height can never be gained (the movement model builds on ANOTHER tile
                        and transfers up; isPlanViable reads a plan on the current tile as achieved),
                        so every rung deadlocks and the ladder hyperspaces out on a full purse. Worse,
                        the body left there makes it a LOOP: climb back, transfer onward into that
                        body, arrive on the dead-end tile again — which is why it escapes only when a
                        watcher eventually eats it. Excluded from the navigation aim ONLY, never from
                        the commit gate above, which must see the current tile or the bot would arrive
                        on the one viable assault tile with its pile built and refuse to commit.
                        Landscape 233, reported from watching: LOST at 34 transfers -> WON +21 at 9,
                        and 888 -> 898/1000 with out-of-clock 27 -> 16 (a busy loop keeps
                        lastActionAt moving, so only the elapsed-time watchdog limb ever sees it). Three differences from v1
                        and everything else shared: it plays in *phases* (secure the high
                        ground, clear the Sentries, harvest everything, then finish) rather
                        than one interleaved ladder; it grades tiles by predicted cover
                        (game/cone.ts) instead of present exposure, applied only to rank
                        tiles it was walking to anyway; and it keeps a **perch** — once
                        standing on the assault tile it holds that position for the rest of
                        the landscape, branching out to collect what's left and transferring
                        back up. (Transfer is the one action that can go upward: the
                        crosshair resolves a Synthoid above the eye where nothing else may
                        be targeted, so the body left on the pile is a ladder home.) The
                        harvest phase is the point: the jump you win is the energy left
                        over, and v1 stopped banking as soon as the endgame was affordable.
                        Since B4 (PLAN-BOT2.md) it also **commits by arriving**. survey() picks
                        NO assault tile: it finds the pedestal, computes the assault band, and
                        seeds one hop field from the whole band — a ladder to anywhere worth
                        arriving, which is why it needs no rebuilding and no retry. An *aim* is
                        re-derived every decision (aimAt, cheap via the cached sightlines), and
                        this.assault is set exactly once, to the tile under the bot's feet, the
                        first time canAssaultFrom accepts. So the tile is reachable because the
                        bot walked there. What that DELETED, and must not come back: the survey's
                        reachable-goal retry (rejectedTiles/MAX_RESURVEYS), the re-point, the
                        never-wired resurvey path, and the latched `phase` field — Phase is now a
                        readout derived per decision by phaseOf() (ASCEND/HARVEST/RETURN/FINISH;
                        CLEAR is gone, it only meant "this decision absorbed a Sentry"), and
                        intention() is keyed on committed-or-not plus the plan cell rather than on
                        the phase, because HARVEST and RETURN alternate freely and a flickering key
                        silently resets the driver's staleness backstop. this.assault is null for
                        the whole climb, so reachable()'s reserved, nextErrand and rung 2b all read
                        it defensively; only the pedestal is fatal to lack. ASCEND_BUDGET bounds
                        the aim's band restriction; lastResort() hyperspaces when no tile anywhere
                        can see the pedestal top, where the old guard returned null forever.
                        Two things B4 measured and did NOT keep, both recorded in BOT.md's
                        rejected table because they read as obvious improvements: freeing the
                        harvest walk from the assault-tile hop field (22/102 against 51 — the
                        confinement is accidentally standing in for a route home the movement
                        model lacks), and replacing the cut-off hatch with a no-height-gained test
                        (177/250 against 182 — a tall pile legitimately spends six or seven
                        decisions before it lifts anything). The cut-off hatch therefore stays,
                        but its meaning changed: band-seeded, !connected now means no route to
                        anywhere the Sentinel could be taken from.
                        Rung 3b, the **move-on** rung (2026-08-15, reported from watching): while in
                        sight and not yet perched, take the step the walk would have returned at rung
                        5 anyway, one rung earlier. Absorbing outranks walking, so with a tree in
                        reach and the purse low the bot always ate rather than moved — and since a
                        draining watcher never rotates away (drainLocked), one point in against one
                        point out is an equilibrium with no exit. NOT the flee rung, which has
                        measured negative six times: that one fires on cone contact and *adds* a
                        journey, this one adds nothing and falls through to the harvest unchanged
                        when the walk has nowhere to go. +6/250 and +16/1000, bled-out 17 -> 4,
                        while reading -3 on the 102 training set. It prices FINISHING the hop
                        (remainingHopCost) rather than the next action, and the drain taken while
                        making it is part of that price: paying action by action cost landscape 16,
                        where the bot laid a boulder under a cone at 7 energy, was drained, built the
                        body, and died one action short of a transfer it had already paid 5 for.
                        Priced on what REMAINS, not the whole hop — charging the full price every
                        decision refuses a half-paid hop and re-creates the grazing loop the rung
                        exists to close. 16 is pinned in the harness at both frame times.
                        Rung 2 reclaims **boulders as well as the body** at the cell just left. It
                        tested top.type === SYNTHOID, so once the body was absorbed the boulder under
                        it stood there forever and every hop ran at a net -2 (boulder 2 + body 3,
                        reclaim +3) — the rung's own comment claimed the walk cost "nothing net" and
                        it never had. Reported from a demo dying on landscape 16 with five boulders
                        abandoned against a maxJump of 22. +11/1000, purse ratio 78% -> 80%. Note the
                        geometry that bounds it: the body is hittable because it stands ON the
                        boulder, so absorbing it drops the boulder half a level and it can fall
                        behind the ridge the hop crossed — canHit then refuses, and the rung
                        correctly declines rather than looping.
                        The hyperspace rungs are guarded three ways, all from landscape 35, where the
                        bot jumped at energy 9 and was stranded at 2 four jumps later: it waits
                        STUCK_BEFORE_JUMPING = 3 consecutive dead decisions (one is transient — a cone
                        crossing the only tile, a body still materialising); it requires
                        energy >= HYPERSPACE_COST + SYNTHOID so it can still act on landing; and it
                        charges a hatch jump per LANDING rather than per proposal, since the 1 Hz
                        cadence refuses plenty and three refusals from one tile used to spend the whole
                        three-jump allowance without moving.
                        NOT done, and deliberately: making chooseDestination's speculative climb
                        boulder conditional on affordability. It scores +3/1000 and reads like a win,
                        but never-reached-assault-position goes 123 -> 150 with it — the gain is bought
                        in the opening and paid for out of the ascent, and the bot visibly climbs in
                        two steps where it climbed in one. Reverted; see PLAN-BOT2.md postscript 8,
                        which also records the plausible-but-false explanation that the boulder is an
                        aim anchor (it is not: one create per hop aims at bare terrain either way).
                        isPlanViable also takes an optional TilePreference now (v2 passes one, v1
                        does not, so v1 is untouched): a plan is dropped when a cone arrives on its
                        destination, graded against the boulders REMAINING rather than the original
                        pile. Measured exactly neutral — 188/250 with and without — and kept only
                        because it closes an unbounded leak for no measurable cost. It fires late by
                        construction (when the cone arrives, after the boulders are paid for); doing
                        better needs the exposure map (PLAN-EXPOSURE.md).
    botPlanners.ts      createPlanner(id) — the one place that knows both planners exist,
                        so nothing else imports a planner it isn't using. Selected by
                        settings.botPlanner (Settings -> Game -> Demo bot, debug-gated) and
                        by BOT_PLANNER in the harness.
    bot.test.ts         Planner coverage on synthetic landscapes: pile arithmetic vs the
                        utils/ formulas, assault-tile choice and its LOS rejection, the
                        never-hop-upward rule, watcher-shadow preference and its budget,
                        each rung of the ladder, the endgame sequence, and route steering's
                        surplus burn (denomination choice and step-down, no-surplus and
                        no-target cases, and winning anyway when nothing can be placed).
    bot2.test.ts        What makes v2 v2, on synthetic landscapes: cover graded by time
                        rather than by "is anything looking now", the phase split (climb
                        before banking, top up when it cannot afford to move, harvest from
                        the perch even with the endgame already affordable), value-ordered
                        harvesting, finishing once the landscape is picked clean, and the
                        two perch rules — never eat the body left on the pile, and go home
                        to it rather than treating it as just another body.
                        Plus B4's describe('committing by arriving'), which is the only place the
                        deferred commitment is observable: survey leaves committedTile() null and
                        the bot climbs anyway, it stays null while too low however good the tile
                        looks, it becomes the tile underfoot the moment canAssaultFrom accepts,
                        and a world where nothing can see the pedestal top hyperspaces instead of
                        idling. committedTile() exists as a read-only accessor precisely so those
                        can be asserted positively: the test this file used to carry for the
                        (never-wired) re-survey asserted only that a step's label was NOT
                        'clear the assault tile', which passed identically with the mechanism,
                        without it, or with it inverted. A negative assertion about a label, with
                        nothing positive about the behaviour in the title, is not a test.
                        Plus describe('finishing under a drain') for rung 3c — the deliberate pair to
                        'harvests from the perch even with the endgame already affordable': same
                        world, same reachable tree, opposite answer once the perch is in sight. Both
                        positive cases fail without the rung (verified by removing it). The scope case
                        asserts POSITIVELY that it keeps harvesting off the perch rather than merely
                        not finishing — a bare not.toBe there would pass with the rung, without it, or
                        with it inverted, which is the trap this file's own B4 note records.
                        Plus the two go-home cases in describe('the perch'): the deadlock world is
                        the existing 'never eats the body it left standing on the pile' world plus the
                        one field that caused it (previousBody pointing at the perch), and the
                        fall-through asserts the ladder still produces a move when the perch body has
                        been eaten — deliberately NOT which move, since it rebuilds via a neighbouring
                        tile (the pile top is already above the eye from there) and pinning that tile
                        would pin the fixture's geometry rather than the rung.
    cone.test.ts        The cone schedule. Its load-bearing case sweeps a 13x13
                        neighbourhood at all 256 facings and cross-checks the pure
                        unit-space predicate against engine/watcher.ts's own inWatcherCone,
                        excluding only the exact-edge tie (every cardinally-aligned cell at
                        the right facing, decided by float rounding inside Vector3.angleTo)
                        — and asserting separately that the predictor is never *less*
                        cautious than the engine.
    route.test.ts       heightGapOf against utils/all.csv's own column (including the two
                        gap-3 landscapes), isPlayableLanding's acceptances (0/1/2/272/9999 —
                        the landscapes bot.harness.test.ts asserts wins on) and rejections
                        (15/23/190/200, enclosed starts), and chooseDemoLanding's maximise /
                        step-down / land-exactly-on-9999 / nothing-to-steer-to behaviour.
                        Plus describe('steering around the blacklist'): a blacklisted landscape the
                        TERRAIN tests accept (so the rejection can only have come from the list),
                        one blacklisted after the memo was already populated, the jump stepping
                        down past it, and the fallback. That last case has to be built out of BOTH
                        kinds of rejection — every candidate failing isPlayableLanding while at
                        least one is not blacklisted — or the primary loop answers it and it tests
                        nothing; it also has to put the surviving candidate somewhere other than
                        `reach`, or it passes against the old unconditional fallback too. Both
                        traps were hit while writing it.
    random.ts           Seeded PRNG (mulberry32) for gameplay randomness — which tile a
                        hyperspace lands on, where a conservation tree appears, object
                        rotations. Reseeded per landscape from currentLevelId() +
                        game.levelEpoch, so a landscape plays out identically every time:
                        bugs reproduce, and engine/bot.harness.test.ts is a stable yardstick
                        rather than something that shifts between invocations.
                        Deliberately NOT world/terrain.ts's rng256 — that is the generator's
                        own LFSR, consumed in a fixed order to stay bit-identical to the
                        original game, re-seeded by every generateLevel() call (which the
                        menu and the level-code index make at arbitrary moments), and its
                        post-generation state is what produces the level codes. Drawing
                        gameplay values from it would make a run depend on whether someone
                        opened a menu. engine/particles.ts stays on Math.random: it is
                        cosmetic and driven by wall-clock frame timing, so it could never be
                        reproducible anyway.
    rules.ts            ENERGY_COST table and energyCostOf().
    turn.ts             TurnDriver — accumulator-based 4 Hz tick over rAF dt.
    timing.ts           TRANSFER_DELAY_MS = 1000, ACTION_COOLDOWN_MS = 1000,
                        WATCHER_GRACE_MS = 3000 (the lock-on stall — THE ONE NUMBER IN THE
                        DRAIN RULES THAT IS OURS: the original waits 5 s but also charged ~3 s
                        per transfer, so a nimbler player gets a shorter fuse. Settled by
                        playtesting). WON/LOST
                        have no timer for a human — WinScreen/LoseScreen dismiss on keypress
                        only. The demo-only timers live here too: DEMO_WIN_HOLD_MS = 4000 and
                        DEMO_LOSS_HOLD_MS = 3000 (App.svelte's supervisor — the end-screen
                        delay PLAN.md records as removed for human play, back for an audience
                        with nobody to press the key), plus the watchdog's
                        DEMO_NO_PROGRESS_MS = 30_000 and DEMO_LEVEL_LIMIT_MS = 300_000.
                        The two watchdog limbs catch different failures: no-progress catches
                        an idle bot, and the ceiling catches the *busy* one — 11 of the 102
                        sweep landscapes keep transferring and building without ever arriving,
                        so game.lastActionAt never stops moving and only elapsed time exposes
                        them.
    log.ts              Lightweight console.debug-based event logger.
    stats.test.ts       recordAbsorb/resetStats/load-save round-trip, plus the two-record
                        split: every recorder honouring setStatsTarget, the separate
                        localStorage keys, and a reset touching only the current record.
    state.test.ts       completeWon's 9999 cap + final-level skip, the once-per-run
                        gameCompletions guard, and the demo sandbox — a demo win advancing
                        only demoProgress/demoStats, the 9999 wrap back to 0, the cursor
                        holding on a loss, and resetDemoRun clearing it.
                        Plus describe('demo failure handling: strikes, blacklist and rewind'):
                        retry-in-place with a fresh levelEpoch each time, the third strike
                        blacklisting and rewinding to cameFrom, a win forgetting earlier failures,
                        the player's progress untouched throughout, and the three cases that hand
                        back to the menu (no cameFrom, the 9999 wrap leaving none, a blacklisted
                        rewind target).

  world/                               # Pure landscape + GameObject classes
    terrain.ts          Landscape generator — 1:1 port of Simon Owen's sentland Python.
                        BigInt 40-bit RNG, smoothing, despiking, object placement, codes.
                        Exports MAP_SIZE = 32 (fixed throughout the engine).
                        DO NOT touch casually: terrain.test.ts guards fingerprint parity.
    terrain.test.ts     Snapshot regression tests for levels 0 and 1 + structural checks
    objects/
      index.ts          Barrel re-export of all object classes
      base.ts           GameObject base class. remove() sets userData.skipRaycast the moment a
                        thing is absorbed: engine/scene.ts's objectsAt already treats it as gone, but
                        its MESH plays out a 1 s (squash) or 2 s (fade) animation, and until
                        2026-08-24 that corpse went on blocking engine/visibility.ts and resolving
                        under engine/picker.ts for the whole of it — one to two entire decisions at
                        the 1 Hz cadence, long enough for the bot to blacklist a cell the rules
                        considered clear, and for a human to click a thing that is not there. The
                        SPAWN animation is deliberately NOT treated this way: a materialising object
                        does exist to objectsAt and canPlaceAt, so it should block, and there the
                        rules and the raycasts already agree.
                        Owns spawn/absorb animations (playFade
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
                        unaffected. Exposes the rotation clock read-only as ticksToTurn /
                        turnPeriod, which is what game/cone.ts predicts from — a window,
                        not a way to reach in and reset it. Plus `turning` (mode !== 'idle'),
                        because ticksToTurn and rot describe DIFFERENT MOMENTS while a turn is in
                        flight: playTick resets the countdown when the turn is queued, rot only
                        commits when the animation ends TURN_DURATION_MS later. game/exposure.ts
                        reads it to shift its schedule by one turn for that window; game/cone.ts
                        does not, and documents the resulting ~2-tick lag instead.
      watcher.test.ts   That clock, driven through real ticks: the turn lands exactly when
                        ticksToTurn said it would and then every turnPeriod, rot advances
                        by one ±20 step in the generator's direction, and a prediction of
                        "in sight in N ticks" comes true on tick N and not before. The half
                        game/cone.test.ts cannot reach, since it tests *where* a cone
                        points rather than *when* it moves.
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

`utils/` holds ESM Node scripts that are not part of the build:

- `obj-shrink.js` — one-off vertex deduplication for `.obj` exports.
- `terrain.js` — plain-JS copy of `world/terrain.ts`, so the analysis scripts can generate landscapes without a TS toolchain.
- `all-levels.js` — sweeps all 10000 landscapes to `utils/all.csv` (`node utils/all-levels.js > utils/all.csv`): sentry/tree counts, total absorbable energy, `heightGap` (Sentinel's tile minus the highest other flat tile, which sets the absorb pile at `2*gap+1` boulders) and `maxJump` (`totalEnergy - 8 - 4*gap`, the largest landscape jump the level can fund — an upper bound, it assumes everything is absorbable and the pile tile has LOS to the Sentinel).
- `paths.js` — routes landscape 0 → 9999 over that CSV (edges `i+1 .. i+maxJump`), writing `path-shortest.csv` (220 hops), `path-easiest.csv` (fewest hops never exceeding 5 secondary sentries — 4 is provably infeasible) and `path-fewest-sentries.csv` (least cumulative difficulty).
- `block-sweep.sh` — plays a block of landscapes with the demo bot in parallel: `BLOCK=6000-6999 PLANNER=v2 ./utils/block-sweep.sh out/label`. Shards the block across `CHUNKS` (default 12) concurrent vitest processes, one log each, then aggregates. 1000 landscapes in ~6 minutes against ~14 sequential. **Pair pre/post runs at identical block, `CHUNKS` and `FRAME_MS`** — blocks differ in difficulty, so only a delta on the same block at the same chunking means anything.
- `sweep-aggregate.js` — re-aggregates those chunk logs into one summary, byte-compatible with the harness's own. Deliberately **ignores each chunk's `sweep summary`** (averaging averages over unequal slices is wrong) and recomputes from the per-landscape lines; warns when the landscape count falls short of `--expect`, since a silently truncated run reads as a lower win rate. `--snapshot` writes a committed-artifact table in the same shape as `bot-v2-*.txt`.
- `bot-v2-6000-6999-preB4.txt` — the pre-B4 baseline for the verdict block, kept so the comparison stays reproducible. `bot-v2-3000-3999.txt` is the older diagnosis-set snapshot. `bot-v2-6000-6999-preRULES.txt` / `-postRULES.txt` bracket the rules-fidelity work; `-postAIM.txt` is the current standing, 888/1000.

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

Phases 1–4 complete (Phase 4's save/load checkpoint deliberately dropped). Phase 4.5 (3D rendering optimization) complete: terrain merged to 4 meshes, game objects merged to 1 mesh each via shader-driven fade, debug grid merged to 1 LineSegments — orbit went from 40 FPS / 2393 draws to 60 FPS / 24 draws. Phase 3.5 (1 Hz player action cap + remove the in-cone scale pulse) complete. Phase 5 (real UI: pause/give-up, main menu + level codes, minimal HUD, help line, win/lose screens) implemented, pending a full manual playtest. Phase 8 (endgame content: level-9999 cap, lifetime stats, "Game Completed" screen, "Reset progress", per-completion rotation speedup) implemented, pending manual visual confirmation of the new WinScreen variants and reset flow (reaching landscape 9999 legitimately takes a full playthrough — see PLAN.md's Phase 8 section for a `localStorage`-based shortcut). Phase 7 (polish) is mostly done (action-cadence HUD cue, bird's-eye view, transfer/particle visual effects, skybox); audio remains open. The demo bot (D1–D4, `BOT.md`) is complete as an attract mode: it plays landscape after landscape unattended, steering each landing, on its own sandboxed progress and stats, with a watchdog closing out landscapes it can't finish. There are now two planners behind the same `BotPlanner` seam (`PLAN-BOT2.md`): the v1 ladder wins 69 of the 102 sweep landscapes banking 46% of the available jump, and the v2 phase planner — built from the human strategy that completed the game — wins 73 on that (training-set) sample, and 739/1000 on the fresh 6000-6999 block banking 80% of the available jump. `settings.botPlanner` selects between them and the browser demo defaults to v2. B4 is done: v2 no longer picks its assault tile before the run starts but climbs toward the assault *band* and commits to the tile under its feet the moment the endgame becomes possible. That landed at **parity** — 709/1000 against 712 on the fresh 6000-6999 verdict block, 182/250 against 181 on 3000-3249 — and its value is the simplification rather than the score: the re-point, the reachable-goal retry, a never-wired `resurvey` path and the latched `phase` field all came out, and the survey went from up to eight hop-field traversals per landscape to one. The measurement rig grew with it — loss-bucket histograms in the harness, and `utils/block-sweep.sh` + `utils/sweep-aggregate.js` to shard a 1000-landscape block across cores in ~6 minutes. Improving further is open-ended work, deliberately orthogonal to the D4 machinery. A follow-up pass from watching it play added the **move-on rung** (don't stand in a cone grazing trees while being drained — take the walk's own next step instead), worth +16/1000 on the verdict block with the `bled-out` loss bucket down from 17 to 4. Three more from watching: reclaim the **boulder** under the body just left, not only the body (landscape 16), make the move-on rung price finishing a hop rather than its next action (also 16, which it had silently regressed), and guard the hyperspace rungs against jumping on one bad decision, jumping broke, and burning the jump budget on refused attempts (landscape 35) — together 740/1000 on the verdict block, banking 80% of available jump with `never-reached-assault-position` at its lowest recorded. `PLAN-BOT2.md` names what's next: give the harvest a route home, the clock, the opening, then the persistent exposure map — extracted to its own `PLAN-EXPOSURE.md` (it outgrew being a v2 rung: it is engine-level sensing, indexed by cell, holding when each watcher will next be able to drain what stands there, relative to the first player action, and it comes with a debug visualisation of its own). `PLAN-BOT3.md` sketches a third planner built from the strategy rather than tuned from aggregates, and is not implemented. The exposure map's **sweep is implemented and validated** (`game/exposure.ts`): built once per landscape inside the frozen-time window before the player's first action (58 ms mean, 233 ms worst), immutable thereafter — a 64-bit cone mask plus a height window per (watcher, cell), read against the watchers' live clocks, so a rotation or a drain-lock stall needs no update at all. Its analytic line of sight is validated against the engine's raycaster by `engine/exposure.harness.test.ts` at 0.0064% unsafe over 217k samples on 50 landscapes, and the residue is an engine face-culling artifact rather than a model error. The **debug visualisation is in** too (`engine/exposureOverlay.ts`, Settings → Display → *Show exposure map*, debug-gated): one coloured square per flat cell on a single InstancedMesh — in sight / countdown ramp / clear / hidden by terrain / above every watcher's eye, with cells waiting on a drain-locked watcher's *held* turn ghosted to half opacity rather than recoloured (colour says when, alpha says whether the clock is running) — repainted on the 4 Hz tick so a drain-locked watcher's sector visibly freezes, plus a crosshair readout giving the exact ticks, the watcher responsible and the height window. It includes the **height stepper** (PageUp/PageDown/Home step the assumed pile by one boulder; the squares rise with it and cells flip from hidden to exposed, which is the only way the height *window* becomes visible). **No planner reads the map yet, deliberately** — it gets watched first, on the argument that every wall so far has been found by watching rather than by measuring. The demo's unattended behaviour is implemented but pending a manual soak (leave it running through several landscapes and confirm `localStorage`'s `state`/`stats` are untouched while `demoState`/`demoStats` grow). **Rules fidelity (`RULES-FIDELITY.md`, `PLAN-RULES.md`) is complete as of 2026-08-17.** A full review against the original game's manuals plus direct testing in Augmentinel (an embedded emulator running the actual Spectrum binary, so faithful by construction) found the implemented rules diverged in six places; all are now fixed, in five measured phases. **The surface rule** (R1): you act on the surface a thing stands on, never the thing — a tile's top face needs an eye above it, a boulder's side needs only line of sight, so a synthoid on bare ground can no longer be absorbed or transferred into through a hill, while one on a pile stays reachable. One predicate, `engine/scene.ts`'s `canTargetTopObject`, behind absorb, transfer and `BotWorld.canTarget`. **Hyperspace** (R2): the landing ceiling no longer rises when nothing fits under it. **The lock-on rule** (R3): a watcher's attention is one exclusive slot on the highest-priority target (synthoid → boulder → tree, nearest first), synthoids stall it for `WATCHER_GRACE_MS` and boulders do not, rotation freezes only on actually draining, player drains cumulate across watchers, and a transfer is no longer a free window. **The scan warning** (R4): `ui/ScanVignette.svelte`, the cue for *being watched* that we never had — we only ever signalled the point already lost. **Meanies** (R5): one at a time (it used to make one *per second*, indefinitely), sweeping rather than homing, reverting to a tree after a fruitless full turn, and testing the player's square rather than their body. Deliberate deviations are listed in `RULES-FIDELITY.md` §G and are unchanged in spirit: 1 Hz action cadence, 1 s transfer, mouse look, free bird's-eye, no suicide-by-hyperspace, and the pedestal jump floored to 1. A sixth divergence, **C9**, was found by *playing* rather than by testing: a watcher detected the player by their feet, which for a body on bare ground is its square, so the half-scan state that spawns a Meanie was unreachable unless the player stood on boulders — meaning the whole Meanie mechanic, and the R5 work above, had never once fired in a real game. Detection now falls back to the body's own model height for the player's body only. The demo bot went **740 → 861/1000** on the 6000-6999 block across the six fixes (`utils/bot-v2-6000-6999-preRULES.txt` → `-postRULES.txt`). Three results are worth carrying forward: the game got *easier* overall, not harder; the two biggest movers were both predicted backwards (the lock-on stall protects the player's own body far more than what they build, `died-in-opening` 100 → 15, and the Meanie swarm had been the most expensive thing in the game, `never-reached-assault-position` 116 → 52); and **C9 proves a rule verified only against a synthetic fixture is verified against the author's assumptions about the rule** — three 1000-landscape sweeps and five phases of unit tests all missed it. **Still pending: a full human playthrough.**

**The aiming pass (2026-08-24, `PLAN-BOT2.md` postscript 9) took the bot 861 → 888/1000**, and is the first change here to move *every* loss bucket in the right direction rather than trading one for another — because it is not a strategy change: it removes work the bot was declining for a reason that was never true. Both halves were reported from watching, and both are the same mistake at different scales — **a cell is not a point, and a model is not a column**. The aim asked about one point (a tile's centre) where everything upstream of it thinks in areas (`engine/visibility.ts` calls a cell reachable if *any of its four corners* is), so a tile whose centre sat behind a fold of ground was written off though most of its surface was in plain view; on landscape 35 that lost both of the bot's only two options and it hyperspaced away from a landscape it was winning. And `BotWorld.canHit` aimed a single ray at an object's bounding-box midpoint — which for the Meanie, a head floating over a tripod foot, is the **hollow between them** — so the rung added on 2026-08-17 to absorb Meanies on sight had never once fired in 1000 landscapes. `engine/bot.ts`'s `aimCandidates` now serves both the driver's aim (pre-flighted with `pickAlong`, so the first shot is one that arrives) and `canHit`, from one list: what the planner believes it can hit is exactly what the driver can deliver. Landscape 35 is now a win of +33 out of a possible 35 and is pinned in the harness. Note what this says about the C9 lesson above, which it repeats in a new key: **the Meanie-absorb path had a rung, a test suite and three 1000-landscape sweeps behind it, and had still never executed.** Absorbing a Meanie in a *human* game remains unexercised.

**A second pass the same day took it 888 → 898** (`PLAN-BOT2.md` postscript 10), again from a watched run, and again a case of two sources of truth. The bot's aim is re-derived every decision and tie-broken by nearest-to-the-body, so it could name **the tile it was standing on** — which is the one tile in a landscape that height can never be gained from, since the movement model climbs by building on *another* tile and transferring up. Every rung then deadlocks and the ladder hyperspaces out on a full purse; and because a body is left standing there, `transfer onward` pulls the bot back onto it after every climb, making it a permanent loop (it escapes only when a watcher eventually eats that body — which is how the reporter confirmed the mechanism). Landscape 233: LOST at 34 transfers → WON +21 at 9. The whole +10 comes out of `out-of-clock` (27 → 16), the bucket a *busy* loop lands in, since every jump moves `lastActionAt` and the no-progress watchdog limb never fires. Two correctness fixes surfaced underneath it, both measured neutral on 1000 landscapes and both kept because they delete a **false invariant** rather than tune a number: a rules refusal is a function of a cell's *contents* (not of where we stand), so a successful action there now clears the blacklist; and an object mid-absorb — which `objectsAt`, and therefore every rule in the game, already treats as gone — no longer blocks raycasts for the 1–2 s its animation runs, which had been long enough to blacklist cells the rules considered clear and to have a human click at a ghost. Particle bursts got the same `skipRaycast` flag, for the class rather than the incidence. **A third pass took it 898 → 908** (`PLAN-BOT2.md` postscript 11), from the other half of that same report: the bot building a three-boulder tower on a plainly exposed cell two squares from the Sentinel. The cause was not the missing exposure map but a missing *question*. Instrumented over 100 landscapes, **9% of adopted assault piles stood on a tile that would be watched before the pile could be finished, against 1% for the ordinary walk** — because the walk is graded by `coverPreference` and the assault path was graded by nothing at all, many of them on a tile a cone was on *at that moment*, which `coverPreference`'s `avoid` tier refuses outright. The largest commitment in a run was the one decision that asked nothing. `findAssaultTile` now takes an optional preference and rung 2b passes the one it already had; `out-of-clock` halved (18 → 8), because a tower laid into a live cone is not a clean loss but a *grind* — build, get eaten, rebuild — that keeps `lastActionAt` moving and so runs until the clock ends it. **Rejected in the same pass and worth recording**, because it was argued straight out of this codebase's own criticism of v1: `coverPreference` computes exact ticks and discards them into `{0,1,2}`, whose middle tier spans a quarter-second of cover to five seconds, and `pickVisible` then takes the candidate nearest the goal. Grading that tier by shortfall scored 907 against 908 **and left the doomed-plan count unmoved at 6** — the tier is only reached when nothing safe existed at all, and then every candidate is doomed. A tight argument built out of the code is not a measurement. **Still open, and now the only thing left for the exposure map:** `ticksUntilSeen` runs its watcher LOS test with `yOffset: 0`, so it answers when a watcher will see a tile's *ground* while the bot builds one to five boulders and stands on top — and the tile carrying the tallest pile is the assault tile, so the missing ask and the missing height window were two defects meeting on the same square. One is fixed; the other needs `ExposureSensor.view().read(col, row, height)`, which exists and is already validated against the engine's raycaster.

**Landscape 482 and the demo's failure handling (2026-08-24, `PLAN-BOT2.md` postscript 12, PLAN.md D5).** Reported from watching the demo stall, and the first reported wall that turned out to be **terrain rather than a bug**: the map holds exactly two flat tiles at or below the starting altitude — the pair the body starts on — so nothing can be climbed and hyperspace merely swaps between them. The bot's trace is a clean two-cycle (hyperspace across, reclaim the hull just left, hyperspace back) that is *energy-neutral*, acts successfully every second, and therefore lands in `out-of-clock` — the bucket a **busy** loop falls in, since `lastActionAt` never stops moving and the 30 s no-progress watchdog limb never fires. Three things came out of it. **A rules bug the bot could not reach:** playing 482 by hand you hyperspace *without* absorbing your old hull first, both tiles are then occupied, and the old code had already spent the 3 before discovering there was nowhere to go — reporting success while the camera never moved. It was the only action in the game that could bill you for having no effect, and hyperspace's 3 is the one cost a landscape can never absorb back, so it was an unbounded drain to zero. Now refused and retryable (`RULES-FIDELITY.md` E6; E3's absolute ceiling untouched), and measured neutral for the bot — 96/102 and 908/1000 with identical buckets and identical loss lists. Worth carrying forward as a pattern: **the bot's trace and a human's playthrough found two different bugs on the same square**, and the one the bot could not reach is the one that loses a human the landscape — a habit as small as "always absorb your old hull" hid the whole branch. **The three-strike blacklist**, in the reactive form `PLAN-BOT2.md` specified in advance and then declined to build: a demo loss now retries in place, and the third consecutive failure blacklists the landscape and **rewinds the cursor to the landscape whose win paid for it**, which is replayed and steered onto a different landing. The rewind, not the list, is load-bearing — it is what keeps every landing *earned* — and it needed no new steering code, since `chooseDemoLanding` already scanned downward and `planSurplusBurn` already spent the surplus. **A pathology the mechanism created:** `chooseDemoLanding`'s "nothing playable, take the longest jump anyway" fallback was near-unreachable at 96% playable, but the blacklist *grows towards it* (every rewind returns to the same landscape, whose window loses a candidate each round), and landing on a blacklisted landscape would earn three fresh strikes and another rewind to the same place — a loop that plays, so no watchdog sees it. Also **measured and rejected**: capping rung 6 (`boxed in — hyperspace out`), the only hyperspace rung without a `MAX_HATCH_JUMPS` budget and the driver of 91 of 482's 93 jumps. It turns 482 from a 300 s busy loop into a 35 s clean stall, 8.6× faster to a verdict — and costs 908 → **907** on the verdict block and 96 → 95 on the 102 set, consistent in direction across both. Left uncapped; 15 minutes is the cost of blacklisting a landscape *once*. **Pending: a manual soak** of the strike/rewind cycle.

**The perch standoff (2026-08-24, `PLAN-BOT2.md` postscript 13).** Reported from watching: perched, one action from winning, drained by a watcher — and absorbing trees instead, drain a point, eat a tree, repeat, *"in every case we eventually ran out of trees and won"*. The reporter's own diagnosis was the important part: on ground flat enough that every conservation tree lands in view, it could last forever. **The purse cannot grow while a watcher is draining you** — a tree is +1 against −1 a second, and a draining watcher never rotates away — so grazing there is not slow progress towards a bigger jump, it is exactly zero, and negative once a second watcher joins. No threshold to tune. And the supply refills at the rate it is consumed, since every drain spawns a tree: `HARVEST_BUDGET`'s comment names this precise loop and treats 80 decisions as an adequate backstop, which on flat ground is the *only* thing that ends it — 80 seconds of the 1 Hz cadence, most of `DEMO_LEVEL_LIMIT_MS`, so a landscape already won is recorded `out-of-clock` and, since the blacklist, given a strike for it. Rung 3b had already *stated* the rule (*"from the perch the answer to being seen is to finish, not to wander"*) with only the not-wandering half implemented. **Rung 3c** implements the other half, fires for exactly one decision per landscape (its first step is always `absorb the Sentinel`, which sets `sentinelAbsorbed` and hands the run to the unconditional endgame guard), and is worth reading as a **measurement that did not move**: 908 → 909 on the verdict block, every bucket flat, `out-of-clock` unchanged at 8 — so on that block the standoff was not costing landscapes, exactly as reported. The cost is jump, −0.3 mean (−0.8%), being the harvest it no longer finishes. Kept for removing an unbounded-in-principle loop at a small bounded price, and flagged as such rather than defended as a win-rate change.

Phase 6 (mobile/touch) is superseded by `PLAN-MOBILE.md`: its Phase M0 (device workflow & platform plumbing) has every code-side bullet implemented — touch-gesture suppression, web app manifest, fullscreen+orientation-lock-on-Start, portrait fallback overlay, Android back-gesture guard — but the on-device verification pass (Tab S6 Lite, Chrome + Samsung Internet) and the two hardware-only bullets (remote debugging setup, baseline perf capture) are still open; none of that can be confirmed without the actual device. Authoritative lists are `PLAN.md` and `PLAN-MOBILE.md`.

Engine / rules summary:
- `game/state.svelte.ts`: state machine, energy economy (`spendEnergy`, `gainEnergy`, `drainEnergy`, `floorEnergyForPedestalHyperspace`), watcher dormancy flag (`firstActionTaken` + `markFirstAction`), action cadence gate (`lastActionAt` + `canPerformAction`, `ACTION_COOLDOWN_MS = 1000` in `game/timing.ts`), Sentinel absorb lock, transfer/win/lost trigger + complete pairs. `levelEpoch` counter forces a same-`levelId` scene rebuild after LOST.
- `game/actions.ts`: pure rules layer. `performTargetedAction`, `performHyperspace`, `pickHyperspaceTile`. Operates through an `ActionContext` interface so the rules code carries no `three` value imports at runtime — `engine/actions.ts` builds the context from sceneData + camera per action.
- Action cadence cap: `engine/actions.ts`'s `handleKeyActions`/`handleMouseAction` check `canPerformAction(time)` (pure, `game/state.svelte.ts`) once a valid target/key is identified, matching the watchers' 1 Hz tempo. `performTargetedAction`/`performHyperspace` (`game/actions.ts`) now return whether the action actually took effect; only a `true` result calls `markActionPerformed(time)` to start the cooldown. A failed attempt (no target, blocked placement, insufficient energy) leaves `lastActionAt` untouched, so it can be retried immediately — only real actions are rate-limited. Transfer/hyperspace are additionally self-limiting via the TRANSFER phase. `Hud.svelte`'s cooldown bar visualizes the same `lastActionAt`/`ACTION_COOLDOWN_MS` window.
- `engine/picker.ts`: shared raycaster — returns a discriminated `Pick` ('object' with a `gameObject` back-ref, or 'terrain' with 'plane'/'slope'). Cone overlays carry `userData.skipRaycast` and are filtered out.
- `engine/visibility.ts:isCellVisibleFrom`: optimistic — corner is reached unless a non-skipped hit is closer than `target − EPS`. Skips invisible objects (the player's hidden active body), target-cell + source-cell hits, and skipRaycast meshes.
- `engine/watcher.ts:runDrainPhase`: 1 Hz drain phase over Sentinel + Sentry. Per cell, the topmost Synthoid/Boulder is the drain target — a tree shields nothing, but a tree on a boulder is itself drainable. Synthoid → Boulder and Boulder → Tree morph in-place via a 500 ms absorb + 500 ms deferredSpawn at `animationScale=2`. Tree drain just removes; conservation tree spawns elsewhere on every successful drain.
- **The lock-on rule** (`RULES-FIDELITY.md` C6/C7, `PLAN-RULES.md` R3). A watcher's attention is a **single exclusive slot** on the **highest-priority** target in its cone — *synthoids first, then boulders, then trees-on-boulders, nearest first within each class* (`drainPriority`). Type beats distance: the boulder a just-drained synthoid leaves behind is not touched until every other synthoid is gone. While that slot is occupied everything else is ignored, which is what makes **parking a shell in front of a pile shield it**. A **synthoid** target stalls the watcher for `WATCHER_GRACE_MS` before the first point is taken; a **boulder** is taken on the tick it is seen. `Watcher.drainLocked` tracks *actually draining*, not merely having a target, so a watcher counting down keeps rotating and loses the target if its beam carries it away — waiting the beam out is as valid an escape as breaking LOS.
- Player-pool drain: when a watcher's slot holds the active body and the tile is visible, `drainEnergy(1, 'watcher-pool')` + a 200 ms red-border canvas flash (`game.drainPulseAt`). **Drains cumulate**: the player's body is exempt from the per-tick one-drain-per-item cap, so three watchers holding your square cost three energy a second. A transfer is **not** a shield — the lock keeps running on the body you are gliding into and the drain lands on arrival; only the *effect* is deferred, so the shell cannot morph to a boulder around the camera mid-glide.
- **The scan warning** (`game.scanState`/`scanWatchers`/`scanElapsedMs`/`scanUpdatedAt`, published by `setScanState()` once per drain tick): `'full'` when a watcher's slot holds you and can see your square, `'partial'` when it sees your body but not your square (no drain — a Meanie instead), `'none'` otherwise. Rendered by `ui/ScanVignette.svelte`.
- `engine/meanie.ts`: **one live Meanie at a time**. It **sweeps** at a fixed rate in a fixed direction (16/256 per 4 Hz tick, so a full turn in 16 ticks) rather than homing, and tests the player's **square** (`yOffset 0`), not their body — its parent spawned it precisely for failing that test. On a sighting, `forceHyperspace` (drains 3, teleports via `pickHyperspaceTile` + `beginTransfer`). After one full sweep (`Meanie.sweptUnits >= 256`) with no sighting it **reverts to a tree**, conserving energy, and its parent resumes scanning. `triggerMeanieConversion` runs on a watcher seeing the body but not the tile — closest tree → animated Meanie at the drain pacing.
- Active body is hidden (`visible=false`) on game start and each transfer. Old body becomes visible again on transfer and faces the new body via `GameObject.faceTowards`.
- Transfer: `beginTransfer` sets phase=TRANSFER and `MainView.svelte`'s Effect 3b calls `CameraController.beginTransferAnim(col, row, objectHeight?)`, which eases the camera's position (not orientation/FOV) from wherever it currently is to the new body's eye position (correct height for the boulder-stack case, via the same `eyeHeightFor` helper `resetToPosition` uses) over `TRANSFER_DELAY_MS` (1 s, `easeInOutCubic`). The old body crossfades transparent→solid and the new body solid→transparent in lockstep with the glide (`camCtrl.transferProgress`, consumed by `MainView`'s per-frame `onStats` callback via `GameObject.setViewOpacity` — the same fade shader bird's-eye uses), and the old body's model still rotates to face the new one (`faceTowards`) — but the camera itself is never re-aimed at it (the old "look back" `lookAtCell` call is gone: direction/vertical/fov stay exactly as they were before the transfer). Mouse-look and all actions are blocked for the whole glide (`updateTransfer` drains mouse delta without applying it; `TRANSFER` is its own branch in `engine/loop.ts`, no longer sharing `updateLook` with PLAYING). `engine/loop.ts` calls `completeTransfer()` (TRANSFER → PLAYING) once `updateTransfer` reports the glide finished — no separate timer. Pausing mid-glide freezes it exactly like the rest of the game (`updateTransfer` only runs while pointer-locked, so it's simply not called during PAUSED) and resuming continues it from exactly where it left off — see `pausedFrom` under Game phases below.
- Hyperspace: spends 3, then either triggers WON (active body on a pedestal) or places a fresh synthoid on a random eligible tile and transfers. The landing ceiling is the body's **altitude** (boulders included, so "climb the tower then jump off it" is a real option) and it is **absolute** — `pickHyperspaceTile` returns null rather than raising it. **The landing is resolved BEFORE the energy is charged** (`RULES-FIDELITY.md` E6, 2026-08-24): a jump with nowhere to land is *refused*, not billed. It used to spend the 3 first and report success, which made hyperspace the only action in the game that could charge for having no effect — and the 3 leaves a landscape permanently, where every other cost stands somewhere absorbable, so on a map with nowhere to land it was an unbounded drain to zero with no cue that anything had gone wrong. Refusing follows E2's line (a voluntary hyperspace is never a way to lose) and stays retryable, since `engine/actions.ts` only starts the 1 Hz cooldown on a `true` return. Found by *playing* landscape 482, not by the demo bot, which always absorbs its old hull first and so never reached the branch — the C9 lesson in another key. Deliberate deviations, both recorded in `RULES-FIDELITY.md` §G: the original *kills* you for a voluntary hyperspace under 3 energy where we refuse the keypress, and it jumps you 0 landscapes where we floor the winning jump to 1. Forced hyperspace (Meanie) uses `drainEnergy` instead of `spendEnergy` so it can push to LOST. The pedestal/WON path is let through even when the 3-energy spend is refused, and also floors the exact-3 case (spend succeeds, 0 left) — `game/state.svelte.ts`'s `floorEnergyForPedestalHyperspace()` sets `game.energy` to 1 so `completeWon()`'s jump is never zero. Without the first part, a player who reaches the pedestal on fewer than 3 energy would be permanently stuck (absorb is already locked post-Sentinel, so there'd be no way left to earn the energy back); without the second, arriving with exactly 3 energy would jump 0 landscapes while arriving with less (floored to 1) jumps 1 — a worse arrival outjumping a better one.
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
- `U`: absorb targeted object (gain its energy value). Subject to the **surface rule** (`engine/scene.ts`'s `canTargetTopObject`, see below). Locked for the rest of the level after the Sentinel is absorbed.
- `Space` / `Enter`: transfer to targeted Synthoid. Free, but subject to the **same surface rule** as absorbing one — the crosshair resolving the model is not enough.
- **The surface rule** (`RULES-FIDELITY.md` A1/A3, `PLAN-RULES.md` R1): you act on the *surface a thing stands on*, never on the thing. Two surfaces are targetable — a tile's top face, visible only from an eye above it, and a boulder's side, visible from anywhere with clear LOS ("boulders act as an extension of the square surface"). So: a boulder is always takeable; anything standing **on a boulder** is takeable with no LOS at all (which is what keeps transferring up a tower legal); anything on **bare terrain** needs LOS to its tile; anything on the **pedestal** — the Sentinel, or the synthoid placed there to win — needs LOS to the pedestal top (`yOffset = 1`). One predicate, two callers: `removeObjectFromScene` for absorb, `ActionContext.canTarget` for transfer, so the two cannot drift. The demo bot reaches the same predicate through `BotWorld.canTarget` rather than deriving it — see `engine/bot.ts`.
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

**DEMO** (`game.demo`, not a phase): the `Demo` menu entry runs the bot's *own* landscape — resumed from `game/demo.svelte.ts`'s cursor, which is why the entry is labelled with that number rather than silently ignoring the level selected below — under `engine/bot.ts` instead of a human. It stays in the ordinary PLAYING/TRANSFER phases under the ordinary rules — the flag only changes *who drives*: `MainView.svelte`'s Effect 3c skips the pointer-lock request (grabbing the watcher's cursor would be rude, and Escape would then pause a demo nobody is there to resume), and `engine/loop.ts` accepts the bot in place of a held lock for the phases it drives. Any key or click (bare modifiers excepted, as in `PauseOverlay`) calls `exitDemo()` → MENU. Unlike `Start`, it does not request fullscreen/orientation lock.

It is an **attract mode**: `App.svelte`'s demo supervisor holds the end screen for a beat and then either calls `advanceDemo()` (a win — straight into the next landscape, no trip through MENU) or `failDemo()` (a loss, including the watchdog's verdict). A loss still deliberately does **not** skip ahead — stepping over a landscape the bot can't win would hand it a landing it never earned — but since 2026-08-24 it no longer stops the demo either: the landscape is retried in place, and **three consecutive failures blacklist it and rewind the cursor to the landscape whose win paid for it**, which is then replayed and steered onto a different landing. See `failDemo()` above and `BOT.md`'s *Giving up on a landscape*. The blacklist is the deliverable of an unattended soak — a landscape on it is either genuinely dead (482) or the next thing to fix — so it is surfaced as a `N skipped` count on the `Demo` menu entry, and `Settings → Reset demo progress` is the only thing that clears it.

Nothing a demo does reaches the player's record. It has its own level cursor and unlocked list (`game/demo.svelte.ts`, localStorage `'demoState'`) and its own lifetime stats (`demoStats`, key `'demoStats'`), so an unattended overnight run can't unlock landscapes nobody played, can't inflate a counter, and — the leak a reset wouldn't undo — can't bump the player's `gameCompletions` and permanently speed up their watchers. It steers its landings too: see `game/route.ts` and `planSurplusBurn` in `game/bot.ts`.

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
