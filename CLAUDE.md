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
  App.svelte            Top-level; composes Hud, MainView, Menu; calls load() from state
  state.svelte.ts       Runes-based shared state (settings + game)

  ui/
    MainView.svelte     Canvas host; wires engine modules together (~100 lines)
    Hud.svelte          Energy icons + level ID
    Menu.svelte         Arrow-key-driven menu tree

  engine/
    renderer.ts         WebGLRenderer + rAF loop (RendererManager)
    scene.ts            Terrain mesh, object placement, palette (buildScene, addObjectToScene)
    camera.ts           CameraController — free-flight + orbit, pendingReset pattern
    input.ts            InputManager — keyboard state, mouse delta, pointer-lock lifecycle
    loop.ts             GameLoop — per-frame object play, sun orbit, render, stat callbacks
    visibility.ts       isCellVisible — raycaster LOS (Y-up coordinates)
    actions.ts          handleClick — raycast dispatch, add/remove object
    disposer.ts         Disposer class — GPU resource registry, disposeAll()
    fonts/
      Font.ts           Vendored+trimmed from Three.js examples
      TextGeometry.ts   Vendored+trimmed from Three.js examples
      fixed_v01_Regular_minimal.js   Glyph data (only glyphs we use); .d.ts sidecar present
    visibility.test.ts  LOS unit tests (height check, blocker mesh)

  world/
    terrain.ts          Landscape generator — 1:1 port of Simon Owen's sentland Python.
                        BigInt 40-bit RNG, smoothing, despiking, object placement, codes.
                        DO NOT touch casually: terrain.test.ts guards fingerprint parity.
    terrain.test.ts     Snapshot regression tests for levels 0 and 1 + structural checks
    objects/
      index.ts          Barrel re-export of all object classes
      base.ts           GameObject base class (appear/disappear face fade, dispose())
      sentinel.ts       Sentinel — view-cone detection, periodic turn animation
      sentry.ts         Sentry stub
      synthoid.ts       Synthoid stub
      boulder.ts        Boulder stub
      tree.ts           Tree stub
      pedestal.ts       Pedestal stub
      meanie.ts         Meanie stub
      models/
        index.ts        Model registry — getObject(type, options), Face/Model interfaces
        sentinel.ts     Raw vertex/face data
        sentry.ts       Raw vertex/face data
        synthoid.ts     Raw vertex/face data
        boulder.ts      Raw vertex/face data
        tree.ts         Raw vertex/face data
        pedestal.ts     Raw vertex/face data
        meanie.ts       Raw vertex/face data

  game/                 Placeholder — game rules will live here (Phase 2+)

  icons.ts              Base64 PNGs for HUD energy icons
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

- **Y-up**: `position.x = col`, `position.y = height`, `position.z = (dim-1) - row`. Camera default up vector (`0,1,0`). All scene code uses this convention — do not reintroduce Z-up.
- World Z range is `[0, dim-1]` (non-negative). Moving "north" (row decreasing) increases world Z.
- Map is a flat `number[]` of size `dim*dim`; index with `row*dim + col` in terrain code. Default `dim = 0x20` (32).
- Heights are integers 1–11. Tile shape codes are 4-bit (see `tileShape` in `world/terrain.ts`).
- Rotations stored as 0–255 (original game's 256-step circle); `angle256ToRad` in `world/objects/base.ts` converts. Models face +Z locally: world forward = `(sin(θ), 0, cos(θ))`.
- Stacking: only a single `Pedestal` (one item allowed on top) or a stack of `Boulder`s (item allowed on top). `actions.ts` enforces; `isCellVisible` (raycast from camera) is the LOS primitive.
- **Color space & lighting**: Three.js 0.184 defaults to sRGB output with linear lighting math. The scene was tuned to preserve the original look **without legacy flags**:
  - `AmbientLight` intensity `0.7` compensates for the linear darkening.
  - `PointLight(color, 0.4, 0, 0)` — `distance=0, decay=0`. `decay=0` is critical: the physical inverse-square default would collapse the sun's contribution to near-zero at its ~30-unit distance.
  - `MeshPhongMaterial.specular` values were doubled-ish: `0x404040` → `0x808080`, `0xa0a0a0` → `0xcfcfcf`. The specular hex is sRGB-interpreted and converted to linear, approximately squaring the effective value. Keep this compensation in mind when touching materials.

## Current state / known unfinished bits

Phases 1–2 complete; Phase 3 bullets 1–7 done plus partial Phase 4 (win/lose flow mechanics). Authoritative list is `PLAN.md`.

- `game/state.svelte.ts`: full state machine + energy economy (`spendEnergy`/`gainEnergy`/`beginTransfer`/`markSentinelAbsorbed`/`triggerWon`/`triggerLost`). `levelEpoch` counter forces same-`levelId` scene rebuild after LOST.
- `game/rules.ts`: `ENERGY_COST` table and `energyCostOf()`.
- `engine/actions.ts`: `handleKeyActions` — creation (R/B/T), absorption (U), transfer (Space/Enter), hyperspace (H). `handleMouseAction` for PLAYING — left=absorb, middle=synthoid, right=boulder. `handleClick` kept for DEBUG mode (now via `onmousedown` so all buttons fire).
- `engine/visibility.ts` `isCellVisible`: optimistic — corner is reached unless a non-skipped hit is closer than `target − EPS`. Skips invisible objects (notably the active body the camera sits inside) and target-cell hits. Calls `scene.updateMatrixWorld()` defensively.
- `game/turn.ts` `TurnDriver` fires at 4 Hz; `Sentinel.playTick` uses level `timer` for turn rate.
- Active synthoid body is hidden (visible=false) on game start and each transfer. Old body shown on transfer.
- Transfer: 1 s stub timeout → PLAYING. Camera snaps to new body at correct height (boulder-stack aware).
- Hyperspace: spends 3, then either triggers WON (active body on pedestal) or places a fresh synthoid on a random unoccupied flat tile with terrain height ≤ active height (raising the bound +1 until something fits) and transfers.
- LOST: `spendEnergy` going strictly below 0 → LOST → 2 s hold → `levelEpoch++` → MENU. Same level rebuilds.
- WON: hyperspace-from-pedestal → 2 s hold → `settings.levelId += remainingEnergy` → MENU. New level loads via the existing `levelId` rebuild path.
- WON/LOST release pointer lock; placeholder orbit camera takes over until scripted cinematic lands.
- Remaining Phase 3: Sentinel/Sentry AI (drain, dormancy), Meanies. Phase 4+ covers themed WON/LOST screens.

## Controls

**PLAYING mode** (pointer locked):
- Mouse: look around.
- Left-click: absorb targeted object (same as `U`).
- Middle-click: create Synthoid (same as `R`).
- Right-click: create Boulder (same as `B`).
- `R`: create Synthoid on targeted tile (−3 energy).
- `B`: create Boulder on targeted tile (−2 energy).
- `T`: create Tree on targeted tile (−1 energy).
- `U`: absorb targeted object (gain its energy value). Locked after Sentinel absorbed.
- `Space` / `Enter`: transfer to targeted Synthoid (visible, not active body). Free.
- `H`: hyperspace (−3 energy). Random flat tile at ≤ current height; on a pedestal, triggers WON.
- ESC / focus loss → PAUSED.

**DEBUG mode** (pointer locked, free flight):
- WASD + Shift (2× speed), `[`/`]` FOV, mouse look.
- Left-click: remove top object on targeted cell.
- Middle-click: add Synthoid (+Ctrl=Sentinel, +Shift=Meanie). **Debug-only.**
- Right-click: add Boulder (+Ctrl=Sentry, +Shift=Tree). **Sentry placement debug-only.**
- ESC / focus loss → MENU.

**MENU / PAUSED**: arrows navigate, Enter/Space selects, Left/Right adjusts, Backspace goes back.

`localStorage.debug=1` unlocks the `Display` and `Level generator` submenus.

## Game phases

The game has a state machine whose state is stored in "game.phase". The existing states are:
- "MENU"
  The camera view is orbiting the landscape of the last selected level. The pointer is not locked. The menu is displayed. Key presses allow menu manipulation (up/down/left/right/enter/backspace). Selecting "Start" switches state to "PLAYING". Selecting "Free roam" switches state to "DEBUG". Game clock is stopped.
- "PLAYING"
  The camera view is subjective at the current position of the active synthoid (which must NOT be displayed, to avoid the view being blocked by the inside of the model). The pointer is locked so that mouse movements update the camera orientation. Mouse clicks act on the item pointed by the camera (detected by ray cast). Key presses are for game actions (hyperspace, robot, boulder, tree, transfer as defined in phase 3 of the plan). The menu is not displayed. ESC (or losing focus) switches state to "PAUSED". Game clock is running. Game rules can trigger state switch to "TRANSFER", "WON" and "LOST".
- "PAUSED"
  The camera view is the same as for "PLAYING", but the pointer is not locked, mouse clicks do not act on game items, the menu is displayed and the keys are the same as for "MENU" state, except "Start" menu entry is replaced by "Resume". Game clock is stopped.
- "WON"
  To be defined. Probably some scripted camera movement and/or sound, message display with score. Camera is controlled, pointer not locked. Key presses have no effect. At the end of the animation (or pending its implementation, after a 2s wait), change state to "MENU". Game clock is stopped.
- "LOST"
  To be defined. Maybe camera movement zooming to the attacking sentinel/sentry/meanie that absorbed the last energy. Camera is controlled, pointer not locked. Key presses have no effect. At the end of the animation (or pending its implementation, after a 2s wait), change state to "MENU". Game clock is stopped.
- "DEBUG"
  Camera is set on the last active synthoid (or the first found is no active one, or center of the map if none). Pointer is locked and rotates camera, key presses (W/A/S/D) move the camera around, staying a fixed height above the curent position. ESC (or losing focus) switches the state back to "MENU". Game clock is stopped.
- "TRANSFER"
  used when the player selects a new synthoid or as a result of Hyperspace (by key press or meanie). Probably a camera movement from last position to the target position. Camera is controlled, pointer stays locked and controls camera orientation. Key presses have no effect. At the end of the animation (or pending its implementation, after a 1s wait), change state to "PLAYING". Game clock is running. 


## Coding conventions

- Tabs for indentation, single quotes, 120-col width (`.prettierrc`). Svelte files order: `<script>`, markup, `<style>`.
- `.ts` for source, `.svelte.ts` for shared runes modules, `.svelte` for components. No new `.js` in `src/` outside `engine/fonts/` data files.
- Package.json has `"type": "module"` — any Node utility under `utils/` must be ESM.
- `world/` and `game/` code must not import `three`. Rules stay unit-testable without WebGL. Engine glue lives in `engine/` and `ui/`.
- When touching level generation (`world/terrain.ts`), the output must remain bit-identical to the original game. `world/terrain.test.ts` has snapshot fingerprints for levels 0 and 1 — run `npm test` after any change.

## Working style

See also the user-prefs captured in `~/.claude/projects/-home-thomas-tmp-SenTynel/memory/`:

- Propose → confirm → execute for anything that changes rendering. The user smoke-tests in a browser; Claude can't see the result, so don't claim visual parity without confirmation.
- always update PLAN.md when we complete a task defined in it. Keep the file tidy, add things that you cannot complete yet at the end of the current phase.
- review and update CLAUDE.md file when we achieve something, so that it correctly describes the current state of the project.
- do NOT issue Git commands that change the repository. Read only is ok, committing is forbidden. Ask explicit permission.
