# PLAN-RULES — restoring rule fidelity to the 1986 original

Companion to `RULES-FIDELITY.md`, which is the findings record and the source of truth for *what the
original does*. This file is the work plan: what to change, in what order, and how each phase is
verified. Decision taken 2026-08-16 — **complete faithfulness**. Every divergence in sections A–F of
the findings is in scope; only the deliberate deviations in section G are kept.

## The two rules everything below restates

Worth having in one place, because five of the six phases are an application of one of them.

**1. The surface rule.** You interact with the surface a thing stands on, never with the thing. The
targetable surfaces are a tile's top face (visible only from an eye above it) and a boulder's side
(visible from anywhere with clear LOS). Absorb *and* transfer both take this test.

**2. The lock-on rule.** A watcher's attention is a single exclusive slot, always on the **closest**
valid target in its cone; everything further away is ignored for the duration. A **synthoid** in that
slot stalls it 5 s before the first unit is taken, then 1 energy per second; a **boulder** it takes at
once. Each watcher runs its own clock and the drains cumulate. The watcher **keeps rotating while the
clock runs** — it freezes only once it is actually draining — so a target the beam carries out of the
cone is lost and the count thrown away. The clock runs through a transfer and survives a shell
becoming the player's body.

## Cross-cutting: the demo bot moves under all of this

Every phase changes the world the bot plays in, and three of them change it a lot. Two consequences
shape the whole plan:

- **One rule change per sweep.** A rules change and a planner change are indistinguishable in a win
  total, so phases land one at a time, each with a paired `utils/block-sweep.sh` run against the same
  block at the same `CHUNKS` and `FRAME_MS`. Diff the **loss-bucket histograms**, not the totals —
  `PLAN-BOT2.md` records that a trade between buckets at an unchanged win rate stayed invisible for
  three whole phases.
- **A new refusal reason is a new infinite loop.** `game/bot.ts`'s `isPlanViable` gives up on a plan
  "already refused by the crosshair". Phases R1 and R2 add refusals the *rules* make while the
  crosshair is perfectly happy, and a planner that cannot see the difference will re-choose the same
  step forever. Each phase that adds a refusal must extend that give-up condition in the same commit.

Expect the bot's win rate to fall and stay down. That is the correct outcome — the game is getting
harder in the ways the original was hard — and `BOT.md`'s numbers are re-baselined at the end, not
defended along the way.

---

## Phase R0 — baseline and failing tests

No behaviour change. Everything after this is measured against it.

1. Pin the pre-change baseline: `BLOCK=6000-6999 PLANNER=v2 ./utils/block-sweep.sh out/preRULES`,
   snapshot via `utils/sweep-aggregate.js --snapshot` to `utils/bot-v2-6000-6999-preRULES.txt`,
   alongside the existing `-preB4` artifact. Record `CHUNKS` and `FRAME_MS` in the file — a later
   comparison at different chunking is worthless.
2. Write the rule tests **first**, red. They encode the target rules, so each later phase is done
   when its tests go green rather than when the code looks right:
   - `game/actions.test.ts` — the targeting matrix (R1).
   - `engine/watcher.test.ts` (new) — grace timing, cumulative drains, and the target-priority
     ordering (R3). The load-bearing case is the three-aligned-synthoids one: assert that the boulder
     a drained synthoid leaves behind is **not** taken before a second, further synthoid. A test
     written against distance alone passes with the bug still in.
   - `engine/meanie.test.ts` (new) — one Meanie, reversion, square-not-body LOS (R5).
   - hyperspace cases into the existing `game/state.test.ts` / `game/actions` coverage (R2).

Not TDD as a practice — the repo's convention is a regression net — but here the expected behaviour
is known precisely and in advance from the findings document, which is exactly the case where
writing it down first pays.

---

## Phase R1 — the surface rule (findings A1, A3)

The largest blast radius, so it goes first, while the baseline is freshest.

**One predicate, two callers.** Today absorb legality lives in `engine/scene.ts`'s
`removeObjectFromScene` and transfer legality is picker-only in `game/actions.ts`. Add a single
exported predicate beside `canPlaceAt`:

```ts
// engine/scene.ts
export function canTargetTopObject(
    sceneData: SceneData,
    col: number,
    row: number,
    isVisible: (col: number, row: number, yOffset?: number) => boolean
): boolean
```

with the rule stated once:

| Top of stack | Rests on | Result |
|---|---|---|
| Pedestal | — | `false` (never absorbable) |
| Boulder | anything | `true` |
| anything | a Boulder | `true` — feet on an extension of the square surface |
| anything | the Pedestal | `isVisible(col, row, 1)` — the Sentinel, and the winning synthoid |
| anything | bare terrain | `isVisible(col, row, 0)` |

`removeObjectFromScene` calls it instead of its current three-branch conditional. Transfer reaches it
through a new `ActionContext.canTarget(col, row)` callback — `game/` must stay three-free, so the
engine injects it exactly as it already injects `canPlace`. Transfer keeps its separate
`absorbedTime !== null` guard: a synthoid mid-morph is not a valid body regardless of visibility.

**What actually changes**, against today:

- Synthoid on bare terrain — was always absorbable/transferable, now needs tile LOS. *The fix.*
- Synthoid on boulders — unchanged, but now for a stated reason rather than by accident.
- Synthoid on the pedestal — was always targetable, now needs pedestal-top LOS. Consistent, and
  reachable in practice: you only get there from a pile that already sees the pedestal top.
- **Tree on a boulder** — was ground LOS, now always targetable. Falls out of the rule for free, and
  fixes an inconsistency nobody had noticed. Confirm in Augmentinel (findings, §"one consequence").
- Boulder, tree on terrain, Sentry, Meanie, Sentinel — unchanged.

**Also in this phase:** correct the two comments that credit the current behaviour to the original —
`game/actions.ts:127` and `engine/scene.ts:444`.

**Bot impact.** Smaller than it first looks, and worth stating so the sweep result is interpreted
rather than feared. v2's perch transfers up onto piles (boulder-supported, unaffected); same-level
transfers keep LOS trivially since the eye sits 0.875 above the feet. The real losses are reclaiming
a shell whose tile the new vantage point hides, and harvesting trees behind folds of ground —
`game/bot.ts`'s reclaim rung and v2's harvest phase. Both must treat a rules refusal as plan-fouling,
per the cross-cutting note.

**Done when:** the targeting matrix is green, `npm run check` and `npm test` pass, and a paired sweep
is recorded with its histogram diffed against R0.

### R1 outcome (2026-08-16) — DONE

Landed. `canTargetTopObject` in `engine/scene.ts` is the single statement of the rule; absorb reaches
it through `removeObjectFromScene`, transfer through the new `ActionContext.canTarget`, and the demo
bot through the new `BotWorld.canTarget`. 15 new tests in `engine/scene.test.ts`, 215/215 unit tests,
`svelte-check` clean, all 17 pinned harness landscapes still won.

**Measured, 6000-6999 @ CHUNKS=12 FRAME_MS=16** (`utils/bot-v2-6000-6999-preRULES.txt` →
`utils/bot-v2-6000-6999-postR1.txt`):

| Bucket | Baseline | R1, first cut | R1, final |
|---|---|---|---|
| **won** | **740** | 717 | **728** |
| died-in-opening | 100 | 101 | 101 |
| bled-out | 10 | 9 | 10 |
| never-reached-assault-position | 116 | 117 | 116 |
| watchdog-stalled | 17 | **45** | 19 |
| out-of-clock | 17 | 11 | **26** |

Two things worth keeping from that table.

**The middle column is the cross-cutting warning coming true, and the histogram is what diagnosed
it.** Every bucket but one was flat; the whole −23 was `watchdog-stalled` +28 — planners re-proposing
a step the rules now refuse, for as long as the body stayed put. On totals alone this reads "the rule
costs 23 landscapes" and sends you tuning the rule. The fix was `BotWorld.canTarget`, and it returned
`watchdog-stalled` to 19 against a baseline of 17.

**The residual −12 is real and is not a loop.** It sits almost entirely in `out-of-clock` (17 → 26):
the bot is not failing, it is *slower*, because it now has to reposition to see tiles it used to
absorb blind. That is the honest price of the rule and it is being paid in the right currency.
Recovering it is planner efficiency, deliberately out of scope here — do not spend R2 on it.

**Note for later phases:** all 17 pinned harness landscapes passed *while 28 landscapes in the wider
block were stalling*. Pinned landscapes are selected as ones the bot wins, so they systematically
under-sample exactly the failures a rules change introduces. They are a smoke test, not a signal.

---

## Phase R2 — hyperspace (finding E3, and a decision on E5)

Much smaller than first scoped. Two of the three planned changes were dropped on 2026-08-16:

- **E2 — sub-3 voluntary hyperspace stays refused, not fatal.** Deliberate: no suicide-by-keypress.
  A Meanie-*forced* hyperspace still kills, which is the faithful half and the fair one — being
  killed by something the game did to you is not the same as pressing H yourself. Now recorded in
  findings §G, not §E.
- **The hyperspace ceiling is already correct.** It is the body's *altitude*, boulders included, and
  Augmentinel confirms that is the original's rule — it is what makes "climb the tower, then jump"
  a real, expensive option. `engine/actions.ts:78` needs no change.

That leaves one genuine fix and one decision.

**Fix — never land higher than you were.** `pickHyperspaceTile` (`game/actions.ts:146`) starts at
the body's altitude and, when nothing fits, **raises the ceiling and retries** up to terrain 11.
Delete the retry: return `null`, and let the 3 energy stay spent exactly as the existing "no tile"
path already does.

**Decision needed — the pedestal energy floor** (`floorEnergyForPedestalHyperspace`,
`game/state.svelte.ts:331`). It is two rules under one name:

- *(a) a pedestal hyperspace goes through even when the 3 can't be paid.* Follows from the E2
  decision — absorption is locked by then, so a player who arrives on 2 energy would otherwise be
  stuck forever. **Keep, no question.**
- *(b) the result is floored to 1 so the jump is never 0.* Invented. In the original, arriving with
  exactly 3 pays it and jumps **0** — you get the code for the landscape you just finished, which is
  not unfair, just anticlimactic.

(b) exists only because (a) creates an inversion without it: arriving on 2 pays nothing and jumps 2,
beating someone who arrived on 3 and jumped 0. The faithful way to keep (a) and drop (b) is to
**charge the 3 as a drain clamped at zero** instead of a refusable spend — 0–3 all jump 0, 4 jumps 1,
monotonic, nothing invented. Confirm which before implementing; `completeWon()` needs a look either
way, since a zero jump should land on the same `levelId` (already in `levelIds`) without churn.

**Bot impact.** Minimal by construction: `botGeometry.ts`'s `endgameCost` already reserves
`HYPERSPACE_COST`, and v2's hyperspace rungs already require `energy >= HYPERSPACE_COST + SYNTHOID`.

### R2 outcome (2026-08-16) — DONE

The floor decision came back **keep both halves** (see findings §E5 and §G): being sent back to the
landscape you just beat is unfun, and a jump of 1 against a potential 20–50 is punishment enough. So
R2 reduced to the one deletion. Six tests in `game/actions.test.ts`, two of which were red on exactly
the ceiling-raising cases.

**Measured: 728 → 725/1000.** `watchdog-stalled` 19 → 22, everything else flat. That is at the noise
floor the sweep header warns about, and directionally it is what a stranded jump looks like: the bot
spends 3 energy, lands nowhere, and is where it was. Accepted.

Note the new failure mode for later: v1's last-resort rung jumps when stuck, and a jump that finds no
tile now leaves it stuck *and* poorer. Worth a look during the planner pass, not now.

---

## Phase R3 — the lock-on rule (findings C6, rules half)

Behaviour only; the HUD is R4. Two sub-changes, both in `engine/watcher.ts`.

**Per-watcher lock-on, synthoids only.** Give `Watcher` a target identity and an elapsed count. Each
drain tick, a watcher that has selected a target either recognises it as the one it locked onto and
advances the clock, or starts a fresh 5 s lock. Only past the grace does it take anything. Losing the
target — the player breaks LOS, the beam rotates past, the object is absorbed — clears the lock, so a
second sighting costs the full 5 s again. Naturally per-watcher: three watchers acquiring you at
different moments run three unsynchronised clocks.

**Boulders are exempt** and drain on the tick they are seen, as they do today. So the gate is on the
target's type, not on the watcher: `findDrainTarget` returns a Synthoid → run the clock; a Boulder or
a tree-on-a-boulder → take it now.

**The attention is a single exclusive slot, and its priority is type-then-distance** (finding C7):

> Synthoids first (each stalled), then boulders, then trees-on-boulders. Nearest to furthest within
> each class. Only synthoids stall.

`tryWatcherDrain` already selects exactly one candidate per watcher per tick, so the exclusivity
needs no code — but its `visibleTargets.sort` is on distance alone and must become
`(classOf(target), distance)` with `Synthoid → 0, Boulder → 1, Tree → 2`. The `TODO` at
`engine/watcher.ts:152-153` is resolved by the finding rather than deleted: the distance sort was only
ever the tiebreak.

**Grace duration is a tunable, not a constant of the game.** Add `WATCHER_GRACE_MS` to
`game/timing.ts` next to `ACTION_COOLDOWN_MS`, documented as "the original is 5 s; we run shorter
because our player is nimbler — see `TRANSFER_DELAY_MS`". **Starting value 3 s**, to be settled by
playtesting rather than by argument. Everything else in this phase is faithful and fixed; this one
number is ours.

That combination gives the player a mechanic we do not currently offer, worth a line in the help or
the release notes: **parking a shell in front of a pile shields it, and shells stack.** Each buys
~6 s of a watcher's undivided attention (5 s stall plus the tick that degrades it) before it will
look at anything else, and the boulder it leaves behind is nearer than the pile, so that goes first
too. Three energy each, two refunded.

**The clock runs through TRANSFER** (finding C8). `engine/watcher.ts:122` currently skips the
destination cell for the whole glide; that free window has to go. Split the two concerns the
immunity was conflating: let the **lock advance** on the destination during TRANSFER, but defer the
**drain action** until the glide lands. That reproduces the original's "arrive already being
drained" exactly, and still prevents the shell morphing to a boulder mid-glide and stranding the
camera inside a non-synthoid — which is the real engine constraint the immunity exists for. Keep the
existing refusal to *initiate* a transfer into an already-draining synthoid (`game/actions.ts:134`).

**Rotation keeps running during the grace** (confirmed against Augmentinel). `drainLocked` currently
tracks `acted`; it must instead track *actually drained*, so a watcher counting down still steps
round on schedule and simply loses the target if the beam carries it away. That is a smaller change
than freeze-on-lock would have been, and it gives the player a second, cheaper escape the original
intended: not only breaking line of sight, but **waiting the beam out**.

One assumption remains, listed as outstanding question 9: whether the Meanie-conversion branch takes
the grace as well. It is the same acquisition so it probably does; implement it uniformly and flag it
in a comment.

**Cumulative drains.** The player's active body must stop going into the shared `tick.itemsDrained`
set (`engine/watcher.ts:170`) — that set exists to stop two watchers morphing the same boulder twice
in one tick, which is right for objects and wrong for the player. Exempt the player-body branch and
every watcher holding your square costs you 1/s independently, each spawning its own conservation
tree, which keeps the energy books balanced. The Meanie branch cumulates too, bounded by R5's
one-live-Meanie rule.

`game.drainPulseAt` still fires; whether the flash should scale with the number of watchers is an
R4 question.

### On the difficulty this hands back

The worry was that a 5 s grace lets you place a boulder, place a synthoid on it and transfer up
**under a watcher's nose** for free — three actions in three seconds at our 1 Hz cadence, inside the
window with time to spare.

**The boulder exemption removes it.** The pile is the part with no grace at all: lay a boulder under
a beam and it is gone on the next tick, so the climb still cannot be done in the open. What the grace
buys is a synthoid on a watched cell and a transfer into it — and the transfer test shows you arrive
*already being drained*, because the clock never stopped. That is a real option, correctly priced:
3 energy to create, and you land under fire.

Two things push the other way, and both mean the net effect of R3 is very likely *harder*, not
easier:

1. **Cumulative drains.** Multi-Sentry landscapes go from 1 energy/s however many watchers hold you,
   to 1/s *each*. Today's game is far softer there than the original.
2. **The transfer window closes** (finding C8). We currently hand out total immunity for the whole
   glide; the original hands out nothing.

Pulling back the other way again, the exclusive-attention rule (C7) hands the player a **new tool**
we do not currently have: a shell parked in front of a pile buys five seconds of a watcher's
attention for 3 energy, most of it refunded. That is a buff, but a priced and skilful one rather than
a free window, and it is exactly the kind of thing the original expected you to work out.

So: **do not pre-compensate.** Land R3 as specified, then measure — a paired sweep plus a human
playthrough fought from a bad position. If it does play too soft afterwards, the honest lever is
`TRANSFER_DELAY_MS` (or the 1 Hz cadence), both of which are our deviations to re-tune, rather than
bending a rule Augmentinel has now confirmed.

### R3 outcome (2026-08-16) — DONE, and the prediction was wrong

**Measured: 725 → 804/1000**, mean jump 81%. Not a loss — a 79-landscape *gain*, and 64 above the
740 baseline. Every prediction in the section below, and in the difficulty analysis above it, called
this the other way. Kept as written rather than quietly corrected, because the reasoning failed in an
instructive place.

| Bucket | Baseline | R2 | R3 |
|---|---|---|---|
| **won** | 740 | 725 | **804** |
| **died-in-opening** | 100 | 101 | **15** |
| bled-out | 10 | 9 | 12 |
| never-reached-assault-position | 116 | 117 | 104 |
| watchdog-stalled | 17 | 22 | 31 |
| out-of-clock | 17 | 26 | 34 |

**`died-in-opening` collapsed from 101 to 15.** That single bucket is the whole result, and it says
the analysis was aimed at the wrong object. The argument above reasoned about what the stall protects
*you are building* — and correctly concluded "nothing, because boulders have no stall". It never
asked what the stall protects *you*. The player's body is a synthoid, so every sighting now costs a
watcher three seconds before it takes a point, and most sightings do not last three seconds: the beam
moves on, or the bot does. **Short exposures are now free**, and the opening is nothing but short
exposures against a purse too small to absorb even one drain.

The rising tail — `bled-out` 9→12, `watchdog-stalled` 22→31, `out-of-clock` 26→34 — is the same
effect seen from the other side. Runs that used to die now survive to stall or time out instead. The
losses did not get harder; they got slower.

Cumulative drains and the closed transfer window are in there too, and they are simply much smaller
than the stall. Worth remembering the next time a phase bundles a buff with a nerf: the two did not
cancel, one of them was an order of magnitude larger, and only the histogram showed which.

**The tuning question is now live and consequential.** `WATCHER_GRACE_MS` is at 3000; the original is
5000, which would be more generous still. The value was chosen to compensate for a nimbler player,
but that reasoning assumed the grace was a modest effect. It is not.

**Bot impact.** *(Written before the measurement above. Wrong, and left as written.)* Two-directional,
and the most interesting sweep of the set — but on balance expect a loss. The 5 s it gains protects only its bodies and shells, not the **boulders** it spends most of
its decisions laying, which is where the `bled-out` and `burned-purse` buckets come from. Against
that it loses its total immunity during every transfer, and pays 1/s *per watcher* on multi-Sentry
landscapes where it used to pay 1/s flat. `game/exposure.ts`'s `readExposure()` returns a single
responsible watcher in `by`; a *count* would let a planner price a cell properly. Note it as a
follow-up — the exposure map has no consumer yet by deliberate choice (`PLAN-EXPOSURE.md`), so this
phase does not need it.

---

## Phase R4 — the scan warning (findings C6, HUD half)

The one change most likely to make the game *feel* like the original, and the reason the original
devoted a corner of its HUD to it.

The original gives **two independent cues** and we currently have half of one: the screen goes fuzzy
while you are *watched*, and a ping sounds on each energy point *taken*. Our red pulse
(`game.drainPulseAt`) covers only the second. The missing one is the important one — it is the cue
you act on, where the pulse only tells you that you were too slow.

So this phase delivers two separate channels, not one indicator with levels:

**Channel 1 — "you are seen"** (new). Three states, matching the two the drain phase already
distinguishes correctly (`engine/watcher.ts:182` splits pool-drain from Meanie conversion on exactly
this), plus the off state:

- **Full** — a watcher can see your square. You are locked on; the drain starts when the stall ends.
- **Half** — a watcher can see your body but not your square. No drain; a Meanie is coming.
- **None.**

**Channel 2 — "a point was taken"** (exists). Keep the red pulse, but it now fires once per point per
watcher, so it must read sensibly when three land in the same tick.

Keeping them distinct is the point: one says *act now*, the other says *you already paid*. Audio —
the original's buzz and ping — stays out of scope; audio is open project-wide (`PLAN.md` Phase 7).

Surface it as state written by the drain phase and read by `ui/Hud.svelte` — say
`game.scanState: 'none' | 'partial' | 'full'`, reset and recomputed each 1 Hz tick, in the same shape
as the existing `drainPulseAt`. Worth carrying the watcher *count* alongside it now that drains
cumulate: "three watchers on you" is different information from "you are seen", and R3 makes the
difference cost three times as much.

### R4 outcome (2026-08-16) — BUILT, awaiting visual confirmation

Chosen treatment: **screen-edge vignette**, the closer analogue of the original's fuzzy screen, in
`ui/ScanVignette.svelte` (always mounted in `App.svelte`, self-gating on phase and scan state like
`Hud`).

- **partial** — steady dim amber. A watcher sees your body but not your square: it can take nothing,
  so the cue is informational and does not ramp.
- **full** — amber ramping to red, widening as it goes. **The ramp is the countdown**: it reaches
  full saturation exactly as the stall expires and the drain starts, which is what turns "you are
  seen" into "you have about this long" — the information the original's filling indicator carried.
- More watchers deepens the colour rather than widening the frame, since drains now cumulate and
  three on you is a different emergency from one.

Deliberately unlike MainView's `#drainFlash`: that is a hard 200 ms spike at an 80 px inset, this is a
slow wash at up to 140 px and sits under it in z-order. Different speed, spread and intensity is what
keeps "act now" and "you already paid" from reading as the same event.

State plumbing: `game.scanState` / `scanWatchers` / `scanElapsedMs` / `scanUpdatedAt`, published once
per drain tick by `setScanState()` — including zeroes, so the cue clears itself. The elapsed/updated
pair lets the component ramp at frame rate between 1 Hz ticks without assuming the drain phase's
clock and `performance.now()` share an origin.

`svelte-check` clean, 233/233 tests, production build fine. **Not visually verified** — that needs a
browser and a watcher actually looking at you.

Audio (the original's buzz and ping) stays out of scope; audio is open project-wide (`PLAN.md`
Phase 7).

---

## Phase R5 — Meanies (findings D1, D2, D3)

Effectively a rewrite of `engine/meanie.ts`'s `updateMeanie`, plus a guard in `triggerMeanieConversion`.

1. **One live Meanie.** `triggerMeanieConversion` currently runs on every 1 Hz tick the half-visible
   condition holds, with no check for an existing Meanie — ten seconds hidden is ten Meanies, and the
   conservation-tree mechanic keeps manufacturing the raw material. Guard on a live Meanie existing.
   Whether "trees in the vicinity" implies a radius is outstanding question 7; until it is settled,
   keep nearest-tree-anywhere and leave a comment saying so.
2. **Sweep, don't home.** Replace the turret that rotates straight at the player
   (`engine/meanie.ts:112`) with a constant-rate rotation in a fixed direction. A homing Meanie
   acquires any bearing in ~2 s and re-acquires as you move, which makes it unavoidable; a sweeping
   one can be dodged by breaking its sightline, which is the counter-play the original intended.
3. **One rotation, then back to a tree.** Track turning against a full 360° budget. If the Meanie has
   not seen the player's square by the end of it, it reverts to a tree — with the same animated
   pacing the conversion uses — and its parent watcher resumes rotating. This needs a Meanie → parent
   link, since the parent is the one currently frozen.
4. **Test the square, not the body.** `engine/meanie.ts:130` raycasts to the player's foot height;
   the sources say the Meanie needs the player's *square*. This matters precisely because the parent
   spawned it for failing that same test — a faithful Meanie is trying to get an angle its parent
   could not.

**Bot impact.** Net easier: Meanies become finite, singular and evadable. Mostly a check that nothing
in `engine/bot.ts` assumed a Meanie is permanent.

### R5 outcome (2026-08-17) — DONE

**Measured: 804 → 890/1000.** The largest single move of the whole effort, and it says the
one-Meanie-per-second bug was never merely a fidelity defect — it was the most expensive thing in the
game.

| Bucket | Baseline | R3 | R5 |
|---|---|---|---|
| **won** | 740 | 804 | **890** |
| died-in-opening | 100 | 15 | 11 |
| **bled-out** | 10 | 12 | **1** |
| **never-reached-assault-position** | 116 | 104 | **52** |
| watchdog-stalled | 17 | 31 | 16 |
| out-of-clock | 17 | 34 | 30 |

`never-reached-assault-position` halved and `bled-out` went to 1. Both follow from the same thing: an
unbounded Meanie swarm meant repeated forced hyperspaces, each costing 3 energy AND throwing the bot
off whatever position it had spent the last minute building toward. It was bleeding purse and
progress at once, which is why fixing it shows up in two buckets rather than one.

**Postscript — C9, found by playing (2026-08-17).** The Meanie work above was correct and, it turned
out, unreachable. A watcher detected the player by their FEET, which for a body on bare ground is
their square, so the half-scan state that creates a Meanie could only occur while standing on
boulders. Fixed by falling back to the body's own model height for the player's body only; see
findings C9.

**Measured: 890 → 861/1000.** A 29-landscape cost, and the right direction — `died-in-opening`
11 → 18 and `never-reached-assault-position` 52 → 69, which is what a live Meanie mechanic looks
like: forced hyperspaces costing 3 energy each and throwing the bot off whatever position it had
built toward. The final figure for the whole effort is therefore **740 → 861**.

The lesson is worth more than the number. Four findings (C6, D1, D2, D3) were correct descriptions of
code that could not run. Five phases of unit tests, three 1000-landscape sweeps and a loss-bucket
histogram missed it, because the bot never seeks that state and every test constructed it the one way
that happened to work. **A rule verified only against a synthetic fixture is verified against the
author's assumptions about the rule.** Play the thing.

**One pinned harness test failed, correctly.** `gives up on a landscape it cannot finish` asserted
the bot loses landscape 900 — and it now wins it. The landscape number is a fixture, not a property
of the watchdog, and it goes stale every time the bot gets better. Replaced with 6706 and annotated
so the next person checks "did the bot improve?" before assuming the watchdog broke.

---

## Phase R6 — documentation and the verification pass

1. Fold the outcome into `CLAUDE.md`'s *Engine / rules summary*, *Controls* and *Current state*
   sections. Several of its statements become wrong the moment R1 and R2 land — the absorb bullet
   ("Synthoids and boulders absorb without an extra LOS check"), the transfer bullet ("No LOS check
   beyond picker resolution"), the hyperspace bullet and the whole
   `floorEnergyForPedestalHyperspace` paragraph. This is not optional tidying; those sentences are
   what the next session will believe.
2. Update `PLAN.md` with the phase outcomes, and `BOT.md` with the re-baselined numbers.
3. Close out the outstanding questions in `RULES-FIDELITY.md` §H as each is tested.
4. **Play it.** Every fidelity claim in this plan is about how the game feels under a human, and none
   of it is visible to a test runner or to me. A full landscape played end to end, plus one
   deliberately fought from a bad position to see the scan warning and a Meanie do their jobs.

---

## Order, and why

R1 first: biggest blast radius, and doing it last would mean re-tuning the bot against four other
changed rules at once. R2 second: now down to one deletion and one decision, a cheap proof that the
phase-and-sweep loop works. R3 before R4 so the warning is built against real timings rather than
guessed ones. R5 last because it is the most self-contained rewrite and the least entangled with the
bot.

R2 could reasonably be swapped ahead of R1 as a warm-up. Nothing else should move.

## Deviations from the original, as they stand after these decisions

Consolidated here because the list is now the interesting part — everything else is being made
faithful. Full rationale in `RULES-FIDELITY.md` §G.

| Deviation | Rationale |
|---|---|
| Voluntary hyperspace below 3 energy is refused, not fatal | No suicide-by-keypress. Meanie-forced hyperspace still kills. |
| Pedestal hyperspace succeeds when the 3 can't be paid | Otherwise unwinnable — absorption is already locked. |
| 1 s transfer glide, mouse look, no U-turn key | The original's ~3 s transfer and slow panning were hardware concessions. Deliberately faster-paced. |
| 1 Hz cap on player actions | The original had no cap. Adopted to match the watchers' tempo. |
| Free bird's-eye view mid-game; no pre-landscape aerial view | The original gave the overview once, before the landscape. |
| Bare pedestal accepts only a synthoid | Guard against an unwinnable state the original allowed. |
| Watchers speed up 5% per completed game; landscape 9999 cap | Project endgame and replayability. |

The middle two are the ones to revisit if R3 makes the game play too soft.
