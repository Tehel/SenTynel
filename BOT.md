# The demo bot

Reference for `src/game/bot.ts` (decides) and `src/engine/bot.ts` (executes). Written to be read
without the code open.

## What it is

A **virtual player**, not an AI opponent. It aims the real camera and then fires the same engine
action path a human's click does, so every energy cost, placement rule, line-of-sight test and
1 Hz cadence applies to it unchanged. It cannot do anything a player could not.

Its **planning is omniscient** — it reads the whole landscape, including objects it cannot see.
Its **execution is not**: every action it chooses still has to survive the crosshair raycast and
the rules. The bot knowing where a Sentry is does not mean it can take it.

It runs in demo mode (`game.demo`), which changes only *who drives*: no pointer lock is
requested, and `engine/loop.ts` accepts the bot in place of a held lock. The phase machine,
rules and HUD are untouched.

## Why it is split in two

| file | role | may import `three` |
|---|---|---|
| `game/bot.ts` | all decisions | no (types only) |
| `engine/bot.ts` | scene access, camera, raycasts | yes |
| `game/route.ts` | which landscape to play next | no |
| `game/demo.svelte.ts` | the bot's own saved progress | no |

The planner sees the world only through a `BotWorld` interface the driver builds each decision —
the same injection pattern `game/actions.ts` uses for `ActionContext`. That is what makes the
decision logic testable against a synthetic landscape with no renderer at all
(`src/game/bot.test.ts`, 40-odd cases, milliseconds).

### What the planner can ask

| question | cost | notes |
|---|---|---|
| `map`, `isFlat`, `objects`, `objectsAt` | free | plain data snapshot |
| `canPlace(col,row,type)` | free | the engine's real stacking rule |
| `canSeeFrom(from, standHeight, to, yOffset)` | 1–4 raycasts | **generous**: true if *any corner* of the cell is reachable |
| `canHit(col,row,aimHeight)` | 1 raycast | **strict**: the single centre ray the game resolves actions against |
| `isWatched(col,row)` | 1 sweep per watcher | in any watcher's line of sight, cone ignored |
| `isInSight(col,row)` | trig, then 1 sweep | in a cone **right now**, with line of sight |
| `ticksUntilSeen(col,row)` | arithmetic, then ≤1 sweep per watcher | ticks until a cone reaches it — **exact**, see `game/cone.ts` |
| `willBeSeenWithin(col,row,n)` | as above | will cover last long enough to finish something here |
| `isBlocked(col,row,action)` | free | this exact action already failed here |
| `energy`, `body`, `previousBody`, `plan`, `sentinelAbsorbed` | free | |
| `targetJump` | 1 landscape generation | demo only, and only once the Sentinel is down |

`canSeeFrom` and `canHit` answer different questions and both are needed. A tree can swallow the
centre ray while leaving a cell's corners open — that is the bot turning to stare at a hillside.

`isWatched` ignores cone direction on purpose: watchers rotate, so line-of-sight shadow is the
only durable cover. `isInSight` is the present-tense version and drives the sharper decisions.

## The geometry everything rests on

**A tile higher than the eye can never be targeted.** `engine/visibility.ts` refuses any target at
or above the eye, so the bot cannot hop upward — height is *only* ever gained by piling boulders
on a tile already in view and transferring onto them. This single fact shapes the whole movement
model.

A boulder is 0.5 tall; the eye sits 0.875 above the feet. Two formulas follow:

```
bouldersToSee(tile, target)      n > 2·(target − tile) − 1.75
                                 → 1 boulder to look one level up, 3 for two, 5 for three
bouldersToOutrank(tile, stand)   smallest n with tile + n·0.5 > stand
```

`bouldersToSee` against the pedestal top (its tile + 1) reproduces `utils/all-levels.js`'s
`n = 2·gap + 1` — the planner and the route CSVs derive pile heights from the same arithmetic, and
a test asserts they agree for gaps 0–3.

`bouldersToOutrank` returns the **smallest** workable n, and zero is a valid answer. One boulder
too many puts the new body above the bot's own eye line, where it cannot be seen and so cannot be
transferred into — 3 energy spent on a body that can never be entered.

## The survey — once per landscape

**Assault tile.** The tile the Sentinel will be taken from: the flat tile needing the shortest
pile whose pile-top eye has line of sight to the pedestal top. Fewer boulders is less energy and
less time exposed. Note this tile is *by construction* in the Sentinel's sight — that is what
qualified it.

**Hop field.** A reverse breadth-first search from the assault tile over every flat tile, giving
each one a true hop count. Straight-line distance is a lie on this terrain: scoring by it makes a
greedy hill-climber that walks into a *pocket* — a dead end near the goal but not connected to
it — and then stops, because nothing reachable is any nearer.

Edges are tested with `terrainVisible`, an analytic line of sight over the height map alone — no
scene, no raycast. That approximation is the only reason an O(tiles²) sweep is affordable; a real
raycast sweep would take minutes. Objects are ignored, and the crosshair re-checks for real
before the bot commits to anything.

Because every edge requires the target to sit under an eye at `tileHeight + 1.375` and terrain heights
are integers, **no edge climbs more than one whole level** — so a hop count is also a level count.

Since Postscript 18 there is a **second kind of edge**, used only where no cheap one exists: a tile
whose eye clears the target after a *taller* pile. It is charged a whole `TALL_HOP_COST`
(`MAP_SIZE²`, more than any route of cheap edges can total), so a cost reads as a pair —
`climbs · TALL_HOP_COST + hops` — and **a walk always outranks a climb**. That bound is the point,
not a tuning knob: a tall tower is usually *cheaper in energy* than the staircase it replaces, so
letting it compete on cost would have the bot habitually tower straight up the terrain rather than
walk it, which is a duller thing to watch in an attract mode. Without it, though, a bowl whose rim is
sloped reads as a dead end and the bot hyperspaces out of a winnable landscape on decision zero —
see *Climbing out of a pocket* below.

**v2 diverges here, since B4** (`PLAN-BOT2.md`). It surveys the *pedestal* and the **band** — every flat
tile that could launch an assault with an affordable pile — and seeds the hop field from the whole band
rather than from one nominated tile. Combined with the property above that makes the field a ladder:
layer 1 is the level below the band, layer 2 the one below that, so descending hops is climbing. No
assault tile is chosen at survey at all; v2 re-derives an *aim* each decision and commits only on
arriving somewhere `canAssaultFrom` accepts. One traversal per landscape, against a worst case of eight
before. v1 still surveys a single tile exactly as described above.

## Plans

A plan is an **intention**: *occupy tile (col,row) standing on N boulders*. The driver holds it;
the planner receives it through `BotWorld` and returns the next one alongside each action.

Deciding afresh every tick means inferring past intent from present world state, and **the world
does not record intent**. Boulders on a tile are equally a pile being built or one half eaten. A
Synthoid is equally the body being walked to or one abandoned two hops back. Every loop of note in
this bot's history came from that gap, and each was patched with a tuned constant until the plan
replaced them.

It is an intention rather than a recorded list of actions on purpose: the next action is
re-derived from it each tick, so a boulder a watcher steals mid-sequence is simply rebuilt, where
a script would march on to the body step.

### Giving up — `isPlanViable`

| condition | why |
|---|---|
| achieved | standing on the target |
| fouled | a drain left a tree/meanie on it; `canPlaceAt` can never accept the stack again |
| overbuilt | something else got there first |
| refused | the crosshair already failed there — commitment without this is stubbornness |
| out of reach | target now above the eye (e.g. after a forced hyperspace) |
| out of sight | no line of sight from where we stand |
| exposed *(v2 only)* | a cone has arrived on the destination since we chose it — see below |

**Exposed** is opt-in, so v1 is unaffected, and it is graded against the boulders *remaining* rather
than the original pile: a plan one boulder from done is not thrown away over cover that would have
lasted long enough. Destination cover was always graded, but only in `chooseDestination`, which is not
re-run while a plan holds — so a plan latched on a clear tile went on being built into a drain that ate
it. Measured **exactly neutral** (188/250 with and without) and kept only because it closes an unbounded
leak for nothing. It fires late by construction: when the cone *arrives*, after the boulders are paid
for. Choosing better needs tiles the walk is not already considering — the exposure map,
`PLAN-EXPOSURE.md`.

Being **short of energy is deliberately not a give-up condition** — the harvest rung earns it and
the plan waits. Nor is a better destination appearing: changing target whenever something
marginally better turns up is the oscillation the mechanism exists to stop.

**Staleness** (24 decisions) lives in the driver, because it is the one condition the planner
cannot see: a watcher eating a pile as fast as it is laid looks tick-by-tick exactly like
progress, with no failure ever reported. Only elapsed time gives it away. *Measured inert* — 24
and 10 give byte-identical outcomes across the sweep, since the viability tests catch everything
observable first. Kept as a guard for the invisible case.

## The decision ladder

Evaluated in order, first match wins. One action per decision, paced by the shared 1 Hz cadence.

**0 · Endgame** — once standing high enough on the assault tile: absorb the Sentinel → put a body
on the pedestal → transfer into it → spend any surplus → hyperspace, which is the win. Once
`sentinelAbsorbed` this rung keeps control for the rest of the run: absorption is locked from that
moment, and handing back to the walk saw the bot step onto the pedestal, stop counting as "in
position", and get transferred straight off it one action from winning. The surplus step is route
steering and fires in demo mode only — see *Attract mode*.

**1 · Transfer onward** — move into a Synthoid that is closer to the goal (in **hops**, ties broken by
straight-line distance) or higher, and **that we have not already stood in**. Free, so it outranks
everything below. *This must come before reclaiming*: `game.previousSynthoidCol/Row` is never cleared,
so a cell the bot once left stays flagged as "a body of ours" forever — reclaiming first had it build a
body at its destination and immediately absorb it as though it were the old one, over and over.

The visited-cells filter is Postscript 20, and it generalises the `previousBody` one. Inside a hop band
the two remaining clauses order tiles in *opposite* directions — higher, and closer to the goal — so
three bodies can each be an improvement on the one before, round and round. `previousBody` is that same
guard one step deep and closes only a two-cycle; landscape 9194 looped three bodies for 67 seconds until
a watcher ate one of them. The argument is about position rather than about loops: every option a cell
offers was on the table while the bot was standing in it. Exempt: the perch it is coming home to, and a
body deliberately built at the plan's destination.

**2 · Reclaim** — absorb the body just left behind, +3. This is what makes the create-and-transfer
walk cost nothing net.

**2b · Clear the assault tile** — if a drain fouled it with a tree, absorb that. A tree there is
always residue: the bot only ever builds boulders and bodies. Without this the one tile the plan
depends on is permanently unbuildable and the bot circles for the rest of the run.

**3 · Take a Sentry** — whenever one is in range, *whatever the purse says*. Same 3 energy as a
Synthoid, and one fewer thing sweeping the ground ahead. Gating this behind "am I short?" had the
bot walking past live Sentries it could see.

**4 · Harvest** — trees, boulders, Sentries and abandoned Synthoids, when below
`endgameCost(n) + 8` or when the walk is unaffordable. Absorbing is free and only ever gains, so
an unaffordable move is its own reason to top up. Abandoned bodies matter: `previousBody` tracks
only *one* cell, so a body left by two transfers in a row is orphaned at 3 energy each.

**4b · Build the assault pile** (v2 only) — plan the *aim* tile as a destination in its own right,
carrying the pile the assault actually needs (`bouldersToSee` against the pedestal top) rather than
the one a climb would need.

Reported from watching the demo on landscape 330, 2026-08-17: right after taking the only Sentry the
bot fell into a shell-to-shell shuffle, hyperspacing out and climbing back six times across 158
seconds, and won only because a random hop eventually left it standing high enough. **58 transfers
against a normal 6.**

The gap was between two boulder counts that were never connected. `chooseDestination` sizes
destinations for *climbing* — one boulder when the hop needs one, otherwise none (and, since
Postscript 18, whatever `escapeClimb` says a pocket needs) — and the goal's own
`boulders` was used for nothing but scoring, so every hop delivered the bot onto band tiles bare. On
330 the pedestal sits at height 9, so the assault wants an eye above 10, and the best ground anywhere
on the map is height 9: bare eye 9.875, **short by an eighth of a unit on every tile it could
reach**. One boulder in the band would have finished it and nothing ever planned one. The bot was at
`hops: 0` the whole time — standing *at* its goal, with nothing left for the walk to improve, which
is why it degenerated into lateral shuffling and then the boxed-in hatch.

Building where it already stands is not an option and never will be: `isPlanViable` treats a plan on
the current tile as achieved, because the movement model only gains height by building on *another*
tile and transferring up. Hence a destination rather than an in-place build. Priced on what remains
of the job, like rung 3b, so a half-built pile is not refused.

Landscape 330: 58 transfers → 6, and the jump improved from +29 to +30.

**Gated on already being in the band (`hops === 0`), and the gate is the whole story.** The first cut
fired whenever the aim tile was merely *viable*, and measured **853/1000 against 861** with
`watchdog-stalled` up 7: from far away the aim tile is usually viable, so the bot abandoned
approaching it in favour of laying its whole five-boulder pile at range, burning the purse on a tower
it could not then reach. Narrowed to the actual pathology — in the band, cannot assault, walk has
nothing left to improve — it measures **862/1000**.

**That is +1 against the 861 baseline, i.e. neutral, and the bucket trade is the real result:**
`never-reached-assault-position` 69 → 63 while `watchdog-stalled` 18 → 24. The rung does get the bot
into assault positions more often; roughly as many of those attempts then stall instead of winning.
Worth a look before this is called done — the likely candidate is a pile it starts in the band and
cannot finish, with nothing to abandon it. Kept because landscape 330's 158-second shuffle is a real
pathology that it genuinely removes, and because the trade is visible rather than hidden.

**0b · Absorb a Meanie** (v2 only) — above everything but the endgame, including the free transfer.
Reported from watching, 2026-08-17: a Meanie spawned in easy reach on two landscapes and the bot
ignored it both times, and was hyperspaced away both times. The asymmetry is extreme — one second of
the cadence and +1 energy, against 3 energy and a random landing that discards the position it has
spent a minute building. No purse condition and no distance limit: a Meanie anywhere is hunting this
body specifically, so "not worth the detour" is never true, and the only question is whether the
crosshair reaches it. **Not added to v1**, which is not the demo default and whose baseline was not
re-measured.

Being the top rung is not enough on its own, and landscape 7755 is why: the bot had shot at the tree
this Meanie was converted from, missed it while its model was still growing in, and blacklisted the
cell — so `!world.isBlocked` held the rung shut for five seconds against a Meanie two squares away in
plain sight. The conversion takes the **closest tree** and so does the harvest, so the Meanie is
systematically the cell the bot has most recently been shooting at. See *Record* under Execution, and
Postscript 19.

**5 · Walk** — follow the plan, or form one. Raise the pile, then stand a body on it; the transfer
comes back around on rung 1. When the goal is above us the hop carries its own boulder, so one
move both approaches and climbs.

**6 · Hyperspace** — nothing else legal or affordable. Not a safety net but a real position: on
the map's floor with every neighbour higher there is *no* legal move, since nothing above the eye
can be targeted and absorbing needs the same clearance. Nine landscapes in a hundred used to end
with the bot standing still for four minutes, purse untouched.

### Choosing a destination

Candidates are flat, placeable, not blocked, not the cell just left, and below the eye. Scored
`hops × 1000 + distance-to-goal − height/2`, then:

- **Pass 1** — a hop that improves lexicographically: fewer hops, or same hops and a whole cell
  nearer. Hops stops the bot walking into pockets; the distance tiebreak keeps it moving *within*
  a hop band, since on open ground every tile in sight of the goal is 1 hop away and hops alone
  would accept only the goal tile. If nothing is found, the same pass runs again **nearest-first**
   — the budget otherwise goes on proving it cannot see the far side of the landscape while the
  good tile two cells away is never tested.
- **Pass 2** — walled in by height, so climb. Ordered by height, because a pile must lift the eye
  above where it already is: raising one on a tile below us wastes boulders catching up.

Exposure is three-tiered: unwatched, then watched-but-not-currently-looked-at (survivable — cones
sweep), then in-sight, taken only when the entire reachable set is under the cones. A body built
on a tile a cone is on can be eaten in the second before the bot transfers in, and the rules
refuse a transfer into a body already being drained — 5 energy for a stepping stone never used.

## Execution

0. **Choose where to point** — `aimCandidates` lists every point on the target cell the crosshair
   could sensibly be aimed at, best first, and the driver pre-flights them with `pickAlong` (the
   same ray, from the eye, without turning the head) and takes the first that actually arrives.
   Two shapes, because the two kinds of target fail differently:
   - **Something standing there** — walk its own silhouette, `AIM_FRACTIONS = [0.5, 0.85, 0.2]`.
     A tree or a fold of ground can cover a body's waist while head and feet are clear, and some
     models have no waist at all: the Meanie is a head floating over a tripod foot with a hollow
     between them, so a ray at its bounding-box midpoint passes clean through.
   - **Bare ground** — walk the tile's own surface, `AIM_OFFSETS`, corners first (that is what
     `engine/visibility.ts` believes: a cell is reachable if *any of its four corners* is) and
     inset by 0.4 so `picker.ts`'s floor-to-a-cell does not round onto the neighbour.

   `BotWorld.canHit` answers from the **same list**, which is the point of it: the planner's idea of
   what can be hit is exactly what the driver can deliver. See Postscript 9 in `PLAN-BOT2.md` for
   what it cost when they disagreed.
1. **Turn** — a scripted ease (`easeInOutCubic`) over a duration set by `TURN_RATE_RAD_PER_SEC`
   (a 180° U-turn in 0.5 s). That sets the *average* rate; the peak is 1.5× at the midpoint and
   zero at both ends. Constant-velocity turning was accurate and looked like a gun turret.
2. **Settle** — act only after 2 consecutive frames on target. `pickTarget` raycasts through
   `camera.matrixWorld`, which Three only refreshes inside `render()`, so an aim set on frame N is
   not raycastable until N+1.
3. **Verify** — check the crosshair found what was aimed at, including that a transfer target
   really is a Synthoid (a pile's own boulders sit at the same coordinates).
4. **Retry** — on a miss, walk the rest of the candidate list. Still worth having after the
   pre-flight above, since the world can move between choosing the shot and taking it.
5. **Record** — persistent failures blacklist `(action, cell)` until the body moves, until an
   action at that cell succeeds, or until **the thing that was standing there is no longer standing
   there**. Keyed by action, not cell: a failed *transfer* says nothing about *absorbing* there, and
   blocking the whole cell once stranded 5 energy of the bot's own construction. The clearing
   conditions past the first each close a false invariant. "Every reason a step can fail is a function
   of where we're standing" holds for an aim miss but **not** for a rules refusal, since `canPlace`
   turns on the cell's *contents* — which the bot rearranges itself. And a record is a judgement about
   a *thing*, not about a square: a drain morph, a conservation tree or a tree turning into a Meanie
   voids it (Postscript 19).

   **A shot at something still materialising is not recorded at all.** The step is dropped and
   re-proposed next decision. A spawning object is present to `objectsAt` and `canPlaceAt` from the
   frame it is created while its mesh spends up to a second growing out of the ground, so a ray at its
   finished midpoint passes over the model that exists — which says nothing about whether it can be
   hit. `aimHeightFor` re-derives that midpoint from the live scene at every attempt for the same
   reason: on landscape 7755 the tree the bot was aiming at became a Meanie mid-turn, and the shot went
   over its head.

**One thing the raycasts must agree with the rules about.** `objectsAt` treats an object as gone the
instant it is absorbed, but its mesh plays a 1–2 s animation. Until 2026-08-24 that corpse went on
blocking `engine/visibility.ts` and resolving under `engine/picker.ts` — one to two whole decisions of
blacklisting cells the rules considered clear. `GameObject.remove()` now sets `skipRaycast`; particle
bursts carry it too. The spawn animation is the mirror image and was found the same way a fortnight
later, on 7755: the mesh is *ahead* of the rules there rather than behind them, so nothing can be
concluded from a ray that misses it.

Idle planning backs off 500 ms — a decision costs a line-of-sight sweep per candidate, and
re-deriving "nothing" at 60 Hz visibly costs framerate.

## Attract mode

The demo plays landscape after landscape unattended. Three pieces make that work.

**Its own progress.** A demo win never touches the player's record. The bot has its own level
cursor and unlocked list (`game/demo.svelte.ts`) and its own lifetime stats (`demoStats` in
`game/stats.svelte.ts`, selected by `setStatsTarget`), so an overnight run cannot unlock landscapes
nobody played, cannot inflate a counter, and — the one that would not be undone by a reset — cannot
bump `gameCompletions` and permanently speed up the player's watchers. `currentLevelId()` is the
one place that decides whose landscape is being played. The side benefit is that the demo **resumes**
where it got to rather than restarting from whatever the menu points at.

**Route steering.** Winning jumps ahead by exactly the energy left over, so the landing is a
consequence of the purse — unless the bot deliberately arrives poorer. Standing on the pedestal
with the purse now final, `game/route.ts` picks the landing and `planEndgame` spends the difference
on creates, which are never refunded (absorption having locked with the Sentinel). Biggest
denomination first, since each costs a whole second of the 1 Hz cadence.

The rule is *maximise the jump, skipping landscapes the bot has no fair run at* — deliberately not
`utils/path-no-tower.csv`'s `heightGap`-0 route, since a one- or two-unit gap is no trouble and
demanding a flat approach would throw away most of the range. Three things get skipped, two known
before the demo starts and one learned while it runs:

- an **enclosed start**, where the body begins in a hollow with nothing at all below its eye to
  target, so its only legal opening move is the 3-energy hyperspace hatch. 372 of the 10000
  landscapes. Line of sight does most of that work: only 20 have no low-enough flat tile anywhere,
  the other 352 have one and cannot see it past a slope.
- `heightGap 3`, a seven-boulder pile and never played through. Exactly two landscapes, 2497 and
  9306.
- the **blacklist**: landscapes the bot has actually failed three times in a row, recorded in
  `game/demo.svelte.ts` beside the cursor. See *Giving up on a landscape* below. Consulted outside
  `isPlayableLanding`'s memo, since unlike the two above it grows while the demo plays.

So 96% of landings are acceptable, and the scan runs **downward** from the furthest affordable jump
and stops at the first one that passes — about 1.04 `generateLevel` calls (~3 ms) per landing rather
than the whole window. There is no precomputed table and nothing to keep in sync with `terrain.ts`.

**A watchdog.** Half the landscapes are lost, and a good share of those end with the bot alive and
achieving nothing — circling a tile it cannot build on, or boxed in below 3 energy so even the
hatch is out of reach. Two limits in `engine/bot.ts` close it out: `DEMO_NO_PROGRESS_MS` since the
last action the rules *accepted* (read off `game.lastActionAt`, which a refused or mis-aimed step
deliberately does not move), and `DEMO_LEVEL_LIMIT_MS` on the landscape overall. Either one enters
LOST with `lostReason: 'stalled'`, so stall and death share one exit and the screen does not caption
a bot with energy in hand "Energy Depleted".

`App.svelte`'s supervisor holds the end screen for a beat and then advances (a win, `advanceDemo`)
or fails it (a loss, `failDemo`).

## Giving up on a landscape

**A loss still never skips ahead** — stepping over a landscape the bot could not win would hand it a
landing it never earned. What changed on 2026-08-24 is that it no longer needs somebody watching.

The landscape is **retried in place**, and three consecutive failures put it on the blacklist and
**rewind the cursor to the landscape whose win paid for it** (`cameFrom`). That landscape is then
replayed, and because `chooseDemoLanding` consults the list, the same win buys a *different* landing:
the surplus burn does the steering and there is no new steering code. Every landing stays earned; the
bot just earns a different one.

Three points about the shape of it:

- **Consecutive, and three.** The bot is not deterministic across browser runs — the 1 Hz cadence
  aligns differently against the 4 Hz drain with frame timing, which is exactly what `BOT_FRAME_MS`
  exists to sample. One loss is a sample; three in a row on one landscape is a shape. A win in
  between clears the count.
- **A retry bumps `levelEpoch`.** Two reasons and both matter: `MainView`'s Effect 2 rebuilds the
  scene on it, so without a bump the bot restarts on the wreckage it just left; and `game/random.ts`
  seeds from `(levelId, levelEpoch)`, so without a bump the three strikes would be three copies of
  one run rather than three attempts.
- **A rewind is spent once.** `cameFrom` is cleared on use, because what a second rewind would need
  is where the *target* was reached from, and nothing records that. So a rewind target has to be won
  again before the chain continues, and a landscape genuinely out of options hands back to the menu
  rather than ping-ponging. The demo's own first landscape has no `cameFrom` at all, so a loss there
  behaves exactly as it did before all this: back to the menu — unless the caller asks to be stranded
instead (`failDemo({ haltWhenStranded })`), which is what touch does: it holds the demo in PAUSED with
a "Nowhere Left To Go" caption and the pause overlay's own controls, since the menu it would otherwise
land in is an arrow-key tree a phone cannot drive. Resuming from there always *starts* a landscape —
the one the overlay's picker names, or a replay of the same one with a fresh seed — never a resume in
place, which would drop the bot into the scene it just lost on.

The list is the point. A soak's product is *which landscapes the bot gave up on*, and they are either
genuinely dead — 482, whose map holds two flat tiles at the starting altitude and no way up from
either — or the next thing to fix. It is shown as a count on the *Demo* menu entry, logged per
entry (under `localStorage.debug=1` — the count is for whoever left the soak running), and cleared
only by *Reset demo progress* (Delete on the menu's *Demo* line), which is what
lets an improved bot disagree with every verdict rather than inherit yesterday's weaknesses.

Separate from it, and deliberately so, is the hard-coded `IMPOSSIBLE_LEVELS` (`game/demo.svelte.ts`,
currently `[482]`): landscapes a *human* has proven have no win in them. That is a claim about the
game rather than about this bot, so there is nothing for a better planner to disagree with — it
survives a reset, is not counted as a skip, and `failDemo` rewinds off one on the first loss instead
of sampling it three times. Rediscovering one costs up to three `DEMO_LEVEL_LIMIT_MS` losses on every
fresh device, which is a quarter of an hour of an attract mode going nowhere in front of whoever is
watching. The bar for an entry is a proven dead end, never a landscape the bot keeps losing. Nothing prunes it
automatically: pruning the evidence is how a skip list turns into curation. See PLAN-BOT2.md's *On
maintaining a blacklist of unwinnable landscapes* for the argument this settles.

## Finishing under a drain

Standing on the perch, in a watcher's sight, the bot **finishes** rather than harvesting (rung 3c).

The reason is arithmetic, not tuning. A tree is +1, a drain is −1 per watcher per second, and a
draining watcher never rotates away — so the purse cannot grow at all while this is going on. Grazing
there is not slow progress towards a bigger jump; it is exactly zero, and negative once a second
watcher joins. The supply refills at the rate it is consumed, too, since every successful drain spawns
a conservation tree: on flat ground the only thing that ever ends the loop is `HARVEST_BUDGET`, whose
80 decisions are 80 seconds of the 1 Hz cadence — most of `DEMO_LEVEL_LIMIT_MS`.

Not gated on affording the endgame: grazing cannot make the bot richer, and the Sentinel is +4, more
than any tree, and stops that watcher for good if it was the one draining. Scoped to standing *on* the
perch — drained out on an errand is the same futility with a different answer (go home, not finish),
and `planEndgame` does not test reachability, so firing it from anywhere else would aim at a pedestal
the bot cannot see. It fires for exactly one decision per landscape.

Measured **908 → 909** of 1000 with every loss bucket flat and mean jump 35.6 → 35.3. The aggregate did
not move; it is kept for closing an unbounded loop cheaply, not for the win rate.

## Getting home to the perch

Off the perch with the errand list empty, the bot **transfers into the body standing on the perch**
(the rung after the harvest, beside the finish branch).

It needs its own rung because rung 1 cannot do it. `chooseTransfer` filters out `previousBody` to stop
a two-body oscillation, and the perch *is* `previousBody` whenever the bot went out to an errand
destination it transferred into — while the reclaim rung protects that same body as the way back up,
and the walk cannot rebuild a way home because the perch tile is occupied by the very body it wants.
Nothing but a transfer clears `previousBody`, so the state is permanent. Landscape 7632, from an
unattended run: seven Sentries absorbed, 37 energy against a `maxJump` of 44, standing one square from
home, doing nothing until the watchdog closed it out. Now **WON +40**.

Placed after the harvest deliberately. Exempting the perch inside `chooseTransfer` would fire at rung 1
and re-open the oscillation the filter exists to prevent: the outbound leg can be taken on
`o.height > body.height`, the return leg is always allowed by `goingHome`, and nothing breaks the
symmetry. After the harvest there is nothing left to oscillate with.

Measured **byte-identical** on the verdict block — 909, same buckets, same losses, nothing flipped —
which was predicted: all fifteen `watchdog-stalled` losses there idle in ASCEND, so this deadlock
occurs nowhere in 6000-6999. It is pinned in the harness asserting the rung fires **exactly once**,
because a win alone cannot distinguish "went home" from "went home repeatedly".

## Transferring reasons in hops, not straight lines

`chooseTransfer`'s "is that body nearer the goal" test compares **hop counts** against the same field
the walk uses, with straight-line distance only as a tiebreak within a hop band.

It compared raw distance until landscape 9950 (2026-08-25), reported as *"it insists on transferring to
an abandoned synthoid at the bottom of a pit"*. A pit five cells from the pedestal, against the assault
tile's ten, with no hop-field entry at all — nothing walks out of it. So the abandoned body down there
was permanently "closer": the bot climbed the ladder to hops 0, transferred down, hyperspaced out,
climbed back, and repeated until the clock ended it. `chooseDestination` had been given `computeHopField`
precisely to stop the walk "strolling into a pocket that is near the goal but not connected to it"; the
transfer rung never got the same treatment.

**909 → 912** of 1000, gaining 6533, 6567 and 6573 and losing nothing, mean jump unchanged, with
`never-reached-assault-position`, `watchdog-stalled` and `out-of-clock` all down and no bucket worse.

## Climbing out of a pocket

Two rules cover the case where no cheap hop leaves the tile underfoot, both added in Postscript 18 and
both inert everywhere else.

**The pile aims at the escape, not at the next half-level.** `bouldersToOutrank` returns the smallest
pile that lifts the feet, which is right wherever the terrain supplies the other half of the level —
the ledge above, one boulder, two energy. On a flat pit floor there is no ledge, so each rung has to
out-rank the last from the same floor: one boulder, then two, then three, an arithmetic series against
a purse that only recovers the rung behind it. `escapeClimb` asks instead how tall the pile must be
before something *better than here* is in sight — better by the field's own cost, so never a ledge
that leads nowhere. It returns 0 whenever the tile has a cheap edge.

**And "nearer the goal" stops counting.** `chooseDestination` grades progress lexicographically —
fewer hops, or the same hops and a whole cell nearer — and the distance half is dropped while the body
stands somewhere no cheap hop leaves. Down there nothing but the climb changes the cost, so a tile
"nearer the goal" is nearer to something no walk reaches, bought with the purse the only real move
needs. On landscape 6161 the bot opened with a one-boulder lateral hop across the pit floor and
arrived with eight energy against the nine the escape then needed; it then laid 42 boulders and
absorbed 37 for two transfers.

That second rule also **switched the hyperspace hatch back on**. Rung 6's stuck counter had existed
since landscape 35 and would always have been correct on 6150 — a genuinely dead bowl — but it never
accumulated, because the shuffle returned a step every second and *churn reads as progress* to every
measurement here. The fix was not to detect the churn but to stop manufacturing it: 6150 now wins **by**
hyperspacing while 6161 wins **on foot**, from one change.

**921 → 926** of 1000 (+8 −3), mean jump unchanged at 81%. Landscape 86 — the report that started it,
a bowl in the first hundred landscapes — goes from a doomed decision-zero hyperspace to **WON +22** of
a maximum 26, with no hyperspace at all.

## Piles are sized to the purse

`chooseDestination` never plans a pile it cannot pay for: the boulder count is capped at what remains
once the body on top is funded. If boulder + body cannot both be afforded, the hop carries no boulder.

Landscape 7398 (2026-08-25) is why. Its opening needs a three-boulder tower, leaving 1 energy; the bot
transfers up, reclaims the body it left (+3) and with **four** in hand plans a hop costing **five**. It
lays the boulder, is left with two, and stops for the rest of the run — nothing clears the plan, the
harvest has nothing in reach, and rung 6's hyperspace needs six, so it cannot even leave.

Gating the walk on `remainingHopCost` (the landscape-16 rule that rungs 3b and 4b already use) would
*not* have fixed it: at four energy every hop with a boulder in it is unaffordable, so refusing them all
stalls just as hard. The answer had to be a cheaper hop.

Not the change [PLAN-BOT2.md](./PLAN-BOT2.md) postscript 8 rejected — that dropped the climb boulder on
*geometry* (destination already above our feet), firing on every hop, and paid for a better opening out
of the ascent. This fires only on *solvency*, and is invisible whenever the bot has money.

Only the **discretionary** boulder is ever dropped — `chooseDestination`'s `Math.max(1, …)` climb
floor, which fires when `bouldersToOutrank` already returns 0 because the destination is at or above
our feet. Everything bouldersToOutrank actually asks for is structural and is kept even when it cannot
yet be paid for, because the harvest tops up. Two wrong versions were measured first, both caught on
landscape 6313: *shortening* a pile makes it gain nothing at all (every count below bouldersToOutrank
tops out at or under our own height), and *dropping* it turns a climb into a fall.

**912 → 919** of 1000, +8 −1, mean jump unchanged, `watchdog-stalled` unchanged. The incoherent
shorten-the-pile version scores **924** and is rejected anyway — see PLAN-BOT2.md postscript 16 for why,
and for what its extra five landscapes are probably telling us.

v1 is untouched; the budget is an optional parameter only v2 passes.

## Deliberately absent

- **No prediction *in the planner*.** The sensor exists and is exact (`ticksUntilSeen`, below), but
  no rung consults it yet — the one that did is the fifth rejected flee variant.
- **No fleeing.** Five variants measured, all negative — see below.
- **No global route.** Steering is greedy: the furthest playable landing, decided one landscape at
  a time. `utils/path-no-tower.csv`'s provably-optimal 221-hop line stays a reference artifact, and
  reaching it would need the bot to actually achieve `maxJump`, which it does not.

## Measuring it

`src/engine/bot.harness.test.ts` drives the **real** `GameLoop` — real scene, real raycasts, real
rules — stubbing only the renderer (its `render()` does the `updateMatrixWorld` that `pickTarget`
needs) and the InputManager. Three.js raycasting is pure CPU; nothing the bot touches needs WebGL
or a DOM.

```
npm test                                              # 4 asserted landscapes + a chain, ~4 s
BOT_SWEEP=1 npx vitest run src/engine/bot.harness --reporter=verbose -t sweep
BOT_TRACE=1 BOT_SECONDS=400 ... -t "sweep 272"        # every decision, one landscape
npx vitest run src/engine/bot.harness -t chain        # three landscapes through advanceDemo()
```

The chain case is attract mode end to end: it replicates `App.svelte`'s supervisor the same way the
rest of the file replicates MainView's Effects 3a/3b, hops landscape to landscape through the real
`advanceDemo()`, and asserts each landing is one the steering should have chosen and that the
*player's* progress is untouched throughout.

**Timing.** The harness runs a fixed 16 ms frame; the browser runs real rAF deltas. The 1 Hz action
cadence and the 4 Hz drain phase therefore drift against each other differently, and that decides
whether a boulder is laid before or after a watcher looks. It is not a small effect on marginal
landscapes: 106 wins at 16 ms and is still wandering at the buzzer at 15 ms. `BOT_FRAME_MS` re-runs
at another frame time, which is the cheapest way to tell a real bug from one alignment's bad luck —
and a reminder that any single sweep number is one sample of a family (v2 scores 74 at 16 ms, 73 at
15 ms).

Gameplay randomness is seeded per landscape (`game/random.ts`), so runs are reproducible and a
failure seen once can be seen again. **Tune against the 102-landscape sweep, not a handful:**
twenty samples could not separate two configurations that scored an identical 12 while winning
different landscapes.

**One limit on that reproducibility, measured 2026-08-13.** A single landscape is reproducible to
the event: run alone, or in an eleven-landscape slice, the same landscape gives byte-identical
tallies every time. A *full* 102-landscape run does not quite: across four of them, each showed
about one landscape whose transfer/failure/retry counts differed — a different landscape each time,
always one already thrashing (dozens of failures, no progress), and **never one that changed a win
into a loss or back**. Wins held at 51 across all four. The cause is not in the planner (it predates
the B2 refactor and appears between two runs of identical code) and has not been found; it does not
reproduce in a slice, which rules out the obvious per-run state and points at something that only
accumulates over a long process.

So: **totals and outcomes are sound, individual counters on a thrashing landscape are not.** Judge a
change on wins and on the jump ratio, and if a single landscape's tallies are the whole evidence for
something, re-run that landscape alone before believing it.

### Current standing — v2 928 of 1000 on the verdict block

The honest measure is a fresh 1000-landscape block; the 102-landscape set below is a training set that
every change in `PLAN-BOT2.md` has been tuned against, and it reads a few points optimistic. On
6000-6999 at a 16 ms frame, v2 wins **928 of 1000**, banking **81%** of the jump those landscapes could
fund (`utils/bot-v2-6000-6999-postAIM.txt` is the 888 snapshot; the figures since are in
`PLAN-BOT2.md`'s postscripts). The progression on that block: 725 before the B4 guards,
740 after them, 861 after the rules-fidelity work (`PLAN-RULES.md`), 888 after the aim fixes of
Postscript 9, 898 once the aim stopped naming the tile underfoot (Postscript 10), 908 once the assault
pile started consulting watchers at all (Postscript 11), 909 once the perch stopped grazing under a
drain (Postscript 13 — a change whose aggregate did not move; see *Finishing under a drain* above), and
912 once transferring reasoned in hops rather than straight lines (Postscript 15), 919 once piles
stopped carrying a discretionary boulder the purse could not pay for (Postscript 16), 921 once a
square being absorbed stopped counting as occupied (Postscript 17 — a game-rules fix, RULES-FIDELITY.md A5),
and 926 once the hop field could express a two-level climb and the walk stopped shuffling sideways
inside a pocket (Postscript 18). Postscript 19 — no longer disqualifying a target because the shot at
it was taken before its model had finished arriving — is a wash on this block at 926 (+7/−7, its noise
floor) and is kept on the strength of the permanent state it removes; see the postscript. 928 once the
free transfer stopped accepting a cell the bot had already stood in (Postscript 20), which is the one
change here whose *bucket* moved exactly as predicted: `out-of-clock` 10 → 7, three runaway
transfer counts turned into wins.

### Older standing — v1 69 of 102, v2 74 of 102

```
            v1    v2
won         69    78     mean jump 17.8 (46% of maxJump) / 31.1 (78%)
lost/stuck  33    24
```

The 24 v2 still loses, from the 2026-08-13 sweep:

```
200  500  700  900  2000 2500 2800 3200 3300 3600 4300 4700
5400 5700 6500 6800 7500 7600 8000 8300 8800 9000 9200 9800
```

Sentry count does not predict them — 4-sentry landscapes go 13/13 while 5-sentry go 6/11 — and neither
does landscape number. Geometry and exposure still decide it.

Any single sweep number is one sample: outcomes on marginal landscapes depend on the frame time —
see *Timing* below.

Both jumped by about eighteen landscapes on 2026-08-13, when two bugs found by *watching* the demo
were fixed (see below). Before that: v1 51, v2 54. Note what happened to the shape as well as the
total — the "still alive at the buzzer" bucket went from fifteen to one, so what is left is almost
entirely honest death rather than wandering.

**Both bugs came from one report of one landscape, and neither was visible in four measured
configurations.** Landscape 42 was played in the browser and looked wrong; replaying it in the
harness with `BOT_LEVELS=42 BOT_TRACE=1` showed both inside a minute.

- **A Sentry generated on the assault tile could never be cleared.** The tile is reserved so the bot
  does not eat its own pile, but the reservation covered *anything* standing there — so the Sentry
  rung skipped it, the harvest rung skipped it, and the "clear the assault tile" rung only knew
  about trees and meanies. The one tile the plan depends on stayed blocked, the bot never got into
  position, and it eventually took the hyperspace hatch. Now only boulders and bodies are reserved.
- **Every hop destroyed its own plan.** A body takes about a second to grow into place, and for that
  second the crosshair cannot resolve it — so the transfer rung declined and the walk was asked what
  to do next. It answered "build the body", which the rules refuse, which blacklists
  `(create-synthoid, cell)`, which `isPlanViable` reads as a dead plan. The bot therefore threw away
  its intention immediately after achieving it, once per hop, on every landscape, for as long as
  plans have existed. `planStep` now returns null there and the walk holds its intention for a tick.

The second one is the larger share of the eighteen, and it is worth being blunt about why it went
unseen: the sweep reports totals, and a bot that silently re-derives the same destination looks from
the outside exactly like a bot that is working. Tuning against that number for several rounds is
what "plateaued at 51" actually was.

Wins run from one-boulder to seven-boulder piles. **Neither sentry count nor landscape number
predicts difficulty** — 9999 has seven secondary sentries and is one of the easier ones, its
ground flat apart from the Sentinel's mound. Geometry and exposure decide it.

## Measured and rejected

Kept here so they are not re-attempted on intuition.

| change | result |
|---|---|
| flee whenever a cone touches us | −4 of 20 |
| the same, only below 8 energy | −1 of 20 |
| flee only into cover that already exists | 0 of 20, never once fired |
| flee only when the alternative is break-even | −6 of 102 |
| flee on cone contact, destination chosen by **predicted** cover | −6 of 102 (45 vs 51) |
| `COMMITMENT` scoring bonus at 500 | too weak — phantom boulder survived |
| `COMMITMENT` at 1e6 | 0 of 102, superseded by plans |
| v2: errand walks graded by distance alone, freed of the assault-tile hop field | **22 of 102** against 51 — see below |
| v2: hyperspace after 24 decisions without gaining height, replacing the cut-off hatch | **177 of 250** against 182 |
| aim at a Meanie's foot before its head (`AIM_FRACTIONS` → `[0.5, 0.2, 0.85]`) | 886 of 1000 against 888 — neutral, see below |
| grade `coverPreference`'s middle tier by shortfall instead of a flat 1 | 907 of 1000 against 908, and the doomed-plan count unchanged — see below |

**Two from B4 (2026-08-14), both instructive rather than merely negative.**

*Freeing the harvest walk.* The harvest navigates with a hop field aimed at the assault objective while
its goal is an errand across the map, so `chooseDestination`'s hops term and distance term pull in
different directions and a candidate with more hops is refused however much nearer the spoils it is.
Removing the mismatch — errand as goal, no field, straight-line progress — reads like an unambiguous fix
and cost **29 landscapes**. The reason is that the confinement was doing a second job nobody had
noticed: it kept the bot near its perch. Freed of it, the bot walked off after distant spoils and rung
1's "transfer into any body higher than this one" clause kept dragging it further out — on landscape 100
to the far corner of the map, off the hop field entirely, never to return. **There is no reliable route
home in the movement model, and the confinement stands in for one.** Fix the way home first.

*The no-progress hatch.* Replacing "is my tile connected to the goal" with "have the feet got higher in
the last 24 decisions" sounds strictly better — connectivity is not progress. It cost five landscapes,
because a tall pile legitimately spends six or seven decisions before it lifts anything, so the test
fired on tiles where the bot was doing exactly the right thing and jumped it away from nearly-finished
towers. Any give-up test measured in decisions has to be longer than the longest legitimate stretch of
apparent inactivity, and for this bot that is a five-boulder tower.

*Ordering the middle cover tier (2026-08-24).* The most convincing argument in this table, and worth
nothing. `coverPreference` computes an exact tick count and discards it, returning `{0, 1, 2}` — and grade
1 covers everything from a quarter-second of cover to five seconds, which is the very criticism this
codebase levels at v1's middle tier. `pickVisible` keeps only the first candidate at each grade, and
candidates arrive sorted by distance to the goal, so among imperfect tiles the walk silently takes the one
nearest the Sentinel. Grading by shortfall fixes all of that and changes nothing: **907 against 908, with
the count of plans laid on tiles that get watched before they are finished unmoved at 6.** The fallback
tier is only reached when nothing safe was available at all, and then *every* candidate is doomed, so
choosing the least-bad among them cannot change an outcome. The defect is real and its cost is zero — a
useful reminder that an argument built out of the code, however tight, is not a measurement.

*Aiming at the Meanie's foot first (2026-08-24).* The model argument is sound — the tripod foot is wider
than the head, and the probe agrees it is the more reliable hit. It measures **neutral** (886 against
888) because of what changed underneath it: every candidate aim is now validated by a real ray before
it is fired, so the order only decides which of several *working* aims is taken. Ordering mattered
while the first shot was blind. It stopped mattering when the shot stopped being blind — which is worth
remembering before tuning any other "try these in order" list in this codebase.

**What *did* pay, and why it is not fleeing (2026-08-15).** Reported from watching: the bot stands in a
cone being drained a point a second, absorbs trees to break even, and never leaves. That is rung
ordering — rungs 2-4 all outrank the walk, so with a tree in reach and the purse low the bot always ate
rather than moved, and a watcher draining us never rotates away, so one point in against one point out
is an equilibrium with no exit. v2 now has a rung between the Sentry and the harvest: **while in sight
and not yet perched, take the step the walk would have returned anyway, one rung earlier.**

The distinction from the six rejected flee variants is the whole point. Those fire on cone contact and
**add** a journey — two or three actions and the current intention spent on a trip that was not
planned. This adds nothing: same destination, same plan, same cost, just sooner, and only while
standing still is actively costing energy. If the walk has nowhere to go the ladder falls through to
the harvest exactly as before. Worth **+6 of 250** on 3000-3249 and **+16 of 1000** on 6000-6999, with
the `bled-out` loss bucket down from 17 to 4 — while reading **−3 on the 102-landscape sweep**, which
is worth remembering next time that number disagrees with a block.

**It must price finishing the hop, not the next action** — the first version did not, and landscape 16
regressed from a win to a loss on it. Under a cone with seven energy the bot laid a boulder (−2), was
drained to four, built the body (−3), was drained to nothing, and died one action short of a transfer it
had already spent five energy on. A hop under a cone costs the hop *plus what the watcher takes while
you make it*, and both terms scale with the pile: `2n + 3` to build, about `n + 2` actions at a point a
second to be drained through.

Price what **remains**, not the whole hop, or the gate re-creates the loop it closes: charging the full
price every decision means a half-paid hop gets refused, and the bot stands on it grazing at a net zero.
Falling through cannot loop either — it leads to the harvest, which raises the purse while the remaining
cost stays fixed, so topping up brings the hop closer every second.

**Reclaim everything you leave behind, not just the body (2026-08-15).** A hop costs a boulder (2) and
a body (3) and returns 3 when the body is reclaimed, so reclaiming only the body runs the walk at −2 an
hop. v2's rung tested `top.type === SYNTHOID`, so once the body was gone the boulder under it was left
standing — five of them on the landscape where this was reported, at 2 apiece against a maxJump of 22.
Worth +11 of 1000 and the purse ratio from 78% to 80%.

Note the geometry, because it bounds how much can ever be recovered: **the body is hittable because it
stands on the boulder.** Take it away and the boulder drops half a level, and it can fall behind the
ridge the hop was crossing — `canHit` then refuses and the energy is unrecoverable from that position.

**And do not buy height the terrain is giving away.** `chooseDestination` folds a boulder into every hop
toward a higher goal, flooring the pile at 1 even where `bouldersToOutrank` says 0 because the
destination is already above our feet. That floor is right — removing it outright costs 18 of 1000, with
`never-reached-assault-position` jumping 123 → 153, because the bot saves energy and then cannot climb —
but it is not right *unconditionally*: on a poor landscape it is a 2-an-hop tax on ground that was
already rising. Gated on `energy >= endgameCost(pile) + DETOUR_RESERVE` it scores better than either
extreme, and cuts `died-in-opening` from 107 to 77.

**Why fleeing lost — settled, after five variants.**

The reasoning here used to read "the drain is 1/second and cones sweep off by themselves". **That is
wrong**, in the one case that matters: `engine/watcher.ts`'s `drainLocked = acted` holds a watcher's
rotation timer while it has anything to eat, and the player's own body is an ordinary drain
candidate. A watcher draining *us* never turns away, so standing in a cone is an unbounded bleed,
not a passing squall. Waiting it out is not an option the bot has.

That made the first four rejections look like failures of *destination* choice — with no way to tell
a durably safe tile from a briefly safe one, the bot fled blind and paid 5 energy for a stepping
stone eaten before it arrived. So the fifth variant gave it exactly that information: fire on cone
contact, and pick the refuge by `BotWorld.ticksUntilSeen` (`game/cone.ts`), which is not an estimate
but a closed-form schedule.

**It lost the same six landscapes: 45 against 51.** The mechanism, counted from a trace of 4200
(won at baseline, lost fleeing): the flee rung fired eleven times against four pile-raises, and
dropped the walk's plan six times. Every lost landscape shows the same signature — *more* transfers
than the baseline, and no more progress.

So the cost is not the energy, which reclaiming mostly returns. It is the **action budget** and the
**plan**: at 1 Hz a flight is two or three seconds not spent advancing, and it discards the
intention that keeps the walk coherent — the thing plans were introduced to protect. Prediction does
not change that arithmetic, because the arithmetic was never about where to run.

The distinction worth carrying forward: prediction is free when it *ranks tiles the bot was going to
visit anyway*, and expensive when it *triggers extra moves*. See [`PLAN-BOT2.md`](./PLAN-BOT2.md) —
the sensor stays, the rung does not.

### Two more found by watching (2026-08-13)

Both from one report of landscapes 106 and 60, replayed with `BOT_LEVELS`.

**`canHit` is not `canSeeFrom`, and a rung that forgets it can loop forever.** The picker resolves
anything the ray reaches, *including a cell above the eye*. Absorbing a tree additionally requires
`isCellVisible` (`engine/scene.ts`), which refuses a target at or above the eye outright. The "clear
the assault tile" rung tested only the crosshair, so once a forced hyperspace dropped the bot below
that tile it proposed an absorb the rules could never accept — and since the failure blacklist
clears every time the body moves, it re-proposed it for the rest of the landscape. **Any rung
proposing an absorb must pass both tests.**

**The assault tile is a single point of failure.** There is one, and every plan aims at it, so a tile
that cannot be cleared ends the landscape.

*Corrected 2026-08-14.* This paragraph used to claim the problem was solved — "`findAssaultTile` now
takes an exclusion set and v2 re-surveys (capped at three) after five consecutive decisions unable to
clear a fouled tile". The exclusion set is real, but **the re-survey was never wired**: `resurvey()`
existed in `game/bot2.ts` from the commit that introduced the file and nothing ever called it, and the
two constants that were supposed to trigger it were never read. The test named after the mechanism
asserted only that the step was non-null and its label was not `'clear the assault tile'`, so it passed
identically with the mechanism, without it, or with it inverted — which is how the gap survived four
rounds of measurement. Dead code and test both deleted; the exclusion set's one live use is the
survey's reachability retry.

The real fix is not a fallback tile but **not choosing one up front** — see `PLAN-BOT2.md`'s B4.

**The bot did not know a winning position when it was standing on one.** `inAssaultPosition` asks
"am I on the tile the survey nominated", and the survey picks its tile before the run starts. A climb
that ends one tile over — high enough, clear view of the pedestal top — did not count, so the bot
walked off to keep pursuing a goal it had already achieved, and could hyperspace away from the
finish. That is what "it derails completely once next to the pedestal" was.

`canAssaultFrom` (`game/botEndgame.ts`) replaces the identity test with the capability one: eye above
the pedestal top, line of sight to it, and the Sentinel actually hittable from here. The third clause
is load-bearing — committing latches the perch, which switches off the hyperspace escape, so a
position that looks winning but cannot take the Sentinel is a landscape thrown away.

**And the discovery has to stick.** Recognising the position without re-pointing the plan was *worse*
than not recognising it: the assault plan is what the walk goes home to, which tile is kept clear,
and which pile is load-bearing, so a perch at one tile and a plan at another had the bot on 600 latch
a winning spot, go harvesting, and then spend 147 decisions walking back to the tile it could not
use.

*Superseded by B4 (2026-08-14).* The re-point is gone, because there is no longer anything to re-point
from: v2 chooses no assault tile at survey, and commits to the tile under its feet the first time
`canAssaultFrom` accepts. The pathology the re-point fixed cannot recur — a perch and a plan at different
tiles is now unrepresentable — and the hop-field rebuild it needed happens once, at commitment, as the
route home. v1 keeps `inAssaultPosition` and the identity test.

**A tile under a cone right now is impossible, not merely bad.** The walk takes the least-bad
candidate when nothing good is reachable, on the principle that standing still is worse than being
seen. That principle has an exception the drain phase makes exact: it runs at 1 Hz and takes the
topmost Synthoid, so a body built where a cone is *now* is eaten before the transfer can complete —
five energy for nothing, every time. Landscape 246 opens on a watched tile with every covered tile
*below* it, and the bot spent its entire purse there twice in five seconds. `TilePreference.avoid`
refuses that grade outright; with nothing else reachable the walk returns nothing and the bot
hyperspaces out instead. **Worth +4 landscapes on the sweep** (74 to 78), which is the largest single
strategy change measured here.

**Cover has to outlast the job.** A fixed 14-tick requirement let the bot start a three-boulder tower
on a tile with three and a half seconds of cover, lay two boulders and watch them eaten — visible on
60, where it survived only because the sentries happened to rotate away, and on a replay where the
conservation trees fell elsewhere it never recovered. The requirement is now four ticks per action
the job takes: each boulder, the body, the transfer.

## Where to look next

The plan for the next attempt is [`PLAN-BOT2.md`](./PLAN-BOT2.md): a **challenger planner** beside
this one rather than another tuning pass, built on the human strategy that completed the game and on
cone prediction (the rotation mechanics make it exact — see that document's *Verified mechanics*).
This file stays the reference for the bot that exists today.

**The purse, not just the win rate.** Measured over the 51 wins of the current sweep, against
`utils/all.csv`'s `maxJump` for those same landscapes:

```
mean jump banked      15.9
mean maxJump          39.1      41% of what the landscape could fund
reached maxJump        0 of 51
```

Winning jumps ahead by exactly the leftover energy, so this is the *other* half of how far a run
gets, and it is the half nobody was watching. Route steering spends a point or two of surplus by
design (`planSurplusBurn`), which is nowhere near the missing 23 — the rest is simply energy left
lying on the landscape, because rung 4 stops harvesting the moment `endgameCost + 8` is covered.

For scale: the project owner completed the game in 260 hops, averaging ~38.5 per hop — essentially
`maxJump` every time. At 15.9 a hop, a bot that won *every* landscape would still need ~630.

1. **Burned purse (25)** — the largest bucket. Energy spent on actions that do not stick, mostly
   the drain race: a body eaten between building it and moving in.
2. **Out of time (15)** — these are alive at the buzzer. Some may be wins the 240 s budget hides;
   worth checking before optimising anything away. Note the watchdog now closes them out at
   `DEMO_NO_PROGRESS_MS`, so a landscape here is a landscape the demo visibly gives up on.
3. **Steeper ground** — `heightGap 3` is still untested and route steering skips it, which is a
   workaround rather than an answer. Two landscapes, so it costs the demo nothing; it would still
   be better to win them.
