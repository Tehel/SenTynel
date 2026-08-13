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
- [ ] Re-measure the 220-hop optimum's reachability against a bot that actually banks 77%.

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
- **B2**: identical v1 sweep result before and after (the 102 per-landscape lines diff clean).
- **B3**: ✓ exceeded. Target was parity on wins; actual is 54 vs 51, with mean jump 30.4 vs 15.9
  (77% of maxJump against 41%).
- **B4**: v2 ahead on wins by more than the 3 it currently leads by. The remaining 48 losses are
  where the ascent lookahead has to earn its place — climbing is the one part of v2 still using v1's
  logic unchanged.

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
planners, plus a re-survey (`findAssaultTile` now takes an exclusion set) so a tile that cannot be
cleared is no longer the end of the landscape.

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
