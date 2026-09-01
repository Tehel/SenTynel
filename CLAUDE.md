# SenTynel

Personal, educational reimplementation of Geoff Crammond's *The Sentinel* (1986) in the browser. Playable end to end — landscape generation, the full rule set, UI, and a demo bot that plays unattended. Full roadmap and decisions live in `PLAN.md`; read it before any significant work.

**Where the detail lives.** This file is the orientation document — keep it that way.
The deep material lives in companion docs, none of which are loaded into context
automatically:

| Document | Holds |
|---|---|
| `ARCHITECTURE.md` | The fully annotated source tree — why each module is shaped as it is, and the "don't re-try that" notes |
| `PLAN.md` | The roadmap and phase-by-phase task list (authoritative) |
| `PLAN-MOBILE.md` | Mobile/touch work, superseding old Phase 6 (authoritative) |
| `PLAN-SOUND.md` | Audio — the sample set, what was measured off it, the conversion pipeline and the plan (authoritative) |
| `BOT.md` | How the demo bot works |
| `PLAN-BOT2.md` | The v2 planner's design, work plan, and postscripts 1–17 (one per investigation) |
| `PLAN-BOT3.md` | A third planner, sketched only |
| `PLAN-EXPOSURE.md` | The exposure map and its visualisation |
| `RULES-FIDELITY.md` | Rules vs. the original game, clause by clause, plus §G's deliberate deviations |
| `PLAN-RULES.md` | The five-phase plan that closed those divergences |
| `STRATEGY-HUMAN.md` | The human account of completing the game, which v2 is built from |

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

`npm run docker:deploy` needs a `.env` at the repo root. It is **gitignored and stays that way** —
it names the deployment host and login, and nothing committed may. Copy `.env.example` and fill it
in; `utils/deploy.sh` reads `DEPLOY_REMOTE`, `DEPLOY_REMOTE_DIR` and `DEPLOY_IMAGE` from it and
aborts before doing any work if `DEPLOY_REMOTE` is unset. The history was rewritten once, in
September 2026, to remove a hardcoded target that had been public on GitHub — so this is a rule
about the repo, not a preference.

## Source layout (`src/`)

**`ARCHITECTURE.md` holds the fully annotated version of this tree** — why each module
is shaped the way it is, and the "we tried that, don't re-try it" notes. Read it before
significant work in an area; the one-liners below are an index, not the reasoning.

```
src/
  main.ts               Svelte entry — mount() App to document.body
  shoot/shoot.ts        Still-frame renderer for headless screenshots (dev-server only, never
                        ships). Imports buildScene directly; driven by utils/shoot.mjs
  App.svelte            Composes MainView/Hud/phase-keyed overlay/PortraitOverlay; owns the
                        demo supervisor, the Android back-gesture guard, and the touch-device
                        auto-start into demo mode
  settings.svelte.ts    Runes-based persistent settings (localStorage)

  ui/
    MainView.svelte     Canvas host; wires the engine modules together (5 effects)
    Hud.svelte          Energy icons, the action-cooldown bar, and the landscape number
                        (top-right, from currentLevelId() so a demo names its own)
    MainMenu.svelte     Arrow-key menu tree; the mirrored Play/Demo lines (Enter starts,
                        Left/Right steps that cursor's unlocked list, Delete resets it),
                        level codes, settings
    PauseOverlay.svelte Shown during PAUSED; Escape gives up, any other key resumes. On a touch
                        demo instead: the drag-with-momentum landscape picker (Scrubber + its
                        rAF loop) and a confirm-stepped "Reset demo progress" button
    WinScreen.svelte    WON overlay — normal / capped-at-9999 / final "Game Completed"
    LoseScreen.svelte   LOST overlay; title from game.lostReason
    HelpLine.svelte     Two static lines of key/mouse bindings, PLAYING only ("Tap to pause"
                        replaces the exit line on touch)
    ScanVignette.svelte The "you are seen" cue — screen-edge vignette whose ramp is the
                        lock-on countdown (RULES-FIDELITY.md C6)
    PortraitOverlay.svelte  CSS-only "rotate your device" screen
    icons.ts            HUD energy icons — the original base64 PNGs, plus a redrawn SVG set used
                        while settings.modelStyle is 'enhanced' (iconSrc picks between them)

  engine/                              # Three.js-backed render + game-loop layer
    renderer.ts         WebGLRenderer + rAF loop
    scene.ts            buildScene, add/replace/removeObjectToScene, finishUnsupportedCorpses,
                        canPlaceAt, objectsAt, topObjectAt, canTargetTopObject (the surface
                        rule). Owns SceneData
    camera.ts           CameraController — free-flight, look-only, transfer glide, orbit,
                        bird's-eye. EYE_HEIGHT = 0.875
    input.ts            Keyboard state, mouse delta, pointer-lock lifecycle
    loop.ts             GameLoop — play(), 4 Hz TurnDriver, 1 Hz drain, meanie phase,
                        the corpse sweep, sun orbit, render, stat callbacks
    picker.ts           pickTarget/pickAlong — the shared raycaster, returns a discriminated Pick
    visibility.ts       isCellVisibleFrom — raycast LOS primitive
    actions.ts          Engine wire-up: builds ActionContext, performEngineAction/
                        …Hyperspace/…ActionOn, key+mouse handlers, isBirdsEyeTrigger
    watcher.ts          1 Hz drain phase — the lock-on rule, atomic morphs, meanie trigger
    meanie.ts           triggerMeanieConversion + runMeaniePhase (one at a time, sweeping)
    cones.ts            Watcher view-cone debug overlay
    particles.ts        Create/absorb particle burst — 30 cubes on one InstancedMesh
    exposureSensor.ts   Live half of the exposure map: builds it once, resolves watcher
                        clocks into an ExposureView. Owned by SceneData as `exposure`
    exposureOverlay.ts  Debug visualisation of that map — one InstancedMesh, five states,
                        held-turn hatching, height stepper (PageUp/PageDown/Home)
    disposer.ts         GPU resource registry, disposeAll()
    audio.ts            The audio layer — one AudioContext, a log volume curve, a 12-voice
                        PositionalAudio pool on 'equalpower', streamed music. NOTHING TOUCHES A
                        BROWSER API AT IMPORT TIME: scene.ts calls into it and the Node bot
                        harness loads scene.ts, so every entry point no-ops until initAudio()
    textures.ts         Procedural terrain textures — module-level cache, same shape as skybox.ts
                        (and fails the same way in Node, which the bot harness depends on)
    platform.ts         isTouchCapable(), enterFullscreenLandscape() (navigationUI: 'hide', so
                        Android's own bars go too), exitFullscreen(), setWakeLockWanted()
    touchGestures.ts    Touch input mechanics for the demo's controls, pure and DOM-free so the
                        thresholds and the whole of the physics are unit-tested without a
                        browser: the "was that a tap?" track, and the inertial Scrubber behind
                        the landscape picker
    bot.ts              Demo-mode BotDriver — a virtual *player*: snapshots the scene into
                        a BotWorld, eases the real camera, calls the same action path.
                        Owns aimCandidates and the demo watchdog
    fonts/              Vendored Three.js Font/TextGeometry + trimmed glyph data
    *.test.ts           bot.harness (headless bot observatory — the way to debug the demo; it now
                        also checks every frame of every run for anything standing on air),
                        morph (the atomic drain morph and the corpse rule, A5b),
                        bot.watchdog (the PAUSED-demo compensation, which the harness cannot
                        reach), exposure.harness (analytic LOS vs. the raycaster),
                        exposureSensor, exposureOverlay, touchGestures, watcher, meanie,
                        scene, visibility

  game/                                # Pure game rules — no `three` value imports at runtime
    state.svelte.ts     Phase state machine, energy economy, level/demo progression.
                        currentLevelId(), beginLevel(), stepLevelId(), the demo
                        strike/blacklist/rewind, resumeDemo()/resetDemoAndRestart()
    stats.svelte.ts     Lifetime stats in two records (player + demo), switched by
                        setStatsTarget; every mutation goes through a recorder
    demo.svelte.ts      The demo bot's own saved progress, plus the three-strike blacklist
    route.ts            Which landscape the demo plays next — heightGapOf, isPlayableLanding,
                        chooseDemoLanding
    actions.ts          performTargetedAction / performHyperspace / pickHyperspaceTile,
                        through an ActionContext so no `three` is loaded
    levelCodes.ts       findLevelByCode + the sharded-Worker index build
    codeCipher.ts       Cumulative-XOR cipher for the persisted code index
    codeIndexer.worker.ts  One shard's generateLevel codes, off the main thread
    exposure.ts         The exposure map, pure: per (watcher, cell) a 64-bit cone mask plus
                        an analytic height window. Built once, never mutated
    cone.ts             Watcher cone prediction, pure — closed-form future schedule
    botWorld.ts         The planner/driver contract: BotStep, BotWorld, BotPlanner
    botGeometry.ts      Arithmetic and terrain analysis every planner needs — pile sizing,
                        computeHopField, assault candidates/band, findAssaultTile
    botMovement.ts      How the bot moves: BotPlan, isPlanViable, planStep, chooseDestination
    botEndgame.ts       The finish, shared: inAssaultPosition, planEndgame, planSurplusBurn
    bot.ts              The v1 planner — a priority ladder (LadderPlanner)
    bot2.ts             The v2 planner — phases, predicted cover, the perch (PhasePlanner)
    botPlanners.ts      createPlanner(id) — the one place that knows both planners exist
    random.ts           Seeded PRNG for gameplay randomness, reseeded per landscape
    rules.ts            ENERGY_COST table and energyCostOf()
    turn.ts             TurnDriver — accumulator-based 4 Hz tick over rAF dt
    timing.ts           TRANSFER_DELAY_MS, ACTION_COOLDOWN_MS, WATCHER_GRACE_MS, demo timers
    log.ts              Lightweight console.debug-based event logger
    *.test.ts           actions, levelCodes, codeCipher, exposure, cone, route, bot, bot2,
                        stats, state

  world/                               # Pure landscape + GameObject classes
    terrain.ts          Landscape generator — 1:1 port of Simon Owen's sentland Python.
                        DO NOT touch casually: terrain.test.ts guards fingerprint parity
    terrain.test.ts     Snapshot regression tests for levels 0 and 1 + structural checks
    objects/
      base.ts           GameObject base — spawn/absorb animations, skipRaycast on absorb,
                        faceTowards, the userData back-reference
      watcher.ts        Watcher base — rotation clock, drainLocked, per-completion speedup
      sentinel.ts / sentry.ts / synthoid.ts / boulder.ts / tree.ts / pedestal.ts / meanie.ts
      index.ts          Barrel re-export
      models/           Model registry (getObject → one merged Mesh) + raw vertex/face data
```

`utils/` holds ESM Node scripts that are not part of the build — `terrain.js` (plain-JS
copy of the generator), `all-levels.js` (sweeps all 10000 landscapes to `all.csv` with
`heightGap` and `maxJump`), `paths.js` (routes 0 → 9999 over that CSV), `block-sweep.sh`
+ `sweep-aggregate.js` (shard a 1000-landscape bot sweep across cores in ~6 minutes;
**pair pre/post runs at identical block, `CHUNKS` and `FRAME_MS`**), `obj-shrink.js`, and
the committed `bot-v2-*.txt` sweep snapshots. See `ARCHITECTURE.md` for the full notes.

`utils/audio-menu-check.mjs` (run through `drive.mjs`) is a referee for the bug this codebase has
now made twice: **a Svelte effect depends on what everything it calls reads**, so a settings read
buried inside `initAudio` made an audio menu entry rebuild the WebGL renderer — exactly as
`buildScene` once did to Effect 2. It counts `getContext` calls after mount; verified to read 8 on
the broken build and 0 on the fixed one.

`utils/` also holds the audio pipeline (`PLAN-SOUND.md`): `convert-sounds.sh` carries the **manifest
of what ships** and encodes it — its header holds the measured reason for every setting plus a
"tried, does nothing" list; `gen-sounds.py` synthesizes the five cues no sample covers (absorb/create
as an inverse pair, transfer's gust, hyperspace's voluntary and forced readings) into
`sounds/candidates/`, and is a design tool meant to be re-tuned rather than a one-shot;
`sound-snr.py` is the referee, gain-matched SNR against a source. **Its >=15 dB floor is calibrated
on the ADPCM rips and does not apply to the synthesized sounds** — those are band-passed noise,
which no codec reproduces waveform-wise, so judge them on spectral envelope instead.

`public/sounds/` holds the eleven shipping `.m4a` files (4.0 MB, of which `music.m4a` is 3.6 MB and
wants lazy-loading — only the menu and the touch pause screen use it). The Augmentinel `.wav` rips
they came from are **untracked and not in the repo**, so those six cannot be rebuilt without them;
the five synthesized ones always can, via `utils/gen-sounds.py`.

`public/` holds `favicon.png`, `manifest.webmanifest`, six equirectangular skybox `.webp`s (only
`kloppenheim_07` is referenced by a theme today), the procedural terrain textures in `public/tex/`,
and a dozen unreferenced box-art scans. Vite copies the lot to `dist/` at build time.

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

`PLAN.md`, `PLAN-MOBILE.md` and `PLAN-SOUND.md` are the authoritative task lists. This is the summary.

| Area | Status |
|---|---|
| Phases 1–4 | Complete (Phase 4's save/load checkpoint deliberately dropped) |
| Phase 4.5 — render optimization | Complete: terrain → 4 meshes, one mesh per object, grid → 1 LineSegments. Orbit 40 FPS / 2393 draws → 60 FPS / 24 draws |
| Phase 3.5 — 1 Hz action cap | Complete |
| Phase 5 — real UI | Implemented, **pending a full manual playtest** |
| Phase 7 — polish | Mostly done (cadence cue, bird's-eye, transfer/particle effects, skybox). **Audio complete 2026-09-01 (`engine/audio.ts`), playtested on desktop and tablet: 12 sounds, positional where it means something, log volume curve, touch slider, music paused on backgrounding. Only the error bip's choice of candidate and level are unheard. See `PLAN-SOUND.md`** |
| Phase 8 — endgame content | Implemented, **pending manual confirmation** of the WinScreen variants and reset flow (reaching 9999 legitimately needs a full playthrough — see PLAN.md for a localStorage shortcut) |
| Phase 9 — menu & HUD housekeeping | Implemented 2026-08-25 (landscape number on the HUD, merged Play/Demo lines, Delete-key resets, touch auto-demo). **Pending browser confirmation** |
| Rules fidelity | **Complete 2026-08-17**, plus A5/A5a/A5b on the absorb window (2026-08-25/26). See `RULES-FIDELITY.md` / `PLAN-RULES.md`. A5b's restored sequential morph is **pending a browser look** |
| Demo bot (D1–D5) | Complete as an attract mode. See `BOT.md` / `PLAN-BOT2.md` |
| Exposure map | Sweep + validation + debug visualisation done. **No planner reads it yet, deliberately** — see `PLAN-EXPOSURE.md` |
| Phase M0 — mobile | Every code-side bullet implemented; the on-device pass and the two hardware-only bullets are open (`PLAN-MOBILE.md`) |
| Phase M0.5 — touch control of the demo | Implemented 2026-08-25 (tap pause/resume, swipe to pick a landscape, confirm-stepped reset button, watchdog pause fix). **Pending on-device pass** |
| `PLAN-BOT3.md` | Sketch only, not implemented |
| Phase 10 — eye candy (`eye-candy` branch) | Terrain textures done for all 8 themes; models, icons and skybox pairing open. See `PLAN.md` Phase 10 |

**Pending, in priority order:** a browser look at the restored sequential drain morph (the cross-fade
that briefly replaced it is gone; `fade`/`dissolve` are now 500 ms a half rather than 1 s, so they
want eyes on them too); browser confirmation of the Phase 9 menu/HUD changes; a full human
playthrough; a manual soak of the demo's strike/rewind cycle (confirm `localStorage`'s `state`/`stats`
stay untouched while `demoState`/`demoStats` grow); the mobile on-device pass, now covering both M0's
fullscreen/orientation/back-gesture work and M0.5's demo touch controls; audio.

### Rules fidelity (2026-08-17)

A review against the original manuals plus direct testing in Augmentinel (an embedded
emulator running the actual Spectrum binary, so faithful by construction) found six
divergences; all are fixed. In short: **the surface rule** (act on the surface a thing
stands on, never the thing), **hyperspace's absolute landing ceiling**, **the lock-on
rule** (one exclusive slot, synthoid → boulder → tree, a stall on synthoids only,
cumulative player drains), **the scan warning** (we only ever signalled the point already
lost), **Meanies** (one at a time, sweeping not homing, testing the player's *square*),
and **C9** — detection by the body's own height, without which the whole Meanie mechanic
had never once fired in a real game. Deliberate deviations are listed in
`RULES-FIDELITY.md` §G. The bot went 740 → 861/1000 across the six fixes.

**Carry forward:** the game got *easier* overall, not harder; the two biggest movers were
both predicted backwards; and **C9 proves a rule verified only against a synthetic fixture
is verified against the author's assumptions about the rule** — three 1000-landscape
sweeps and five phases of unit tests all missed it.

### The demo bot

Two planners behind one `BotPlanner` seam (`settings.botPlanner`; the browser demo
defaults to v2). v1 is a priority ladder; v2 is a phase planner built from the human
strategy that completed the game. **v2 stands at 928/1000 on the 6000-6999 verdict block,
banking ~80% of the available jump.** Full accounts live in `BOT.md` (how it works) and
`PLAN-BOT2.md` (postscripts 1–18, one per investigation).

Recent work, all reported **from playing or watching** rather than from a sweep:

| # | Finding | Effect |
|---|---|---|
| 9 | A cell is not a point, and a model is not a column — aiming at a tile centre / a bounding-box midpoint | 861 → 888, every loss bucket down |
| 10 | The aim could name the tile underfoot, the one tile height can never be gained from | 888 → 898 |
| 11 | The assault tile — the largest commitment in a run — was the one decision graded by nothing | 898 → 908 |
| 12 | Landscape 482: terrain, not a bug. Produced the three-strike blacklist + rewind, and an E6 rules fix a human hit but the bot could not reach | neutral |
| 13 | The perch standoff — the purse cannot grow while a watcher drains you | 908 → 909 |
| 14 | The go-home rung (7632) | byte-identical, as predicted |
| 15 | Transferring by straight-line distance into a pit (9950) | 909 → 912 |
| 16 | Planning a hop the purse cannot finish (7398) | 912 → 919 |
| 17 | A square being absorbed still counted as occupied (6313) | 919 → 921 |
| 18 | The reachability field could not express a two-level climb, so a bowl read as a dead end (86, 6161, 6150) | 921 → 926 |
| 19 | A shot taken before its target's model had finished arriving disqualified the cell — gating the absorb-a-Meanie rung shut against the Meanie hunting us (7755) | 926, unchanged (+7/−7) |
| 20 | Three bodies cycling through the free transfer — `previousBody` is a one-step memory and closes only a two-cycle (9194) | 926 → 928, `out-of-clock` 10 → 7 |

**Six lessons worth keeping.** *The sweep validates a fix; it never diagnoses one* —
7632 occurs nowhere in the verdict block, 9950 wins at the default epoch, 7398 read as one
loss among ninety, and all three were permanent states rather than bad play. *A landscape
is not one sample* — outcomes depend on both `BOT_FRAME_MS` and `BOT_EPOCH`, so a pinned
fixture must name its epoch. *A rule wrong on every individual landscape can still
measure better in aggregate* — postscript 16's rejected variant scores five higher and is
rejected anyway, because that reading means something **else** is mispriced. And
**churn is not progress, and only a person can see the difference**: every measurement the
harness takes reads a bot laying and reclaiming boulders as working, which is why the
"boxed in — hyperspace out" rung could exist, be correct, and never once fire on the
landscape that needed it (postscript 18). **A "no" is only as good as the moment it was taken in**:
three separate pieces of the driver went on consulting a judgement about the world after the world had
moved — a blacklist entry about an object that had been replaced, an aim ladder walking a silhouette
that had gone, and a miss against a model still growing out of the ground (postscript 19). That last
one is the exact mirror of the corpse rule in `GameObject.remove()`, found the same way a fortnight
earlier. And finally **a memory's length is a claim about the pathology**: `previousBody` was added
against a two-body oscillation, was right, and could not see a cycle of three (postscript 20) — when a
guard is a memory, say beside it how long it is.

## Engine / rules summary

- `game/state.svelte.ts`: state machine, energy economy (`spendEnergy`, `gainEnergy`, `drainEnergy`, `floorEnergyForPedestalHyperspace`), watcher dormancy flag (`firstActionTaken` + `markFirstAction`), action cadence gate (`lastActionAt` + `canPerformAction`, `ACTION_COOLDOWN_MS = 1000` in `game/timing.ts`), Sentinel absorb lock, transfer/win/lost trigger + complete pairs. `levelEpoch` counter forces a same-`levelId` scene rebuild after LOST.
- `game/actions.ts`: pure rules layer. `performTargetedAction`, `performHyperspace`, `pickHyperspaceTile`. Operates through an `ActionContext` interface so the rules code carries no `three` value imports at runtime — `engine/actions.ts` builds the context from sceneData + camera per action.
- Action cadence cap: `engine/actions.ts`'s `handleKeyActions`/`handleMouseAction` check `canPerformAction(time)` (pure, `game/state.svelte.ts`) once a valid target/key is identified, matching the watchers' 1 Hz tempo. `performTargetedAction`/`performHyperspace` (`game/actions.ts`) now return whether the action actually took effect; only a `true` result calls `markActionPerformed(time)` to start the cooldown. A failed attempt (no target, blocked placement, insufficient energy) leaves `lastActionAt` untouched, so it can be retried immediately — only real actions are rate-limited. Transfer/hyperspace are additionally self-limiting via the TRANSFER phase. `Hud.svelte`'s cooldown bar visualizes the same `lastActionAt`/`ACTION_COOLDOWN_MS` window.
- `engine/picker.ts`: shared raycaster — returns a discriminated `Pick` ('object' with a `gameObject` back-ref, or 'terrain' with 'plane'/'slope'). Cone overlays carry `userData.skipRaycast` and are filtered out.
- `engine/visibility.ts:isCellVisibleFrom`: optimistic — corner is reached unless a non-skipped hit is closer than `target − EPS`. Skips invisible objects (the player's hidden active body), target-cell + source-cell hits, and skipRaycast meshes.
- `engine/watcher.ts:runDrainPhase`: 1 Hz drain phase over Sentinel + Sentry. Per cell, the topmost Synthoid/Boulder is the drain target — a tree shields nothing, but a tree on a boulder is itself drainable. Synthoid → Boulder and Boulder → Tree morph in place through `engine/scene.ts`'s `replaceObjectInScene`: **one atomic replacement** on the drained object's own rung. Atomic *in the rules*: the replacement is in `allObjects` from the frame the drain fires, holding its rung, while its `creationTime` sits half an interval ahead so the screen still shows the old object squashing away and only then the new one inflating. `MORPH_DURATION_MS` (1 s, one drain interval) is the pair's total and `morphAnimationScale()` fits whichever style is on into 500 ms a half, so the swap's tempo is a rules quantity rather than a display preference. Cross-fading the two halves was tried and rejected — see A5b. Tree drain just removes; conservation tree spawns elsewhere on every successful drain. **Nothing outlives what it stands on**: the frame the last mesh under a corpse leaves the scene, `finishUnsupportedCorpses` takes the corpse with it (`engine/loop.ts`). Both halves are `RULES-FIDELITY.md` A5b, from a report of a tree left suspended in mid-air when the player and a watcher took one tower apart at two levels in the same second — see `engine/morph.test.ts`.
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
- `End`: toggle terrain between **Classic** and **Textured** live (`settings.visualStyle`). Not a
  game action — no energy, no cooldown — and it swaps the four terrain materials **in place**
  rather than rebuilding, so a landscape can be judged mid-game with everything the player has
  built still standing (`engine/scene.ts`'s `applyTerrainStyle`; `buildScene` would repopulate the
  level from `generateLevel`). Also available in BIRDSEYE, and as Settings → Display → Terrain.
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

**PAUSED** (`PauseOverlay.svelte`, no menu tree): Escape → `giveUp()` → rebuild + MENU. Any other key → `resumeGame()` → back to PLAYING. A **paused demo is left alone by that handler** — `MainView`'s demo keydown ends the demo instead, which is what a key press should do to an attract mode; both used to fire on one event and exit won only by listener order.

**Touch control of the demo** (`PLAN-MOBILE.md` Phase M0.5): exactly one screen gesture — a **tap toggles the pause** — recognized by `engine/touchGestures.ts` (pure, DOM-free, unit-tested) and mapped onto phases by `App.svelte`'s single window listener, since tap-to-pause must work while PLAYING and tap-to-resume while PAUSED and splitting the stream across components would have two handlers racing over one touch. The Android **back gesture** pauses too (a second press does nothing — back is not a toggle). Everything else is a control on the pause overlay.

**Picking a landscape is a draggable strip with momentum** (`PauseOverlay.svelte`, physics in `touchGestures.ts`'s `Scrubber`). It shipped as swipe-to-step and that was the wrong instrument: a swipe steps by one and an unlocked list runs to hundreds, so choosing cost a gesture per entry. Press and drag and the strip follows the finger continuously; release with velocity and it glides, decelerates, and snaps onto an entry, with a second flick mid-glide accumulating as any mobile list does. The scrubber holds a **fractional** index — what lets the strip slide rather than jump — with continuous exponential friction (same flick, same distance at 60 or 120 Hz), a velocity cap, ends that absorb the throw, and a snap so it always rests *on* an entry. `SCRUB_PX_PER_ENTRY` is deliberately both the drag sensitivity and the strip's visual spacing: different values would slide the entries at a rate other than the finger dragging them, which is what reads as broken. Pointer Events + `setPointerCapture` (the drag survives leaving a strip one line tall, and a mouse can exercise it); `touch-action: none` or the browser claims the drag as a scroll.

The selection is **pending** — reported up via `onPick` and held in `App.svelte`, never written to `demoProgress.levelId`: `MainView`'s Effect 2 keys the scene rebuild on `currentLevelId()`, so a live cursor would demolish the paused run, and under momentum would rebuild the scene dozens of times per flick. Holding it means you can scrub the whole list, change your mind, and resume exactly what you were watching. `resumeDemo(pending)` decides — unchanged resumes the run in place, changed calls `setDemoLevel` + `startDemo()` for a full fresh `beginLevel()`. **Sound is a single slider on that overlay**, full left for silence — one control rather than the desktop menu's volume-plus-two-switches, because the pause overlay is somewhere you visit briefly with a thumb, not a settings tree. It is a native `<input type=range>`, deliberately *not* another hand-rolled `Scrubber`: that one exists because the landscape picker needs momentum and a fractional index, and a volume has neither, so the platform's own pointer capture and drag are simply better. **Reset is a labelled button with a confirm step** (`resetDemoAndRestart()`), never a gesture: a long-press was considered and rejected as destructive, hidden and unconfirmed, on a device class where a tablet under a resting palm generates long presses by itself. Every overlay control carries `data-touch-control` so the window gesture handler skips touches that land on it — otherwise the touch that drags the strip would also read as a tap and resume the demo out from under it.

A related fix that this needed (`engine/bot.ts`): `BotDriver.checkWatchdog` measures against rAF time and the render loop never stops, so a pause longer than `DEMO_NO_PROGRESS_MS` (30 s) had the first resumed frame declare the landscape stalled and book a strike against a run that was fine. Both stamps now advance by the frame delta while PAUSED — **PAUSED only**, since TRANSFER counts against the watchdog and excusing it would move every sweep number in `PLAN-BOT2.md`.

**MENU** (`MainMenu.svelte`): arrows navigate, Enter/Space selects, Left/Right adjusts, Backspace goes back, `Delete` runs the focused entry's destructive action (confirm/cancel line, same local-mode pattern as "Input level code"). `localStorage.debug=1` unlocks Free Roam + the `Display` and `Level generator` submenus.

The top two entries are mirrors of each other, one per cursor — `Play: <id> (code: xxxxxxxx)` over the player's record and `Demo: <id>` over the bot's (` (skipped: N)` appended only under `localStorage.debug=1`: the blacklist count is for whoever left a soak running, and to anyone else it is a defect count on an attract mode). Each starts on Enter, steps *its own* unlocked list on Left/Right (`settings.levelIds` / `demoProgress.levelIds`, via the shared `stepLevel` helper — stop at each end, no wrap), and resets *its own* record on Delete (`resetProgress()` / `resetDemoRun()`, previously the last two entries of Settings). Play merges the former `Start` and `Level:` lines, which were always one decision split across two, with the level code stranded on the line you did not press Enter on. Stepping the Demo line goes through `setDemoLevel()`, which clears `cameFrom` and the strike count: a hand-picked cursor was not paid for by any win, so there is no earlier jump to re-steer and nothing to blacklist. `MenuEntry.hint` renders the dim line under the menu that advertises the Left/Right and Delete bindings — an unlabelled key is a key nobody finds.

**DEMO** (`game.demo`, not a phase): the `Demo` menu entry runs the bot's *own* landscape — resumed from `game/demo.svelte.ts`'s cursor, which is why the entry carries that number and steers it, rather than borrowing the player's cursor from the `Play` line above — under `engine/bot.ts` instead of a human. It stays in the ordinary PLAYING/TRANSFER phases under the ordinary rules — the flag only changes *who drives*: `MainView.svelte`'s Effect 3c skips the pointer-lock request (grabbing the watcher's cursor would be rude, and Escape would then pause a demo nobody is there to resume), and `engine/loop.ts` accepts the bot in place of a held lock for the phases it drives. Any key or click (bare modifiers excepted, as in `PauseOverlay`) calls `exitDemo()` → MENU — except on touch, see below. Unlike `Play`, it does not request fullscreen/orientation lock.

**Fullscreen on touch** comes from two mechanisms, because neither covers both cases. `public/manifest.webmanifest` declares **`display: fullscreen`** (not `standalone`, which hides only the browser's URL bar and leaves Android's status and navigation bars): an installed launch therefore starts with no bars at all and needs no gesture, which is the only way to have them gone from the first frame — `requestFullscreen()` requires a user gesture and the demo auto-starts without one. Changing `display` on an already-installed app needs an uninstall/reinstall. The **Fullscreen API** (`engine/platform.ts`) covers a plain browser tab and the way back out: the tap that resumes a demo calls `enterFullscreenLandscape()` synchronously *before* `resumeDemo()` (anything async in front of it spends the gesture and the request is refused), and an effect calls `exitFullscreen()` on every route into PAUSED — the tap, the back gesture, and `failDemo` stranding the demo — so a paused demo hands the device back. Touch-only: on a desktop, fullscreen is something the player asked for from the menu and pausing is not a request to undo it. Known limit: in the installed app the missing bars come from the manifest rather than the API, so `exitFullscreen()` cannot restore them, and the way out there is Android's own edge gestures.

**The screen is held awake while the game is on** (`engine/platform.ts`'s `setWakeLockWanted()`, driven by an `$effect` on the phase in `App.svelte`). The demo is what needs it — hours of play touching nothing, so every idle timer eventually blanks a page the OS sees as doing nothing. Two properties of the Screen Wake Lock API shape the code: it is granted only to a **visible** document, and the browser **releases it itself whenever the page is hidden**, so a single request at startup silently stops working after the first backgrounding. Hence a standing *want*, re-synced on `visibilitychange`, with transitions serialized through one promise chain. The rule has two halves: a **demo** holds it in every phase but PAUSED (including the brief win/loss screens the supervisor is about to move past), a **person** only while actually playing — their end screens wait on a keypress that may never come, and someone who walks away from a win screen should be allowed to let the phone sleep. PAUSED releases either way, the same call the fullscreen effect makes.

**On a touch device the demo starts immediately** (`App.svelte`, guarded by `isTouchCapable()`): the menu is an arrow-key tree and the game is a mouse-look game, so until `PLAN-MOBILE.md`'s Phase M4 gives touch its own controls, a phone landing on MENU is a phone looking at a list it cannot move through. The demo drives itself, so it is the one thing such a device can be shown. It follows that a **tap does not end a demo on touch** (`MainView.svelte`'s `onMouseDown` — it pauses instead, see *Touch control of the demo* under Controls) and neither does the **Android back gesture**, while a **key press still does**, deliberately: a keyboard is exactly what the menu needs and what a phone does not have. There is deliberately still no way to *exit* a demo on touch, because there is nothing usable to exit to — which is the whole reason it auto-starts.

It is an **attract mode**: `App.svelte`'s demo supervisor holds the end screen for a beat and then either calls `advanceDemo()` (a win — straight into the next landscape, no trip through MENU) or `failDemo()` (a loss, including the watchdog's verdict). A loss still deliberately does **not** skip ahead — stepping over a landscape the bot can't win would hand it a landing it never earned — but since 2026-08-24 it no longer stops the demo either: the landscape is retried in place, and **three consecutive failures blacklist it and rewind the cursor to the landscape whose win paid for it**, which is then replayed and steered onto a different landing. See `failDemo()` above and `BOT.md`'s *Giving up on a landscape*.

When it runs out of rewinds — no `cameFrom` behind it, or a rewind target itself given up on — the caller chooses what happens, via `failDemo({ haltWhenStranded })`. Desktop hands back to MENU as before; **touch is held in PAUSED with `game.demoHalted`** set, because that menu is an arrow-key tree a phone cannot drive, and the demo's touch pause already carries exactly the two controls the situation calls for (pick another landscape, reset the run). The policy is passed in rather than detected in the rules layer, which has no business knowing about platforms. `PauseOverlay` then captions itself "Nowhere Left To Go" instead of "Paused" — a stranded demo is not a pause anybody asked for — and `resumeDemo()` treats a stranded demo's resume as a **start**, whatever the stepper names: an untouched stepper replays the landscape with a fresh seed (`levelEpoch++`), a moved one begins the landscape it names. Resuming in place is the one thing that must never happen there, since the phase machine reached PAUSED from a loss and would drop the bot back into the scene it lost on with the energy it lost with. The blacklist is the deliverable of an unattended soak — a landscape on it is either genuinely dead (482) or the next thing to fix — so it is surfaced as a `skipped: N` count on the `Demo` menu entry under `localStorage.debug=1`, and *Reset demo progress* (Delete on that line) is the only thing that clears it.

Alongside it sits `IMPOSSIBLE_LEVELS` (`game/demo.svelte.ts`, currently `[482]`) — the one part of the skip list that is **curation rather than evidence**, and kept apart from the earned blacklist for exactly that reason. A landscape here has been *proven* to have no win in it by a human reading its terrain, so it is a claim about the **game**: nothing a better planner could disagree with, hence it survives a reset, is not counted on the menu line, and `blacklistDemoLevel` refuses to copy it into the earned list. `isDemoBlacklisted` is the union of the two — the only place they are treated alike, since a landing is refused either way. Seeded because rediscovering one is not free: the verdict costs up to three `DEMO_LEVEL_LIMIT_MS` losses, a quarter of an hour of an attract mode visibly going nowhere, on every fresh device. `failDemo()` also skips the three-strike sampling for these and rewinds on the first loss, which is all that can be done for a cursor *already* parked on one (a `demoState` saved before the entry existed, the run that discovered it, or a hand-pick). The bar for adding an entry is a proven dead end, never a landscape the bot merely keeps losing — that is what the earned list is for, and confusing the two would turn today's weakness into a permanent exclusion.

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

  A **demo** can be PAUSED too — how touch stops it (see *Touch control of the demo* under Controls), and where `failDemo()` strands one that has run out of rewinds on a touch device (`game.demoHalted`). The keyboard handler above deliberately skips a demo entirely — `MainView`'s demo keydown ends it instead — and the overlay renders its touch variant: the landscape stepper plus the confirm-stepped reset. The bot freezes for free, since `BotDriver.tick` early-returns on any non-PLAYING phase and `loop.ts` gates the 4 Hz TurnDriver on PLAYING/TRANSFER, so watchers and Meanies stop dead with it. What did *not* come for free is the demo watchdog, which measures against rAF time and had to be taught to stand still while paused — see `engine/bot.ts`.
- "WON"
  `WinScreen.svelte`: themed overlay showing the completed landscape and the energy-driven jump to the next one. Camera is controlled (orbit), pointer not locked. No timer — stays until any key calls `completeWon()`, which advances `settings.levelId`, appends to `settings.levelIds`, saves, → MENU. Game clock is stopped.
- "LOST"
  `LoseScreen.svelte`: themed overlay ("Energy Depleted" + the landscape number). Camera is controlled (orbit), pointer not locked. No timer — stays until any key calls `completeLost()`, which bumps `levelEpoch` (same `levelId` rebuilds) → MENU. Game clock is stopped.
- "DEBUG"
  Camera is set on the last active synthoid (or the first found is no active one, or center of the map if none). Pointer is locked and rotates camera, key presses (W/A/S/D) move the camera around, staying a fixed height above the curent position. ESC (or losing focus) switches the state back to "MENU". Game clock is stopped.
- "TRANSFER"
  used when the player selects a new synthoid or as a result of Hyperspace (by key press or meanie). `CameraController.beginTransferAnim`/`updateTransfer` ease the camera's position from wherever it was to the target's eye position over `TRANSFER_DELAY_MS` (1 s, `easeInOutCubic`) — orientation and FOV are left exactly as they were, the camera is never re-aimed. Pointer stays locked but neither mouse-look nor any action key has any effect during the glide (mouse delta is drained, not applied). The old body crossfades transparent→solid and the new body solid→transparent in lockstep with the glide. State changes to "PLAYING" only once the glide reaches the target (`engine/loop.ts` calls `completeTransfer()`), not on a fixed timer. Game clock is running. Pausing (ESC) freezes the glide in place (see PAUSED) and resuming continues it from there.


## Eye candy (branch `eye-candy`)

`settings.visualStyle` (`'classic' | 'enhanced'`) switches terrain between the Augmentinel-faithful
flat colours and procedurally textured surfaces. **`classic` is never touched** — verified by
pixel-comparing rendered frames before and after the texture work (0 differing pixels).

- **`utils/gen-textures.py`** generates seven seamless surfaces at 128 px per world tile. Albedo is
  **greyscale** because `MeshPhongMaterial.map` multiplies `.color` — so one texture set serves all
  eight themes and `themes[]` stays in charge of hue. Normal maps ship at half resolution.
- **`themes[]` (`engine/scene.ts`)** now carries a `planeSurface`/`slopeSurface` pair and an
  optional `enhanced` palette used only in textured mode, so timber can be brown and concrete grey
  without disturbing the classic colours. Everything downstream reads `palette`, never `theme`.
- **`utils/rules-check.sh`** is the referee: a fixed 100-landscape block through the real scene and
  real raycasts, diffed against `utils/rules-baseline.txt`. Measured zero-noise over three
  consecutive runs, so a single differing line is signal. Run it after any change that touches
  geometry, materials or models.
- **Model silhouettes are frozen, the drawn models are not.** Every `GameObject` renders a
  detailed mesh flagged `skipRaycast` and carries an **occluder** — an untextured copy of the
  ORIGINAL low-poly shape (`world/objects/models/legacy/`) on `LAYER_OCCLUDER`, which no camera
  renders and every raycaster sees (`raycaster.layers.enableAll()` in `visibility.ts` and
  `picker.ts`). Anything the rules depend on reads `obj.occluder`, never `obj.object3D` —
  `watcher.ts`'s head-height test and the bot's aim ladder both do. `legacy/` is frozen data: if
  one of those shapes has to move, the game has changed.
- **`utils/gen-models.mjs`** builds the drawn models from primitives and writes
  `world/objects/models/*.ts`. Two constraints are load-bearing. Stacking heights: a boulder's top
  face must sit at exactly 0.5 and a pedestal's at 1.0, matching `BOULDER_RISE`/`PEDESTAL_RISE`.
  And **a drawn model must never be narrower than its occluder** — the occluder still answers the
  crosshair, so a slimmer model shows you a tile past it that the game then refuses to let you
  touch, with nothing visible to explain the refusal. The pedestal took three attempts to get
  right and **three hundredths of a unit of inset was still enough to be maddening in play**: it
  is now built exactly as the original was, a square prism whose faces sit flat at ±0.5 for the
  whole height with only the corners chamfered. Decoration on a model like this has to come from
  colour or corners, never from width.
- **Relief is not always the albedo's height field.** `utils/gen-textures.py` blurs the height
  before taking normals, per surface, so shading carries the coarse structure — clumps, plates,
  dunes — while the albedo keeps every grain. Grass needed it: its height is dominated by blade
  speckle, so its normals perturbed at pixel scale and the relief toggle produced a fine shimmer
  rather than legible form. Measured, the floors were changing *more* than the slopes (RMS 0.031
  vs 0.016) and still read as unaffected — **a bigger measured change is not a more visible one**,
  and the eye reads form, not variance.
- **Texture scale is relative to the object.** Surfaces with macro structure (`metal`'s panel grid
  and rivets, `concrete`'s form seams) are authored per world tile and only read correctly on
  things about that size. On half-unit figures they stamp a visible pattern, which is why the
  animate models use `hull` — grain with nothing in it that lines up.
- **`utils/drive.mjs`** drives the *real* app in headless Chrome over the DevTools protocol
  (no dependency — Node 24 has a global `WebSocket`), so anything that only happens while playing
  can be reproduced and measured. It is what caught the End-key rebuild below.
- **Effects must `untrack` the scene build.** `buildScene` reads settings of its own
  (`settings.visualStyle` for the palette, and again inside `applyTerrainStyle`), so calling it
  bare inside `MainView`'s Effect 2 enrolled those reads as dependencies of the effect — and
  toggling the terrain style tore the landscape down and rebuilt it, resetting the camera to
  (0,0) and regenerating everything the player had built. Every dependency the effect actually
  wants is read *above* the call, deliberately, so the call is wrapped in `untrack`. **A Svelte 5
  effect's dependency list is not what it appears to read — it is what everything it calls
  reads.**
- **`utils/shoot.mjs`** renders stills headlessly so a visual change can be looked at before it is
  claimed. It does not replace a browser pass — it catches seams, texel density, blown specular and
  broken silhouettes, not whether the result feels like *The Sentinel*.

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
