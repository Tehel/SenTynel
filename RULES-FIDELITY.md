# Rules fidelity review — SenTynel vs. *The Sentinel* (1986)

A line-by-line comparison of the rules as implemented against the original game's documentation.
Written 2026-08-16. Nothing in the codebase was changed to produce it — this is a findings
document, and the "what to do about it" section at the end is a proposal, not a record.

## Sources, and how much to trust each

| Source | Weight | Why |
|---|---|---|
| Simon Owen's **Augmentinel** rules page ([simonowen.com](https://simonowen.com/spectrum/augmentinel/)) | **Highest** | Augmentinel *runs the original Spectrum code* under emulation and hooks it; the rules text is written by someone who reverse-engineered the game logic. Same author as `sentland`, which `world/terrain.ts` is a port of. |
| **Spectrum manual** ([nvg.ntnu.no](https://rk.nvg.ntnu.no/sinclair/instructions/sentinel.html)) | High | Primary document, but the manual is vague in exactly the places we care about. |
| **C64/BBC manual** ([archive.org](https://archive.org/details/Sentinel_The_1984_Firebird_Software), [Lemon64](https://www.lemon64.com/doc/sentinel-firebird/522)) | High | Same text, different platform. |
| **C64-Wiki** ([c64-wiki.com](https://www.c64-wiki.com/wiki/The_Sentinel)) | Medium-high | Detailed and mechanically specific, but player-written and contradicts Augmentinel on two numbers. |
| **Wikipedia** ([en.wikipedia.org](https://en.wikipedia.org/wiki/The_Sentinel_(video_game))) | Medium | Good on the Meanie lifecycle, which the manuals omit. |
| **FRGCB** ([frgcb.blogspot.com](http://frgcb.blogspot.com/2013/11/the-sentinel-firebird-1986.html)) | Low | Review, admits limited experience with Meanies. |

Where sources conflict, that is called out rather than resolved silently — see *Unresolved* at the end.

---

## The single rule everything hangs off

Every source states the same core interaction rule, and it is worth writing down in one line
because most of the divergences below are a failure to apply it uniformly:

> **You interact with the square *surface*, not with the object.** Put the sights on the square a
> thing stands on. Boulders are the one exception — they "act as an extension of the square
> surface", so you aim at a boulder's *side*, and a boulder can therefore be absorbed with no view
> of its base tile at all.

**Resolved 2026-08-16 by testing against Augmentinel**, which makes that rule sharper and shows it
is one rule, not two. The targetable surface is either a **tile's top face** (visible only from an
eye above it) or a **boulder's side** (visible from anywhere with clear line of sight). An object is
absorbable *or transferable* iff **the surface it stands on** is visible:

| Object stands on | Requirement |
|---|---|
| Bare terrain | LOS to the tile, `yOffset = 0` — so your eye must be above it |
| One or more boulders | **None beyond seeing it** — its feet rest on an extension of the square surface |
| The pedestal | LOS to the pedestal top, `yOffset = 1` |
| (the object *is* a boulder) | None beyond seeing it |

The two observations that pin this down: a bare synthoid one level above the player **cannot** be
transferred into (its tile's top face is not visible from below), while a synthoid standing on a
boulder **can** — even though that puts its feet higher still. Nothing but the surface rule explains
both, and it is also the only model under which the game's central climb loop stays legal: a robot
on top of a seven-boulder tower has its feet far above your eye, and you must be able to transfer up
to it.

One consequence not yet confirmed in Augmentinel, worth a minute's testing: **a tree standing on a
boulder should be absorbable with its base tile hidden**, exactly like the boulder under it. We
currently require ground LOS for that case.

Augmentinel states it as a rule: *"You can absorb objects on the landscape if you can see the tile
they are standing on, except for boulders that can always be absorbed."* C64-Wiki states it twice,
independently: *"All items at places, whose base area is visible can be absorbed"* and *"Rocks can
be absorbed without seeing the corresponding base area."*

The implementation applies it to trees, Sentries and the Sentinel, and exempts **both** boulders
**and synthoids**. The synthoid exemption is the largest single divergence found.

---

## A. Absorbing and targeting

### A1 — Synthoids can be absorbed without line of sight to their square ❌

`engine/scene.ts:449`

```ts
if (top instanceof Boulder || top instanceof Synthoid) {
    allowed = true;
```

Only boulders are exempt in the original. A synthoid — your abandoned shell, or any other robot —
requires a view of the square it stands on, exactly like a tree.

This is load-bearing for difficulty, not a detail. The intended climb loop is *place boulder →
place robot on it → transfer up → **turn around and absorb the shell you can now see***. That last
step is supposed to be a positioning problem: sometimes the terrain you just climbed hides your old
body's square and you eat the 3-energy loss. As implemented, you can always reclaim it as long as
the crosshair reaches any pixel of the model, and the same permissiveness lets you strip robots
across the map from behind a ridge.

Two code comments assert the opposite and should be corrected whatever is decided about the rule
itself:

- `game/actions.ts:127` — *"Original-game rule: if the picker resolved to a synthoid … transfer is
  allowed"* (see A3, unverified).
- `engine/scene.ts:444` — *"Boulders and synthoids are always absorbable regardless of LOS
  (original game rule…)"* — half right; the original rule names boulders only.

### A2 — Everything else in the absorb path is faithful ✔

- Tree: needs LOS to its tile — `engine/scene.ts:454`. ✔
- Sentry: needs LOS to its tile (so you must be above it). ✔
- Sentinel: needs LOS to the **pedestal top**, `yOffset = 1`, not the pedestal's base tile —
  `engine/scene.ts:452`. Matches *"a stack of boulders of sufficient height that the Synthoid on top
  can look down on the Sentinel's platform"*. ✔
- Pedestal itself is not absorbable — `engine/scene.ts:440`. ✔
- Meanie: worth 1, needs LOS to its tile. ✔
- Absorption is locked for the rest of the landscape once the Sentinel goes —
  `game/actions.ts:112`. ✔ *"Once the Sentinel has been absorbed, you can no longer absorb energy,
  although you can still create objects and transfer."*

### A3 — Transfer requires no square visibility ❌ (confirmed)

`game/actions.ts:126-138` accepts any synthoid the centre ray resolves, at any pixel of the model.

**Confirmed against Augmentinel:** transfer takes the *same* surface test as absorbing a synthoid —
C64-Wiki's *"aiming at the shell's feet"* is literal. A1 and A3 are therefore one fix, not two: one
predicate serving both, per the table above.

---

## B. Creating and building

### B1 — The placement rules are faithful ✔

C64-Wiki is the most specific source: *"New robots may be placed on flat visible terrain which can
be viewed from the current position, i.e. it must lie below eye height — or atop a freshly made
rock."* Augmentinel: *"Objects can be created on any free flat tile."*

The implementation never checks visibility or eye height explicitly for creation — it is enforced
*geometrically*, and correctly:

- Slopes are rejected outright (`game/actions.ts:73`), so "flat tile" holds.
- The picker only returns what the centre ray hits, so "visible" holds.
- Terrain plane meshes are `FrontSide`, so a tile above the eye presents only its back face to the
  ray and cannot be picked — "below eye height" holds without a line of code.
- Occupied tiles are rejected by `canPlaceAt` (`engine/scene.ts:420`), so "free" holds.

This is worth recording precisely *because* it is implicit: anyone adding an explicit visibility
check to the create path would be duplicating a rule the geometry already enforces, and anyone
switching the terrain material to `DoubleSide` would silently break the eye-height rule.

### B2 — Boulder stacking is faithful ✔

Aiming at a boulder's side returns the boulder's cell, and `canPlaceAt` allows anything on top of an
all-boulder stack (`engine/scene.ts:425`) — including stacks whose top is far above the eye, which
is exactly how a seven-boulder tower gets built from the ground. Matches *"Boulders can be stacked
and have things placed on top of them."*

### B3 — A bare pedestal accepts only a synthoid ⚠ (deliberate)

`engine/scene.ts:423`. No source says the original restricted this; it is almost certainly a
project-added guard against an unwinnable state (absorb is locked post-Sentinel, so a boulder
parked on the pedestal could never be removed). Listed here so it is not mistaken for a faithful
rule. The original was presumably happy to let you brick your own landscape.

---

## C. Draining (Sentinel and Sentries)

### C1 — The target-selection rule is faithful ✔

*"scanning the landscape for squares which contain more than 1 unit of energy"*, reduced *"one unit
at a time"*, robot → boulder → tree.

`engine/watcher.ts:58` (`findDrainTarget`) reproduces this correctly, including the non-obvious
consequences:

- A lone tree (1 unit) is never touched. ✔ — which is what makes trees usable as LOS blockers.
- A tree **on a boulder** *is* drained, because the square holds 3 units. The tree goes first, then
  the boulder next tick, leaving 1. ✔
- Sentries, Sentinels, Meanies and pedestals are never drain targets. ✔ (*"The Sentinel, Sentry and
  Meanie can't be absorbed by the Sentinel/Sentries."*)
- Only the topmost item is acted on, so a stack shields what is under it. ✔

### C2 — Energy conservation is exactly right ✔

*"The total amount of energy in a landscape remains constant"*. Every drain path conserves:

| Event | Before | After |
|---|---|---|
| Synthoid drained | 3 | boulder 2 + conservation tree 1 |
| Boulder drained | 2 | tree 1 + conservation tree 1 |
| Tree-on-boulder drained | 1 | conservation tree 1 |
| Player pool drained | 1 (yours) | conservation tree 1 |
| Tree → Meanie | 1 | 1 |

### C3 — The body-visible / square-visible distinction is exactly right ✔

`engine/watcher.ts:182-205` is the best-matched piece of the whole rule set. LOS to the body's foot
height decides whether the watcher engages at all; a **second** LOS test to the square (`yOffset =
0`) then splits pool-drain from Meanie conversion. That is precisely the original's full-scan /
half-scan distinction, and it is the mechanic the entire Meanie subsystem exists to serve.

### C4 — Rotation freezes while draining ✔

`Watcher.drainLocked`, `world/objects/watcher.ts:89`. Matches *"Whenever the Sentinel or a Sentry
finds energy … it halts its rotation and drains it one unit at a time."*

### C5 — Dormancy until the first action ✔

*"remain inactive until you expend or absorb energy"* — `game.firstActionTaken`. ✔

Minor: the original also woke on a U-turn (C64-Wiki: *"plain rotation is silent, but a 180° flip is
not"*). There is no U-turn key here (mouse look replaced it), so there is nothing to port.

### C6 — No scan warning and no grace period ❌

The original gives **two distinct cues**, and they signal different things: the screen goes *fuzzy*
while you are watched, and an audio *ping* rings on each energy point actually taken. We have only
the second half of the second one — the red pulse on drain — and nothing at all for "you are seen".

Every manual describes a two-stage detection: the scan indicator top-right fills with specks, a
buzz sounds, and *then* the drain starts. Spectrum manual: *"you get roughly five seconds to break
line of sight before draining begins."* BBC/C64 manual: the same. This is the player's whole
defensive game — spot the fuzz, break LOS, survive.

The implementation has neither. `engine/watcher.ts:194` drains on the very first tick the condition
holds, and the only feedback is a 200 ms red border flash *after* the energy is already gone
(`game.drainPulseAt` → `ui/MainView.svelte:326`). There is no scan indicator anywhere in the HUD
(`ui/Hud.svelte` renders energy icons and the cooldown bar only).

Of everything in this document this is the biggest divergence in *feel*: it converts a warned,
escapable threat into an unannounced one, and it removes the tension the original built the whole
top-right corner of its HUD around.

**Resolved 2026-08-16 by testing against Augmentinel** — and it is worse than a missing timer,
because the *shape* of the threat is wrong in two ways:

- The grace period is **5 s, per watcher**, and then **1 energy per second**. Each watcher runs its
  own lock-on clock, so breaking one watcher's sightline resets only that one. It is a real delay
  rather than an artifact of the beam arriving: a target placed squarely inside a watcher's cone
  still gets its 5 s.
- **The grace applies to synthoids only.** *(Corrected 2026-08-16 — an earlier test had it applying
  to boulders too.)* **Boulders are drained immediately**, on the tick they are seen. This is the
  detail that gives the rule its shape: the delay is an intruder-specific stall, not a generic
  reaction time. You cannot build a pile under a beam, because the boulders go as fast as you lay
  them — but a synthoid, and the player inside it, gets five seconds.
- The stall occupies the watcher **exclusively**, and its target is always the **closest** thing in
  the cone — see C7, which is where the mechanic really lives.
- **The clock keeps running through a transfer, and survives the shell becoming the player.** Create
  a synthoid on a watched cell and transfer into it: you arrive already being drained, because the
  lock started when the shell appeared and never reset when you moved in. Confirmed on both the
  original and Augmentinel, where a transfer is ~4 s of blank screen against a 5 s grace.
- **Rotation is *not* frozen during the grace.** A watcher keeps stepping round while its clock runs,
  and freezes only once it actually starts taking energy. Place a synthoid in front of a watcher 4 s
  before its next turn and it rotates away having drained nothing — the clock does not survive the
  target leaving the cone. This is the opposite of what the "5 s to escape" framing suggests, and it
  matters: the escape window is not the beam pausing on you, it is simply a delay, and *waiting the
  beam out* is as valid an escape as breaking line of sight.
- Watcher drains **cumulate**. Three watchers holding your square is 3 energy per second. The
  implementation caps the player-pool drain at 1/s in total, because the player's body goes into the
  shared `tick.itemsDrained` set (`engine/watcher.ts:170`) and every watcher after the first skips
  it as already-drained this tick.

Together these make multi-Sentry landscapes far less dangerous than the original's, while making
single-Sentinel ones *more* punishing than the original's (no warning at all). The current model
isn't uniformly easier or harder — it is the wrong curve.

### C7 — Which target a watcher picks ✔ (confirmed 2026-08-16)

`engine/watcher.ts:152` picks the closest visible candidate, under a `TODO` saying no reference was
available. **Half right.** Distance is the tiebreak, but it is not the first key:

> **All synthoids first, nearest to furthest, each with its own 5 s stall. Then boulders, nearest to
> furthest, each taken at once.**

Three synthoids lined up on the Sentinel were drained one every ~5 s in distance order, and *only
after all three had become boulders* did it start on the boulders. That is the decisive detail: the
boulder the nearest synthoid had just become was closer than the second synthoid, and the watcher
still took the second synthoid first. Type priority beats proximity.

The test that shows it also establishes something the ordering alone does not — the lock is
**exclusive**. A synthoid placed in front of the Sentinel with a boulder behind it: the Sentinel
locked onto the synthoid, sat through its 5 s doing nothing, drained the synthoid, and only then
started on the boulder. The boulder was *never* taken during the stall, even though a boulder on its
own is taken at once.

So a watcher's attention is a single slot, not a scan of everything in the cone:

- Detection is **instant** — the watcher sees the synthoid the moment the beam covers it. The 5 s is
  a delay before the first unit is taken, not time spent noticing.
- While the slot is occupied, **everything else is ignored** — not just things further away, and not
  just things of lower priority.
- Rotation still runs during the stall (see C6), so the beam can carry the target out of the cone and
  the whole thing is abandoned.

**Trees rank last.** A tree on a boulder *is* drained (confirmed) — it has to be, or the boulder
under it could never be reached — and it goes after the bare boulders. So the full order is three
classes, nearest-first within each:

| Priority | Target | Stall |
|---|---|---|
| 1 | Synthoid (loose shell or the player) | 5 s each |
| 2 | Boulder | none |
| 3 | Tree on a boulder | none |

This also closes a model ambiguity that looked live a moment ago: "by type" and "by descending energy
value" (synthoid 3, boulder 2, tree 1) now predict **identical** orderings in every case the game can
produce, so there is nothing to choose between them. Implement it as a type priority; the distinction
is unobservable.

**The tactical consequence**, which the original clearly intends and which we do not currently offer:
**a synthoid parked in front of a pile shields it**, and shells stack. Each one buys its own ~6 s
(5 s stall plus the tick that degrades it) before the watcher will look at anything else, three of
them buy ~18 s, and even then the resulting boulders are nearer than the pile and go first. Three
energy each, two of it refunded. This is the counter-play the whole rule exists to enable.

### C7a — An observed anomaly we are deliberately **not** reproducing

Recorded so nobody re-derives it and "fixes" our engine to match. Three synthoids aligned on the
Sentinel and seen from above, all three plus their cells visible. The observed sequence was:

1. #1 → boulder
2. **#3** → boulder (skipping #2, which is nearer)
3. #1's boulder → tree
4. #3's boulder → tree

— and #2 was never touched. Step 3 onward is explicable if #1's tree, once grown, occluded #2; trees
are tall where the boulder that preceded it was not. **Step 2 is not explicable** by the rule above,
by distance, or by occlusion, since half-height boulders cannot hide a synthoid.

The likeliest account is that the original iterates some internal object list rather than a sorted
one, and the sorted behaviour we measured everywhere else is what that happens to produce in simpler
arrangements. **Decision: treat it as a peculiarity of the historic engine and do not reproduce it.**
Our rule is the deterministic one in C7. If our build ever shows something similar, check for
occlusion first — our raycast LOS can produce the tree-hides-synthoid half for free — but do not
chase step 2.

### C9 — A watcher detected the player by their FEET, so the half-scan state was unreachable ❌ (found in play, fixed)

Reported from playing 2026-08-17, and the reason the entire Meanie mechanic had never been seen to
fire: a bare synthoid behind a slope on landscape 10 (cell 3,23), Sentinel high enough to see the body
but not the cell underneath, trees nearby — no amber vignette, no conversion, and the Sentinel simply
rotated away.

The bug was in target *selection*, not in the Meanie code. `runDrainPhase`'s candidate filter tested
line of sight to each object's **foot** (`cand.height - map[cell]`), and a synthoid standing on bare
ground has its foot exactly at its square. So the detection test and the square test asked the same
question, a hidden square meant the player was never selected as a target at all, and the code that
splits pool-drain from Meanie conversion was never reached. The half-scan state was only ever
reachable when the player happened to be standing on boulders — the one case where foot and square
differ.

Fixed by falling back to the body's own model height (`verticalExtent(...).max`, 0.9375 for a
synthoid) when the square is hidden. Deliberately limited to the **player's body**: for every other
object, foot-height detection coincides with the surface rule the player absorbs under (A1), so a
shell whose square is hidden is out of a watcher's reach for the same reason it would be out of
yours, and nothing in the sources suggests otherwise.

Worth noting what this says about the rest of the audit: C6, D1, D2 and D3 were all *correct
findings about code that could not run*. Five phases of unit tests, a 1000-landscape sweep and a
loss-bucket histogram never surfaced it, because the bot never sought that state and no test
constructed it. It took one person standing behind a slope.

### C8 — The transfer destination is immune while you are gliding into it ❌

`engine/watcher.ts:122` skips the cell the player is transferring into for the whole TRANSFER phase —
no pool drain, no Meanie conversion — and deliberately leaves the watcher free to keep looking
elsewhere rather than locking on.

The original does the opposite, and the test that shows it is the one above: create a synthoid on a
watched cell, transfer in, and you land already being drained. The watcher held its lock on that
square the entire time you were in transit. Our rule hands the player a free window instead.

The engine reason for the immunity is real and must survive the fix: without it, the shell's morph
to a boulder can complete mid-glide and strand the camera inside a body that is no longer a synthoid.
The fix is to separate the two concerns — let the **lock clock** advance on the destination during
TRANSFER while deferring the **drain action** until the glide lands. That reproduces the observed
"drained on arrival" exactly and keeps the camera safe. Our glide is 1 s against the original's ~4 s,
so the window in which this can even matter is small.

---

## D. Meanies

The Meanie rules come mostly from Wikipedia and Augmentinel, since the manuals only say a Meanie
exists "to flush you out".

> If the Sentinel or Sentry cannot see the square the Synthoid is standing on, but its head is
> visible **and there are trees in the vicinity**, it may transform **one** of them into a Meanie,
> that will force the Synthoid to hyperspace and lose 3 units of energy. **If the Meanie cannot see
> the player's square after a full rotation, it will turn back into a tree and the Sentinel or
> Sentry will resume rotation.**

### D1 — A new Meanie is created every second, indefinitely ❌ (also a bug)

`engine/watcher.ts:203` calls `triggerMeanieConversion` from inside `applyDrain`, which runs on
every 1 Hz drain tick the half-visible condition holds. There is no check for an already-existing
Meanie, no "trees in the vicinity" proximity condition (it takes the closest tree anywhere on the
map), and no cap.

Stay hidden-square/visible-head for ten seconds and ten trees become ten Meanies. Since the
conservation-tree mechanic keeps *manufacturing* trees, this can run for a long time. The original
creates one.

### D2 — Meanies never revert to trees ❌

`engine/meanie.ts` has no lifetime and no rotation budget. A Meanie exists until absorbed or until
it forces a hyperspace — and even after forcing one it stays, ready to force another.

The original gives it exactly one full 360° sweep. Miss, and it becomes a tree again and hands
rotation back to its parent watcher. That is a real strategic beat: break the square-sighting and
you can *wait the Meanie out*.

### D3 — Meanies home rather than sweep ⚠

`engine/meanie.ts:112` rotates the Meanie directly toward the player at up to 22.5°/tick and fires
the moment it is aimed. The original describes a Meanie *"rotating fast"* / *"spinning rapidly with
a low clicking noise until it sights you"* — a fast independent sweep, not a turret tracking you.

Functionally this makes the implementation's Meanie close to unavoidable: it takes at most ~2
seconds to acquire any bearing, and it re-acquires as you move. A sweeping Meanie can be dodged by
breaking its sightline; a homing one cannot.

Related: `engine/meanie.ts:130` tests LOS to the player's **body** (foot height), where the sources
say the Meanie needs the player's **square** (*"If the Meanie cannot see the player's square"*).
Given the parent watcher spawned it precisely *because* the square was hidden, this matters — a
faithful Meanie is usually trying to get an angle the parent could not get.

### D4 — The forced hyperspace itself is faithful ✔

Costs 3, applied as a drain rather than a spend so it can kill (`engine/meanie.ts:155`). ✔ Matches
*"can push energy negative and destroy it"*.

---

## E. Energy and hyperspace

### E1 — The energy table is right (with one contested value) ✔

`game/rules.ts`: tree 1, boulder 2, synthoid 3, sentry 3, sentinel 4, meanie 1. Starting energy 10
(`game/state.svelte.ts:87`). The HUD's golden-robot-is-15 icon (`ui/Hud.svelte:24`) matches
*"golden robot heads represent 15 points"*. ✔

~~The **Sentry** value is contested~~ — **settled 2026-08-16 by testing against Augmentinel: the
Sentinel gives 4, Sentries give 3.** The implementation is already correct; C64-Wiki and the
Spectrum instructions page are both wrong to say 4 for a Sentry. No change needed.

### E2 — Hyperspace under 3 energy: refused, where the original kills ⚠ (deliberate, 2026-08-16)

**Decision: keep the current behaviour.** A *voluntary* hyperspace below 3 energy stays refused
rather than fatal — no suicide-by-keypress — while a *Meanie-forced* one still kills. What follows
records the original's rule and why the two paths differ on purpose.

`game/actions.ts:193` — `if (!spendEnergy(3)) return false;`.

Every source is unambiguous: *"If you hyperspace with less than 3 units of energy, you are
destroyed."* The implementation silently refuses the key instead.

The two hyperspace paths disagree with each other: a **Meanie-forced** hyperspace uses `drainEnergy`
and *can* kill you (`engine/meanie.ts:155`), while a **voluntary** one cannot. In the original both
are fatal. The asymmetry is now the intended design — being killed by something the game did to you
is fair, pressing H yourself and dying for it is not — so only the forced path stays faithful.

### E3 — Hyperspace can land you higher than you started ❌

`game/actions.ts:146` (`pickHyperspaceTile`) starts at `maxHeight` and, if no tile qualifies,
**raises the ceiling by one and retries** up to terrain height 11.

The original is firm: *"You land at the same height or lower but never on your original square"* /
*"only on equal or lower height"*. Handing the player a free climb when the map is crowded inverts
the rule at exactly the moment it matters.

**Not** an issue, though it looked like one: the ceiling passed in is `body.height`, the body's
*altitude* including any boulders under it (`engine/actions.ts:78`). **Confirmed 2026-08-16 against
Augmentinel — altitude is correct**, and deliberately so: it is what makes "climb a tower, then
hyperspace off the top" a legal play. Costly and risky, but available. Leave it alone.

### E4 — Everything else about hyperspace is faithful ✔

- Costs 3 — *"costs the same as placing a robot"*. ✔
- Creates a fresh shell at a random spot and moves you into it. ✔
- Leaves the old body standing (as does transfer). ✔ *"make sure you absorb your old hull"*.
- Never lands on an occupied tile, so never on your own square. ✔

### E6 — A jump with nowhere to land is refused, not charged for ⚠ (deliberate, 2026-08-24)

Reported from *playing* landscape 482, whose map holds exactly two flat tiles at or below the
starting altitude — the pair the body starts on. Jump once and you land on the second; jump again and
both are occupied (your old hull still stands on the first), so `pickHyperspaceTile` returns null.

The implementation used to have already spent the 3 by then, log `hyperspaceNoTile`, and report
success. That was the consequence E3 drew from making the ceiling absolute — *"if nothing fits,
nothing fits: the caller has already spent the energy and the jump is simply wasted"* — and read
correctly in the abstract. In play it is wrong on three counts:

- **It was the only action in the game that charged for having no effect.** Every create the stacking
  rule refuses, every absorb the surface rule refuses, costs nothing and can be retried.
- **It broke energy conservation in the one direction that cannot be undone.** A landscape's energy
  is otherwise closed: what you spend stands somewhere as an object you can absorb back. Hyperspace's
  3 leaves permanently, so on a map with nowhere to land it is an unbounded drain to zero.
- **Nothing distinguished it from a jump that worked.** The camera does not move, the energy goes, and
  the player is left to infer that they landed inside a pre-existing synthoid. (That is precisely how
  it was reported.)

**Now:** the landing is resolved *before* the spend, and an impossible jump is refused — `false` from
`performHyperspace`, so `engine/actions.ts` never starts the 1 Hz cooldown either and the key is
retryable the instant a tile frees up. Follows E2's line: a voluntary hyperspace is never a way to
lose. **The ceiling itself is untouched** — still absolute, still the body's altitude, and E3 stands
in full. What changed is only whether an action the rules have already refused gets billed.

Untestable in the original as far as we can tell: it needs a map where every flat tile at or below
your altitude is occupied, and the manuals say nothing about it. Recorded in §G as ours.

### E5 — The pedestal-hyperspace energy floor is invented ⚠ (deliberate)

`game/state.svelte.ts:331` (`floorEnergyForPedestalHyperspace`) lets a pedestal hyperspace succeed
below 3 energy and floors the result to 1 so the landscape jump is never zero.

It is **two** rules wearing one name, and they need deciding separately:

- **(a) A pedestal hyperspace succeeds even when the 3 energy can't be paid.** Follows directly from
  the E2 decision: if a voluntary hyperspace is never fatal, this one must still go through, or a
  player who reaches the pedestal on 2 energy is permanently stuck — absorption is already locked, so
  there is no way left to earn the shortfall. **Keep.**
- **(b) The result is floored to 1 energy, so the landscape jump is never 0.** Separate, and pure
  invention. In the original, finishing with exactly 3 pays the 3 and jumps you **0** landscapes —
  you are handed the code for the landscape you just played. That is the original's actual behaviour
  and there is nothing unfair about it.

The reason (b) exists at all is that (a) creates an inversion without it: arriving on 2 energy would
pay nothing and jump 2, out-jumping someone who arrived on 3, paid it, and jumped 0. A worse arrival
must not beat a better one.

**Decision 2026-08-16: keep both.** The faithful alternative — charge the 3 as a drain clamped at
zero, so 0–3 all jump 0 — was considered and rejected on play feel: being sent back to the landscape
you just finished is unfun, and against a potential jump of 20–50 a jump of 1 is already punishment
enough. Both halves are now deliberate deviations rather than open questions.

---

## F. Endgame and progression

### F1 — Win sequence ✔

Absorb the Sentinel → place a synthoid on the vacated pedestal → transfer into it → hyperspace.
Matches every source. ✔

### F2 — Landscape jump arithmetic ✔

`game/state.svelte.ts:354`: `levelId + game.energy`, where `game.energy` has already had the
hyperspace's 3 deducted. Matches Augmentinel's *"leftover energy (minus 3 for the hyperspace)"* and
is consistent with the manual's looser *"landscape + energy left"*. ✔

The 9999 cap and the "nothing further to unlock" branch are project additions for a finite game.
Harmless.

---

## G. Deliberate deviations (not defects — recorded so they are not "fixed")

| Deviation | Where | Note |
|---|---|---|
| 1 Hz cap on player actions | `game/state.svelte.ts:121`, PLAN.md Phase 3.5 | The original had no cooldown; you acted as fast as you could type. Adopted to match the watchers' tempo. |
| Always-on sights | — | The original toggled sights with SPACE, and panned faster with them off. Mouse look replaced the whole scheme. |
| Free bird's-eye view mid-game | `engine/camera.ts` | The original gave an aerial view *once*, before the landscape started, and never again. This is a substantial help the original withheld. |
| No pre-landscape aerial view | — | The flip side of the above: the one overview the original *did* give is missing. |
| Watchers speed up 5% per completed game | `world/objects/watcher.ts:17` | Project replayability incentive. |
| Pedestal accepts only a synthoid | `engine/scene.ts:423` | See B3. |
| Landscape 9999 cap | `game/state.svelte.ts:357` | Project endgame. |
| Transfer glide is 1 s, not ~3 s | `game/timing.ts` | The original's ~3 s transfer and its slow panning were hardware concessions — the U-turn key existed *because* panning was slow. Deliberately faster-paced here; the U-turn key is correspondingly unnecessary. |
| Watcher grace period may be tuned below the original's 5 s | `game/timing.ts` | Follows from the row above: a nimbler player needs a shorter fuse for the same pressure. Ships as a single named constant, starting point 3 s, to be settled by playtesting. |
| A pedestal hyperspace succeeds below 3 energy, and the winning jump is floored to 1 | `game/state.svelte.ts` | E5. The first half is forced by keeping voluntary hyperspace non-fatal; the second is a play-feel choice — replaying the landscape you just beat is unfun, and a jump of 1 against a potential 20–50 already stings. |
| A hyperspace with nowhere to land is refused rather than charged for | `game/actions.ts` | E6. Follows E2 — a voluntary hyperspace is never a way to lose. The original's behaviour here is unknown and probably unreachable; ours makes it the only action in the game that can't bill you for doing nothing. |

---

## H. Source conflicts — settled and outstanding

**Settled 2026-08-16 by direct testing against Augmentinel** (faithful by construction: an embedded
emulator running the actual Spectrum binary):

1. ~~Sentry energy value~~ → **Sentinel 4, Sentry 3.** Implementation already correct (E1).
2. ~~Player drain rate~~ → **5 s grace per watcher, then 1 energy/second, cumulative across
   watchers.** C64-Wiki had indeed conflated the grace period with the rate (C6).
3. ~~Whether transfer requires square visibility~~ → **yes, the same surface test as absorbing a
   synthoid** (A3).

4. ~~Does the 5 s grace apply to non-player targets too?~~ → **synthoids only.** Loose shells get it
   like the player does; **boulders are drained immediately**. *(Revised — an earlier test had said
   uniformly.)* It is a genuine delay, not the beam taking time to arrive (C6).
4b. ~~Does the clock run during a transfer?~~ → **yes**, and it survives the shell becoming the
   player's body: you arrive on a watched cell already being drained (C6, C8).
5. ~~Does a watcher freeze rotation during the grace?~~ → **no.** It freezes only once it actually
   starts draining; a target that leaves the cone mid-grace is simply lost (C6).
6. ~~Hyperspace ceiling: terrain height or body altitude?~~ → **body altitude**, deliberately — it is
   what makes the tower-then-hyperspace play possible. Implementation already correct (E3).

**Still outstanding** — none blocks the work, but each should be checked in Augmentinel as the
corresponding phase is built:

7. **Is the lock-on clock per object, or per square?** Largely defused now that boulders have no
   grace — the boulder-then-synthoid test is moot, since the boulder goes at once. What remains is
   the narrow case of a synthoid replacing a just-drained synthoid on the same square. Low value.
8. **Does a fresh target need a fresh 5 s?** Once a watcher has finished with one square, is the next
   *synthoid* in its cone stalled again from zero, or taken at once? (The shield trick in C7 is
   renewable only if the answer is "from zero".)
9. **Does the Meanie-conversion branch take the grace too?** Same acquisition, so probably — but it
   yields a Meanie rather than an energy loss, and has never been timed.
10. **"Trees in the vicinity" for Meanie conversion** — is there a radius, or is it the nearest tree
    anywhere? (D1.)
11. **Meanie sweep rate**, and whether its one-rotation budget is a full 360° of its own turning (D3).
12. ~~Watcher target ordering with several candidates in view~~ → **all synthoids first (nearest to
    furthest, each stalled 5 s), then boulders (nearest to furthest, immediate)**, and the lock is
    exclusive throughout. Our distance sort is only the tiebreak; the type priority is new (C7).
12b. ~~Where does a tree-on-a-boulder rank?~~ → **last, after the bare boulders**, and it is drained
    (it must be, or the boulder beneath could never be reached). Closes the type-vs-value model
    question too: with trees last the two models coincide everywhere (C7).
13. **Watcher rotation cadence** — implemented as 28.125° (±20/256, straight from `sentland`, almost
    certainly right) every 12 s. C64-Wiki says 30° every 10 s. The period is the soft number.

---

## What to do about it

The decision (2026-08-16) is **complete faithfulness**: every divergence in sections A–F is to be
fixed, and only the deliberate deviations in section G are kept. The phased work plan lives in
**`PLAN-RULES.md`**; this document stays as the findings record and the source of truth for *what
the original does*.
