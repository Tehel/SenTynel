# SenTynel

Personal, educational reimplementation of Geoff Crammond's *The Sentinel* (1986) in the browser. Old unfinished project — the goal with Claude's help is to push it toward a playable game.

See `README.md` for the one-paragraph pitch, preview screenshot, and credits (terrain generation is ported from Simon Owen's Python `sentland`).

## Tech stack

- **Svelte 3** + **TypeScript** (strict tsconfig via `@tsconfig/svelte`)
- **Three.js 0.140** for 3D rendering (WebGL)
- **Rollup** build (`rollup.config.js`), outputs to `public/build/bundle.{js,css}`
- No test framework, no linter beyond `svelte-check`. Formatting via Prettier (`.prettierrc`: tabs, 120 cols, single quotes, trailing commas `es5`, `svelteSortOrder: scripts-markup-styles`).

## Run / build

```
npm ci              # install
npm run dev         # rollup watch + sirv on :5000 (auto-reload)
npm run build       # production bundle (minified)
npm run check       # svelte-check type-checking
npx http-server     # also works — just serves public/
```

The Heroku `Procfile` runs `http-server`. `public/build/bundle.js` **is committed** (only sourcemaps are gitignored) so the site works without a build step.

## Source layout (`src/`)

- `main.ts` — Svelte entry, mounts `App`.
- `App.svelte` — top-level; composes `Hud`, `MainView`, `Menu`; calls `load()` from stores.
- `MainView.svelte` — the heart: Three.js scene setup, camera, render loop, input handling (WASD + mouse look), click-to-add/remove objects, ray-cast visibility. ~640 lines and growing.
- `Menu.svelte` — arrow-key-driven menu tree (Start / Level / Settings → Game / Sound / Display / Generator). Display and Generator sections only show when `debug` is set (enable by setting `localStorage.debug=1`).
- `Hud.svelte` — energy icons (tree/boulder/synthoid/golden) + level ID display.
- `stores.ts` — Svelte writable stores for all game/UI settings. `load()`/`save()` persist them to `localStorage` under key `"state"`.
- `sentland.ts` — **landscape generator**, faithful port of Simon Owen's Python. BigInt-backed 40-bit RNG (`rng256`), smoothing, despiking, tile-shape classification (16 shape codes), placement of Sentinel/sentries/player/trees, and the 5 per-platform copy-protection codes.
- `GameObject.ts` — base class + `Tree`, `Pedestal`, `Boulder`, `Sentinel`, `Sentry` (= Sentinel), `Synthoid`, `Meanie`. Handles appear/disappear fade animations (face-by-face). Sentinel has partial detect/turn logic — plenty of `TODO` comments for absorb/spawn.
- `models.ts` — hand-crafted 3D meshes as `{v, f}` vertex/face lists, converted to `BufferGeometry`. Colors `-1` and `-2` are placeholders substituted from `customColors` (per-level theme).
- `icons.ts` — base64-inlined HUD icons.
- `Font.js` + `TextGeometry.js` — vendored-and-trimmed copies from Three.js examples, used to render the "THE SENTINEL" title in 3D.
- `fonts/` — Three.js typeface JSON; `*_minimal.js` versions contain only the needed glyphs.

`utils/obj-shrink.js` is a one-off Node script to deduplicate vertices in `.obj` exports (not part of the build).

## Domain / coordinate conventions

- **Z is up.** The code sets `camera.up = (0, 0, 1)` and uses `posX`/`posY` for the horizontal plane, `posZ` for height. Don't confuse with Three.js's default Y-up.
- Map is a flat `number[]` of size `dim*dim`; index with `y*dim + x`. Default `dim = 0x20` (32).
- Heights are integers 1–11. Tile shape codes are 4-bit (see `tileShape` in `sentland.ts` for the full enum of flat / 4 slope-to-edge / 4 three-up-one-down / 4 three-down-one-up / 2 diagonal cases).
- Rotations are stored as 0–255 (original game's 256-step circle); `angle256ToRad` converts.
- Object stacking: only allowed cases are a single `Pedestal` (anything on top) or a stack of `Boulder`s (anything on top). `MainView.addObject` enforces this; `removeObject` uses raycast visibility (`isCellVisible`) against the current camera.

## Current state / known unfinished bits

Mostly a viewer + free-flight camera + scene editor, not yet a game:

- Menu `Start` just `console.log`s — no game loop wired up.
- Energy store is hardcoded to 37; no gameplay consumes/produces it.
- `Sentinel.play` has view-cone detection but TODOs for full visibility check, absorb, spawn, and meanie-triggering.
- `Meanie` and `Synthoid` behaviors are stubs (comments note they should hyperspace the player / face the player).
- `dispose()` in `MainView` has a TODO — currently leaks most geometries/materials when regenerating scene.
- Sound: store exists, nothing plays.

## Controls (from README + code)

- Click canvas → pointer-lock, WASD + Shift (2× speed), Q/E vertical, `[`/`]` FOV, mouse look, `R` releases.
- Left-click: remove top object on targeted cell. Middle-click: add Synthoid (+Ctrl=Sentinel, +Shift=Meanie). Right-click: add Boulder (+Ctrl=Sentry, +Shift=Tree). All subject to stacking rules.
- Menu: arrow keys to navigate, Enter/Space to select, Left/Right to adjust, Backspace to go back.

## Coding conventions in this repo

- Tabs for indentation, single quotes, 120-col width (see `.prettierrc`).
- Svelte files order: `<script>`, markup, `<style>`.
- TypeScript is used for new code; `Font.js`/`TextGeometry.js` are intentionally `.js` (vendored).
- Prefer editing `MainView.svelte` and `GameObject.ts` for gameplay work; `sentland.ts` is a faithful port — match its structure if extending it.
