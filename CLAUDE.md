# SenTynel

Personal, educational reimplementation of Geoff Crammond's *The Sentinel* (1986) in the browser. Old unfinished project, currently a terrain-generation + rendering proof-of-concept — the goal is a playable game. Full roadmap and decisions live in `PLAN.md`; read it before any significant work.

See `README.md` for the pitch, preview screenshot, and credits (terrain generation is ported from Simon Owen's Python `sentland`).

## Tech stack

- **Svelte 5** (runes) + **TypeScript 5.9** — `@tsconfig/svelte` v5 as base, with local `"strict": false` override (Phase 1 of `PLAN.md` re-enables strict after the MainView split).
- **Vite 7** build (`vite.config.ts`), dev server with HMR, outputs to `dist/` (not committed).
- **Three.js 0.184** — latest; color management at the sRGB default, specular values re-tuned to compensate (see *Three.js notes* below).
- **`@sveltejs/vite-plugin-svelte` v6** with `vitePreprocess` (handles TS in `<script lang="ts">`).
- Formatting: Prettier (`.prettierrc`: tabs, 120 cols, single quotes, trailing commas `es5`, `svelteSortOrder: scripts-markup-styles`). No linter beyond `svelte-check`. No tests yet (vitest harness scheduled in Phase 1).
- Zero npm audit findings.

## Run / build

```
npm ci              # install
npm run dev         # Vite dev server with HMR
npm run build       # production bundle to dist/
npm run preview     # serve the built dist/ locally
npm run check       # svelte-check
```

`dist/` is gitignored. There is no committed build output.

## Source layout (`src/`)

Current structure (pre-Phase-1 split — the layout in `PLAN.md` shows where this is heading):

- `main.ts` — Svelte entry, uses `mount()` (Svelte 5 style) to attach `App` to `document.body`.
- `App.svelte` — top-level; composes `Hud`, `MainView`, `Menu`; calls `load()` from state.
- `MainView.svelte` — the heart (~640 lines, god component): Three.js scene setup, render loop, WASD+mouse input, click placement, raycast visibility. **Scheduled for split** in `PLAN.md` Phase 1 into `engine/{renderer,scene,camera,input,visibility,disposer}.ts`.
- `Menu.svelte` — arrow-key-driven menu tree. `Display` and `Level generator` submenus are debug-only, shown when `localStorage.debug` is set.
- `Hud.svelte` — energy icons + level ID. Uses `$derived.by` to split the energy number into icon tokens.
- `state.svelte.ts` — **runes-based** shared state. Two `$state` objects:
  - `settings` (persisted to `localStorage` under key `"state"` via `save()`/`load()`): levelId, levelIds, soundVolume, rotationInterval, mouseSpeed, displayed-debug toggles, mapSize, smooths, despikes.
  - `game` (not persisted): currently just `energy`, will grow with Phase 2.
  - `debug()` is a function (not a boolean) — reads `localStorage.debug` at call time so the menu picks up changes on reload. A previous `export let debug` + reassign pattern broke under Svelte 5's aggressive identifier tracking.
- `sentland.ts` — **landscape generator**, 1:1 faithful port of Simon Owen's Python. BigInt-backed 40-bit RNG (`rng256`), smoothing, despiking, 16-code tile-shape classification, placement of Sentinel/sentries/player/trees, the 5 per-platform copy-protection codes. **Do not touch casually**: regression tests on level fingerprints are planned and will catch drift. Internally uses Y-up (`y` = height); the view currently remaps to Z-up (Phase 1 will unify on Y-up).
- `GameObject.ts` — base class + `Tree`, `Pedestal`, `Boulder`, `Sentinel`, `Sentry`, `Synthoid`, `Meanie`. Appear/disappear face-by-face fade animations. Sentinel has partial view-cone detection; most AI is `TODO`.
- `models.ts` — 18 k file of hand-crafted meshes as `{v, f}` vertex/face lists. Colors `-1` and `-2` are placeholders substituted from `customColors` (per-level theme). **Scheduled for split** into `world/objects/models/` per-entity files.
- `icons.ts` — base64 PNGs for HUD.
- `Font.ts` + `TextGeometry.ts` — vendored-and-trimmed from Three.js examples, used to render the "THE SENTINEL" title mesh. Converted to TS during the modernization pass.
- `fonts/` — typeface JSON data; `*_minimal.js` versions contain only the glyphs we use. Intentionally `.js` (auto-generated data).

`utils/obj-shrink.js` is a one-off ESM Node script to deduplicate vertices in `.obj` exports (not part of the build, but runnable under the project's `"type": "module"`).

`public/` holds only `favicon.png` — Vite copies it to `dist/` at build time. `public/build/` is gitignored (legacy-safeguard).

## State / reactivity conventions

Svelte 5 runes are used throughout:

- Component-local reactive values: `let x = $state(...)`.
- Derivations: `const y = $derived(...)` or `$derived.by(() => {...})`.
- Side effects: `$effect(() => {...})` (replaces Svelte 4 `$:`).
- DOM refs: `let el: HTMLCanvasElement | null = $state(null)` + `bind:this={el}`.
- Event handlers: modern `onclick={handler}` style. Event modifiers like `|preventDefault` are no longer used — call `e.preventDefault()` inside the handler instead.
- Module-level `$state` requires the file to end in `.svelte.ts` (or `.svelte.js`). Regular `.ts` files cannot use runes.

Don't reintroduce `svelte/store`. Writable stores still work in Svelte 5, but new code goes through runes per the PLAN.md "stay on official recommendations" principle.

## Three.js notes

- **Currently Z-up** (`camera.up = (0, 0, 1)`): `posX`/`posY` horizontal, `posZ` vertical. **Flipping to Y-up is Phase 1 of PLAN.md** — don't cement more code around Z-up.
- Map is a flat `number[]` of size `dim*dim`; index with `y*dim + x` in terrain code. Default `dim = 0x20` (32).
- Heights are integers 1–11. Tile shape codes are 4-bit (see `tileShape` in `sentland.ts`).
- Rotations stored as 0–255 (original game's 256-step circle); `angle256ToRad` converts.
- Stacking: only a single `Pedestal` (one item allowed on top) or a stack of `Boulder`s (item allowed on top). `MainView.addObject` enforces; `isCellVisible` (raycast from camera) is the LOS primitive.
- **Color space & lighting**: Three.js 0.184 defaults to sRGB output with linear lighting math. The scene was tuned to preserve the original look **without legacy flags**:
  - `AmbientLight` intensity `0.7` (up from `0.5`) compensates for the linear darkening.
  - `PointLight(color, 0.4, 0, 0)` — the trailing `0, 0` is `distance=0, decay=0`. `decay=0` is critical: the physical inverse-square default would collapse the sun's contribution to near-zero at its ~30-unit distance from geometry.
  - `MeshPhongMaterial.specular` values were doubled-ish: `0x404040` → `0x808080`, `0xa0a0a0` → `0xcfcfcf`. Reason: the specular hex is now sRGB-interpreted, converted to linear for the shader, which approximately squares the effective value. If touching materials, keep this compensation in mind.

## Current state / known unfinished bits

At a glance — the authoritative list is `PLAN.md`.

- No game loop. Menu's `Start` just `console.log`s.
- No energy economy. `game.energy = 37` is hard-coded.
- `Sentinel.play` has view-cone detection but calls no one.
- `Meanie` / `Synthoid` AI are stubs.
- `dispose()` leaks geometries/materials between level changes.
- Pointer-lock lifecycle is shaky (requested on `focus`, no `pointerlockchange` handler, escape via `R` only).
- `deltaTime` is sampled on a 200 ms boundary, so physics uses a stale value most frames (works by accident at 60 fps).
- `MainView.svelte` is a god component.
- No tests.
- `tsconfig.json` has `strict: false`.

## Controls (current, debug-era)

The PLAN.md calls for a real scheme (crosshair + `R`/`B`/`T`/`U`/`Space`/`H`). Until Phase 3 lands:

- Click canvas → pointer lock, WASD + Shift (2× speed), Q/E vertical, `[`/`]` FOV, mouse look, `R` releases lock.
- Left-click: remove top object on targeted cell.
- Middle-click: add Synthoid (+Ctrl=Sentinel, +Shift=Meanie). **These Sentinel/Meanie placements are debug-only and will be removed.**
- Right-click: add Boulder (+Ctrl=Sentry, +Shift=Tree). **Sentry placement is debug-only.**
- Menu: arrows navigate, Enter/Space selects, Left/Right adjusts, Backspace goes back.
- `localStorage.debug=1` unlocks the `Display` and `Level generator` submenus.

## Coding conventions

- Tabs for indentation, single quotes, 120-col width (`.prettierrc`). Svelte files order: `<script>`, markup, `<style>`.
- `.ts` for source, `.svelte.ts` for shared runes modules, `.svelte` for components. No new `.js` in `src/` outside `fonts/` data.
- Package.json has `"type": "module"` — any Node utility under `utils/` must be ESM.
- **Post-Phase-1 target**: `world/` and `game/` code must not import `three` (rules stay unit-testable without WebGL). This split doesn't exist yet but will shape upcoming reorganization.
- When touching level generation (`sentland.ts`), the output must remain bit-identical to the original game. Regression tests on fingerprints are planned in Phase 1.

## Working style

See also the user-prefs captured in `~/.claude/projects/-home-thomas-tmp-SenTynel/memory/`:

- Propose → confirm → execute for anything that changes rendering. The user smoke-tests in a browser; Claude can't see the result, so don't claim visual parity without confirmation.
