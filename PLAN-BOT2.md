# SenTynel — bot v2: a challenger planner

Plan for a second demo-bot planner, built alongside the existing one rather than replacing it.
`BOT.md` describes the bot that exists today (v1) and stays the reference for it. This file is the
roadmap for what comes next; move settled facts into `BOT.md` as each phase lands.

## Why

v1 wins **51 of the 102 sweep landscapes** and has plateaued: successive tuning passes trade
landscapes rather than gaining them. *(Written before B3. It turned out not to be a plateau but a
bug — see the postscript at the end: v1 is now at 69 and v2 at 73.)* Its own loss breakdown says why — the largest bucket (25) is
"burned purse", energy spent on actions that did not stick, mostly a body eaten between building it
and moving into it. That is not a bug to find; it is a policy the ladder does not have.

The human reference point is sharper than the win rate suggests. The project owner completed the
game in **260 hops with two backtracks** — against a provable optimum of 220 (`utils/paths.js`,
`path-shortest.csv`) — which means two things at once:

- a win rate around **258/260** where the bot manages 51/102, and
- an average jump of ~38 landscapes, which is only reachable by **absorbing nearly everything
  absorbable on nearly every landscape**.

The second gap is the one v1 cannot close by tuning, because it is not trying to: `planNextStep`
harvests only while `energy < endgameCost(n) + 8`, then stops. Its objective is "reach the pedestal
alive". The human objective was "leave with a full purse". Those are different games, and route
steering (`game/route.ts`, `planSurplusBurn`) is currently optimising a landing off a purse the
harvest policy never fills.

## Start here — state on 2026-08-15

**Where it stands.** Two planners behind one `BotPlanner` seam, selected by `settings.botPlanner`
(browser demo defaults to v2) and `BOT_PLANNER` in the harness.

```
                    102-sweep   3000-3249   6000-6999 (verdict block)
v2   wins            73/102      184/250     739/1000  (73.9%)
     mean jump       30.3 (78%)  30.6 (80%)  34.8 (80% of maxJump)
v1   wins            69/102                            (unchanged since B2)
     mean jump       17.8 (46%)
```

Note the 102 reads *lower* than before the last change while both real blocks read higher — the
clearest demonstration yet of why it is a training set and not a measurement.

Blocks are not comparable to each other — 6000-6999 runs about two points harder than 3000-3999 while
its landscapes are richer (maxJump 43.7 against 38.9). Only a pre/post delta on the *same* block means
anything; see *Method*.

Head to head over 1000 landscapes: v2 wins 128 that v1 loses, v1 wins 28 that v2 loses, 240 both
lose. Unaided, v2 has walked from landscape 0 to 246 in the browser.

**Where v2's losses actually go**, on the 6000-6999 verdict block (261 losses) now that the harness
buckets them — see *Method* below:

```
never-reached-assault-position   114   44% of losses — never got into a position to finish
died-in-opening                  111   <=2 transfers inside 30s, and not a drain bleed
watchdog-stalled                  16
out-of-clock                      16   still playing at the 240s harness budget
bled-out                           4   watchers took more than absorbing earned
died-after-the-Sentinel            0
burned-purse                       0
```

Three of those reset long-standing assumptions. **`burned-purse` is zero** — it was v1's largest bucket
(25 of 55) and the opening premise of this whole document, and v2's phase split eliminated it outright.
**`died-after-the-Sentinel` is zero** too: the endgame, once started, never fails. And **`bled-out` is down
to 4 of 275** since the move-on rung landed (postscript 6; it was 17 before), so B4b's flee argument has
far fewer candidates left than it looked — even landscape 390, written up in postscript 5 as *the* flee
case, measures as gain 25 / spend 25 / watcher-pool drain 5 over the whole run and buckets as an
overspend that never got high enough.

So the losses are the ascent and the opening, confirmed on a block rather than inferred from one trace.

**Next:** the two things B4 exposed, in this order, because both are aimed at metrics that are *not* at
parity where B4's own target was:

1. **Give the harvest a way home, then unconfine it.** See *What B4 exposed* under B4. The harvest walks
   on a hop field aimed at the assault objective while its goal is an errand, which confines it to one
   hop band — and the confinement cannot simply be removed, because it is accidentally standing in for a
   route home the movement model does not have. This is the purse, and the purse is the jump.
2. **The clock**, though the move-on rung has already given most of this back: out-of-clock plus stalled
   is 36 of 275, against 44 immediately after B4 and 33 before it.
3. **The opening.** `died-in-opening` is now the second largest bucket at 108 and the only one that rose
   (from 101) — moving rather than grazing costs energy early, which is the trade the move-on rung makes.

Then **the exposure map** (specified in `PLAN-EXPOSURE.md`), and only then B4b's economic flee trigger,
which is now a much smaller prize than it looked: `bled-out` is 4 of 275 losses and landscape 390 does
not qualify.

### Method — read this before measuring anything

- **The 102-landscape sweep is a training set now.** Every change in this document has been tuned
  against it, and it has drifted optimistic: it reads ~3 points above the systematic block. Use it as
  a fast smoke test only.
- **3000-3999 is a diagnosis set.** Its per-landscape snapshot is committed and has been mined (the
  bucket table above, the heightGap breakdown, the transfer-count profile). Reading a set is not
  tuning against it, but a block whose losses you study to design a change cannot also be that
  change's verdict. **The verdict block is 6000-6999**, never enumerated in the repo before B4.
- **Judge a change by the delta on one block, not by the level.** Blocks differ in difficulty, so an
  absolute number is not comparable across them. Baseline the verdict block *before* the change and
  compare pre to post at **identical block, chunk boundaries and frame time** — that is what cancels
  difficulty out.
- **Know the noise.** 1σ ≈ **1.4 points at n=1000**, ≈ **2.8 at n=250**. "181/250 → 185/250" is noise.
- **A single frame time is one sample.** `BOT_FRAME_MS` changes how the 1 Hz action cadence aligns
  with the 4 Hz drain phase, and marginal landscapes flip on it: 106 won at 16 ms while still failing
  at 15. Check a reported failure at two frame times before calling it fixed.
- **A full 102-run disagrees with itself on about one landscape**, always a thrashing one, never on
  the win. Individual tallies are not evidence; re-run a landscape alone before believing it.
- **Diff the bucket histogram, not just the total.** A change that trades one bucket for another at an
  unchanged win rate is a real finding, and was invisible for the whole of B1-B3.
- **Parallelise the big runs** with `utils/block-sweep.sh`, which shards a block across concurrent
  vitest processes and re-aggregates. 250 landscapes in 1.5 min against 3.5 sequential; 1000 in ~6.
  Verified to reproduce a single-process run exactly — same total, same jump, same losing ids.

### Tools built for this, all opt-in

```
BOT_LEVELS=42            replay one landscape        BOT_LEVELS=3000-3999   a whole block
BOT_PLANNER=v1,v2        which strategies run        BOT_FRAME_MS=15        simulated frame time
BOT_TRACE=1              every decision, with the planner's *beliefs* (phase, perch, inPos)
BOT_PROBE=390            exposure map around the start, next to the drain phase's ground truth

BLOCK=6000-6999 PLANNER=v2 ./utils/block-sweep.sh out/label     # sharded block run
node utils/sweep-aggregate.js --snapshot out/x.txt out/label/chunk-*.log
```

`sweep-aggregate.js` deliberately **ignores each chunk's own `sweep summary`** and recomputes from the
per-landscape lines: averaging averages over unequal slices is wrong, and it warns if the landscape
count falls short of the block, since a silently truncated run reads as a lower win rate.

The sweep summary prints wins, mean jump against maxJump, the trade between planners, and the losing
ids. `BOT_TRACE` printing beliefs rather than only actions is what turned "most of the decisions are
counterintuitive from there" into a one-run diagnosis — keep that property when adding rungs.

### What four rounds of watching established

Every wall reported from watching the demo has been a bug, and each was worth far more than the
landscape that surfaced it: **+18 wins** (assault-tile reservation and the plan self-destruction),
**+4** (refusing tiles under a live cone), plus 106, 600 and 390 diagnosed. Meanwhile every change
argued from the aggregate alone was worth 0-3.

The reason is worth keeping in mind rather than relearning: **a total cannot show you a bot that is
busy doing nothing.** Silently re-deriving the same destination, walking at an unreachable goal, or
standing in a cone all look exactly like working. Four separate pathologies hid behind a plateaued
win rate, and a human watching for five minutes found each of them.

The corollary for the failure list: the 249 known failures in 3000-3999 are worth going through, but
a landscape the demo *actually walked into* outranks any of them.

### Two things that are settled

- **Cone geometry is exact, and the sensors are honest.** The cone is 20 of 256 rotation units wide,
  every watcher steps ±20 per period, so the schedule is closed-form (`game/cone.ts`). The probe
  cross-checks `isInSight` against the drain phase's own targeting on every tile near a start:
  **zero disagreements**. When the bot ignores a safe tile, the sensor is not the suspect.
- **Retreat has been asked six ways and lost every time** (table in `game/bot.ts`). That does not
  settle B4b — see the trigger argument there — but it does settle that *positional* triggers do not
  pay.


## Ground rules

**A challenger, not a rewrite.** The bot is already two separable things, and only one of them is
strategy:

| | what it holds | rewrite? |
|---|---|---|
| `engine/bot.ts` + `bot.harness.test.ts` | turning, settle frames, crosshair verify, silhouette retry, `(action,cell)` blacklist, watchdog, the `BotWorld` snapshot, the 102-landscape sweep | **never** — all of the debugging pain, none of the strategy |
| `game/bot.ts` | the ladder, destination scoring, plan viability | freely |

`BotWorld` → `BotDecision` is already a policy interface. A second planner can sit beside the first,
be selected by a flag, and be scored on the same sweep. v1 stays the default until v2 beats it on
that number, and both stay in the tree afterwards — a regression in v2 should be visible as a
comparison, not inferred.

**Nothing here relaxes the rules.** The bot remains a virtual player: it aims the real camera and
fires the same engine action path a human click does. Planning stays omniscient, execution stays
earned. The new sensors below are *computed from state the bot already reads* — no new privileges.

**`BOT.md`'s measured-and-rejected table stands.** It is the expensive part of what we know. Append
to it; do not quietly re-run a rejected experiment and call it new. The one exception is documented
under *Verified mechanics* below: the flee experiments were run without cone prediction, and one of
the stated reasons for rejecting them turns out to be wrong.

## The human's account

Recorded as **inspiration, not specification**. It is the strategy that actually completed the game,
so it is worth far more than an invented one, but it was written from memory by a player working
with partial information — it is a description of intent, not a decision procedure, and where the
bot can do better than the description it should.

> - if a sentry is absorbable, do it now (worst case if I'm watched, +2 energy)
> - when watched, if a safe synthoid is available, transfer there, else identify a safe cell, spawn
>   a synthoid and transfer (stay safe, no work under pressure)
> - absorb anything you can, in descending energy value order (more energy is always good, and buys
>   time in a dire situation)
> - look for a safe higher cell that will give a view on an even higher one. If found, start
>   ascending: put a boulder on a safe higher cell, put a synthoid on it, transfer to it; if the
>   tower we're building gets absorbed, absorb what's on that cell, pick a new candidate cell and
>   retry
> - if there's no simple "small-steps" path for ascending, we need to plan a higher tower, either
>   for the next step, or for the following one
> - harvest time: once we have reached the highest position and removed all the sentries, go harvest
>   the remaining energy (trees, meanies, abandoned boulders or synthoids)
> - finish: create the smallest possible tower that enables absorbing the sentinel, transfer there,
>   absorb the last previous boulder+synthoid if any, absorb sentinel, spawn synthoid on pedestal,
>   transfer to it, hyperspace

Two notes from the same account, both about the asymmetry between player and bot:

**On fleeing.** Kept at high priority deliberately, against v1's measurements: "it may be more
important for a human than for a bot, since bot efficiency is much better for actions, letting it
stay stable as long as there are absorbable trees, whereas a human player will very soon lose. I'd
still keep it high, as time spent surviving is probably time lost." See *Verified mechanics* — the
mechanics support the instinct, and v1's rejection rested partly on a false premise.

**On safety.** "When looking for a safe cell, human is at a big disadvantage: partial knowledge of
the cones and it's often a trial-and-error thing — spawn a boulder, see if it holds, if not absorb
the remaining tree and try somewhere else. I also try to remember the way the watchers rotate to
estimate the future state, but I do not always have the information, especially early in the game.
Bot will know all and predict perfectly, I expect a huge efficiency gain here." This is the single
largest expected gain in the whole plan, and *Verified mechanics* fact 1 says it is exact rather
than approximate.

Two optimisations from the same account, both currently absent from v1:

- **Latest-watched placement.** When choosing a tile to build a tower on, especially near the
  Sentinel, prefer the one that becomes watched *last* — typically waiting for the Sentinel to
  rotate and then taking the sector it has just left.
- **Perch and branch.** During harvesting, deliberately leave a Synthoid in a very high place (the
  "winning" one, possibly at Sentinel level, ready to finish) and branch from it: spawn cheap
  single-use bodies with no boulders under them on tiles that can reach the remaining trees,
  transfer out, absorb the trees, transfer back to the perch, absorb the temporary body. This is the
  mechanism behind the ~38-landscape jumps.

## Verified mechanics

Read out of the code while drawing this plan up. All three change how the prose translates, and none
of them is currently exploited.

### 1. Cone geometry is exactly predictable, not estimable

- `engine/watcher.ts:16` — `CONE_HALF_ANGLE_RAD = (10/128)π`, i.e. **10 of the 256 rotation units**,
  so the cone is **20 units (28.125°) wide**.
- `world/terrain.ts:422` — every watcher's rotation step is `r & 1 ? -20 : 20`: **always ±20 units**,
  direction randomised per watcher.
- `world/objects/watcher.ts:11,46` — period is `TURN_PERIOD_TICKS = 48` ticks (12 s at 4 Hz), scaled
  by `0.95^gameCompletions`; the first turn is offset by `(1 + timer/64) × period`, where `timer` is
  the generator's per-watcher stagger.

So **the cone advances by exactly its own width every 12 seconds**: adjacent sectors, no overlap and
no gap. Consequences the planner can rely on:

- A cell in sight *now* is guaranteed out of sight after the next step.
- The full future schedule of "when is this cell inside this watcher's cone" is closed-form from
  `rot`, `step`, `ticksUntilTurn` and the bearing — no simulation, no search.
- Choosing "the sector it has just left" can buy **the better part of a minute** of guaranteed
  cover, not the few seconds a human can be confident of.

`rot` and `step` are already public on `GameObject` (`world/objects/base.ts:62-63`).
`ticksUntilTurn` and `turnPeriodTicks` are private on `Watcher` and need read-only accessors — a
getter each, no behaviour change.

### 2. A watcher that is draining you never turns away

`engine/watcher.ts:94-95` sets `watcher.drainLocked = acted` after each 1 Hz drain phase, and the
player's own body is an ordinary drain candidate (the `isPlayerBody` branch at
`engine/watcher.ts:177` is the pool drain). So while a watcher has *anything* to eat — including us
— its rotation timer is held.

`BOT.md`'s rationale for rejecting the flee rung reads "the drain is 1/second and cones sweep off by
themselves". **They do not, in the one case that matters.** Standing in a cone is an unbounded 1/s
bleed that ends only when we move or the thing being drained is gone. (`game/bot.ts:718` already
states this correctly for the sharpest trigger tested; the summary in `BOT.md` does not.)

This does not make the measurements wrong — four variants did lose ground — but it reframes them as
failures of *destination choice*: with no way to tell a durably safe tile from a briefly safe one,
the bot fled blind, often into another watched cell, and paid 5 energy for a stepping stone that was
eaten before it arrived. The same trigger with fact 1 available is a different experiment, and it is
cheap to re-run.

### 3. The mirror image is free, predictable cover

The same lock applies when a watcher is eating something else: an abandoned boulder anywhere in its
cone pins that cone in place. The bot can know this exactly, which turns leftover junk into a
schedulable distraction rather than a waste.

## Reading the prose against v1

| the human's rule | v1 today | what the challenger needs |
|---|---|---|
| Sentry absorbable → take it now | rung 3, unconditional, whatever the purse says | ✓ keep unchanged |
| Absorb everything, **descending energy value** | `findHarvest` sorts by **distance**, and rung 4 only fires below `endgameCost + 8` | value-ordered harvest, and no threshold during the harvest phase |
| Watched → relocate; no work under pressure | absent (four variants measured negative, all without prediction) | safety interrupt driven by `ticksUntilSeen`; never build where cover expires before the pile is done |
| Ascend in small steps, choosing a height that **reveals the next height** | climbs only to out-rank its own feet; the hop field assumes a one-boulder climb; no chain lookahead | a real 2+ step height lookahead |
| No small-step path → plan a taller tower now | only pass 2 of `chooseDestination` (climb the highest reachable tile) | explicit multi-level tower planning |
| **Phases**: secure height and clear sentries → *then* harvest everything → *then* finish | one interleaved ladder; harvest is a top-up to a threshold | a phase machine with different objectives per phase — the biggest structural change here |
| Finish: smallest tower, absorb the leftovers behind you, then the Sentinel | matches, except "absorb the last previous boulder+synthoid" | small addition, real energy |
| Perch high and branch out for the last trees | absent entirely | new — and this is the maximise-finishing-energy engine |
| Prefer the tile that becomes watched **last** | three-tier exposure test (unwatched / watched / in-sight), all present-tense | replace the middle tier with a *time* to exposure |

The phase separation and the perch trick are the two that account for the jump-size gap, and neither
is expressible as a tweak to the ladder. That is the case for a challenger rather than another pass.

## New sensors

`BotWorld` stays the seam and grows. All of these are implemented in `engine/bot.ts`, where the scene
and the watchers live, and all are derived from state the bot already reads.

```
ticksUntilSeen(col, row): number      // ticks until any watcher's cone covers this cell with LOS;
                                      // Infinity if nothing reaches it inside the horizon
willBeSeenWithin(col, row, ticks)     // sugar; the safety test the planner actually asks
```

*Shipped in B1 as two, not the three originally listed here: `ticksOfCoverAt` was the same function
under a second name, and one question with two spellings is worse than one.*

Implementation notes:

- Needs the two `Watcher` accessors from fact 1. Cache per decision, like `watchedCache` /
  `inSightCache` already are.
- **Bounded by a horizon** (`SIGHT_HORIZON_TICKS`, 32 s). Every cell a watcher has line of sight to
  is covered *eventually* — the ±20 step walks the facing onto a 4-unit lattice, so nothing with LOS
  is permanently safe — which would otherwise make this a ranking of far-off exposures no plan lives
  long enough to care about. The longest honest plan is about 36 ticks, so anything clear well past
  that is simply "safe" and ties at Infinity.
- The cheap test goes first, exactly as `isInSight` already orders itself: the schedule is pure
  arithmetic and runs for every watcher, and the line-of-sight sweep is only spent on a watcher that
  could improve on the best answer so far.
- **One documented approximation**, in the spirit of `terrainVisible`: an exact prediction would need
  to know whether each watcher has a drain target on every future tick, since that is what freezes
  its clock (fact 2). Assume the clock runs unless the watcher has a target *right now*. Exact in
  the common case; when it is wrong it is wrong in the safe direction (predicts exposure earlier
  than it happens).
- `isWatched` and `isInSight` stay. `isWatched` (cone-blind LOS) is still the right question for
  "can this ever be seen", and `isInSight` is `ticksUntilSeen === 0`.

## Architecture

Four changes, none of which alter v1's behaviour:

- **`game/botGeometry.ts`** — extract the pure arithmetic both planners must agree on: `bouldersToSee`,
  `bouldersToOutrank`, `eyeHeightOn`, `endgameCost`, `terrainVisible`, `computeHopField`,
  `findAssaultTile`, `tileIndex`, `EYE_HEIGHT`. `game/bot.test.ts` keeps covering it, including the
  assertion that the pile formula agrees with `utils/all-levels.js`.
- **`game/bot.ts`** — v1, unchanged, importing the above.
- **`game/bot2.ts`** — the challenger: phase machine, its own plan/memory type.
- **A `BotPlanner` interface** so `engine/bot.ts` stores whatever memory it is handed without knowing
  its shape (today it holds a `BotPlan` and compares its `col`/`row` to decide staleness — that
  comparison moves into the planner, or becomes a planner-supplied "is this the same intention"
  callback). v1 becomes one implementation; `MAX_PLAN_DECISIONS` staleness stays in the driver, as
  the one condition a pure planner cannot observe.
- **Selection by flag** — `BOT_PLANNER=v2` for the harness, plus a debug-gated Settings entry so a
  browser session can watch either one. Default v1 until the sweep says otherwise.

Harness work, which is the whole feedback loop:

- Sweep both planners and print a **side-by-side per-landscape table** plus each one's bucket
  breakdown (won / burned purse / out of time / died later / never got going). Trades must be
  visible per landscape: "12 vs 12 while winning different landscapes" is the failure mode that
  wasted tuning passes before.
- Keep `BOT_TRACE=1` working for v2 from the first commit. It is the only practical way to debug a
  planner, and a phase machine needs the current phase in every trace line.

## Risks and open questions

- **The perch is drainable.** A Synthoid standing on a pile at Sentinel height is a prime drain
  target, and while the bot is off collecting trees it is unguarded — losing it costs the pile, the
  body, and the position. The trick is only safe *with* fact 1; it should refuse to leave a perch
  whose cover expires before the round trip completes.
- **Harvest-everything means more time on the landscape**, hence more drain exposure. This is the
  opposite trade from v1's "bank the minimum and go", and it is the hypothesis most likely to need
  retuning. If prediction does not pay for it, the phase ordering is what to question, not the
  ladder.
- **A phase machine can wedge** where a ladder merely dithers — "secure height" never completing is
  a hang, not a slowdown. Every phase needs an explicit exit test and a fall-through; the watchdog
  (`DEMO_NO_PROGRESS_MS` / `DEMO_LEVEL_LIMIT_MS`) stays as the backstop, and a phase that never exits
  should be visible in the trace.
- **Conservation trees respawn on every successful drain** (`engine/watcher.ts`), so the board never
  truly empties. "Harvest everything" needs a stopping rule — probably "nothing reachable worth more
  than the walk", not "nothing left".
- **Route steering interacts with the new objective.** With a full purse, `targetJump` stops being a
  surplus to burn off and becomes a real choice among far-apart landings; `chooseDemoLanding`'s
  downward scan may need to look further, and `planSurplusBurn` may barely fire.
- **Absorbing everything also removes the cover** that fact 3 makes useful, and every boulder
  absorbed is one less pinned cone. Probably a wash, but worth watching in the traces before assuming
  it.
- **Unknown: how much of the 15 "out of time" bucket is already a win** behind the 240 s harness
  budget. Worth measuring before optimising anything away, and it may flatter or flatten v2's first
  numbers.

## Work plan

Each phase is separately measurable on the 102-landscape sweep, and none of them is allowed to
regress v1.

### B1 — Cone prediction (no strategy change) — **done 2026-08-13**

- [x] Read-only `ticksToTurn` / `turnPeriod` accessors on `Watcher`.
- [x] `ticksUntilSeen` / `willBeSeenWithin` on `BotWorld` (`game/cone.ts` for the arithmetic,
      `engine/bot.ts` for the wiring), with per-decision caching, a `SIGHT_HORIZON_TICKS` bound, and
      the documented clock approximation. A shared per-(watcher, cell) line-of-sight cache now backs
      all three exposure questions, which stops `isWatched` and `isInSight` re-raycasting each
      other's work.
- [x] Unit tests. `game/cone.test.ts` sweeps a 13×13 neighbourhood at all 256 facings against the
      real `inWatcherCone`, and `world/objects/watcher.test.ts` drives a live `Sentry` through real
      ticks to confirm the clock predicts when `rot` actually moves — the half a pure test cannot
      reach.
      - *Found on the way:* cells sitting exactly on the cone edge — every cardinally-aligned cell at
        the right facing, so common rather than exotic — are decided by float rounding inside
        `Vector3.angleTo`. The predictor is deliberately inclusive there, and the test asserts the
        property that matters: it is never *less* cautious than the engine.
- [x] Re-run the flee variants with the sensor. **Rejected: 45 against 51**, six landscapes lost and
      one gained. Recorded as a fifth row in `BOT.md`.

**What the flee result actually taught us**, since it was not what the hypothesis predicted. The
destination choice was never the problem. Counted from a trace of landscape 4200 (won at baseline,
lost fleeing): the flee rung fired eleven times against four pile-raises and dropped the walk's plan
six times, and every lost landscape shows the same signature — more transfers, no more progress. At
1 Hz the cost of a flight is two or three actions and the *intention*, not the energy, which
reclaiming mostly returns.

So the rule to carry into B3: **prediction is free when it ranks tiles the bot was going to visit
anyway, and expensive when it triggers extra moves.** The safety interrupt planned there should bias
placement within the existing walk rather than add journeys to it — which is also, on re-reading, what
the human account describes ("choose the place it just stopped watching"), as against the "drop
everything and run" reading this experiment tested.

### B1b — The purse, measured (unplanned, 2026-08-13)

Falling out of the same sweep, against `utils/all.csv`'s `maxJump`:

```
mean jump banked      15.9      over the 51 wins
mean maxJump          39.1      41% of what those landscapes could fund
reached maxJump        0 of 51
```

This is the quantified version of the gap this whole plan opens with, and it is wider than the win
rate suggests: at 15.9 a hop, a bot winning *every* landscape would still need ~630 hops against the
human's 260. Route steering's deliberate surplus burn accounts for a point or two, not 23 — the rest
is energy left on the landscape by rung 4's `endgameCost + 8` threshold.

It also reorders the plan slightly. B3's value-ordered, thresholdless harvest is no longer just
"match the human's style"; it is aimed at a measured 59% shortfall, and it can be evaluated on a
number the harness does not yet print. **B2 must add mean-jump-versus-maxJump to the sweep output.**

### B2 — Make room for a challenger (pure refactor) — **done 2026-08-13**

- [x] Extract `game/botGeometry.ts` — the pile formulas, `terrainVisible`, `computeHopField`,
      `findAssaultTile`. `game/route.ts` now takes its geometry from there too.
- [x] **`game/botWorld.ts`**, which the plan did not anticipate: the *contract* had to come out
      separately from the arithmetic, or a challenger would have had to import the incumbent to get
      at `BotWorld`. It holds the world interface, the step/action vocabulary and `BotPlanner`.
- [x] `BotPlanner` interface; `engine/bot.ts` holds no planner state; v1 wrapped as `LadderPlanner`.
      The driver's plan bookkeeping (hold the plan between decisions, run the survey, log
      plan/planDropped) moved into the wrapper; what stayed is the staleness backstop, now expressed
      against an opaque `intention()` key so every planner gets the safety net for free.
      `planNextStep` takes the plan as an argument instead of reading it off `BotWorld` — the world
      is what the driver can see, not where a planner keeps its memory.
- [x] Harness: `runDemo` takes the planner, and the sweep plays every landscape with each entry of a
      `PLANNERS` list, printing per-planner wins **and mean jump against mean maxJump**, plus the
      gained/lost trade once there is more than one entry. `maxJumpOf` is a port of
      `utils/all-levels.js` pinned by its own test against `utils/all.csv`'s numbers — which earned
      its keep immediately by catching a wrong expected value.
- [ ] ~~Planner selection flag (`BOT_PLANNER`, debug Settings entry)~~ — **deferred to B3.** The
      injection point is what mattered and it exists (`new BotDriver(..., planner)`); a registry and
      a menu entry offering one choice are noise until there is a second planner to choose.

**Verification.** Two post-refactor sweeps against the pre-refactor baseline: 51/102 in both, and
every landscape's *outcome* identical. Each run differed from the baseline on exactly one
landscape's ancillary counters — 5300 in the first, 5100 in the second, both already thrashing and
lost either way.

Chased, because the sweep is the yardstick for everything below it: those landscapes are
byte-identical when run alone (twice each) and byte-identical in an eleven-landscape slice (twice),
so the variance needs the full 102-landscape process to appear. It is **not** a B2 regression — the
baseline run disagrees with itself the same way — and it never flips a win. Written up under
*Measuring it* in `BOT.md`; the practical rule is to judge changes on wins and the jump ratio, and to
re-run a landscape alone before believing its individual tallies. Not chased further: a 1-in-102
counter wobble that never changes an outcome is not worth the hours, and the alternative was to
leave a claim of exact reproducibility standing when it isn't true.

### B3 — the challenger — **done 2026-08-13**

- [x] More shared extraction first, since a challenger that imported the incumbent would pin v1 in
      place for good: `game/botMovement.ts` (the `BotPlan` intention, `isPlanViable`, `planStep`,
      `chooseDestination`) and `game/botEndgame.ts` (`inAssaultPosition`, `planEndgame`, the surplus
      burn). `game/bot.ts` went from 1024 lines to 367 — what is left is the ladder itself.
- [x] `TilePreference` as the seam in `chooseDestination`: how much a planner would like to stand
      somewhere, graded. v1 keeps `presentExposure` (unchanged behaviour); v2 supplies
      `coverPreference`, which reads `ticksUntilSeen`. **Applied only to rank tiles the walk was
      going to choose between anyway** — the B1 lesson, honoured by construction.
- [x] `game/bot2.ts` — `PhasePlanner`. Phases derived per decision rather than latched (a latched
      machine can wedge; the one thing that *is* latched is the perch, and deliberately).
- [x] Harvest by descending energy value, no threshold once the perch is held, bounded by
      `HARVEST_BUDGET` — a bound is required, since every drain spawns a conservation tree and
      "collect everything" against a live Sentinel would never terminate on its own.
- [x] The perch, which turned out to be the whole game (this is B5's *perch-and-branch*, which
      arrived early because the phase structure made it nearly free): once standing on the assault
      tile that position is held for the rest of the landscape, and the bot branches out and
      transfers back up. It rests on a rule worth stating plainly — **transfer is the only action
      that can go upward**, since the crosshair resolves a Synthoid above the eye where
      `isCellVisibleFrom` refuses outright. The body left on the pile is a ladder home.
- [x] `game/botPlanners.ts` + `settings.botPlanner` (Settings → Game → Demo bot, debug-gated) +
      `BOT_PLANNER` in the harness — the selection flag deferred from B2. **The browser demo defaults
      to v2.**
- [x] `game/bot2.test.ts`, 8 cases on synthetic landscapes.

**Result — v2 wins on both metrics, measured side by side on the same 102 landscapes:**

```
v1: won 51/102 | mean jump 15.9 of maxJump 39.1 (41%)
v2: won 54/102 | mean jump 30.4 of maxJump 39.4 (77%)
v2 vs v1: +4 (3400 4100 4600 6100) | -1 (3600)
```

The jump is the headline: **41% → 77% of what the landscapes could fund**, near-doubled. In hops to
9999 that is roughly 630 → 330, against the human's 260 — the purse gap is now mostly closed, and it
closed by playing the described strategy rather than by tuning anything. The win rate moved too,
which was not the expectation going in (parity was).

One caveat on the shape of the win: harvesting everything means longer landscapes, so the losses
should be re-bucketed before B4 — a bot that now runs out of clock is a different problem from one
that burns its purse.

### B5 — Perch-and-branch, and the purse as an objective — **done early, inside B3**

- [x] Perch concept: hold a high finishing body, branch out, return and reclaim. It landed in B3
      because the phase structure made it almost free, and it is what produced the jump result above.
- [ ] Re-examine `game/route.ts` now the purse is routinely large. `chooseDemoLanding` scans downward
      from the furthest affordable jump; with mean jump at 30 rather than 16 the window it searches
      has roughly doubled, and `planSurplusBurn` will be spending more. Worth measuring what steering
      now costs.
- [ ] Re-measure the 220-hop optimum's reachability against a bot that actually banks 78%
      (`utils/path-no-tower.csv` assumed a maxJump purse v1 never approached).

### B4 — **Ascend first, commit by arriving** — **done 2026-08-14**

The idea is the landscape owner's, and it is a correction to an assumption baked in since B3 rather
than an addition: *"I'm not sure it's right to pick the assault tile right from the start. That's not
something I do, and it seems to really narrow the bot's options. Purely ascending until we're 1 or 2
levels lower than the pedestal and only then choosing from where we'll assault should be enough (it
is, for a human)."*

**Why it is right, from this document's own evidence.** Committing to one tile before the run begins
is the root cause of three separate patches already applied, each of which would come out again:

| patch | what it was really compensating for |
|---|---|
| the **re-point** (postscript 3) | the climb ends somewhere better than the tile chosen in advance |
| the **reachable-goal retry** (postscript 5) | the tile chosen in advance may have no route to it |
| the **cut-off hatch** (postscript 5) | …and when it does not, the walk sets off anyway |

Three fixes for one bad assumption, and the assumption is that a tile picked from a standing start,
by pile height and straight-line closeness, is where the landscape will be won from. It is chosen
before the bot knows anything about the terrain it will actually be able to climb.

**The shape as built — commit by *arriving*, with no CHOOSE step at all.** The plan above expected a
height threshold and then a filtered `findAssaultTile`. What landed is simpler and stricter: the climb
pursues the **band** (every flat tile whose top-of-pile eye can see the pedestal top with an affordable
pile), an *aim* is re-derived every decision from where the bot stands, and `this.assault` is set
exactly once — the first time `canAssaultFrom` is true, to the tile **under the bot's feet**.

The threshold became unnecessary because arrival is a strictly better test than proximity, and the
reachability filter became unnecessary because the tile is reachable *by construction*: the bot walked
there. Two things made it work:

- **A hop field seeded from the whole band**, not from one tile. No field edge climbs more than one
  whole level (the edge test puts the walker's eye at `h + 1.375` against integer terrain), so seeded at
  the top the field is a ladder: layer 1 is the level below the band, layer 2 the one below that, and
  descending hops *is* climbing. It also no longer depends on which tile is nominated, which is what
  makes the retry pointless rather than merely unused.
- **A per-decision aim with a cached sightline test.** Affordable at 1 Hz because the candidate list is
  built once per landscape and a tile's view of the pedestal top depends only on the height map.

A seeding subtlety worth keeping: seeding on the **pedestal cell** — the obvious first choice, and the
one this plan proposed — is wrong twice over. It asks a question one whole unit too lenient (the
pedestal's tile, not its top), and it produces an *empty* field on `heightGap` 2, where no tile's
one-boulder eye clears the summit at all: 59 landscapes on which every hop count would silently become
Infinity and the walk would degrade to straight-line scoring.

- [x] `ASCEND` navigates by the band-seeded ladder rather than hops-to-a-nominated-tile.
- [x] No `CHOOSE` step: commitment happens on arrival, which subsumes both the height threshold and the
      reachability filter.
- [x] Deleted: the **re-point**, the **reachable-goal retry** (with `rejectedTiles` and
      `MAX_RESURVEYS`), and — found on the way, never wired since the file was created — the whole
      **`resurvey` path** (`blockedClears`, `CLEAR_ATTEMPTS_BEFORE_GIVING_UP`) plus the vacuous test that
      claimed to cover it. Also gone: the latched `phase` field, six writers and one reader.
- [ ] **The cut-off hatch stays**, and this is the one bullet that did not come out. Its replacement — a
      no-progress test, hyperspace after 24 decisions without the feet getting higher — measured
      **177/250 against 182** and was reverted. The mechanism is obvious once stated: a tall pile
      legitimately costs six or seven decisions before it lifts anything, so the test fired on tiles
      where the bot was doing exactly the right thing and jumped it away from nearly-finished towers.
      What changed instead is what the hatch *means*: seeded from the band, `!connected` now says there
      is no route from here to *anywhere* the Sentinel could be taken from. That is a fact about the
      terrain rather than an artifact of a guess, so it is no longer compensation.
- [ ] Still open from the old B4: prefer a climb whose top reveals a *further* climb, and plan an
      explicit multi-level tower when no small-step chain exists.

**Result — parity on wins, with the assumption and three of the four patches gone.**

```
                                  pre-B4        post-B4
6000-6999 (fresh verdict block)   712/1000      709/1000     1 sigma is ~14 landscapes
   mean jump                      33.9 (78%)    33.9 (78%)
3000-3249 (ratified criterion)    181/250       182/250
102-sweep (smoke only)            76/102        76/102
   watchdog-stalled                 4             1
v1, unchanged throughout          69/102        69/102       identical losing ids
```

Bucket shift on the verdict block, which is the part a total cannot show:

```
never-reached-assault-position   139 -> 129     B4's target, and it moved
out-of-clock                      13 ->  21
watchdog-stalled                  20 ->  23
died-in-opening                  102 -> 101
```

So the climb does reach a winning position more often, and the landscapes it gains are handed straight
back as runs that no longer finish in time. That is a coherent and slightly disappointing story: a
deferred commitment means the aim keeps moving, and an aim that moves costs decisions. **The next thing
to look at is therefore the clock, not the ascent** — 44 of the 291 losses are now "still going when
time ran out" against 33 before.

By this document's own criterion (*"if the total holds and those three come out, the rework has
succeeded even at parity"*) B4 succeeded: the pre-run commitment is gone, three compensations plus a
fourth dead one came out, `game/bot2.ts` lost the `phase` field, and the survey went from up to eight
hop-field traversals per landscape to exactly one. But it is parity, not progress, and it should be
recorded as such.

### What B4 exposed — the harvest walks on a field aimed somewhere else

Found by tracing landscape 100 when the band-seeded field first went in, and the sharpest defect in the
planner today. `chooseDestination` grades progress lexicographically — fewer hops to the *field's*
target, or the same hops and a cell nearer the *goal* — which is only coherent when the field and the
goal are the same place. On an errand they are not: the field is the route to the assault objective and
the goal is a tree across the map, so the hops term pulls one way and the distance term the other, and a
candidate with more hops is refused however much closer it gets to the spoils. **Harvesting is confined
to whatever hop band the bot already stands in**, and the harvest is what earns the 78% purse.

The band-seeded field turned that from a quiet limit into a deadlock — the zero set became every band
tile, and nothing can have fewer hops than zero, so standing on any of them the walk could accept
nothing at all. Landscape 100: perched, 33 energy in hand, an errand eleven cells away, and sixty
seconds of `did: nothing` until the watchdog called it.

**And the obvious fix made it much worse: 22/102 against 51.** Pairing the errand with its own goal (an
empty field, so straight-line progress) freed the bot to walk off after distant spoils — and then rung
1's "transfer into any body higher than this one" clause kept dragging it further out. On 100 it reached
the far corner with `hops: null`, off the field entirely, and never came home. **There is no reliable
route home in the movement model, and the confinement was accidentally standing in for one.**

So B4 confines its change to the climb, and the mismatch survives on purpose. Fixing it properly means
giving the harvest a way home first — a field over the perch, or a return rung that outranks the
height-chasing transfer — and only then relaxing the confinement. That is the single most promising
piece of work left in this document, because it is aimed at the metric that is *not* at parity: the
purse, which is what the jump is made of.

### The exposure map — **moved to `PLAN-EXPOSURE.md`**

The landscape owner's idea, after watching the demo: keep a **persistent map of every cell** holding
whether it is watched and how long until it becomes watched, update it incrementally, and plan against
the whole map rather than against the handful of tiles the walk happens to be choosing between.

Shelved here as "B6", it has outgrown a numbered step of this roadmap — it is engine-level sensing
rather than a v2 rung, and it comes with a debug visualisation of its own. The specification, the
measured cost, the analytic-LOS caveat and the design now live in **`PLAN-EXPOSURE.md`**.

### B4b — Fleeing, on an economic trigger

The landscape owner, after the sixth negative measurement: *"I'm deeply convinced that fleeing (aka
finding a safe place when drained) is always the right move, whatever the A/B shows on that, and I'm
nearly sure it will be included in our final version."*

Worth taking as a hypothesis rather than overruling with a number, because **all six variants tested
the same trigger** — *am I standing in a cone* — which is positional, and fires while the bot is doing
productive work. The rule as actually stated is economic: flee when **drained**, meaning when the
bleed is not being out-earned and the purse is trending to zero. On 390 that fires on the first
decision (energy 10, no income, unbounded bleed). On most of the landscapes where fleeing cost 6 of
102 and 11 of 250, it would not fire at all.

- [ ] Trigger on the energy trajectory, not on cone contact: in sight, *and* net energy over the last
      N decisions is negative or flat, *and* a tile with lasting cover is reachable.
- [ ] Re-test **after** B4, since the movement model underneath it changes.
- [ ] If it measures negative a seventh time, report it plainly — and note that the decision is the
      owner's, not the sweep's. An attract mode that visibly stands still while being eaten is a bad
      demo even on the landscapes where standing still wins.

### Later — human traces, if the above plateaus

Deliberately last, because it is the most infrastructure for the least certain return, and because
B1–B5 are all things we can already name.

- [ ] Action recorder on the player path (`engine/actions.ts` is a single funnel; log game-tick
      counts, not wall clock, since the drain phase is 1 Hz and turns are 48 ticks apart).
- [ ] Replayer over `bot.harness.test.ts`'s existing headless GameLoop; gameplay randomness is
      already seeded per landscape (`game/random.ts`), so a replay is faithful.
- [ ] **Divergence report**: at each recorded human decision, ask the planner what it would have
      done and list the disagreements. That is the high-value artifact — every divergence is either a
      bot bug or an unwritten rule — and it needs only a handful of landscapes, not 260.

The known limits of this route, recorded so they are not rediscovered: one player, a few thousand
actions at most (insight extraction, never statistical learning), no record of *intent* in the log
(the pauses are data, the reasoning is not), and traces produced without omniscience, so they are a
floor to match rather than a ceiling to reach.

## Success criteria

- **B1**: ✓ flee re-measured (45 vs 51, rejected and documented); v1 still at 51.
- **B2**: identical v1 sweep result before and after (the 102 per-landscape lines diff clean).
- **B3**: ✓ exceeded. Target was parity on wins; actual is 54 vs 51, with mean jump 30.4 vs 15.9
  (77% of maxJump against 41%).
- **B4**: ✓ **met, at parity.** 182/250 on 3000-3249 (from 181) and 709/1000 on the fresh 6000-6999
  block (from 712 — within a fifth of a sigma). The criterion was "if the total holds and those three
  come out", and three did: the re-point, the reachable-goal retry, and a fourth that turned out never
  to have been wired at all. The cut-off hatch is the exception — its replacement measured 177/250
  against 182 and was reverted, though what it *means* changed from compensating for a bad guess to
  testing a fact about the terrain. Also gone: the pre-run commitment itself, the latched `phase`
  field, and seven of the eight worst-case hop-field traversals per landscape.
  What it did **not** buy is wins: `never-reached-assault-position` fell 139 → 129 on the verdict
  block and out-of-clock plus stalled rose 33 → 44. Recorded plainly because the temptation is to
  report the bucket and not the total.

## Postscript — what watching it was worth (2026-08-13)

The plan above assumed v1 had plateaued and that better play needed a better strategy. Half of that
was wrong, and the correction came from the one thing no sweep can do: someone watched the demo play
and said *that looks wrong*.

Landscape 42, replayed in the harness (`BOT_LEVELS=42 BOT_TRACE=1`, which exists because of this),
showed two bugs inside a minute:

- a Sentry generated **on the assault tile** was reserved from absorption along with the bot's own
  pile, so the one tile the plan depended on could never be cleared;
- and, on **every hop of every landscape**, the bot proposed building a body it had already built —
  because for the second its body spends materialising the crosshair cannot resolve it, so the
  transfer rung declined and the walk answered "build the body". The refusal blacklists the cell,
  and `isPlanViable` reads a blacklisted cell as a dead plan. The bot discarded its own intention
  immediately after achieving it, once per hop, for as long as plans have existed.

| | before | after |
|---|---|---|
| v1 wins | 51 | **69** |
| v2 wins | 54 | **73** |
| v2 mean jump | 30.4 (77%) | 30.6 (78%) |
| still alive at the buzzer | 15 | **1** |

Eighteen landscapes each, from two fixes, against every strategy change measured in this document
put together. The lesson is not "test more" — the sweep was run faithfully at every step. It is that
**a total cannot show you a bot that is busy doing nothing**: silently re-deriving the same
destination looks, from outside, exactly like working. Four flee variants were measured against that
number, and a plateau was diagnosed from it, while this sat underneath the whole time.

So: keep watching it. The harness is the yardstick, not the eyes.

## Postscript 2 — 106 and 60, and a limit of the harness (2026-08-13)

Two more reports from watching, and one of them exposed something about the measuring rig rather
than the bot.

**Neither landscape reproduced.** Both *won* in the harness. The difference is frame time: the
harness steps a fixed 16 ms, the browser uses real rAF deltas, so the 1 Hz action cadence and the
4 Hz drain phase drift against each other differently — which decides whether a boulder is laid
before or after a watcher looks. At `BOT_FRAME_MS=15`, 106 fails exactly as described. So a sweep
number is one sample of a family, and "cannot reproduce" now has a second thing to try before it
means anything.

**What 106 actually was.** `canHit` (the picker) resolves targets above the eye; the absorb rule
(`isCellVisible`) refuses them. The "clear the assault tile" rung tested only the former, so after a
forced hyperspace dropped the bot below that tile it proposed an impossible absorb — and the failure
blacklist clears whenever the body moves, so it re-proposed it until the clock ran out. Fixed in both
planners.

> **Corrected 2026-08-14.** This paragraph also claimed "plus a re-survey (`findAssaultTile` now takes
> an exclusion set) so a tile that cannot be cleared is no longer the end of the landscape". The
> exclusion set landed; **the re-survey never did.** `resurvey()` had no callers from the commit that
> introduced `bot2.ts`, and `blockedClears` / `CLEAR_ATTEMPTS_BEFORE_GIVING_UP` were never read. So an
> unclearable assault tile *was* still the end of the landscape for the whole of B3 onward. Deleted
> rather than wired, because B4 removes the early commitment the mechanism was compensating for. The
> test that named it passed vacuously — see `BOT.md` for the lesson.

**What 60 was.** Cover was a flat 14 ticks regardless of what was being built, so a three-boulder
tower — 24 ticks of work — was started on tiles with three and a half seconds of clear. Now scaled to
the job.

```
v2: 73 -> 74 at 16 ms, 73 at 15 ms, mean jump 30.8 (78% of maxJump)
```

Modest on the total, and that is the point worth recording: the loops these fixes removed were
*visible* and *wrong* long before they were expensive. The remaining 28 losses are mostly one thing
now — 106 at 15 ms no longer loops, it simply never climbs to a height-10 assault tile — which is
**B4, the ascent**, and it is where the next real gain is.

## Postscript 3 — "it derails once next to the pedestal" (2026-08-13)

Reported from watching 106. The harness won it at every frame time but 15 ms, and the 15 ms failure
was a *different* one — the bot never climbed at all. So the report and the repro disagreed, which
usually means the instrument is missing the thing that matters.

It was. The trace printed every action and no belief, and the fix was to log one line per decision
with phase, position, perch, and whether the endgame was considered available. With that in place the
answer took one run of the whole sweep: **all 28 losses had never reached the assault tile**, and the
tile-identity test was why.

`inAssaultPosition` asks "am I on the tile the survey nominated". A climb ending one tile over — high
enough, clear view of the Sentinel — did not count, so the bot walked away from a winning position to
keep pursuing the nominated one. Replaced by `canAssaultFrom`: eye above the pedestal top, line of
sight to it, and the Sentinel hittable from here.

Two things that only measurement could have told me, both worth keeping:

- **The loose version cost three landscapes** (74 → 71). Committing latches the perch, which disables
  the hyperspace escape, so "I can see the pedestal top" is not a strong enough claim to bet a
  landscape on. The `canHit` clause is what makes it one.
- **Recognising the position without re-pointing the plan was worse than not recognising it.** The
  assault plan is what the return journey aims at; a perch at one tile and a plan at another had the
  bot on 600 spend 147 decisions walking to a tile it could not use. Re-pointing recovered the three.

```
v2: 74/102, mean jump 31.0 (79% of maxJump), +6 -1 against v1
    106 and 600 now won at 15 ms and 16 ms, asserted in the harness
```

Same total as before the change, better jump, and one whole class of silent failure gone. The
remaining 28 are still ascent: the bot is good at collecting and finishing, and weak at getting high.

## Postscript 4 — landscape 246, and the standing question of a skip list

Reported from watching: v2 walked unaided from landscape 0 to **246**, then died there in five
seconds. The start is watched, and every tile with cover is *below* it.

The bot spent its whole purse building two bodies on tiles a cone was on, losing each to the drain
before it could transfer in. That was the walk working as designed — take the least-bad tile, because
standing still is worse than being seen — meeting a case where the least-bad tile is not bad but
*impossible*: the drain runs at 1 Hz and takes the topmost Synthoid, so the body is gone before the
transfer completes. `TilePreference.avoid` now refuses that grade outright, the walk returns nothing,
and the bot hyperspaces out — which is exactly what the report guessed would work.

```
v2: 74 -> 78 of 102, mean jump 31.1 (78%), +10 -1 against v1
246: LOST in 5 s -> WON +32, at both frame times
```

The largest single strategy change measured in this document, and it came from one watched landscape.

### On maintaining a blacklist of unwinnable landscapes

Proposed, and worth answering carefully because the machinery already exists — `isPlayableLanding`
skips enclosed starts and `heightGap` 3, so curation is not a new kind of cheat here.

**Not yet, and the reason is empirical.** Every wall reported from watching so far — 42, 106, 600,
246 — has turned out to be a bug with a real fix, and each fix was worth landscapes far beyond the one
reported. A blacklist would have permanently hidden all four, plus 1300, 1600 and 2600, which flipped
from unwinnable to won during a single session. Right now a wall is the most valuable bug report this
project gets, and a skip list is a machine for throwing those away.

Two practical points reinforce it. A hand-curated or sweep-derived list could not have contained 246
at all — it is not in the 102-landscape sample, and the demo walks its own path through 10000. And
the list would need regenerating after every planner change, or it would quietly encode yesterday's
weaknesses.

**When it becomes right**, and it will, the honest form is *reactive and self-maintaining* rather than
curated: record a landscape the bot has actually failed, in `game/demo.svelte.ts` beside the cursor,
and skip it on a subsequent encounter. That is evidence rather than a guess, it self-heals when the
bot improves, and `Reset demo progress` already exists to clear it. Note it reverses a deliberate
decision documented in `BOT.md` — a loss currently does *not* skip ahead, precisely so the weakest
landscape makes itself known — so the trade is: an attract mode that always keeps moving, against one
that tells you where to look next. Worth making once walls stop being bugs.

## Postscript 5 — landscape 390, and what the probe settled (2026-08-14)

Reported with a specific suspicion: the bot ignored a plainly safe tile, so `isWatched` might be
lying. It is not. `BOT_PROBE=390` (new, in the harness) prints what the planner believes about every
tile near the start beside what the drain phase would actually do to a body standing there, and on
390 they agree on **every tile within six — zero disagreements**. The safe tiles were real, the bot
could see them, and (2,10) was adjacent and permanently clear.

**What actually killed it:** the bot never moved. It stood in the Sentinel's cone at (1,9) for the
whole run, building a remote three-boulder pile, bleeding a point a second — and that bleed is
unbounded, because a watcher draining you never rotates away. Nothing in the movement model retreats:
the walk only accepts tiles that make progress toward the goal.

**Fleeing, measured a sixth time.** The narrowest form yet — no rung, just the walk permitted to
accept a covered tile that makes no progress while standing in a cone, reusing the same hop, plan and
reclaim, so it adds no journey at all. On 390 it did exactly the right thing and took (2,10). Across
the population it lost 6 of 102 and 11 of 250. Reverted; sixth row added to the table in
`game/bot.ts`.

**What did help** was the second thing 390 exposed. The survey line read `reachableTiles: 7` — of the
whole map, seven tiles connected to the assault tile it had chosen, none of them the bot's. So every
plan aimed at a goal no sequence of hops could reach. `findAssaultTile` optimises for the shortest
pile and the nearest approach and never asks whether there is a route; the hop field already answers
that and was simply not consulted before committing. The survey now retries until it finds a tile it
can actually walk to, and a bot that is cut off anyway takes the hyperspace hatch.

```
                                102-sweep   3000-3249   total
baseline                          78/102     173/250    251/352
cut-off hatch alone               76/102     175/250    251/352   (inert)
reachable-goal survey + hatch     76/102     181/250    257/352   kept
```

A note on the samples: the 102-landscape sweep has been the target of every change in this document
and is by now effectively a training set. The 3000-3249 block is the honest read, and it is the one
that moved.

## Postscript 6 — grazing while being eaten (2026-08-15)

Two more reported from watching, and the sixth time in a row that the eyes have beaten the sweep.

> *"I still occasionally see it stuck in a position where it is watched (so drained), and continuously
> absorbs trees to compensate, with enough energy left to create a synthoid on a safe place and
> transfer to it. Sometimes it eventually escapes, often not."* And separately: *"it insists on
> building on a watched cell where what it builds gets absorbed immediately — not fatal, but an energy
> drain that closes further options."*

**The first is rung ordering, not a missing rung, and that distinction is what made it cheap.** Rungs
2-4 (reclaim, sentry, harvest) all outrank the walk, so with a tree in reach and the purse under the
top-up threshold the bot *always* ate rather than moved. Pair that with the fact `BOT.md` already
records — a watcher draining us never rotates away, because `drainLocked` freezes its clock while it
has anything to eat — and one point a second in against one point a second out is a stable equilibrium
the bot has no reason to leave. It grazes until something else kills it.

The fix is a rung between the Sentry and the harvest: **while in sight and not yet perched, take the
step the walk would have returned anyway, one rung earlier.** It is emphatically *not* the flee rung
that has now measured negative six times. That one fires on cone contact and **adds** a journey,
spending two or three actions and the current intention on a trip the bot had not planned; this one
adds nothing — same destination, same plan, same cost, just sooner, and only when standing still is
actively costing energy. If the walk has nowhere to go the ladder falls through to the harvest exactly
as before, so the bot can never end up doing less than it did.

```
                        3000-3249      6000-6999 (verdict)
before                   182/250        709/1000
after                    188/250        725/1000
bled-out                   3 -> 1        17 -> 4
out-of-clock               7 -> 8        21 -> 15
mean jump                 78% -> 79%    33.9 -> 34.2
```

+6 on one block and +16 on the other, consistent in direction, with the bucket it targets down 76%.
**And it reads as −3 on the 102-landscape sweep**, which is the sharpest illustration yet of what that
sample is now worth: had it been the yardstick, this would have been reverted.

**The second — building on a watched cell — turned out to be real, rare, and worth almost nothing.**
`isPlanViable` had six give-up conditions and no exposure test, so a plan latched on a tile that was
clear went on being built after a cone arrived: `coverPreference` refuses such a tile, but only in
`chooseDestination`, which is not re-run while a plan holds. Adding the test (opt-in, so v1 is
untouched, and graded against the boulders *remaining* rather than the original pile) fires about
**0.5 times per landscape** and measures **exactly neutral** — 188/250 with it and 188/250 without.
Kept anyway, on the grounds that it closes an unbounded leak for no measurable cost, but it should be
recorded as neutral rather than as a fix, and dropped without ceremony if it ever gets in the way.

The reason it is worth so little is worth understanding, because it points at the next thing. The test
fires when the cone *arrives* — by which time the boulders are already paid for. The waste happens
earlier, when the walk knowingly accepts a tile whose cover expires mid-build (grade 1) because
nothing better is reachable. Choosing better requires knowing about tiles the walk is not already
considering, which is exactly what the **exposure map** (`PLAN-EXPOSURE.md`) is for.

## Postscript 7 — the boulder nobody picked up (2026-08-15)

> *"I started a demo session from level 0 and the bot lost early on level 16, because it was never
> reclaiming the boulder of his previous position (it did absorb the synthoid, though)."*

Both halves of that were true, they had **separate causes**, and between them they were costing a
landscape whose entire `maxJump` is 22. Seventh report from watching, seventh real bug.

**Cause 1: the reclaim rung tested for a Synthoid.** `top.type === GameObjType.SYNTHOID`, so the moment
the body was absorbed the boulder underneath stopped being a candidate and stood there for the rest of
the run. The rung's own comment claimed it was "what makes the create-and-transfer walk cost nothing
net" — it never did: boulder 2 + body 3 − reclaim 3 = **−2 an hop**. The trace on 16 is unambiguous:
energy 10, 6, 5, 3, 0 across four hops, and five boulders left standing around the map at 2 apiece.

Extending it to boulders is worth **+11 of 1000** on the verdict block and lifts the purse ratio from
78% to 80%. It reads **−4 of 250** on 3000-3249, which is noise at 1.4σ and a reminder not to judge on
the smaller block.

A geometric detail worth keeping, found from a one-off `reclaimCheck` trace: **the body is hittable
because it stands on the boulder.** Absorb it and the boulder drops half a level, and on 16 two of the
three then fell behind an intervening ridge — `canHit: false`, unrecoverable. The rung declines
correctly there; the energy is simply gone. Which leads to the second cause.

**Cause 2: most of those boulders should never have been laid.** `chooseDestination`'s "climb while you
walk" floors the pile at one boulder on any hop toward a higher goal — `Math.max(1, bouldersToOutrank(…))`
— but `bouldersToOutrank` already returns 0 when the destination tile is *above* our feet. Landscape 16
climbs 5 → 5 → 6 → 7 on its own, so two of three boulders bought half a level the terrain was giving
away, at 2 energy each, unrecoverable.

Removing the floor outright is **worse**, and instructively so:

```
speculative boulder      6000-6999    died-in-opening   never-reached-assault   3000-3249
always on (before)        736/1000         107                 123               184/250
always off                718/1000          80                 153               189/250
only when affordable      739/1000          77                 150               192/250
```

Off saves the opening and then **cannot climb** — which is exactly what the floor was put there for, so
the original reasoning was right and merely unconditional. Gating it on
`energy >= endgameCost(pile) + DETOUR_RESERVE` keeps the climb where the purse can stand the tax and
skips it where it kills, and lands the best figure on both blocks. Landscape 16 goes from LOST to **WON
+19 of a possible 22**, at both frame times, and is now pinned in the harness.

Two process notes, both worth more than the landscape:

- **The 250-block and the 1000-block disagreed on every one of these three changes.** Reclaim: −4 and
  +11. Speculation off: +5 and −18. Only the verdict block's bucket histogram made the mechanism legible
  in each case, and it is the bucket that explained *why* every time.
- **The first version of the new reclaim test passed with the fix disabled.** With a low purse the
  top-up rung absorbs that boulder anyway, so the case asserted nothing — the same flaw as the
  re-survey test deleted in B4, reintroduced within a day of writing that lesson down. It now runs on a
  full purse, where only the reclaim rung can produce the step, and it was checked by disabling the fix
  and watching it fail. **Write the check that fails first, then make it pass.**

## Postscript 8 — when the total lies (2026-08-15)

Two reports from a demo run, one of them a judgement rather than a bug:

> *"Now the bot often spawns synthoid without a boulder (hence the inability to absorb the boulder of
> the tower it comes from), so it has to ascend in two steps and reclaim the boulder later, if it has
> the opportunity. It wins 16 nonetheless, but still a regression to me."* And: *"it also now fails very
> early on the next one (35), hyperspacing for an unseen reason... a fatal decision that leaves it
> stranded, on a low position with not enough energy to climb."*

**The first was right, and the aggregate had hidden it.** Postscript 7's affordability gate on the
speculative climb boulder scored 739/1000 against 736 and 192/250 against 184 — a small win on both
blocks, so it shipped. What the totals did not say is that `never-reached-assault-position` went
**123 → 150** at the same time. The gate fires whenever the purse is below the endgame reserve, which
early on is nearly always, so in practice it was "speculation off during the climb" — and off means the
bot gains only what the terrain gives, climbs in two steps where it climbed in one, and often never
arrives. The win came entirely from the opening (`died-in-opening` 107 → 77) and was paid for out of
the ascent. **Reverted.** The floor's original reasoning was right; the only error was thinking it was
unconditional. Landscape 16 goes back to being a loss, and is deliberately *not* pinned in the harness —
pinning it would pin a net regression.

One explanation offered for the revert was **measured and found false**, and is recorded because it is
the sort of thing that otherwise becomes folklore: *"the boulder is also what the bot aims at, so a
zero-boulder plan aims at bare terrain and misses."* The aim misses are real (`missed onto: terrain`)
but they do not depend on the floor — with the floor restored the same two misses simply moved from
`body at destination` to `raise pile`. Either way exactly one create per hop is aimed at bare ground.
The floor buys height, not accuracy.

**The second was a real bug, and independent of the first** — 35 failed identically with speculation
forced on, which is what separated them. The trace: boxed in at **energy 9**, hyperspace, land at
`13_18` with `hops: null` (a pocket, off the field), then three `cut off` hyperspaces, ending stranded
at energy 2 with nothing affordable. Three faults, all in how the hyperspace rungs were guarded:

- **It jumped on a single dead decision.** The walk finding nowhere to go for one tick is usually
  transient — a cone crossing the only good tile, a body still materialising, a create the crosshair
  refused. Now `STUCK_BEFORE_JUMPING = 3` consecutive dead decisions, so the answer is "there is nothing
  here" rather than "there was nothing this second".
- **It jumped without being able to play afterwards.** A jump costs 3 and lands at random; arriving with
  less than a body in hand is not an escape but a slower death, and the landing may be another pocket.
  Both rungs now require `energy >= HYPERSPACE_COST + energyCostOf(SYNTHOID)`.
- **A refused jump burned the budget.** `hatchJumps++` ran when the step was *proposed*, and the 1 Hz
  cadence refuses plenty — on 35 three consecutive proposals from the same tile spent the whole
  three-jump allowance without the bot ever moving. Charged per landing now, by position.

```
                                 before   gate (reverted)   guards, no gate
6000-6999                        725      739               739
   never-reached-assault-position 127     150               114
   died-in-opening                101      77               111
   mean jump                     34.2     34.8 (80%)        34.8 (80%)
3000-3249                        188      192               184
```

So the guards recover everything the gate was buying and leave the climb alone — the same total on the
verdict block with `never-reached` at its lowest ever recorded. 35 is still lost (it never finds a
workable destination from its start), but it now loses in one place instead of spending its purse on
four jumps to get there.

**The methodological point, which is the durable part.** This is the second time in two days that a
change improved the headline and degraded the mechanism, and both times the bucket histogram was what
made it visible. A total can be bought from one bucket and paid for out of another. **Read the
histogram, and when a human watching says it looks worse, believe them and go and find which bucket
moved.**

## Postscript 9 — a cell is not a point, and a model is not a column (2026-08-24)

Landscape 35 again, reported the same way as everything else here — from watching it:

> *"After the first transfer, it tries to target successively two 'safe' cells, and fails both times
> because they are only partially visible (and decisively, their center is hidden by a slope). After
> these two failures, it hyperspaces itself and stays stuck since it doesn't have enough energy to
> ascend again. For my eyes, it's very easy to spot a clickable area on both cells."*

**Postscript 8's diagnosis of this landscape was wrong.** It concluded 35 "never finds a workable
destination from its start" and left it as a loss with better-guarded hyperspace rungs. The destinations
were there all along; the bot could not *aim* at them. The guards were still worth having — they are why
the failure now ends in one place instead of four — but they treated the symptom.

### What was actually happening

The crosshair is a single ray and everything upstream of it thinks in areas. `engine/visibility.ts`
asks whether **any of the four corners** of a cell is reachable, and `canSeeFrom`, `isPlanViable` and
the hop field are all built on that. The aim then asked about **one point, the centre**. On 35 a fold
of ground hid the centres of `14_26` and `9_24` while leaving most of both squares in plain view; the
ray resolved on the hillside in front, the driver blacklisted both, and with its only two options gone
the planner correctly concluded it was boxed in. It hyperspaced at energy 9 and was stranded.

Probed directly, the visible fraction of those cells is not marginal — a whole edge of each, several
tenths of a cell wide. This is the gap `engine/picker.ts`'s own header already named ("a stricter
question than `engine/visibility.ts`'s") without anyone costing it.

### The same bug one level up, and a rung that had never fired

The user's second report, from the same replay: *"the meanie was very absorbable, but the bot didn't
even try."* Rung 0b (KILL THE MEANIE, added 2026-08-17) was guarded on `world.canHit`, which aimed one
ray at the object's **bounding-box midpoint**. The Meanie model is a head at y 0.77–0.92 floating over
a tripod foot at y 0–0.41 — **a hollow between them**, and the midpoint lands in it. The ray went
straight through and hit the terrain beyond.

So the rung had never once fired. Not on the reported landscape, not anywhere: `grep "absorb MEANIE"`
over the whole 1000-landscape baseline returns nothing. It was dead from the day it was written, and
the win-rate measurements that followed it were measuring its absence. `CLAUDE.md` had independently
recorded "absorbing a Meanie, a path that has never been exercised" as a pending manual check — it was
right, and for a reason nobody had looked for.

### The fix, in one shape

`aimCandidates(col, row, startY)` in `engine/bot.ts`: every point on a cell the crosshair could sensibly
be aimed at, best first. Something standing there → walk its own silhouette (`AIM_FRACTIONS`). Bare
ground → walk the tile's surface (`AIM_OFFSETS`, corners first because that is what the reachability
model believes, inset 0.4 so `picker.ts`'s floor-to-a-cell does not round onto the neighbour).

It is used in **two** places, and that is the point: the driver's aim pre-flights it with `pickAlong`
(the ray the crosshair would cast, without turning the head first — microseconds instead of the second
of the 1 Hz cadence that turning, firing and missing costs), and `BotWorld.canHit` answers from the same
list. **The planner's idea of what can be hit is now exactly what the driver can deliver.** When those
two disagree one of them is wrong every time: too strict and it declines work that was there for the
taking, too loose and it spends a slot aiming into a hillside.

```
6000-6999                        baseline   tile offsets only   + shared ladder
won                              861        865                 888
died-in-opening                   18         19                  15
bled-out                           2          3                   2
never-reached-assault-position    64         61                  53
watchdog-stalled                  24         21                  15
out-of-clock                      31         31                  27
mean jump of maxJump             81%        81%                 82%
```

**Every loss bucket fell.** That is unusual enough to be worth stating plainly — most changes here trade
one bucket for another, and Postscripts 7 and 8 are both about exactly that. This one does not trade,
because it is not a strategy change: it removes work the bot was declining for a reason that was never
true. Landscape 35 goes from a loss to **WON +33 of a maximum 35**, stable at 15, 16 and 17 ms frames,
and on the way it absorbs the first Meanie in the project's history.

### Measured and rejected: aiming at the Meanie's foot first

Proposed while the above was being measured, and a good argument: *"targeting its foot (the center of
the supporting cell) would be a better bet most of the time. The foot and head are connected, but by a
thin, not centered neck."* True of the model — the tripod is wider than the head, and the probe agrees
(the foot hit in every sample where anything hit; the head did not).

Reordering `AIM_FRACTIONS` to `[0.5, 0.2, 0.85]` scores **886/1000 against 888** — neutral, inside the
churn. The reason it changes nothing is the pre-flight: every candidate is now validated by a real ray
before it is used, so the order only decides which of several *working* aims is taken. Order mattered
when the first choice was fired blind; it stopped mattering when the choice stopped being blind. Kept
at `[0.5, 0.85, 0.2]`, whose stated rationale (most occluders are on the ground) is still the right one
for the models that do have a middle.

### The durable part

Postscript 8 ended on "read the histogram". This one adds: **when the histogram and the human disagree
about the cause, the human is looking at the actual screen.** The bucket said
`never-reached-assault-position`, which is true and useless — it describes where the run ended, not why.
The cause was two rays, and it took someone saying "I can plainly see a place to click" to go and look.
