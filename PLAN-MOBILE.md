# SenTynel Mobile — touch & Android roadmap

Replaces `PLAN.md`'s Phase 6. That phase started as a single design pass and, on review, turned out to
touch the game's state-machine backbone (pointer lock isn't just camera input — it's the mechanism the
whole phase machine uses to detect "the player lost control"), plus platform-specific realities (Android
back-gesture data loss, iOS orientation-lock limits, touch targeting precision) that don't fit in a handful
of bullet points. This document is the replacement: a full roadmap, phased like `PLAN.md`, scoped
specifically to bringing the existing desktop game to touch hardware.

`PLAN.md` remains authoritative for everything not touch/mobile-specific — engine internals, rules,
terrain, and desktop UI don't get re-litigated here. Where a phase below depends on a `PLAN.md` phase
(e.g. Phase 7's audio, once it ships), it's cross-referenced, not duplicated.

---

## Target hardware & platforms

- **Primary target: Samsung Galaxy Tab S6 Lite.** 10.4", 2000×1200 (~5:3, so noticeably less widescreen
  than a 16:9 phone — matters for HUD margins), Wacom-EMR S Pen. Chipset varies by revision (2020 model:
  Exynos 9611 / Mali-G72 MP3; 2022 refresh: Snapdragon 720G / Adreno 618) — treat it as **mid-range**
  either way, not flagship. This is the device development is verified against at every phase.
- **General target: "most Android."** Wide spread of aspect ratios (~19.5:9 phones up to ~4:3/5:3
  tablets) and GPU tiers (budget MediaTek well below the Tab S6 Lite, flagship Snapdragon well above).
  Design for the weak end, verify on the Tab S6 Lite, spot-check on a second device where possible
  (Phase M6).
- **Stretch, explicitly droppable: iOS Safari.** Real platform gaps exist (Screen Orientation lock only
  inside an installed PWA, no `navigator.vibrate`, manual "Add to Home Screen" install). Attempted last,
  after a go/no-go checkpoint (Phase M7) — dropped without regret if the incremental cost isn't small.
- **Non-goals**: no native app wrapper (Capacitor/Cordova/etc.) — stays a pure web app unless a future
  decision reverses this. No multiplayer. No gamepad support (that's `PLAN.md` Phase 5's unrelated
  stretch bullet).

---

## Guiding principles

1. **Detect input modality, not device or screen size.** A tablet with a keyboard case runs desktop
   controls; a touchscreen laptop with no mouse runs touch controls. Screen size only feeds layout.
2. **One responsive build, not two apps.** `game/` and `engine/` stay entirely mode-blind (already true
   today — see `PLAN.md`'s Conventions). Forking is concentrated in the input layer and `ui/`.
3. **"Input engaged" is a mode-abstracted concept, not `InputManager.isLocked`.** Today, Pointer Lock
   acquisition/loss *is* the game's "am I in control" signal — `onLockLost` fires on real lock loss and on
   a failed reacquisition, and it's the only recovery path from a stuck `PLAYING`/`DEBUG` state (it's what
   the Phase 5 alt-tab fix and the Phase 7 TRANSFER-resume fix both hang off). Touch has no pointer lock.
   Phase M1 below generalizes this signal so both input modes can drive the same phase machine.
4. **Every phase ends with an on-device check on the actual Tab S6 Lite**, not just Chrome DevTools
   device emulation — emulation doesn't reproduce touch latency, real GPU tier, or thermal behavior.
5. **No dead ends.** Anything reachable on desktop (bird's-eye view, Sentinel absorb-confirm, settings
   override, pause) must have a touch path. Each phase below explicitly names the touch equivalent for
   every desktop-only trigger it replaces.
6. **48×48dp minimum touch target** (Android's own Material guideline; ≈44 CSS px at typical density) for
   every tappable element, from the first mock onward — this drives HUD layout math, so it's a rule set
   now, not a footnote added after the toolbar is built.
7. **Prefer the Pointer Events API** (`pointerdown`/`pointermove`/`pointerup`, with `pointerId` and
   `pointerType`) over raw Touch Events for the new input layer. It unifies touch and S Pen input under
   one event model (the S Pen reports `pointerType: 'pen'`), which matters for the hover edge case in
   Phase M4, and makes multi-touch gesture disambiguation (drag vs. pinch) simpler than tracking a
   `TouchList` by index.

---

## Phase M0 — Device workflow & platform plumbing

Foundation work. No visible gameplay change; establishes how every later phase gets verified and removes
browser-default behaviors that would otherwise fight touch input from the first tap.

- [ ] **Remote debugging set up early.** `chrome://inspect#devices` over USB (or wireless ADB) from the
      Tab S6 Lite, so console output and `renderer.info` stats are visible live during development —
      needed before Phase M5's perf work can mean anything. **Manual, device-side — not code.**
- [ ] **Baseline perf capture on real hardware.** Run the current desktop build (mouse-driven, over a
      wired peripheral or DevTools touch emulation) on the Tab S6 Lite and record FPS / draw calls via
      the existing `Show FPS` overlay (`PLAN.md` Phase 4.5 instrumentation). Establishes whether the
      desktop-tuned scene already holds 60fps on the actual target GPU or needs Phase M5's tiering work.
      **Manual, device-side — not code.**
- [x] **Kill default browser touch gestures** (2026-07-07). `index.html`'s viewport meta gained
      `maximum-scale=1, user-scalable=no`; `touch-action: none` on `#mainViewCanvas`
      (`ui/MainView.svelte`) blocks native pinch-zoom/pan so Phase M2's own pinch gesture won't fight the
      browser; `overscroll-behavior: none` added to the existing `html, body` rule in `index.html` kills
      pull-to-refresh and rubber-band scroll. Desktop mouse wheel/right-click/zoom shortcuts are
      untouched — none of these rules affect anything outside the canvas or non-touch input.
- [x] **Web app manifest** (2026-07-07). `public/manifest.webmanifest` — name, `display: standalone`,
      `orientation: landscape`, linked from `index.html`. Icons list only the existing 192×192
      `favicon.png` — no 512×512 source art exists yet; worth generating one before relying on
      "Add to Home Screen" producing a crisp icon.
- [x] **Fullscreen + orientation lock on Start** (2026-07-07). `engine/platform.ts`'s
      `enterFullscreenLandscape()`, called from `MainMenu.svelte`'s Start entry alongside `startGame()`.
      Fullscreens `document.documentElement` rather than the canvas specifically — the HUD, menu, and
      phase overlays are siblings of the canvas (see `App.svelte`), so fullscreening the canvas alone
      would hide all of them; the plan's literal wording didn't account for that DOM shape. Gated behind
      a new `isTouchCapable()` heuristic (`navigator.maxTouchPoints > 0 || 'ontouchstart' in window`) so
      desktop dev/playtest sessions don't get pulled into fullscreen on every Start click — an interim
      stand-in for Phase M4's real `settings.inputMode`, cheap to delete once that lands. `lock()`
      failures (unsupported browser, denied) are swallowed; the portrait overlay below covers the
      fallback. TS's bundled DOM lib omits `ScreenOrientation.lock`/`unlock` (Safari doesn't implement
      it), so `src/global.d.ts` gained a small ambient augmentation.
      **Still needs**: on-device confirmation that the lock actually holds on the Tab S6 Lite in Chrome
      and Samsung Internet.
- [x] **Portrait fallback overlay** (2026-07-07). `ui/PortraitOverlay.svelte` — always mounted in
      `App.svelte`, CSS-only visibility via `@media (orientation: portrait)`, no JS/game-phase
      involvement. Covers the moment before fullscreen/lock engages and any browser where the lock call
      silently fails.
- [x] **Android back-gesture / back-button guard** (2026-07-07). `App.svelte`: an `$effect` pushes a
      history entry for the duration of any phase past `MENU`; a `popstate` handler routes the gesture
      into the same pause flow ESC already uses (`pauseGame()` from PLAYING/TRANSFER/BIRDSEYE,
      `returnToMenu()` from DEBUG, `giveUp()` from PAUSED) and immediately re-pushes the history entry so
      the gesture doesn't actually navigate away. The guard drops once back at MENU, so the next back
      press behaves like ordinary browser back (harmless in this single-page app — at worst it exits,
      matching Android's "back from the main screen" convention).
- [ ] **On-device pass** (Tab S6 Lite, Chrome + Samsung Internet): confirm fullscreen/orientation-lock
      holds, the back gesture pauses instead of exiting, and no default touch gesture (pinch-zoom, pull-
      to-refresh) fires on the canvas. Not yet done — everything above is implemented and passes
      `npm run check && npm run build && npm test`, but hasn't been hand-verified on real hardware.

**Exit criteria**: on the Tab S6 Lite, Start enters fullscreen landscape and locks orientation; the system
back gesture pauses the game instead of leaving the page; no default browser touch gesture (zoom, refresh,
overscroll bounce) fires on the canvas; desktop mouse/keyboard flows are unaffected.

**Progress (2026-07-07)**: all code-side bullets implemented (touch-gesture kill, manifest, fullscreen +
orientation lock on Start, portrait fallback, back-gesture guard). `npm run check && npm run build &&
npm test` green — 0 svelte-check errors, build succeeds, all 36 existing tests pass. The two hardware-only
bullets (remote debugging setup, baseline perf capture) and the on-device verification pass remain open —
none of this can be confirmed without the actual Tab S6 Lite.

---

## Phase M1 — Input-engaged abstraction

The architectural correction identified during the Phase 6 review: pointer lock is load-bearing for the
phase machine, not just a camera-input detail, and touch has nothing equivalent to it.

- [ ] **`ControlsSession` interface** (new, e.g. `engine/input/session.ts`): `engaged: boolean`,
      `onDisengaged: () => void`, `consumeLookDelta(): {dx, dy}`, `destroy()`. Mode-blind — callers
      (`MainView.svelte`, `game/state.svelte.ts`) stop talking to `InputManager` directly for
      engagement/disengagement and go through this instead.
- [ ] **Desktop implementation**: thin wrapper over the existing `InputManager`. `engaged === isLocked`;
      `onDisengaged` is today's `onLockLost` (fires on real lock loss and on failed reacquisition,
      unchanged). No behavior change on desktop — this is a refactor, not a rewrite, of the existing path.
- [ ] **Touch implementation** (new `engine/input/touch.ts`, Pointer Events-based per the guiding
      principles): `engaged` tracks the game phase directly (true across `PLAYING`/`TRANSFER`/
      `BIRDSEYE`/`DEBUG`) — there is no lock to acquire. `onDisengaged` fires on:
      - `document.visibilityState` → `'hidden'` (tab backgrounded / app switched away from),
      - the M3 pause button being tapped,
      - the M0 back-gesture guard.
      No `requestPointerLock()` call anywhere in this path.
- [ ] **Regression pass on desktop.** The exact edge cases the abstraction must not break: alt-tab during
      `PAUSED` (Phase 5), pausing mid-`TRANSFER` and resuming back into `TRANSFER` (Phase 7), a failed
      lock reacquisition falling back to `PAUSED` rather than sticking in a dead `PLAYING`.

**Exit criteria**: desktop behavior is unchanged (manual re-check of the alt-tab and mid-transfer-pause
cases above). On the Tab S6 Lite, backgrounding the app or tapping the (unstyled, stub) pause button from
Phase M3 reaches `PAUSED` and resumes correctly — with zero reliance on Pointer Lock anywhere in the touch
path.

---

## Phase M2 — Camera & targeting

- [ ] **Touch look**: single-finger drag, raw Pointer Events deltas fed through the existing
      `applyMouseLook` math (renamed `applyLookDelta` per the original Phase 6 note — trivial, the math
      is unchanged) instead of `movementX/Y`. No on-screen reticle.
- [ ] **Explicit tap/drag state machine** (the ambiguity flagged in the Phase 6 review, resolved here
      rather than left as "gated by a threshold"):
      - `pointerdown`: record start point + time; state = `pending-tap`.
      - `pointermove` exceeding a ~10px deadband from the start point: state → `looking` for the rest of
        this pointer's lifetime (even if the finger drifts back inside the deadband — no flapping back to
        `pending-tap`). Camera rotates by the delta each frame while `looking`.
      - `pointerup` while still `pending-tap`: fire a tap-target action at the release point.
      - `pointerup` while `looking`: no action; the drag simply stops.
- [ ] **Pinch-to-zoom (FOV)**, replacing `[`/`]`: a second concurrent pointer starts a distinct two-finger
      gesture recognizer, independent of the single-finger state machine above (tracked by `pointerId`,
      per the Pointer Events principle) — so a pinch can't be misread as an errant single-finger drag.
- [ ] **`pickTarget` grows an optional screen-point parameter**: `pickTarget(camera, sceneData, ndc?)`,
      defaulting to camera-centre (desktop's existing behavior unchanged) or the tap's NDC coordinates on
      touch. Mechanical change, per the original Phase 6 assessment.
- [ ] **Fat-finger mitigation.** A raycast from the exact tap point is small-target-hostile on a 32×32
      grid viewed at an angle (thin sloped tiles, distant cells) — and the finger itself occludes what
      it's aiming at. Two mitigations: sample the pick point ~30px *above* the raw touch position
      (counters occlusion); widen the effective hit-test tolerance for touch (e.g. a small ray cluster
      around the sample point, or a "snap to nearest valid tile within N screen px" fallback when the
      direct hit misses). Validate specifically against small/sloped/distant tiles on the Tab S6 Lite —
      this failure mode doesn't show up in desktop mouse testing at all.
- [ ] **Bird's-eye view gets a touch trigger.** The desktop gesture ("left-click on empty sky while
      looking up >30°," `engine/actions.ts:isBirdsEyeTrigger`) has no single-finger equivalent once a tap
      is claimed by targeting — use a **two-finger tap** while looking up >30° instead, mirroring the same
      `pickTarget() === null` gate. This was undefined in the original Phase 6 draft.

**Exit criteria**: on the Tab S6 Lite, a player can look around freely, tap to accurately target objects
and terrain (including thin sloped tiles and cells near the horizon), pinch to zoom, and enter/exit bird's-
eye — all without the browser's own zoom/scroll ever engaging.

---

## Phase M3 — Action UI (toolbar / radial hybrid)

- [ ] **Hybrid layout**, per the Phase 6 review's resolution: a persistent bottom toolbar for **absorb**
      and **transfer** (highest-frequency actions; both are cheap to mis-tap — transfer is free, absorb
      is already LOS-gated), and a **contextual radial menu on tap-and-hold of an empty tile** for the
      three creation types (rarer, needs an energy-cost readout per option, benefits from appearing where
      the player just indicated).
- [ ] **Armed-action state.** Tapping a toolbar action arms it (visibly highlighted) and waits for a
      target tap. Disarmed by: a second tap on the same button, a tap on non-actionable UI/empty sky, or
      a **5s idle timeout** — the timeout is new versus the original Phase 6 draft, which left an armed,
      energy-costing action able to sit indefinitely.
- [ ] **Hyperspace**: standalone corner button, no target needed — unchanged from the original Phase 6
      call, that one was already right.
- [ ] **Sentinel / Sentry absorb confirmation.** Tap highlights the target; a distinct "Confirm" button
      (≥48dp) appears near it; any other tap dismisses without committing. This stays the one action
      allowed a deliberate extra step, since it's the one irreversible-for-the-level action (locks all
      further absorption). Every other absorb stays one-tap.
- [ ] **Haptic feedback** (Android only — see Phase M7's iOS gate): a short `navigator.vibrate()` pulse on
      every action that actually commits. Cheap stand-in for the tactile/audible confirmation a mouse
      click gives for free — worth doing regardless of whether `PLAN.md` Phase 7's audio work has landed
      yet.
- [ ] **Low-fidelity layout mock before wiring real components.** One sketch (ASCII or a quick design
      artifact) showing energy icons, the action-cooldown bar, the toolbar, the hyperspace button, and the
      pause button coexisting at the Tab S6 Lite's actual ~5:3 landscape aspect ratio with safe-area
      margins — catches overlap before code exists. (The original Phase 6 draft was pure prose with zero
      layout artifact; this is the fix.)

**Exit criteria**: create/absorb/transfer/hyperspace are all reachable by touch with no dead ends;
Sentinel/Sentry absorb cannot be triggered by a single mis-tap; the layout mock shows no overlapping
elements at the target aspect ratio.

---

## Phase M4 — Menu & HUD rewrite

- [ ] **Full rewrite, explicitly scoped as a retrofit.** `PLAN.md`'s Phase 5 already shipped
      (2026-07-05) as a single keyboard-driven tree (`MainMenu.svelte` is pure
      `<svelte:window onkeydown>`, zero touch handlers today) — the original Phase 6 draft's "cheapest if
      co-designed with Phase 5" window already closed. Budget this as splitting an existing, working
      component, not greenfield design.
- [ ] **Interaction model**: vertical scrollable list, tap-to-select, swipe-right to go back,
      native-feeling sliders/steppers for numeric settings (mouse sensitivity, sound volume, rotation
      interval) — the arrow-key tree doesn't translate to touch at all.
- [ ] **Full settings parity, checked against the live tree, not memory.** Port every current entry,
      including ones added after the original Phase 6 draft was written (animation style cycle, particle
      effects toggle, "Reset progress") — an explicit line-by-line check against `MainMenu.svelte` as it
      exists now.
- [ ] **`settings.inputMode: 'auto' | 'desktop' | 'mobile'` override, reachable by touch regardless of
      the currently-detected mode.** Closes the chicken-and-egg gap found in review: today's menu has no
      touch handlers at all, so a misdetected device has no way to fix itself. Expected to be rare on
      Android (no mouse/keyboard to confuse detection with) but not impossible — the Tab S6 Lite's S Pen
      is a real edge case: Wacom EMR hover events can satisfy a `hover: hover` media query the same way a
      mouse would. Bias the initial guess toward mobile whenever any touch capability is present at all,
      regardless of hover support, and let "live switch on first input" correct from there.
- [ ] **Safe-area-aware HUD.** `Hud.svelte` currently hardcodes `top: 5px` / `left: 66.6%` for the energy
      icons and cooldown bar — this phase retrofits those to `env(safe-area-inset-*)`-relative positioning
      alongside the new M3 toolbar/hyperspace/pause buttons. Not new-component work; an edit to what's
      already shipped.
- [ ] **Replace the key-binding help line.** Desktop's `HelpLine.svelte` text is meaningless on touch.
      Default to a one-time first-launch tutorial overlay (covers energy costs, which bare toolbar icons
      wouldn't convey on their own); revisit if the toolbar/radial labels end up sufficient alone.

**Exit criteria**: a first-time touch user on the Tab S6 Lite reaches `PLAYING`, can adjust every setting,
and can recover from a misdetected input mode — all without ever touching a keyboard.

---

## Phase M5 — Performance tiering for "most Android"

The Tab S6 Lite is mid-range, and the general Android target spans well below it.

- [ ] **Re-run the Phase 4.5 measurement on the Tab S6 Lite specifically.** The reference machine that
      phase tuned against (Ryzen 9 5900HX / RTX 3050 Laptop) is a different GPU class entirely; the Tab S6
      Lite is the real primary target now and needs its own baseline (Phase M0 already captures this —
      this phase acts on it).
- [ ] **Pixel ratio policy.** The renderer currently never calls `setPixelRatio` (implicit ratio of 1,
      paired with `image-rendering: pixelated` for the intentional retro look — see `PLAN.md`'s Phase 4.5
      notes). Confirm this still holds up on higher-density Android panels; if not, cap explicitly (e.g.
      `Math.min(devicePixelRatio, 2)`) rather than rendering at full native density on a 400+ppi phone,
      while keeping the pixelated aesthetic.
- [ ] **Quality tier for weaker GPUs.** Step down particle-burst count/lifetime and skybox resolution one
      notch on `pointer: coarse` devices below some cheap capability threshold (e.g.
      `navigator.hardwareConcurrency`, or a one-time render-time self-probe) rather than a hardcoded
      device allowlist — the target is "most Android," which can't be enumerated.
- [ ] **Thermal/battery check.** Verify a sustained ~10-minute play session on the Tab S6 Lite doesn't
      throttle FPS or drain the battery unreasonably — mid-range SoCs throttle sooner than a laptop dGPU,
      and this doesn't show up in short manual tests.

**Exit criteria**: 60fps sustained for a 10-minute session on the Tab S6 Lite with no visible thermal
throttling; the quality tier degrades gracefully (not a crash or blank frame) under Chrome DevTools CPU
throttling as a low-end proxy.

---

## Phase M6 — Playtest & polish

- [ ] **Full manual playthrough on the Tab S6 Lite**: create/absorb/transfer/hyperspace, Sentinel
      confirm-absorb, win/lose screens, pause via the button and via backgrounding, the back-gesture
      guard, orientation lock (and the portrait fallback if lock ever fails), bird's-eye entry/exit.
- [ ] **Spot-check on at least one other Android form factor** if available — a phone, specifically for
      the ~19.5:9 aspect ratio and its smaller absolute touch targets. The target is "most Android," not
      only the one owned tablet.
- [ ] **Re-check the M3 layout mock against the shipped HUD** for drift accumulated across M3–M5.

**Exit criteria**: a full landscape is completable by touch alone on the Tab S6 Lite, no keyboard/mouse
involved at any point — matching `PLAN.md` Phase 3's original desktop exit criteria, now for touch.

---

## Phase M7 (stretch, gated) — iOS

Attempted only after M0–M6 ship, and only if the incremental cost is genuinely small. Known gaps to weigh
at the gate, all specific to iOS Safari:

- No Screen Orientation `lock()` outside an installed home-screen PWA — the fallback is the Phase M0
  rotate-prompt overlay, **permanently**, unless the user installs the app.
- `navigator.vibrate()` is unsupported entirely — Phase M3's haptic feedback silently no-ops, which is
  acceptable, but worth confirming it degrades silently rather than throwing.
- Install is manual (Share → Add to Home Screen) with no native install banner — most users will simply
  never reach the "locked landscape, standalone" experience at all.
- Web Audio's autoplay/unlock-on-gesture rules are stricter on iOS — relevant once `PLAN.md` Phase 7's
  (currently unimplemented) audio work exists and gets ported.

**Decision checkpoint**: after M6, assess actual remaining iOS-specific work against the gaps above. If
it's mostly "verify it already works" (touch/pointer basics have converged between Blink and WebKit),
proceed. If it demands materially different orientation/install UX branching, defer or drop entirely —
iOS was always a bonus, not a requirement.

---

## Testing matrix

| Tier | Device / browser | Role |
|---|---|---|
| Primary | Galaxy Tab S6 Lite — Chrome | Verified at the end of every phase above |
| Primary (secondary browser) | Galaxy Tab S6 Lite — Samsung Internet | Checked at Phase M0 (orientation lock) and M6 (full playthrough) — Samsung tablets default to this browser, and it can diverge from Chrome |
| Secondary | Any other Android device available (phone form factor) | Phase M6 spot-check for aspect ratio + smaller touch targets |
| Proxy for low-end | Chrome DevTools CPU throttling | Phase M5, when no real low-end device is available |
| Stretch | iOS Safari | Phase M7 only, post go/no-go |

---

## Open questions carried forward (to settle during implementation, not before)

These don't block starting M0–M2, but should be settled by the time they're load-bearing:

1. Toolbar icon set and radial-menu visual language (Phase M3) — needs the layout mock first.
2. Exact one-time-tutorial content and dismissal gesture (Phase M4).
3. Low-end quality-tier thresholds (Phase M5) — needs real measurement data from Phase M0/M5, not a
   guess.
