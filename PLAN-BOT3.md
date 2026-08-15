# SenTynel — bot v3: a planner built from the strategy, and a way of working that can tell

Plan for a third demo-bot planner, written from scratch beside the other two. `BOT.md` describes the
bot as it exists; `PLAN-BOT2.md` is the v2 roadmap and its seven postscripts are the evidence this
document is built on. Nothing here is implemented yet.

## Why

v2 wins **739 of 1000** on the 6000-6999 block, banking 80% of the available jump. The person whose
strategy it was built from completes the game at **~99%** — with no omniscience, slower execution, far
less compute, and by their own account no complex planning. **The bot has strictly more information and
wins a quarter less often.** That gap is not sensing. It is decision quality, and no amount of tuning
the existing rungs has closed it.

### The real reason, which is about method

Five changes went in over two days, each justified by an aggregate on a 250- or 1000-landscape block.
Three of them had a shape no total could show:

| change | what the total said | what was actually happening |
|---|---|---|
| the move-on rung | **−3** on the 102-sweep | **+16** on a real block — judged on the training set we would have discarded a good change |
| affordability-gated climb boulder | **+3** on the verdict block | `never-reached-assault-position` **123 → 150**: bought in the opening, paid for out of the ascent |
| the session as a whole | totals held or rose | **landscape 16 regressed from WON +17 to LOST** — and was then reported as a pre-existing loss, because nothing was checking |

A bot this compound — rungs that interact, a plan that latches, an energy economy coupling them — cannot
be steered by a scalar. Two good changes can measure bad together, and a bad change can measure fine.
Every wall found by *watching* has been a real bug worth many landscapes; almost every change argued
from an aggregate has been worth nothing or has quietly traded one failure for another.

### What is *not* wrong

The finish is solved. Across 1000 landscapes `burned-purse` and `died-after-the-Sentinel` are both
**zero** — once the bot is in position, it never fumbles the ending. **86% of losses are
`never-reached-assault-position` (114) and `died-in-opening` (111).** It cannot reliably get
established, and then it finishes perfectly. v3 is aimed at getting established.

### Out of scope

The persistent exposure map (`PLAN-BOT2.md` B6) stays shelved. The human plays at 99% *without* it, so
it is an optimisation and not the missing piece. Revisit only if v3 plateaus with sensing as the
suspect.

---

## Two engine facts that make this v3 rather than v2.1

Both read out of the engine and verified directly. Neither is expressible in v2's movement model, which
is why this is a rewrite of the decision layer rather than another rung.

### 1. A boulder pile has no height limit, and a pile above the eye is still reachable

`canPlaceAt` (`engine/scene.ts:394-400`) returns true for any stack that begins and ends with a Boulder
— **there is no cap**. Creates are gated only by `canPlace` and energy; absorbing a Boulder or Synthoid
skips the line-of-sight test entirely; a transfer needs only that the crosshair resolves a live
Synthoid. And flat planes use the default `FrontSide` material (only slopes are `DoubleSide`,
`scene.ts:157-158`), so a ray from below cannot hit a higher plateau's top face.

So the only thing genuinely unreachable above the eye is **bare terrain** — not a pile.

v2 already depends on this at its goal tile: heightGap 2 landscapes are won by building 5-boulder piles
far above the eye of the body that builds them. But *everywhere else* v2 restricts itself to
`bouldersToOutrank` — the smallest pile that out-ranks its own feet — and `chooseDestination` hard-filters
`tileHeight >= body.height + EYE_HEIGHT`. Its climb primitive is a half-level hop, **by choice**, in a
game that permits an arbitrary tower.

Gaining one whole level from level ground:

| | actions | net energy | tiles that must be safe |
|---|---|---|---|
| two half-level hops (v2) | ~10 | ~4 | 2 |
| one 2-boulder tower | ~5 | ~4 | 1 |

Same energy, **half the actions, half the exposure, and half as many usable tiles**. That is the human's
*"if there's no simple small-steps path, plan a higher tower"* rule, and against a 44% loss bucket it is
the largest structural gap in the bot.

**The risk this carries.** Aiming at the top of a tall pile from below may hit a lower boulder of the
same pile. Modelling the pile as a unit-footprint column gives

```
d  >=  2 * (pileTop − eye − 0.25)
```

— build tall towers *far away*, not next door. That is a model, not a measurement, and the driver's
three-point aim ladder muddies it. **If tall towers cannot actually be shot, most of this design is
void**, so it is measured before anything is built (M0).

### 2. Watchers are completely dormant until the first action

`runDrainPhase` returns on `!game.firstActionTaken` (`engine/watcher.ts:68`) and so does
`Watcher.playTick` (`world/objects/watcher.ts:70`). They neither drain **nor rotate**.

Waiting therefore gains nothing — the cones are frozen exactly where they started. What is true, and
better, is that **the bot chooses when the clock starts**. The entire opening can be planned against a
static, fully known cone configuration, with the exact tick of each watcher's first turn knowable in
advance from `ticksToTurn` and `turnPeriod`. Nothing in v1 or v2 uses this, and 43% of losses are in the
opening.

*(Recorded because the opposite was proposed during design and is wrong: there is no free waiting
window. The lever is choosing the moment of engagement, not stalling.)*

A third, smaller fact: `tryWatcherDrain` eats the **closest** visible candidate and freezes that
watcher's rotation while eating. Junk nearer a watcher than your tower genuinely shields the tower.

---

## How we will work — this is the point of the document

**No sweeps during development.** A 100- or 1000-landscape run at this stage teaches nothing we can act
on and costs minutes per iteration. Worse, it is what got us here: a number that moves for reasons
nobody can name.

Instead:

1. **Play landscape 0. Repeatedly.** Not until it wins — until it wins **and the trace looks like the
   strategy**. Every decision is read. A surprising action is either explained or it is a bug, and
   "it won anyway" is not a defence.
2. **Then landscape 1.** Then the next. One at a time.
3. **Every accepted landscape joins the regression set**, and the whole set must keep passing at **both
   frame times** before any change is accepted. A landscape that was won and now loses is a bug to
   investigate, never a line in a +15/−6 summary.
4. **Sweeps come back at the end**, as a final measurement against v2 — not as the development
   instrument.

The acceptance bar is therefore two things, and the second is the new one: **it wins**, and **its
reasoning is what we expect**. Surprises are allowed, but must be justified and written down.

### What that needs from the tooling

Most of it exists. `BOT_LEVELS=0`, `BOT_TRACE=1` and the per-decision belief line already give the
read-every-decision loop, and `BOT_FRAME_MS` gives the second frame time.

What is missing is small and should be built when the first milestone lands, not before:

- **An accepted-landscapes list** (`utils/bot-v3-accepted.txt`, or a literal in the harness) plus a
  harness case that plays every entry at 15 ms and 16 ms and asserts a win. That *is* the regression
  test, and it runs in seconds while the list is short.
- **A trace reader that is pleasant at one-landscape scale.** The current `BOT_TRACE` output is one
  dense JSON line per decision. For reading every decision of every run, a compact aligned column view
  (tick, phase/waypoint, energy, position, what it did, why) would pay for itself immediately.

Deliberately **not** building now: the `--baseline` snapshot diffing designed for the sweep workflow.
It is the right tool for the end-stage comparison and the wrong one for level-by-level work.

### The risk this method carries, stated up front

Tuning on landscape 0, then 0-1, then 0-2 is **overfitting by construction**, and landscape 0 is not
typical: heightGap 0, one sentry, open ground. The mitigations, which we should agree now rather than
discover later:

- Prefer general rules to special cases, and when a fix is specific to the landscape in front of us,
  say so out loud and write it down.
- Grow the set in *difficulty* as well as number — deliberately admit an early landscape with a
  heightGap of 1 or 2, a watched start, and a cut-off start, rather than taking 0,1,2,3… in order.
- Take an occasional **cold read**: play a landscape never worked on, watch it once, and do not fix
  anything. It is a thermometer, not a task.

---

## The architecture

Written from scratch, reusing only the sensors (`botWorld.ts`), the pure geometry (`botGeometry.ts`),
the cone schedule (`cone.ts`) and a few small helpers (`aimAt`, `topAt`, `isBody`, `createdType`).
**v2's decomposition — rungs, perch, phases — is not assumed.** That is exactly what is in question.
v1 and v2 stay in the tree, untouched, for comparison.

### The state space is the real choice

Position in this game is not `(col, row)`. It is a **stance**: `(col, row, feet)`, where
`feet = terrainHeight + 0.5 × boulders`. Feet determine the eye, the eye determines what can be
targeted, and that is the entire movement model. `computeHopField`'s graph is over *tiles*, with a
hardcoded one-boulder edge — it **cannot represent** "the same tile, three boulders higher", which is
precisely the move that solves a landscape with no small-step ladder.

```
botStance.ts    Stance, Move, stanceMoves(), topShotClear(), computeLevelField()
botRoute.ts     Route, Waypoint, planRoute(), repairRoute()
bot3.ts         the BotPlanner: survey -> route, decide -> next action for the current waypoint
```

A **route** is a sequence of waypoints, each an *intention* (occupy this stance) rather than a recorded
action — `BOT.md` settled that: a script marches on when a watcher eats a boulder mid-sequence, an
intention is simply re-derived. Search is a bounded best-first over stances with an admissible
levels-to-band heuristic; a route is planned once at survey and **repaired locally**, not replanned, when
the world interferes.

Four things this expresses that a priority ladder cannot:

- **Is this climb affordable to the end?** A route has a total cost; a rung has none. `died-in-opening`
  at 111 losses is the shape of a planner that starts climbs it cannot fund.
- **Does this cell reveal a further one?** A node is worth expanding only if it has non-dead-end
  children — the human's two-step lookahead falls out of expansion rather than needing new machinery.
- **Tower or chain?** Both are edges in one space, priced identically in energy, actions and risk. No
  special case.
- **A stable `intention()`**, since a waypoint changes only on real progress. v2's key had to be
  carefully de-flickered to keep the driver's staleness backstop working.

Cost is not the constraint at this scale: analytic terrain LOS is ~1.5 µs, so a 600-node search is
~15 ms — but it will carry a node budget and a per-landscape `planMs` counter regardless, so a cost
regression shows up in the same run as a behaviour change.

### Kept from v2, deliberately

- **Commit-by-arriving.** The moment `canAssaultFrom` is true the route is finished, however much of it
  remained. B4 established that a plan must never talk the bot out of a winning position it stumbled
  into.
- **The finish.** `botEndgame.ts` is reused as-is at first. It measurably never fails, and rewriting it
  would be rewriting the one part that works.

### Safety as a restriction, never a new option

Six flee variants measured negative; all six **added a journey**. The one thing that measured positive
(+16/1000) **added nothing** — it took the step the walk was going to return anyway, one rung earlier.
So the invariant restricts the option set and never extends it: moves whose work window closes before
the work finishes are not generated; the executor re-checks the window before spending an action; and
`ticksUntilSeen` being closed-form means the planner can **schedule** a start rather than relocate.

Guards, non-negotiable: it may never add an action or a destination; if it empties the option set, take
the least-bad option anyway and log it; keep it switchable for a clean A/B.

---

## Build order

**M0 is a measurement, not code**, and everything else depends on it.

| | what | how it is judged |
|---|---|---|
| **M0** | Harness probe: on real landscapes, build an n-boulder tower at distance d and transfer into the body on top. Report the hit rate for n = 1..8, d = 1..8 | **Binary gate.** If tall towers cannot be shot, this design is void — fall back to a ladder over the existing hop primitive. Half a day, and it settles the largest assumption |
| **M1** | `botStance.ts` + `bot3.ts` executor + a depth-1 route + the reused finish. Registered as `v3` | **Landscape 0, read decision by decision.** Wins, and does nothing surprising |
| **M2** | Towers: pile heights above the minimum, `topShotClear`, action-weighted cost | landscape 0 still won; then the next landscapes, one at a time |
| **M3** | The search proper: depth, repair triggers | the accepted set keeps passing; new landscapes admitted one at a time |
| **M4** | The safety invariant and start-time scheduling | the accepted set, plus deliberately-admitted watched-start landscapes |
| **M5** | The opening policy, including the dormant-watcher lever | deliberately-admitted hard openings |
| **M6** | Harvest and purse — cherry-picked from v2 once justified | **only now** does mean jump matter; until here v3 will bank far less than v2 and that is expected |
| **M7** | The sweeps come back: 6000-6999 against v2, and a final verdict on 1000-1999, which neither planner has ever been measured on | the comparison, once there is something to compare |

Registering v3 touches three files: `game/botPlanners.ts` (`PlannerId`, `PLANNER_IDS`,
`createPlanner`), `settings.svelte.ts` (the `'v1' | 'v2'` union, which duplicates `PlannerId` and should
just *be* it), and `ALL_PLANNERS` in the harness. `ui/MainMenu.svelte` already cycles `PLANNER_IDS`.

### Tests

`decide()` is no longer the whole story, so `bot3.test.ts` needs `makeTerrain()` (ASCII terrain — a
heights record is unreadable past three tiles) and `runDecisions()` (apply the planner's own step to the
synthetic world, so a test can assert a *trajectory*). The load-bearing case: **terrain where the greedy
best waypoint is a dead end and the second-best reaches the goal in two more moves.** That test fails
against v2 by construction, and it is this design's thesis in a single case.

Every test must be checked by disabling the thing it covers and watching it fail. Two tests written in
the last two days passed with their mechanism removed, and one such test survived for months.

---

## How this could fail

- **Towers may not be shootable.** M0 first, before anything is built on it.
- **A route is a commitment, and B4 spent a whole phase deleting commitment** — and got parity plus a
  large simplification. v3 reintroduces a much larger commitment. The hedge is cheap local repair and
  commit-by-arriving, but if the world proves more dynamic than expected, the route is noise and the
  honest response is to say so.
- **The diagnosis may be wrong.** "Never got established" might be execution quality rather than route
  quality. M2 and M3 test the two hypotheses separately for exactly this reason, with an explicit
  stopping rule: if M2 moves the needle and M3 does not, stop and spend the effort on the opening.
- **Level-by-level overfits.** See the mitigations above; the cold read is the cheapest of them.
- **v1's "plateau" was misdiagnosed once already** — it was two bugs worth 18 landscapes, not strategy
  exhaustion. It would be characteristic of this project for v2's plateau to be the same, and for v3 to
  be a large answer to a small question. The level-by-level method is the best defence: reading every
  decision is how the last four real bugs were found.
