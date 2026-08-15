# SenTynel — the exposure map

A persistent, per-cell map of **when each watcher will next be able to drain whatever stands on that
cell**, computed once at the start of a landscape and read (not recomputed) during play, plus a debug
visualisation of it.

Extracted from `PLAN-BOT2.md`, where it lived as "B6 — a persistent exposure map", shelved. It is no
longer called B6: it is not a numbered step of the v2 roadmap, it is a piece of engine-level sensing
that the planners — and the player, through the visualisation — can use. `PLAN-BOT3.md` lists it as
out of scope for v3; that stands for v3's *decision layer*. This is the sensing underneath it, and it
is being built first because it can be watched.

**Status: the sweep is built and validated** (`game/exposure.ts`, 2026-08-15) and **the debug
visualisation is complete**, height stepper included (`engine/exposureOverlay.ts`, 2026-08-16). No
planner uses the map yet, deliberately.

## Why

The landscape owner's idea, after watching the demo:

> *"Keep a persistent map of every cell holding whether it is watched and how long until it becomes
> watched, update it incrementally, and plan against the whole map rather than against the handful of
> tiles the walk happens to be choosing between. The bot could leverage such a map to build a much
> better plan, probably completely avoiding being watched on most levels."*

What the bot has today is a per-decision, per-candidate answer: `engine/bot.ts`'s `ticksUntilSeen`,
asked only about the tiles `chooseDestination` is already considering, and thrown away at the end of
every decision. That is enough to *reject* a bad tile and not enough to *find* a good one.

`PLAN-BOT2.md`'s postscript 6 measured the consequence precisely. Refusing to keep building on a tile
a cone has arrived on fires about 0.5 times per landscape and is **exactly neutral** — 188/250 with
it and without. It fires late by construction: when the cone arrives, the boulders are already paid
for. The waste happens earlier, when the walk knowingly accepts a tile whose cover expires mid-build
because nothing better is *among the candidates it looked at*. Choosing better requires knowing about
tiles the walk is not already considering. That is this map.

## What makes it tractable

Three facts, all read out of the engine and verified, that together turn "simulate the watchers" into
"evaluate a closed form".

### 1. Time is frozen until the first player action

`runDrainPhase` returns on `!game.firstActionTaken` (`engine/watcher.ts:68`) and so does
`Watcher.playTick` (`world/objects/watcher.ts:70`). Watchers neither drain **nor rotate** before the
player acts.

So there is a real, unbounded budget for an initial computation — a second or so is affordable, and
it is spent before any clock the player can lose to has started. It also means exposure times are
naturally expressed **relative to the first action**: a single origin shared by every cell and every
watcher, rather than relative to "now".

*(Recorded because the opposite was proposed during design and is wrong: this is not a free waiting
window during play. The cones are frozen exactly where they started, so waiting gains nothing. The
lever is that the bot chooses the moment of engagement — and that the map can be built for free
before it does.)*

### 2. The rotation schedule is closed-form, and there are only 64 orientations

From `game/cone.ts`: the cone is 20 of the 256 rotation units wide, every watcher steps ±20 units per
period, so a cone advances by exactly its own width each turn — adjacent sectors, no overlap, no gap.

Since `gcd(20, 256) = 4`, a watcher visits **64 distinct facings** before repeating. Writing the
facing after *k* turns as `rot₀ + 20k mod 256 = rot₀ + 4m` with `m = 5k mod 64`, the map from turn
index to facing is a bijection on 0..63, invertible as `k = 13m mod 64` (since 5·13 = 65 ≡ 1 mod 64).
A cone covers a bearing over a window ±10 units wide — 21 units, at 4 units of facing per step — so
**each (watcher, cell) pair is covered at 5 or 6 of the 64 facings**, and those can be found directly
from the bearing rather than by testing all 64.

The consequence is the reason this is worth building, and it is not visible from inside the current
32-tick horizon:

> A turn period is 48 ticks = 12 s, so a full 64-turn cycle is **12.8 minutes**. A cell with line of
> sight is therefore covered in **5 or 6 isolated 12-second windows per cycle** — in the cone about
> **8% of the time**, with gaps averaging **~2.4 minutes**.

`SIGHT_HORIZON_TICKS` is 128 ticks (32 s), well inside a single gap. So today the bot mostly cannot
tell "clear for the next 30 seconds" from "clear for the rest of the landscape". *(Figures are for a
fresh record; `turnPeriodTicks` scales by 0.95^`gameCompletions`, which shortens every interval but
changes nothing structural.)*

Watcher positions are fixed for the whole landscape, and so is the terrain.

### 3. A drain-locked watcher's clock is frozen

`Watcher.drainLocked` freezes the rotation timer while the watcher has something to eat
(`engine/watcher.ts`), resuming on the first idle tick. The current predictor assumes every clock
runs and documents the approximation, erring towards predicting exposure *early*. Under the design
below a stall needs no compensation at all: it stops the watcher's clock, and the clock is the only
thing that moves.

## The design

### The factorisation

Whether watcher *w* can drain what stands on cell *c* is `inWatcherCone(w, c)` **and**
`isCellVisibleFrom(...)`. Those two halves depend on disjoint variables:

| | depends on orientation | depends on target height | cost |
|---|---|---|---|
| cone | **yes** | no | trig on a fixed bearing |
| line of sight | no | **yes** | a ray march, or a raycast |

So the "list of cells each watcher can drain in each of its 64 orientations" is the intersection of
**one** line-of-sight set per watcher with **64** cone masks. The 64 orientations never cost 64
sweeps; the sweep is paid once per watcher and the orientations are arithmetic on top of it.

### What is stored, per (watcher, cell)

**A 64-bit cone mask.** Bit *k* set iff the watcher's facing after *k* turns covers this cell's
bearing. Built in ~5 operations from the bearing via the `m ↔ k` bijection above, not 64 tests. As
two 32-bit words (`BigInt` is not wanted in a hot path).

**A minimum visible height** — the lowest target height at which this cell becomes visible from that
watcher's eye, `Infinity` for a cell it can never see whatever is built there.

That second field is the answer to a question the boolean version gets dangerously wrong. The drain
phase tests line of sight to the target's **foot** height, not to the terrain:
`yOffset = cand.height − map[cell]` (`engine/watcher.ts:132`), so a body on a five-boulder pile is
tested from ~2.5 units up. The cone is height-independent, so the mask is unaffected — but **a cell
with no line of sight at ground level can become fully exposed the moment a pile is built on it**,
and a terrain-level boolean map would have called that cell permanently safe. Those are exactly the
cells the bot cares most about, since building piles is how it gains height at all.

A threshold costs nothing extra to obtain: under terrain-only occlusion, visibility is **monotone in
target height** (raising the endpoint raises the ray everywhere along it), so one ray march can
return the height needed to clear the worst blocker instead of a yes/no, for the same work. One
`Float32` per pair then answers every pile height.

Footprint, worst case (1024 cells, 8 watchers): 8 KB of mask + 4 KB of threshold per watcher, **~96
KB total**. Not a constraint.

### Reading it

Per watcher the engine already tracks the live clock (`ticksToTurn`, `turnPeriod`, and the current
facing). Next exposure of cell *c* by watcher *w*, for a target at height *h*:

1. if `h < minVisibleHeight(w, c)` → never;
2. otherwise rotate the mask by the watcher's current turn index and take the lowest set bit *j*;
3. `j = 0` → in sight now; else `ticksToTurn + (j − 1) · turnPeriod`.

The cell's exposure is the minimum over watchers. That is a handful of integer operations, cheap
enough to run over the whole map per decision if wanted.

### There is no incremental update

This is the part that changed from the original sketch, and it simplifies it substantially. Both
proposed update events dissolve:

- **"A watcher's cycle is altered by a drain lock."** A stall does not reshape the schedule, it
  pauses it. Since the answer is computed *from* the watcher's live clock at read time, a frozen
  clock is handled by doing nothing — and handled **exactly**, replacing the current predictor's
  documented err-early approximation.
- **"A watcher rotates away from a cell, so recompute its next exposure."** The mask already contains
  every future window; rotating the read index past a set bit exposes the next one for free.

So the map is **immutable for the whole landscape**. Only the watcher clocks move, and the engine
owns those already. Nothing to invalidate, nothing to keep in sync, no staleness bug class.

What survives from the original optimisation list is absorbed into the structure: a cell no watcher
can ever see is `minVisibleHeight = Infinity` and is never touched again; ageing by subtraction is
what step 3 does; the drain lock is handled by reading the clock.

### What it answers: "can be drained", not "will be drained"

Decided rather than left open. The two differ because `tryWatcherDrain` takes at most one action per
watcher per tick and eats only the **closest** visible candidate, so junk nearer the watcher than you
genuinely shields you.

The bot uses **"can be drained"** — cone plus line of sight, the conservative reading. The reasoning
is the landscape owner's:

> *"It makes little difference in practice — it's very rare that we leave boulders or synthoids
> behind, so we can't really count on it happening by chance. It could be leveraged as a tactic
> (create a synthoid roughly between the bot and the watcher to buy time to escape), but it's just as
> simple to create that synthoid on a safe cell and transfer to it, and the energy result is better
> or the same."*

Worth recording because the decoy is a real mechanic and will look like a missed opportunity later:
it is not rejected as unavailable, it is rejected because the safe-cell-and-transfer alternative
dominates it on both energy and simplicity. Modelling "will be drained" would also make the map
depend on object placement, which is what keeps it immutable.

### Still open

- **Objects change line of sight.** Terrain is static; boulders, trees and piles are not, and they
  block sightlines the terrain-only pass never saw. Measured as ~2% of samples where the map says
  "exposed" and the engine says "hidden" — the safe direction, and mostly this. The claim still to
  verify rather than assume: a new object can only ever make cells *behind* it safer, so an
  unrefreshed map errs safely. If true, the map stays immutable and object occlusion is simply
  unmodelled headroom.
- **Whether a consumer asks per-cell or per-(cell, height).** The stored window answers any height,
  but a caller wanting "exposure of the tile I would stand on" must supply the height it means. The
  visualisation has to pick one to colour, and that choice is the first real use of the API.
- **What the map is keyed on before the first action.** Times relative to the first action are
  undefined until it happens; the map simply reads as "at t = 0" until then.

## What was built — the sweep (2026-08-15)

`game/exposure.ts` (three-free), `game/exposure.test.ts` (10 cases) and
`engine/exposure.harness.test.ts` (validation against the engine). `npm test` and `npm run check`
green.

**The line-of-sight question is settled: analytic, and validated.** The 20% disagreement the older
`terrainVisible` showed was not intrinsic — it came from the two causes named below, and fixing both
closes it:

- the eye is `WATCHER_EYE_HEIGHT` above the watcher's tile at the **cell centre**, matching
  `engine/watcher.ts`'s own drain eye;
- the engine accepts a cell if **any of its four corners** is reachable, so the march runs per corner
  and takes the minimum threshold.

The march also returns the threshold *natively*, which is what made analytic the only affordable
option. Along a sightline the height sits at `eyeY + (targetY − eyeY)·t`, so clearing a blocker at
sample `t` needs `targetY ≥ eyeY + (terrain(t) − eyeY)/t`, and the threshold is the maximum of that
over the samples: one march, one number, for any target height. A raycast returns a boolean and would
have to be bisected — five or so raycasts a pair, ~6 s a landscape, unaffordable even in the frozen
window.

**Measured build cost: 58 ms mean over landscapes 0–49, 120 ms over the four pinned ones, 233 ms
worst (9999).** Against a budget of "a second or so", with room to spare.

**Validation, over 217,765 (watcher, cell, height) samples on 50 landscapes: 14 unsafe (0.0064%),
2.0% safe-side.** The two directions are counted separately and mean different things — unsafe is
"the map called a cell safe that a watcher can see", the one that kills a bot.

`SIGHTLINE_MARGIN = 0.1` resolves the model's own uncertainty band (discrete sampling, bilinear
interpolation of a triangulated surface) towards "exposed". Chosen from a measured trade-off rather
than picked:

```
margin   unsafe          safe-side
0        40 (0.018%)     0.92%
0.05     21              1.33%
0.1      14 (0.0064%)    2.01%     <- chosen, the knee
0.25      8              3.65%
0.5       7              6.01%
```

**The residue is an engine artifact, not a model error**, and that is worth knowing before someone
tries to drive it to zero. Traced on landscape 390 (watcher at 14,15 h8 → cell 23,3): the sightline
enters a hill almost tangentially, the raycaster misses that grazing entry, and the ray then travels
*three whole levels inside the hill* without registering a hit — the faces it would exit through are
back-facing, and flat planes use `FrontSide`. Cast the identical ray backwards and it hits the
blocker cleanly at the expected distance. So in these cases the **engine** is the permissive one: it
sees through terrain that geometrically blocks. No analytic model reproduces a face-culling artifact,
so the harness bounds the rate rather than asserting zero.

*(Noted in passing, since it is not only about this map: `PLAN-BOT3.md`'s fact 1 already relies on the
`FrontSide` behaviour — "a ray from below cannot hit a higher plateau's top face". This is the same
property biting in the other direction, and it means engine line of sight is slightly optimistic near
grazing sightlines generally.)*

## Cost, measured 2026-08-15

Six landscapes (0, 100, 390, 3000, 6000, 9999), 340–537 flat cells, 1–8 watchers, so 460–4300
watcher×cell pairs:

```
                                            per pair    full map, one landscape
real raycast (isCellVisibleFrom)             291 us      121 ms  ..  1296 ms
analytic (terrainVisible) + cone schedule    1.5 us      3.4 ms mean, 6 ms worst
```

Note what the frozen-time window does to this table. 1296 ms of real raycasts was the number that
made the map look expensive; spent *before the first action*, it is affordable outright. The
per-decision budget is what must stay small — and under the design above the per-decision cost is a
bit-rotate, not a sweep.

## Three findings that shape the design

- **The bot does almost no line-of-sight work today**: 0.1–0.7 raycasts per *decision*, 0–54 per
  whole landscape. `ticksUntilSeen` runs the cone schedule first and spends a raycast only when the
  arithmetic says a cone is genuinely coming. So a raycast-based full map costs ~20× the bot's entire
  current LOS budget for a landscape, while the analytic one costs about what twelve raycasts cost.
- **`losCache` gets zero hits** as it stands (`engine/bot.ts:155`). Each cell is asked about once per
  decision and `seenCache` short-circuits repeats, so it is dead weight *within* a decision; it can
  only earn its keep persisted across decisions. Persisting it saves ~10 ms a landscape — it is an
  **enabler, not a performance win**, and should not be sold as one. This map supersedes it.
- **Analytic LOS currently disagrees with the engine in the dangerous direction.** A `terrainVisible`
  sweep (`game/botGeometry.ts:286`) reports ~20% *fewer* visible cells than `isCellVisibleFrom`
  (landscape 9999: 2328 against 2684) — i.e. it would call a cell safe that a watcher can see. Partly
  measurement error (the real watcher eye is `height + 0.9` at the cell *centre*), partly structural:
  the engine returns true if **any corner** of the cell is reachable, `terrainVisible` casts one
  centre ray. `BOT_PROBE` exists precisely to settle this and records zero disagreements for the
  current raycast sensor; **it must be re-run for any analytic one before that map is trusted.**

## Hybrid, if the sweep has to be cheap

The fallback shape, agreed before the frozen-time budget was brought into it: the cheap analytic map
ranks and plans globally; the real raycast confirms before the bot actually builds or transfers. That
is the same "cheap filter, exact confirm" pairing `computeHopField` and `findAssaultTile` already use,
and it keeps exactness where it is load-bearing (committing) without paying for it where it is not
(ranking).

With a second of frozen time available, the honest first attempt is the **exact** sweep, and the
hybrid is what to fall back to if it does not fit.

**Not needed, as it turned out.** The corrected analytic sweep matches the engine closely enough
(0.0064% unsafe, and that residue is the engine's own artifact) that there is nothing left for a
confirming raycast to add at ranking time. Keep the pattern in mind for the moment a *planner*
commits to building or transferring — an exact check there is cheap because it is one cell, not a
map — but the map itself does not need it.

## The visualisation

Colour-code the exposure map onto the terrain cells themselves — watched now / watched in N ticks /
never — behind the existing debug gate, alongside the watcher-cone overlay (`engine/cones.ts`,
Settings → Display).

**This is how the map gets trusted**, and given every wall found so far has been found by watching
rather than by measuring, it is worth building *before* any planner uses the map at all.

### Built (2026-08-16) — `engine/exposureOverlay.ts`

One small square per **flat** cell, floating above the ground, on a single `InstancedMesh` with
per-instance colour — one draw call, `skipRaycast`, `Disposer`-registered. Toggled by
`settings.showExposureMap` (Settings → Display → *Show exposure map*, debug-gated). Every tuning
constant is in one exported block at the top of the file: `SQUARE_SIZE` (1/2 a cell),
`HOVER_HEIGHT` (0.02), `RAMP_HORIZON_TICKS` (144 = 36 s, a whole multiple of the 48-tick rotation
period), `STRIPE_PERIOD` / `STRIPE_DUTY`, `BOULDER_HEIGHT` / `MAX_PILE_BOULDERS`, and the five
colours.
Values tuned on the landscape, not guessed.

Five states, chosen so that "safe" is never one undifferentiated colour:

| state | colour |
|---|---|
| in sight now | red `COLOR_IN_SIGHT` |
| exposed within the ramp horizon | red → amber → green |
| exposed, but past the horizon | green `COLOR_CLEAR` |
| no sightline at this height | blue `COLOR_HIDDEN` |
| at or above **every** live watcher's eye — permanently undrainable | violet `COLOR_ABOVE_EYE` |

…and one **orthogonal** channel: a cell whose next exposure waits on a **held** turn keeps its ramp
colour and is *hatched* rather than recoloured. Colour says *when*, the hatching says *whether the
clock is running*. World-space diagonal gaps are cut through the square with `discard`, so the ground
shows through — adjacent held cells line up into continuous bands, and it reads at any distance on
any theme. Half-opacity was tried first and rejected: at 0.5 on a saturated theme it mostly read as
"slightly darker". That separation matters — a held watcher pauses its whole future schedule, so every cell it
will ever reach is technically held, and flagging them all one colour is true but throws away the
ramp. "Red once it stops" and "green once it stops" are very different places to be standing, and a
plan is built out of exactly that difference. (Reported from watching: the first version painted them
all one dark red, which was correct and useless.)

A per-instance pattern is not something `InstancedMesh` offers — colour is per instance, this is
material-level — so `held` arrives as an instanced attribute and the shader acts on it, patched at
the same `#include <dithering_fragment>` point the object fade uses, with the world-space stripe
coordinate carried as a second varying. Still one draw call.

### The transfer flicker — found and fixed

Reported from watching: the squares were occasionally not drawn for a fraction of a second, most
noticeably during a body transfer. **The cause was the material being `transparent: true`**, and the
fix was to make it opaque. Confirmed on the landscape: gone completely, at `HOVER_HEIGHT` back down
to 0.02.

**`polygonOffset` was tried and REVERTED — it made things markedly worse**, and that is worth
recording because the hypothesis was so plausible. The squares float `HOVER_HEIGHT` above the
ground, the camera runs near `0.01` / far `2000` (a ratio of 200,000, so almost no depth precision
survives at range), and a flicker that correlates with camera movement is z-fighting's calling card.
Adding polygon offset made it fire on *short* transfers too, and at `HOVER_HEIGHT = 0.1` the squares
are visibly separated from the ground with no change to the flicker. **So the depth comparison is
not the cause**, and neither is the hover height. Do not re-try this.

Two changes kept, both justified independently of the flicker rather than as guesses at it:

- **`frustumCulled = false`.** Three caches an `InstancedMesh`'s bounding sphere on first render and
  never invalidates it (`engine/particles.ts` was bitten by exactly that). The matrices here are all
  written before the first draw so the cache is correct today — but this object spans the whole map,
  so the test can only pay off when the entire landscape is off-screen. It also cannot be the cause:
  disabling culling can only ever draw *more*.
- **Opaque, not `transparent: true`.** Since the hatching is cut with `discard`, every surviving
  fragment is fully opaque, so this belongs in the opaque pass. Transparency put it in the sorted
  pass, where Three orders objects by the depth of the **object's origin** — and this mesh's origin
  is world (0,0,0), the corner of the map, while its instances cover the whole landscape. That sort
  key is close to meaningless and swings as the camera moves, and it shared the pass with the
  crossfading bodies of a transfer and any live particle burst. It was only ever transparent because
  the first version faded held cells with alpha; nothing has needed it since the stripes landed.
  **This was the flicker**, confirmed by fixing it.
- **`customProgramCacheKey`.** Three keys its program cache on material parameters and ignores
  `onBeforeCompile`, so two materials with matching parameters share one program and whichever
  compiled first wins — a patched material can silently run an unpatched program. Nothing in the
  scene collides today; the failure is invisible when it happens, which is why it is guarded.

**The lesson, since it cost two wrong turns:** the flicker correlated with camera movement, which
made z-fighting the obvious suspect and sent the first fix at the depth buffer. It correlated with
camera movement because *transparent draw order* depends on camera position — not because depth
precision does. When a rendering artifact tracks the camera, "what else is ordered by distance?" is
worth asking before reaching for the depth buffer. `exposureOverlay.test.ts` asserts the chunk names against Three's own `ShaderLib`,
because a rename would make the patch silently no-op and ghosted cells would render solid — looking
exactly like watched ones.

Opaque by design: the level themes are saturated and vary per landscape, so a translucent overlay
would take its apparent hue from whichever theme was loaded and the same exposure would read
differently from landscape to landscape.

The ramp horizon is deliberately far shorter than a watcher's 12.8-minute cycle. Scaled to the
cycle, nearly every cell with a sightline would sit mid-gradient and the picture would say nothing;
scaled to a decision, the colour answers *"can I finish what I am doing here before the cone
arrives"*.

**Repainted on the 4 Hz game tick**, not per frame — the watchers' clocks are the only thing that
can change a colour. That makes a **drain-locked watcher's frozen sector visible for free**: its
clock stops, so its colours stop with it, which is the behaviour `game/cone.ts` could only
approximate. `MainView.svelte`'s Effect 3e does one extra paint when the overlay is switched on or
the scene is rebuilt, because the tick does not run in MENU/PAUSED/BIRDSEYE or before the player's
first action — which is exactly when you would want to study it.

**The held state came out of watching it** (2026-08-16), and it was a real modelling bug rather than
a display one. A drain-locked watcher holds its turn while `ticksUntilTurn` keeps decrementing into
negatives, so `firstTurn = max(0, ticksToTurn)` collapsed to zero and the sector the watcher was
*about to* turn into reported 0 ticks — identical to the sector it was actually looking at. Standing
in those two is opposite situations. The fix is in the map, not the overlay:

- `firstTurn` floors at **1**, so 0 ticks now means exactly "the current facing covers this cell";
- `WatcherClock` carries `drainLocked`, so a reader can tell a *paused* schedule from an overdue one;
- `readExposure()` returns `{ ticks, by, inSightNow, held }` — the three answers a bare countdown
  cannot separate. The `ticks` value stays conservative (earliest it could possibly happen, since
  the lock breaks the moment the watcher runs out of food); only the label says it is paused.

`game/cone.ts` still floors at zero, deliberately: it has no drain-lock signal, its caller only
wants a conservative number, and changing it would move the existing planners for no benefit.

**A second watching pass found the same class of bug again** (2026-08-16): mid-rotation, every ramped
cell briefly jumped a sector's worth *away* from red and then snapped back. `playTick` resets
`ticksUntilTurn` to a full period the instant a turn is **queued**, but `rot` is not committed until
the animation ends `TURN_DURATION_MS` later — so for half a second the clock is fresh while the
facing is stale, and the sector the watcher is visibly rotating *into* reads as a whole period away.
`Watcher.turning` now exposes "a turn is in flight", and while it is set the schedule shifts by one:
`j = 1` is arriving now, `j = 2` inherits the countdown `j = 1` would have had. The regression test
pins the error at exactly one period, so a reappearance is unmistakable rather than merely a bit off.

Both bugs are the same mistake in different clothes — **two fields that describe different moments,
read as though they described one.** Worth remembering when adding a third signal.

**The crosshair readout** sits in `MainView.svelte`'s existing `#internals` block: for the cell under
the crosshair, the exact tick count and seconds, *which* watcher gets there first, and the height
window — and it names `IN SIGHT NOW` / `held (watcher draining)` rather than leaving those to be
inferred from a number. It goes through `exposureAt()`, the same accessor the colouring uses, so the
number and the picture cannot drift apart.

**Absorbing a watcher** is the one thing that genuinely changes, and it is handled at read time
rather than by rebuilding: `resolveClocks` accepts `null` for an absorbed watcher and marks it
`alive: false`, so its cone stops being painted without the ~58 ms rebuild the design can only
afford before the first action. Covered by `exposure.test.ts`.

### The height stepper — done (2026-08-16)

The overlay answers for a body standing on `pileBoulders` boulders, stepped at runtime with
**PageUp / PageDown**, **Home** to return to bare ground. Named keys rather than punctuation because
`engine/input.ts` tracks `KeyboardEvent.key`, and `,` / `.` sit in different physical places on an
AZERTY keyboard while PageUp/PageDown/Home do not move at all.

**The squares rise with it**, which is the point rather than a flourish: you are looking at the plane
you are asking about, and cells flipping blue → red as boulders go under them *is* the height window
made visible. `assumedHeight()` is the single helper behind the square positions, the colouring and
the crosshair readout, so the picture and the number cannot answer about different planes.

Handled in `engine/loop.ts` outside `handleKeyActions` — it is not a game action, costs no energy and
takes no cooldown — and allowed in **BIRDSEYE** as well as PLAYING, since looking down at the whole
map is exactly when stepping through pile heights is worth doing. `setExposurePile` reports whether
anything moved so the caller repaints only on a change: the 4 Hz tick that normally repaints does not
run in BIRDSEYE or before the first action, which is precisely when someone would be standing still
stepping through heights.

Tested headlessly, including the claim the whole feature exists for: a cell behind a ridge reads
`COLOR_HIDDEN` at ground level and stops being hidden at two boulders.

Implementation note: terrain is four merged meshes with flat-colour `MeshPhongMaterial` and no vertex
colours (`engine/scene.ts`), so per-cell colouring means a separate overlay layer — one merged or
instanced set of quads sitting just above each cell top — not recolouring the terrain itself. That
follows `engine/cones.ts`'s pattern: shared geometry and material created once per `buildScene`,
registered with the `Disposer`, `userData.skipRaycast` so it never intercepts the picker, toggled by
a `settings` flag exposed in the debug-gated Display submenu.

Two things it must show, since they are the two claims most likely to be wrong: cells whose exposure
depends on **what is built on them** (`minVisibleHeight` above ground level), and the **countdown**
running against the live clock, which is the only way to see a drain-locked watcher's stall being
handled correctly.

## What already exists to build on

| | |
|---|---|
| `game/cone.ts` | pure, three-free, closed-form cone schedule: `bearingUnits`, `coversBearing`, `ticksUntilBearingCovered`. Cross-checked against the engine's own `inWatcherCone` in `cone.test.ts` |
| `engine/watcher.ts` | `inWatcherCone` (exported precisely so nothing keeps a second copy of the rule), `EYE_HEIGHT_LOCAL = 0.9`, `runDrainPhase`, `drainLocked`, and the foot-height `yOffset` at `:132` |
| `world/objects/watcher.ts` | the rotation clock, exposed read-only as `ticksToTurn` / `turnPeriod` |
| `engine/bot.ts:389` | `ticksUntilSeen` — the per-decision version of this map, and the reference for cheap-test-first ordering |
| `engine/bot.harness.test.ts:769` | `BOT_PROBE=<level>` — per-cell sensor readings printed next to a replay of the drain phase's own targeting. The validation harness for anything this document produces |
| `engine/cones.ts` | the pattern for a debug overlay |
| `game/botGeometry.ts:286` | `terrainVisible`, the analytic LOS whose disagreement with the engine is noted above |

## Status

**The sweep is done** — `game/exposure.ts`, validated against the engine, 58 ms mean per landscape,
0.0064% unsafe. The structure held: immutable per landscape, a cone mask plus a height *window* per
(watcher, cell), read against the live watcher clocks with no incremental update.

**The visualisation is complete** (`engine/exposureOverlay.ts`) — one coloured square per flat cell,
a crosshair readout, and the height stepper, all debug-gated. Both things it had to show are there:
the live countdown against a possibly-stalled clock, and the height dimension.

**The engine/visualisation seam is cut** (2026-08-16). Three layers, and the middle one is new:

| | |
|---|---|
| `game/exposure.ts` | pure, three-free, immutable once built |
| `engine/exposureSensor.ts` | owns the once-per-landscape build, turns live `Watcher`s into snapshots, hands out an `ExposureView` (map + clocks resolved once, cheap per-cell reads) |
| `engine/exposureOverlay.ts` | draws it, and nothing else |

That was needed however the bot ends up consuming the map: a planner must be able to read exposure
without importing a visualisation, and a debug feature that is off almost always must not be on the
path of anything that matters. `SceneData.exposure` is the sensor; `SceneData.exposureOverlay` is
the picture.

**Next: a planner consumer**, and nothing before it. Nothing in `game/bot.ts` or `game/bot2.ts` reads
this module yet, deliberately — `PLAN-BOT3.md` is designed as if it were not there. That was the
right call: watching the overlay produced five bugs, four of them in the map or its reading, none of
which any test or aggregate would have surfaced.
