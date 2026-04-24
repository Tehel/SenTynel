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

Phase 1 is complete. At a glance — the authoritative list is `PLAN.md`.

- No game loop. Menu's `Start` just `console.log`s.
- No energy economy. `game.energy = 37` is hard-coded.
- `Sentinel.play` has view-cone detection (scale doubles when player is in cone) but calls no one.
- `Meanie` / `Synthoid` / `Sentry` AI are stubs.
- Pointer-lock: `R` releases, but no handling of the lock being broken externally (e.g. Alt+Tab).
- No win/lose conditions.
- `game/rules.test.ts` is deferred until Phase 2 energy/creation rules exist.

## Controls (current, debug-era)

The PLAN.md calls for a real scheme (crosshair + `R`/`B`/`T`/`U`/`Space`/`H`). Until Phase 3 lands:

- Click canvas → pointer lock, WASD + Shift (2× speed), Q/E vertical, `[`/`]` FOV, mouse look, `R` releases lock.
- Left-click: remove top object on targeted cell.
- Middle-click: add Synthoid (+Ctrl=Sentinel, +Shift=Meanie). **Debug-only, will be removed.**
- Right-click: add Boulder (+Ctrl=Sentry, +Shift=Tree). **Sentry placement is debug-only.**
- Menu: arrows navigate, Enter/Space selects, Left/Right adjusts, Backspace goes back.
- `localStorage.debug=1` unlocks the `Display` and `Level generator` submenus.

## Coding conventions

- Tabs for indentation, single quotes, 120-col width (`.prettierrc`). Svelte files order: `<script>`, markup, `<style>`.
- `.ts` for source, `.svelte.ts` for shared runes modules, `.svelte` for components. No new `.js` in `src/` outside `engine/fonts/` data files.
- Package.json has `"type": "module"` — any Node utility under `utils/` must be ESM.
- `world/` and `game/` code must not import `three`. Rules stay unit-testable without WebGL. Engine glue lives in `engine/` and `ui/`.
- When touching level generation (`world/terrain.ts`), the output must remain bit-identical to the original game. `world/terrain.test.ts` has snapshot fingerprints for levels 0 and 1 — run `npm test` after any change.

## Working style

See also the user-prefs captured in `~/.claude/projects/-home-thomas-tmp-SenTynel/memory/`:

- Propose → confirm → execute for anything that changes rendering. The user smoke-tests in a browser; Claude can't see the result, so don't claim visual parity without confirmation.
