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

**1 · Transfer onward** — move into a Synthoid that is closer to the goal or higher. Free, so it
outranks everything below. *This must come before reclaiming*: `game.previousSynthoidCol/Row` is
never cleared, so a cell the bot once left stays flagged as "a body of ours" forever — reclaiming
first had it build a body at its destination and immediately absorb it as though it were the old
one, over and over.

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

1. **Turn** — a scripted ease (`easeInOutCubic`) over a duration set by `TURN_RATE_RAD_PER_SEC`
   (a 180° U-turn in 0.5 s). That sets the *average* rate; the peak is 1.5× at the midpoint and
   zero at both ends. Constant-velocity turning was accurate and looked like a gun turret.
2. **Settle** — act only after 2 consecutive frames on target. `pickTarget` raycasts through
   `camera.matrixWorld`, which Three only refreshes inside `render()`, so an aim set on frame N is
   not raycastable until N+1.
3. **Verify** — check the crosshair found what was aimed at, including that a transfer target
   really is a Synthoid (a pile's own boulders sit at the same coordinates).
4. **Retry** — on a miss, try other points on the same silhouette (middle, high, low) before
   giving up. One ray can be blocked by a tree covering a body's waist while its head is clear.
5. **Record** — persistent failures blacklist `(action, cell)` until the body moves. Keyed by
   action, not cell: a failed *transfer* says nothing about *absorbing* there, and blocking the
   whole cell once stranded 5 energy of the bot's own construction.

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
demanding a flat approach would throw away most of the range. Two things get skipped:

- an **enclosed start**, where the body begins in a hollow with nothing at all below its eye to
  target, so its only legal opening move is the 3-energy hyperspace hatch. 372 of the 10000
  landscapes. Line of sight does most of that work: only 20 have no low-enough flat tile anywhere,
  the other 352 have one and cannot see it past a slope.
- `heightGap 3`, a seven-boulder pile and never played through. Exactly two landscapes, 2497 and
  9306.

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

`App.svelte`'s supervisor holds the end screen for a beat and then advances (a win) or returns to
the menu (a loss). **A loss does not skip ahead** — stepping over a landscape the bot cannot win
would be cheating, and leaving the cursor put is what makes its weakest landscape known. Settings →
*Reset demo progress* is the way out.

## Deliberately absent

- **No prediction.** `isInSight` is where cones point *now*; nothing models where they will point.
- **No fleeing.** Four variants measured, all negative — see below.
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

Gameplay randomness is seeded per landscape (`game/random.ts`), so runs are reproducible and a
failure seen once can be seen again. **Tune against the 102-landscape sweep, not a handful:**
twenty samples could not separate two configurations that scored an identical 12 while winning
different landscapes.

### Current standing — 51 of 102

```
won                 51
burned purse early  25   spent energy on actions that didn't stick
out of time         15   still alive at 240 s
died later          10
never got going      1   (was 9 before plans and the hyperspace hatch)
```

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
| `COMMITMENT` scoring bonus at 500 | too weak — phantom boulder survived |
| `COMMITMENT` at 1e6 | 0 of 102, superseded by plans |

**Why fleeing loses.** The drain is 1/second and cones sweep off by themselves, but a flight costs
3 for the body plus the slots to build it, move in and reclaim — three or four seconds of not
advancing, from a purse that is short precisely when the trigger fires. Treading water is a slow
loss; running is a faster one. Worth revisiting only with something the planner cannot currently
see: where the cones will point *next*, so it can wait a second instead of paying to move.

## Where to look next

1. **Burned purse (25)** — the largest bucket. Energy spent on actions that do not stick, mostly
   the drain race: a body eaten between building it and moving in.
2. **Out of time (15)** — these are alive at the buzzer. Some may be wins the 240 s budget hides;
   worth checking before optimising anything away. Note the watchdog now closes them out at
   `DEMO_NO_PROGRESS_MS`, so a landscape here is a landscape the demo visibly gives up on.
3. **Steeper ground** — `heightGap 3` is still untested and route steering skips it, which is a
   workaround rather than an answer. Two landscapes, so it costs the demo nothing; it would still
   be better to win them.
