# SenTynel — bot v2: a challenger planner

Plan for a second demo-bot planner, built alongside the existing one rather than replacing it.
`BOT.md` describes the bot that exists today (v1) and stays the reference for it. This file is the
roadmap for what comes next; move settled facts into `BOT.md` as each phase lands.

## Why

v1 wins **51 of the 102 sweep landscapes** and has plateaued: successive tuning passes trade
landscapes rather than gaining them. Its own loss breakdown says why — the largest bucket (25) is
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

### B2 — Make room for a challenger (pure refactor)

- [ ] Extract `game/botGeometry.ts`; v1 imports it; tests unchanged and still green.
- [ ] `BotPlanner` interface; `engine/bot.ts` holds opaque planner memory; v1 wrapped as an
      implementation.
- [ ] Planner selection flag (`BOT_PLANNER`, debug Settings entry).
- [ ] Harness: dual sweep with a per-landscape side-by-side table and per-planner buckets.

No behaviour change anywhere — the sweep must print an identical v1 result before and after.

### B3 — bot2 skeleton: phases, safety, value-ordered harvest

- [ ] Phase machine — `ASCEND` → `CLEAR` → `HARVEST` → `FINISH` — with explicit entry/exit tests, the
      current phase in every trace line, and a fall-through when a phase cannot progress.
- [ ] Safety interrupt above every phase: if the cell we stand on is in sight, relocate to the
      reachable tile with the most cover (preferring an existing body, then a build); never work
      under a cone.
- [ ] Harvest by **descending energy value**, no threshold, subject to a stopping rule.
- [ ] Reuse v1's movement (`chooseDestination`, hop field, plan-as-intention) underneath, with the
      exposure tier replaced by `ticksUntilSeen` and placement preferring latest-watched tiles.

### B4 — Ascent lookahead and tower planning

- [ ] Height-chain lookahead: prefer a climb whose top reveals a further climb, rather than the
      highest reachable tile.
- [ ] Explicit multi-level tower planning when no small-step chain exists, including deciding to
      build the taller tower one step early.
- [ ] Rebuild-on-theft as a first-class case (the prose's "if the tower gets absorbed, absorb what's
      on that cell, pick a new candidate and retry") rather than something `isPlanViable` happens to
      catch.

### B5 — Perch-and-branch harvesting, and the purse as an objective

- [ ] Perch concept: hold a high finishing body, branch with cheap single-use bodies, return and
      reclaim. Gated on the perch's cover outlasting the round trip.
- [ ] Maximise finishing energy as an explicit objective, and re-examine `game/route.ts` once the
      purse is routinely large — `targetJump` becomes a choice rather than a burn.
- [ ] Re-measure the 220-hop optimum's reachability: `utils/path-no-tower.csv` assumed a `maxJump`
      purse v1 never approached.

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
- **B2**: byte-identical v1 sweep result before and after.
- **B3**: v2 within reach of v1 on the sweep (it starts with less tuning, so parity is a good first
  result), and the burned-purse bucket measurably smaller.
- **B4/B5**: v2 ahead of v1 on wins, and average jump per win materially above v1's — that second
  number is not currently reported by the harness and should be added in B2.
