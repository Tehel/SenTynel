/*
 The v2 planner: the strategy that actually completed the game, as described by the person who did
 it (PLAN-BOT2.md quotes the account in full).

 It differs from the v1 ladder in three ways, and everything else is shared code.

 **It plays in phases rather than one ladder.** Secure the high ground, clear the Sentries, *then*
 collect everything the landscape has, and only then finish. v1 interleaves those, and stops
 harvesting the moment it can afford the endgame — which is why it banks 41% of what a landscape
 could fund (BOT.md). The jump you win is the energy you have left, so the last phase before the
 finish is the one that decides how far the run travels.

 **It grades tiles by how long their cover lasts**, not by whether anything is looking at them right
 now (game/cone.ts). Note where this is applied: to rank tiles it was going to walk to anyway. The
 fifth flee experiment established that prediction cannot pay for *extra* journeys, only for better
 choices among the ones already being made.

 **It keeps a perch.** Once it is standing on the assault tile with the pile built, that position is
 held for the rest of the landscape: it branches out to collect what is left and comes back, rather
 than wandering off and having to climb again. Transfers are the one action that can go *upward* —
 the crosshair resolves a Synthoid above the eye even though nothing else may be targeted there — so
 the body left standing on the pile is a ladder home.

 Pure and three-free like every other planner: the world arrives through BotWorld.
*/

import { GameObjType } from '../world/terrain';
import { energyCostOf } from './rules';
import { logEvent } from './log';
import {
	assaultBand,
	assaultCandidates,
	bouldersToSee,
	computeHopField,
	distance,
	endgameCost,
	findAssaultTile,
	findPedestal,
	tileIndex,
	HYPERSPACE_COST,
	MAX_ASSAULT_BOULDERS,
	MAX_VISIBILITY_TESTS,
	type AssaultPlan,
	type PedestalTarget,
} from './botGeometry';
import {
	aimAt,
	chooseDestination,
	createdType,
	isBody,
	isPlanViable,
	planStep,
	topAt,
	type BotPlan,
	type TilePreference,
} from './botMovement';
import { canAssaultFrom, inAssaultPosition, planEndgame } from './botEndgame';
import type { BotObject, BotPlanner, BotStep, BotWorld } from './botWorld';

/*
 Ticks of cover a tile needs before v2 will treat it as safe.

 Four ticks is one action at the 1 Hz cadence, so the requirement is simply *how many actions the
 job takes*: each boulder of the pile, the body on top, and the transfer into it, plus a tick of
 slack. A bare hop needs about twelve ticks; a three-boulder tower needs twenty-four.

 Scaled rather than fixed, because a fixed figure is wrong at both ends and was visibly wrong on
 landscape 60: at 14 ticks the bot would start a three-boulder tower on a tile with three and a half
 seconds of cover, lay two boulders, and watch the drain phase eat them. It kept its energy only
 because the sentries happened to rotate away, and on a replay where the conservation trees fell
 elsewhere it never recovered.

 The distinction v1 cannot draw at all. Its middle tier — "in some watcher's line of sight but not
 looked at right now" — lumps a tile that is clear for the next forty seconds together with one a
 cone reaches in the next second.
*/
const TICKS_PER_ACTION = 4;
const coverNeededFor = (boulders: number) => TICKS_PER_ACTION * (boulders + 2) + 2;
/*
 Decisions the harvest phase may spend before it gives up and goes to finish.

 It needs a bound, because the landscape refills: every successful drain spawns a conservation tree
 somewhere (engine/watcher.ts), so "collect everything" against a live Sentinel is not a task that
 finishes on its own — the bot's own perch body being eaten would produce a fresh tree to go and
 fetch, forever. Generous enough to sweep a whole landscape, and it is a backstop, not a schedule:
 the phase normally ends because nothing reachable is left.
*/
const HARVEST_BUDGET = 80;
// Energy in hand before the harvest phase considers a *detour* worth funding. Below this the bot is
// one drain away from being unable to build a body at all, so it collects what it can see first.
const DETOUR_RESERVE = 6;
/*
 Decisions the climb may spend before it stops looking for somewhere better and takes what it can get.

 A backstop, not a schedule: the ascent normally ends because canAssaultFrom comes true. It exists
 because a phase with no explicit bound is a hang rather than a slowdown, and because the give-up
 conditions a planner can observe for itself are exactly the ones that cannot detect "I am busy doing
 nothing". A decision count and not a purse condition — energy can be drained to zero, and then no
 test that mentions energy ever fires again. 120 decisions is two minutes of the 1 Hz cadence, against
 a five-minute level limit and a harvest that wants eighty of them.
*/
const ASCEND_BUDGET = 120;
/*
 Consecutive decisions with nowhere legal to walk before the bot writes the spot off and jumps.

 One dead decision is usually transient: a cone crossing the only good tile, a body still
 materialising, a create the crosshair refused. Landscape 35 jumped on exactly one of those, at nine
 energy, and was dead four jumps later. Three is long enough that "there is nothing here" is a fact
 rather than a moment, and short enough to still be an escape.
*/
const STUCK_BEFORE_JUMPING = 3;
// Hyperspaces taken purely because the goal was unreachable on foot. A landing can drop us into
// another pocket, so this needs a bound, but each jump is a fresh draw and three is generous.
const MAX_HATCH_JUMPS = 3;
/*
 Tallest pile the hop field may assume when nothing one boulder high connects (see computeHopField).

 Three is the two-level climb — bouldersToSee(h, h+2) — which is the bowl landscape 86 starts in and
 the shape the one-boulder field kept mistaking for a dead end. Five would buy the three-level climb
 as well, at ten energy of boulders before a body is paid for, which is the whole starting purse.
 The field charges any such edge a full TALL_HOP_COST, so raising this can only ever add routes where
 there were none; it can never make the bot prefer a climb to a walk.
*/
const MAX_FIELD_CLIMB_BOULDERS = 3;

// What absorbing something is worth, which is what "descending energy value order" ranks by.
const VALUE: Partial<Record<GameObjType, number>> = {
	[GameObjType.SENTRY]: 3,
	[GameObjType.SYNTHOID]: 3,
	[GameObjType.MEANIE]: 3,
	[GameObjType.BOULDER]: 2,
	[GameObjType.TREE]: 1,
};
const valueOf = (o: BotObject) => VALUE[o.type] ?? 0;

/*
 Which of its jobs a decision belonged to — a *readout*, not state.

 It used to be a field with six writers and one reader (the trace), which is a state machine that can
 disagree with the world: a label set on one decision survived into the next, and one of the writes was
 a self-assign that existed only to avoid clobbering a stale value. Derived per decision instead, from
 the two things that really are state (is a perch held, has the Sentinel gone) plus what the decision
 actually did. A derived label cannot wedge, and it cannot lie.

 CLEAR is gone with the field. It only ever meant "this decision absorbed a Sentry", which the step's
 own label already says.
*/
type Phase = 'ASCEND' | 'HARVEST' | 'RETURN' | 'FINISH';

/*
 Grade a tile by how long it stays out of sight, for the shared walk to rank destinations with.

 Three grades so it slots into the same machinery as v1's: 0 is worth taking, 1 is survivable, 2 is
 a cone on the tile right now — which is the one that actually costs, since the drain phase will eat
 whatever we put there in the second before we can move into it.
*/
export const coverPreference = (world: BotWorld, boulders = 1): TilePreference => ({
	grade: (col, row) => {
		const ticks = world.ticksUntilSeen(col, row);
		return ticks === 0 ? 2 : ticks >= coverNeededFor(boulders) ? 0 : 1;
	},
	reject: 0,
	// A cone on the tile now means the body is eaten before we can enter it, so this is refused
	// outright rather than taken reluctantly. With nothing else reachable the walk returns nothing,
	// and the bot hyperspaces out instead of paying five energy to be drained.
	avoid: 2,
});

/*
 What is still to be spent finishing a hop, plus what a watcher takes while it is spent.

 Used by the move-on rung to answer "can I actually complete this from here", which is a different
 question from "can I pay for the next action" — see landscape 16, where paying action by action put the
 bot one create short of a transfer it had already spent five energy on.

 Two terms. The creates that remain: 2 an outstanding boulder, 3 for the body if it is not up yet. And
 the drain taken while making them, at a point a second for one action each plus the transfer — which is
 the term the first version of this rung missed entirely, and the only reason a hop can cost more than
 its price list. Both shrink as the work is done, so a half-built hop is correctly cheaper to finish
 than a fresh one is to start.
*/
function remainingHopCost(world: BotWorld, plan: BotPlan): number {
	const stack = world.objectsAt(plan.col, plan.row).length;
	const bouldersLeft = Math.max(0, plan.boulders - stack);
	const bodyNeeded = stack <= plan.boulders ? 1 : 0;
	const creates = 2 * bouldersLeft + energyCostOf(GameObjType.SYNTHOID) * bodyNeeded;
	// +1 for the transfer itself, which costs no energy but is another second of being drained.
	return creates + bouldersLeft + bodyNeeded + 1;
}

export class PhasePlanner implements BotPlanner {
	private assault: AssaultPlan | null = null;
	private hopField = new Map<number, number>();
	private plan: BotPlan | null = null;
	/*
	 The high position, latched the first time it is reached and never given up.

	 Latched rather than re-derived, because the moment the bot steps off the pile to go and collect
	 something, `inAssaultPosition` stops being true — and a planner that re-derived its phase from
	 that would decide it was back to climbing and start again somewhere else.
	*/
	private perch: { col: number; row: number } | null = null;
	/*
	 The pedestal, and the tiles the Sentinel could be taken from.

	 `pedestal` is everything the finish needs and costs nothing to find. `candidates` is every flat
	 tile scored by the pile it would need — terrain only, so static for the landscape. `band` is the
	 subset that could really launch an assault, and it is what seeds the hop field: see survey().

	 `sightlines` caches the real pedestal-top raycast per tile. Sound for the whole landscape because a
	 tile's view of the pedestal top depends only on the height map, which never changes.
	*/
	private pedestal: PedestalTarget | null = null;
	private candidates: AssaultPlan[] = [];
	private band: AssaultPlan[] = [];
	private sightlines = new Map<number, boolean>();
	/*
	 The route to the committed assault tile, built once when the perch latches.

	 Kept separate from the ascent's band-seeded field because the two answer different questions: the
	 band ladder is "how do I get high", this is "how do I get back to that one tile". The ascent uses
	 the first and everything after the perch uses the second, which is what confines B4's change to the
	 climb — see the field/goal pairing in the walk.
	*/
	private assaultField = new Map<number, number>();
	private harvestDecisions = 0;
	/*
	 The errand this decision settled on, or null. Written once where it is computed and cleared at the
	 top of every decision, so the phase readout can tell "walking out to fetch something" from
	 "walking home" without the walk having to report it back up through ten return statements.
	*/
	private errand: { col: number; row: number; tileHeight: number } | null = null;
	private hatchJumps = 0;
	/*
	 Consecutive decisions on which the walk found nowhere to go, and where we were when we last asked
	 for a hyperspace. Both exist because a *proposed* action is not a *taken* one: the 1 Hz cadence can
	 refuse it, and the crosshair can miss, and on landscape 35 that burned the whole hatch budget from
	 a standing start without the bot ever moving.
	*/
	private deadDecisions = 0;
	private hatchedAt: { col: number; row: number } | null = null;
	// Decisions spent, for the ascent's unconditional bound below.
	private decisions = 0;
	/*
	 Every cell this run has already stood in. Consulted by chooseTransfer, and the reason is a
	 THREE-BODY TRANSFER LOOP seen on landscape 9194 (PLAN-BOT2.md postscript 20).

	 `previousBody` was the guard against this and it is a ONE-STEP memory: it closes a two-body
	 oscillation and three bodies walk straight around it. Cells rather than objects, because the
	 identity of the body standing there is not what makes the move pointless — the *position* is.
	*/
	private visited = new Set<number>();

	/*
	 Once per landscape: find the pedestal, work out where it could be assaulted from, and build the
	 one field the whole run navigates by.

	 The field is seeded from the **whole band** rather than from a single nominated tile, and that is
	 the change B4 turns on. Seeded at one tile it is a route to that tile, and every patch this planner
	 has needed — re-pointing when the climb ended somewhere better, retrying when the tile had no route
	 to it, hyperspacing when the bot was cut off from it — was compensation for having picked that tile
	 from a standing start, before knowing anything about the terrain that could actually be climbed.

	 Seeded from the band it is a ladder to *anywhere worth arriving*. Because no field edge climbs more
	 than one whole level (see computeHopField) and the band is the top one to three levels, layer 1 is
	 the level below the band, layer 2 the one below that, and descending hops is climbing. So the field
	 no longer depends on which tile is nominated — which is what makes the reachability retry that used
	 to live here pointless: rejecting a tile cannot change whether the body can reach the band. It is
	 gone, and with it the last reason the survey was the most expensive thing this planner did. One
	 traversal per landscape, where the worst case used to be eight.
	*/
	survey(world: BotWorld): void {
		this.pedestal = findPedestal(world);
		if (!this.pedestal) {
			logEvent('bot', 'survey', { planner: 'v2', pedestal: null });
			return;
		}
		this.candidates = assaultCandidates(world, this.pedestal);
		/*
		 Widen the pile ceiling rather than give up. Five boulders covers heightGap 2, which is every
		 landscape the bot is known to handle, but a band of nothing would leave the field seeded on the
		 pedestal cell — a strictly more lenient question (the pedestal's own tile sits a whole unit below
		 its top) and empty on a gap-2 landscape, where no tile's one-boulder eye clears the summit at all.
		*/
		for (const ceiling of [MAX_ASSAULT_BOULDERS, 7, Infinity]) {
			this.band = assaultBand(world, this.candidates, ceiling);
			if (this.band.length > 0) break;
		}
		const seed = this.band.length > 0 ? this.band : [{ col: this.pedestal.pedestalCol, row: this.pedestal.pedestalRow }];
		this.hopField = computeHopField(world, seed, MAX_FIELD_CLIMB_BOULDERS);
		/*
		 And that is the whole survey. No assault tile is chosen here, which is B4.

		 It used to nominate one from a standing start, by pile height and straight-line closeness, before
		 the bot knew anything about the terrain it could actually climb — and then every plan for the rest
		 of the run aimed at it. Now the climb pursues the band, an *aim* is re-derived each decision from
		 wherever the bot is standing, and the tile is committed only on arriving somewhere the endgame can
		 actually start from. Reachable because we walked there, rather than because a BFS predicted it.
		*/
		const body = world.body;
		logEvent('bot', 'survey', {
			...this.pedestal,
			planner: 'v2',
			band: this.band.length,
			candidates: this.candidates.length,
			reachableTiles: this.hopField.size,
			hops: body ? (this.hopField.get(tileIndex(body.col, body.row)) ?? null) : null,
		});
	}

	// The aim the last decision ran on, for the log line only — see decide(). Never read as state.
	private lastAim: AssaultPlan | null = null;

	decide(world: BotWorld): BotStep | null {
		const step = this.choose(world);
		/*
		 The planner's own view of the world, once per decision.

		 The action log alone says what the bot did and never why, and from the assault tile onwards
		 the two look unrelated: "build a synthoid over there" is the correct move while harvesting
		 and a derailment while standing one action from winning, and nothing in the step
		 distinguishes them. Reported from watching as "most of the decisions are counterintuitive
		 from there", which is exactly the symptom of a trace that omits the state they turn on.
		*/
		const body = world.body;
		const assault = this.assault;
		logEvent('bot', 'v2', {
			phase: this.phaseOf(world, step),
			energy: world.energy,
			at: body ? `${body.col}_${body.row}@${body.height}` : null,
			// Where we stand on the climb, in the hop field's own currency. No edge in that field climbs
			// more than one whole level (see computeHopField), so a hop count is a level count: 0 means
			// standing somewhere the assault could be launched from. null means the field never reached
			// us, which is a pocket — and the thing to suspect first if the bot is wandering.
			hops: body ? (this.hopField.get(tileIndex(body.col, body.row)) ?? null) : null,
			perch: this.perch ? `${this.perch.col}_${this.perch.row}` : null,
			inPos: body && assault ? inAssaultPosition(body, assault) : null,
			// Why the endgame is or isn't available, which is the question from here on.
			needs: assault ? `${assault.col}_${assault.row}>${assault.pedestalHeight + 1}` : null,
			// Where this decision was heading, committed or not. Distinct from `needs`, which is null
			// for the whole climb (B4 defers commitment until arrival), leaving the trace silent about
			// the one thing every rung below the aim turns on.
			aim: this.lastAim ? `${this.lastAim.col}_${this.lastAim.row}x${this.lastAim.boulders}` : null,
			errand: this.errand ? `${this.errand.col}_${this.errand.row}` : null,
			plan: this.plan ? `${this.plan.col}_${this.plan.row}x${this.plan.boulders}` : null,
			did: step?.label ?? 'nothing',
		});
		return step;
	}

	private choose(world: BotWorld): BotStep | null {
		const body = world.body;
		const pedestal = this.pedestal;
		// Cleared here rather than left from last time: the phase readout reads it, and a value that
		// outlives the decision that produced it is exactly the staleness the phase field used to have.
		this.errand = null;
		/*
		 A missing pedestal is fatal; a missing assault tile is not, which is the change.

		 This guard used to require an assault plan, so a landscape the survey could not nominate a tile
		 for produced no actions whatsoever for the full five minutes. Now the climb needs only the
		 pedestal — the direction to go and the height to beat — and where to build is decided on arrival.
		*/
		if (!body || !pedestal) return null;
		// Recorded before any branch: where we have stood is a fact about the run, not about the phase.
		this.visited.add(tileIndex(body.col, body.row));

		// Absorption is locked from the Sentinel onwards, so the finish owns the rest of the run.
		if (world.sentinelAbsorbed) {
			this.plan = null;
			return planEndgame(world, body, this.assault ?? pedestal);
		}

		/*
		 Commit by arriving.

		 `canAssaultFrom` is the real question — eye above the pedestal top, line of sight to it, and the
		 Sentinel actually hittable from here — and the first time it is true, the tile under our feet
		 becomes the assault tile. Not a tile chosen in advance and then defended: this one is reachable
		 because we walked to it, its sightline was confirmed by the same test the endgame will use, and
		 there is nothing to re-point because nothing was ever pointed anywhere else.

		 That deletes three patches at once. The re-point existed because the climb ended somewhere better
		 than the nominated tile; the survey's reachability retry because the nominated tile might have no
		 route to it; and both were still only guesses made before the terrain was known. What is left is
		 one latch, at the moment the answer is certain.
		*/
		if (!this.perch) {
			const aim = this.aimAt(world, body);
			if (aim && canAssaultFrom(world, body, pedestal)) {
				const tileHeight = world.map[tileIndex(body.col, body.row)];
				this.perch = { col: body.col, row: body.row };
				this.assault = {
					...pedestal,
					col: body.col,
					row: body.row,
					tileHeight,
					boulders: bouldersToSee(tileHeight, pedestal.pedestalHeight + 1),
				};
				// The route back to it, which everything after this point navigates by.
				this.assaultField = computeHopField(world, this.assault, MAX_FIELD_CLIMB_BOULDERS);
				logEvent('bot', 'commit', { at: `${body.col}_${body.row}`, height: tileHeight, decisions: this.decisions });
			}
		}
		/*
		 What the rest of this decision aims at: the committed tile once there is one, otherwise the best
		 the band currently offers from where we stand. An aim is not a commitment — it is re-derived every
		 decision and latched by nothing, so a better one found halfway up simply supersedes it.

		 NEVER THE TILE WE ARE STANDING ON. Control only reaches here uncommitted, which means
		 canAssaultFrom just refused the tile underfoot — and a tile we are standing on but cannot assault
		 from is the one tile in the landscape that can never be made to work, because the movement model
		 gains height only by building on ANOTHER tile and transferring up (isPlanViable reads a plan on
		 the current tile as already achieved). Aim there and every rung below deadlocks at once: the
		 assault-pile rung excludes it by its own guard, the walk cannot choose the cell it stands in, and
		 the ladder falls through to the hyperspace rung with a full purse.

		 Reported from watching landscape 233, where it is not merely a wasted decision but a self-
		 sustaining loop: the bot jumps out at 20 energy, climbs back, and `transfer onward` moves it into
		 the body it abandoned on that same tile — arriving, aiming at its own feet, and jumping again. The
		 body left behind is what closes the circuit, which is confirmed by how the loop ENDS when it does:
		 over repeated runs it escapes exactly when a watcher eventually eats that body, removing the thing
		 that keeps pulling it back. Also the explanation for a run whose transfer count runs away (34 on
		 233, against 9 once fixed) while nothing progresses.
		*/
		/*
		 The aim skips a tile a cone is sitting on RIGHT NOW.

		 coverPreference's `avoid` tier fires exactly when ticksUntilSeen is 0, which does not depend on
		 how tall the pile would be — so it is safe to grade here, before `prefer` below can be sized
		 against plan_assault.boulders. findAssaultTile consults nothing but `avoid`, and falls back to
		 the refused tile when every viable one is watched, so this can only ever change WHICH tile is
		 aimed at, never whether there is one.
		*/
		const plan_assault = this.assault ?? this.aimAt(world, body, true, coverPreference(world, 0));
		// Kept for the decision log only. Uncommitted, `needs` reads null and the aim is the single
		// piece of state every rung below turns on — a trace without it cannot explain a climb.
		this.lastAim = plan_assault;
		if (!plan_assault) return this.lastResort(world, body);
		this.decisions++;
		// Sized to the work: climbing to the assault tile means laying its whole pile, while an
		// errand is a bare body and a transfer.
		const prefer = coverPreference(world, this.perch ? 0 : plan_assault.boulders);
		const onPerch = this.perch !== null && body.col === this.perch.col && body.row === this.perch.row;

		/*
		 A viable intention survives every rung below: a Sentry worth taking or a body worth reclaiming
		 is a detour, not a change of mind.

		 Graded for cover as well, which v1 does not do — the plan is dropped when a cone arrives on its
		 destination, rather than being built into the drain. Sized to the work still outstanding rather
		 than the original pile, so a plan one boulder from finished is not thrown away over cover that
		 would have lasted long enough.
		*/
		if (this.plan) {
			const remaining = Math.max(0, this.plan.boulders - world.objectsAt(this.plan.col, this.plan.row).length);
			const cover = coverPreference(world, remaining);
			if (!isPlanViable(world, this.plan, body)) {
				this.plan = null;
			} else if (!isPlanViable(world, this.plan, body, cover)) {
				// Logged separately from the other give-up conditions because this one is new and its
				// rate is the whole question: too rare and it is not the pathology that was reported,
				// too often and the bot is being talked out of work it should finish.
				logEvent('bot', 'planExposed', { at: `${this.plan.col}_${this.plan.row}`, remaining });
				this.plan = null;
			}
		}

		/*
		 0b. KILL THE MEANIE. Above everything but the endgame.

		 Reported from watching the demo, 2026-08-17: a Meanie spawned within easy reach on two separate
		 landscapes, the bot ignored it both times, and both times it was duly hyperspaced away.

		 It outranks even the free transfer because of what it costs to be wrong. A Meanie that finds your
		 square forces a hyperspace: 3 energy, and a random landing that throws away whatever position you
		 spent the last minute building — which is the same damage the R5 sweep measured at 29 landscapes
		 when the mechanic first started working at all. Against that, absorbing it costs one second of the
		 cadence and *pays* a point. There is no purse condition and no distance limit for the same reason:
		 a Meanie anywhere on the landscape is hunting this body specifically, so "not worth the detour"
		 is never true, and the only question is whether the crosshair can reach it.

		 One at a time is guaranteed by the rules layer (engine/meanie.ts), so `find` is enough — but it
		 takes the first targetable one rather than assuming, since nothing here should depend on that.

		 Not gated on sentinelAbsorbed: the endgame branch above has already returned by this point, which
		 is also when absorption locks and this would be illegal.
		*/
		const meanie = world.objects.find(
			o =>
				o.type === GameObjType.MEANIE &&
				topAt(world, o.col, o.row) === o &&
				!world.isBlocked(o.col, o.row, 'absorb') &&
				world.canTarget(o.col, o.row) &&
				world.canHit(o.col, o.row, o.aimHeight)
		);
		if (meanie) return { action: 'absorb', ...aimAt(meanie), label: 'absorb MEANIE' };

		/*
		 1. Move into a Synthoid that helps. Free, so it outranks everything.

		 Must come before reclaiming: game.previousSynthoidCol/Row is never cleared, so a cell the
		 bot once left stays flagged as a body of ours forever, and reclaiming first has it build a
		 body at its destination and immediately eat it as though it were the old one.
		*/
		const move = this.chooseTransfer(world, body, plan_assault);
		if (move) {
			if (this.plan && move.col === this.plan.col && move.row === this.plan.row) this.plan = null;
			return { action: 'transfer', ...aimAt(move), label: 'transfer onward' };
		}

		/*
		 2. Reclaim everything left behind at the cell we just left — the body, and then the boulders
		    that were under it.

		 A hop costs a boulder (2) and a body (3) and gives 3 back when the body is reclaimed, so
		 reclaiming the body alone leaves the walk running at **−2 an hop**. This rung used to stop at
		 the Synthoid: once that was absorbed the top of the stack was a Boulder, the type test failed,
		 and the boulder stayed there for the rest of the landscape. Reported from watching a demo run
		 die on landscape 16, and the trace is unambiguous — energy 10, 6, 5, 3, 0 across four hops,
		 with five boulders left standing around the map at 2 apiece on a landscape whose entire maxJump
		 is 22. The comment here used to claim the walk cost "nothing net"; that was the intent, and this
		 is what makes it true.

		 Boulders and Synthoids only: anything else on that cell is the landscape's, not ours, and
		 something a drain has turned into a tree is the harvest rung's business rather than a reclaim.
		 Never the perch, which is the way back up, and never the tile we are currently building on.
		*/
		const previous = world.previousBody;
		const reclaimable = (o: BotObject) => o.type === GameObjType.SYNTHOID || o.type === GameObjType.BOULDER;
		const building = this.plan !== null && previous !== null && this.plan.col === previous.col && this.plan.row === previous.row;
		if (previous && !this.isPerch(previous.col, previous.row) && !building) {
			const top = topAt(world, previous.col, previous.row);
			if (
				top &&
				reclaimable(top) &&
				!isBody(top, body) &&
				world.canTarget(top.col, top.row) &&
				world.canHit(top.col, top.row, top.aimHeight)
			) {
				const what = top.type === GameObjType.SYNTHOID ? 'body' : 'boulder';
				return { action: 'absorb', ...aimAt(top), label: `reclaim previous ${what}` };
			}
		}

		/*
		 2b. Clear the assault tile of anything that isn't ours — drain residue (a tree, a meanie) or, on
		     landscape 42, a Sentry the generator put there. The bot only ever builds boulders and bodies,
		     so anything else up there is in the way, and while it stays the tile cannot be built on.

		     Only for a *committed* tile. Spending an action clearing somewhere we merely have an eye on is
		     work for a tile the next decision may not even be aiming at — and unlike the old nominated
		     tile, an aim that turns out to be fouled costs nothing, because the aim simply moves.
		*/
		const fouled =
			this.assault !== null &&
			world
				.objectsAt(plan_assault.col, plan_assault.row)
				.some(o => o.type !== GameObjType.BOULDER && o.type !== GameObjType.SYNTHOID);
		if (fouled && !onPerch) {
			const top = topAt(world, plan_assault.col, plan_assault.row);
			/*
			 Line of sight as well as a clear crosshair, and the two are not the same question.
			 canHit is the picker, which resolves anything the ray reaches — including a cell above
			 the eye. Absorbing a tree additionally needs isCellVisible (engine/scene.ts), which
			 refuses a target at or above the eye outright. Proposing the absorb on the strength of
			 the crosshair alone is an action the rules can never accept, and since the failure
			 blacklist clears every time the body moves, the bot re-proposed it for the rest of the
			 landscape — the loop seen on 106 after a forced hyperspace dropped it below the tile.
			*/
			const canClear =
				top &&
				!world.isBlocked(plan_assault.col, plan_assault.row, 'absorb') &&
				world.canHit(top.col, top.row, top.aimHeight) &&
				world.canSeeFrom(body.col, body.row, body.height, top.col, top.row, top.height - plan_assault.tileHeight);
			if (canClear) {
				return { action: 'absorb', ...aimAt(top), label: 'clear the assault tile' };
			}
		}

		// 3. Any Sentry in range, whatever the purse says: same 3 energy as a Synthoid, and one
		//    fewer thing sweeping the ground we still have to cross.
		const sentry = this.reachable(world, body, o => o.type === GameObjType.SENTRY);
		if (sentry) return { action: 'absorb', ...aimAt(sentry), label: 'absorb SENTRY' };

		/*
		 3b. Being looked at: move on rather than stopping to shop.

		 Reported from watching the demo, and it is a rung-ordering fault rather than a missing rung.
		 Absorbing outranks walking, so while a tree is in reach and the purse is under the top-up
		 threshold the bot will *always* eat rather than move — and a watcher draining us never rotates
		 away (engine/watcher.ts's drainLocked). One point a second in, one point a second out: a stable
		 equilibrium the bot has no reason to leave, and it stands in it until something else kills it.
		 "Sometimes it eventually escapes, often not."

		 Deliberately NOT the flee rung, which has measured negative six times (BOT.md). That one fires
		 on cone contact and *adds* a journey, spending two or three actions and the current intention on
		 a trip the bot had not planned. This adds nothing: it takes the very step the walk was going to
		 return at rung 5 anyway, one rung earlier, and only when standing still is actively costing
		 energy. If the walk has nowhere to go the ladder carries on to the harvest exactly as before, so
		 the bot never ends up doing *less* than it did.

		 Pre-perch only. From the perch the answer to being seen is to finish, not to wander.

		 **Afford the whole hop, not just the next action.** The first version checked only that this
		 second's create was payable, and landscape 16 is what that costs: seven energy, in sight, so it
		 laid a boulder (-2), was drained to four, built the body (-3), was drained to nothing, and died
		 one action short of a transfer it had already paid five for. Without the rung it tops up first
		 and wins by seventeen.

		 A hop under a cone costs the hop *plus what the watcher takes while you make it*, and the second
		 term is the one that was missing. Both scale with the pile: `2n + 3` to build it, and about
		 `n + 2` actions at a point a second to be drained through. Below that, topping up first is not
		 grazing — it is the only way to arrive solvent.

		 Price what REMAINS, not the whole hop, or the gate re-creates the very loop it closes. Charging
		 the full price every decision means a hop that is already half paid for gets refused: on 16 the
		 bot topped up to eight, laid the boulder, dropped to five, and was then told a five-energy hop
		 costs eight — so it stood on a half-built hop grazing at a net zero, which is where this rung
		 came in. What is left is what matters, and it shrinks as the work is done.

		 Falling through therefore cannot loop either: it leads to the harvest, which *raises* the purse
		 while the remaining cost stays fixed, so every decision spent topping up brings the hop closer.
		 The bot tops up and then leaves.
		*/
		if (!this.perch && world.isInSight(body.col, body.row)) {
			const escape = this.plan ?? chooseDestination(world, plan_assault, this.hopField, prefer, world.energy, MAX_FIELD_CLIMB_BOULDERS);
			const step = escape ? planStep(world, escape) : null;
			if (escape && step && world.energy >= remainingHopCost(world, escape)) {
				this.plan = escape;
				logEvent('bot', 'moveOn', { from: `${body.col}_${body.row}`, to: `${escape.col}_${escape.row}` });
				return step;
			}
		}

		/*
		 3c. On the perch and being drained: FINISH.

		 Reported from watching (2026-08-24): perched, one action from winning, drained by a watcher —
		 and grazing trees instead. Drain a point, absorb a tree, repeat. The reporter saw it hold for
		 the rest of several landscapes, escaping only when the reachable trees ran out.

		 **The purse cannot grow while a watcher is draining you.** A tree is +1, the drain is -1 per
		 watcher per second, and a draining watcher never rotates away (engine/watcher.ts's drainLocked).
		 So harvesting under a drain is not slow progress towards the jump — it is exactly zero, and
		 negative the moment a second watcher joins. There is no threshold here to tune and no purse
		 large enough to make waiting pay: the equilibrium is stable by construction.

		 Worse, the supply refills at precisely the rate it is consumed. Every successful drain spawns a
		 conservation tree somewhere, so the watcher draining us is restocking the shelf we are eating
		 from — see HARVEST_BUDGET, whose comment names this loop and treats 80 decisions as an adequate
		 backstop. It is not: 80 decisions is 80 seconds of the 1 Hz cadence, most of
		 DEMO_LEVEL_LIMIT_MS, and on ground flat enough that every new tree lands in view the bound is
		 the only thing that ever ends it. A landscape already won gets recorded as `out-of-clock` — and
		 now, with three strikes, blacklisted.

		 This is the rule rung 3b above already states and never implemented: *"From the perch the answer
		 to being seen is to finish, not to wander."* Not wandering was enforced; finishing was not.

		 Deliberately NOT gated on the endgame being affordable. Standing here poor is not a reason to
		 keep grazing, because grazing cannot make us richer — and absorbing the Sentinel is +4, more
		 than any tree, and stops that watcher for good if it was the one draining us. If the finish
		 then fails on energy we lose a landscape we were losing anyway; if it succeeds we win one the
		 backstop would have spent on the clock.

		 **It fires for exactly one decision per landscape.** Its first step is always `absorb the
		 Sentinel`, and the moment that lands `world.sentinelAbsorbed` makes the guard at the top of
		 decide() own the whole rest of the run unconditionally — drained or not. So this is a one-shot
		 trigger that pulls the finish forward, not a second control regime running alongside the
		 harvest, and the most it can cost is the jump that the remaining harvest would have banked.

		 Scoped to standing ON the perch, where planEndgame's steps are known-reachable — canAssaultFrom
		 accepted this tile, which is what makes the pedestal aimable from it. Being drained while out on
		 an errand is the same futility with a different answer (go home, not finish), and is left alone:
		 planEndgame does not test reachability, so firing it from wherever the bot happens to be standing
		 would aim at a pedestal it cannot see and blacklist the cell for the trouble.
		*/
		if (onPerch && world.isInSight(body.col, body.row)) {
			const finish = planEndgame(world, body, plan_assault);
			if (finish) {
				this.plan = null;
				logEvent('bot', 'finishUnderDrain', { at: `${body.col}_${body.row}`, energy: world.energy });
				return finish;
			}
		}

		/*
		 4. Harvest.

		 The phase split, and the whole point of this planner. Before the high ground is secured,
		 energy is for climbing and the bot only tops up when it must — banking is pointless if a
		 watcher takes the pile while we shop. Once the perch is held, everything reachable goes into
		 the purse in descending value order, because from here on the only thing energy buys is
		 distance: the jump is whatever is left when the Sentinel goes.
		*/
		const walkCost = energyCostOf(GameObjType.SYNTHOID);
		if (this.perch === null) {
			const needed = endgameCost(plan_assault.boulders) + DETOUR_RESERVE;
			if (world.energy < needed || world.energy < walkCost) {
				const top = this.reachable(world, body, () => true);
				if (top) return { action: 'absorb', ...aimAt(top), label: `absorb ${GameObjType[top.type]}` };
			}
		} else if (this.harvestDecisions < HARVEST_BUDGET) {
			const pick = this.reachable(world, body, () => true);
			if (pick) {
				this.harvestDecisions++;
				return { action: 'absorb', ...aimAt(pick), label: `harvest ${GameObjType[pick.type]} (+${valueOf(pick)})` };
			}
		}

		/*
		 5. Walk. Where to depends on what is still outstanding: up to the assault tile while the high
		    ground is still to be taken, out to whatever is left to collect once it is held, and back to
		    the perch when the landscape is empty.
		*/
		const errand = this.perch && this.harvestDecisions < HARVEST_BUDGET ? this.nextErrand(world, body) : null;
		this.errand = errand;

		// Standing on the perch with nothing left to fetch: this is the finish.
		if (onPerch && !errand) {
			this.plan = null;
			return planEndgame(world, body, plan_assault);
		}

		/*
		 Off the perch with nothing left to fetch: GO HOME.

		 Landscape 7632, reported from watching: all seven Sentries absorbed, 37 energy against a maxJump
		 of 44, standing one square from its own perch — and doing nothing at all until the watchdog wrote
		 the landscape off. A DEADLOCK BETWEEN TWO RULES THAT ARE EACH CORRECT.

		 The bot had built a body beside the perch as an errand destination and transferred into it, which
		 makes the perch its `previousBody`. From there:

		 - `chooseTransfer` (rung 1) filters `previousBody` out, so it cannot transfer back. That filter
		   is what stops a two-body oscillation, and it is right to be there.
		 - rung 2 refuses to reclaim the previous body when it is the perch, because the perch body is the
		   way back up. Also right.
		 - the walk cannot help either: getting home the ordinary way means BUILDING a body on the perch
		   tile, and canPlace refuses it — the perch body is already standing there.

		 And `game.previousSynthoidCol/Row` is never cleared, so nothing but a transfer can change it, and
		 no transfer is available. Permanent, and deterministic: three attempts in a row looked identical.

		 chooseTransfer's own comment already lists "the perch we are coming home to" as one of the four
		 reasons to move into a body. The case exists; the `previousBody` filter simply runs first and eats
		 it. Two right guards in the wrong order.

		 WHY THE FIX LIVES HERE AND NOT IN THAT FILTER. Exempting the perch there would fire at rung 1,
		 before the harvest — and the outbound leg of a perch/body pair can be taken on
		 `o.height > body.height` while the return leg is always allowed by `goingHome`, so the two
		 together are a cycle with no asymmetry to break it. That is precisely what the filter prevents.
		 Placed here, after the harvest has declined and the errand list has come back empty, there is
		 nothing left to oscillate with: the only thing this can do is go home, and once home the branch
		 above takes the finish on the very next decision.

		 Falls through to the walk when there is no body to come home to — a watcher having eaten the perch
		 body is exactly the case where building on the tile works, because it is empty now — or when the
		 crosshair cannot reach it from here.
		*/
		if (!onPerch && !errand && this.perch) {
			const home = this.perch;
			const homeBody = world.objects.find(
				o =>
					o.type === GameObjType.SYNTHOID &&
					o.col === home.col &&
					o.row === home.row &&
					!isBody(o, body) &&
					topAt(world, o.col, o.row) === o &&
					!world.isBlocked(o.col, o.row, 'transfer') &&
					world.canTarget(o.col, o.row) &&
					world.canHit(o.col, o.row, o.aimHeight)
			);
			if (homeBody) {
				this.plan = null;
				logEvent('bot', 'goHome', { from: `${body.col}_${body.row}`, to: `${home.col}_${home.row}` });
				return { action: 'transfer', ...aimAt(homeBody), label: 'transfer home to the perch' };
			}
		}

		/*
		 Cut off from the high ground altogether: jump rather than walk at it hopefully.

		 A tile with no entry in the hop field is one from which no sequence of hops reaches the field's
		 seed. The walk cannot tell — with no hop count it falls back to straight-line scoring and sets off
		 at something it can never arrive at, which is what landscape 390 is: a start in a pocket, seven
		 connected tiles in the whole landscape, and a bot spending its purse walking toward them.

		 B4 changed what this means without changing the test, and for the better. The field used to be
		 seeded on one nominated tile, so "cut off" partly meant "cut off from a tile chosen badly, before
		 the terrain was known" — the hatch was compensating for the survey. It is now seeded from the whole
		 band, so `!connected` means there is no route from here to *anywhere* the Sentinel could be taken
		 from. That is a fact about the terrain, not an artifact of a guess, and it is worth keeping.

		 A no-progress test was tried in its place — hyperspace after N decisions without the feet getting
		 higher — on the argument that being connected is not the same as making progress. It measured
		 **177/250 against 182**, and the mechanism is visible once stated: a tall pile legitimately costs
		 six or seven decisions before it lifts anything, so the test fired on tiles where the bot was doing
		 exactly the right thing and jumped it away from nearly-finished towers. Reverted; recorded in
		 PLAN-BOT2.md rather than left to be reinvented.

		 Bounded, because a landing can be another pocket and the hatch must not become a loop.
		*/
		const connected = this.hopField.has(tileIndex(body.col, body.row));
		const canPlayAfterJump = world.energy >= HYPERSPACE_COST + energyCostOf(GameObjType.SYNTHOID);
		if (!connected && !this.perch && canPlayAfterJump && this.hatchJumps < MAX_HATCH_JUMPS) {
			// Charged per landing, not per proposal: a refused hyperspace leaves us where we were, and
			// counting those exhausted the budget in three consecutive decisions on landscape 35 without
			// the bot ever leaving the tile.
			if (!this.hatchedAt || this.hatchedAt.col !== body.col || this.hatchedAt.row !== body.row) {
				this.hatchJumps++;
				this.hatchedAt = { col: body.col, row: body.row };
			}
			this.plan = null;
			logEvent('bot', 'hatch', { from: `${body.col}_${body.row}`, reachable: this.hopField.size, jumps: this.hatchJumps });
			return { action: 'hyperspace', col: body.col, row: body.row, aimHeight: body.height, label: 'cut off — hyperspace out' };
		}

		/*
		 A goal, and a hop field actually built for it — which had drifted apart, and the band-seeded
		 field turned the mismatch from a quiet limit into a deadlock.

		 chooseDestination grades progress lexicographically: fewer hops to the field's target, or the
		 same hops and a whole cell nearer the goal. That is only coherent when the field and the goal are
		 the same place. They were not: the field was the route to the assault objective while the goal, on
		 an errand, was some tree across the map — so the hops term pulled one way and the distance term
		 another, and a candidate with more hops was refused however much closer it got us to the spoils.
		 Harvesting was quietly confined to whatever hop band the bot already stood in.

		 Seeding the field from the whole band made that fatal rather than merely limiting. The zero set is
		 now every tile the Sentinel could be taken from — sixty-odd on an open landscape — and nothing can
		 have fewer hops than zero, so the moment the bot stood on any of them the walk could accept no
		 tile at all. Landscape 100: perched, thirty-three energy in hand, an errand eleven cells away, and
		 sixty seconds of "nothing" until the watchdog called it.

		 So B4's change is confined to the climb: while there is no perch the goal is the assault tile and
		 the field is the band ladder that leads to it. From the perch onward, both are exactly what they
		 were — a field built for the committed tile.

		 That last part is deliberate and was measured. Pairing the errand with its own goal (an empty
		 field, so straight-line progress) *looks* like the obvious fix for the mismatch, and it made things
		 much worse: 22/102 against 51. The reason is worth recording, because it is the opposite of what
		 the mismatch reads like. Confining the harvest to the assault tile's hop band was accidentally
		 load-bearing — it kept the bot near its perch. Freed of it, the bot walked off after distant
		 spoils, and then rung 1's "transfer into any body higher than this one" clause kept dragging it
		 further out; on landscape 100 it wandered to the far corner with `hops: null`, off the field
		 entirely, and never came home. There is no reliable route home in the movement model, and until
		 there is, the confinement is what stands in for one.
		*/
		/*
		 4b. BUILD THE ASSAULT PILE.

		 Reported from watching the demo on landscape 330: right after taking the only Sentry the bot fell
		 into a shell-to-shell shuffle, hyperspacing out and climbing back six times over 158 seconds, and
		 won only because a random hop eventually left it standing high enough.

		 The gap is between two boulder counts that were never connected. `plan_assault.boulders` is the
		 pile the ASSAULT needs — bouldersToSee against the pedestal top. `chooseDestination` sizes its
		 destinations for CLIMBING, one boulder when the hop needs one and otherwise none, and the goal's
		 own count is used for nothing but scoring. So every hop delivered the bot onto band tiles bare.
		 On 330 the pedestal sits at 9, the assault needs an eye above 10, and the best ground on the map
		 is height 9 — bare eye 9.875, short by an eighth of a unit, on every tile it could reach. One
		 boulder anywhere in the band would have finished it, and nothing ever planned one.

		 Building where it already stands is not an option and never will be: isPlanViable treats a plan on
		 the current tile as achieved, because the movement model only gains height by building on another
		 tile and transferring up. So the fix is to make the aim tile a destination in its own right,
		 carrying its own pile, rather than a scoring hint the walk rounds down to zero.

		 Ordered after the reclaim rungs (a body left behind is still worth 3 on the way past) and before
		 the walk, so an affordable assault outranks another lateral shuffle. Priced on what REMAINS of the
		 job, the same test rung 3b uses: charging the full price every decision would refuse a half-built
		 pile, which is the grazing loop that rung exists to close.

		 GATED ON ALREADY BEING IN THE BAND (hops 0), which the first cut was not, and that cost 8
		 landscapes on the verdict block with `watchdog-stalled` up 7. Unrestricted, the rung fires
		 during the ordinary climb too: the aim tile is often viable from far away, so the bot abandoned
		 approaching it in favour of laying its whole five-boulder pile at range, burning the purse on a
		 tower it then could not reach. The pathology being fixed is specifically "standing in the band,
		 cannot assault, and the walk has nothing left to improve" — so that is the only place it fires.
		*/
		const inBand = this.hopField.get(tileIndex(body.col, body.row)) === 0;
		if (inBand && !this.perch && !(body.col === plan_assault.col && body.row === plan_assault.row)) {
			const pile: BotPlan = { col: plan_assault.col, row: plan_assault.row, boulders: plan_assault.boulders };
			/*
			 Graded, which until 2026-08-24 it was not — and this rung commits the largest pile in the run.
			 isPlanViable's exposure test refuses a tile a cone is on now, the same rule the walk below has
			 always applied to a one-boulder hop, and `prefer` here is already sized to this pile because
			 !this.perch on this branch. Without it the bot laid its assault tower into a live cone and the
			 drain phase ate the body between building it and transferring in: five energy, every time.
			*/
			if (isPlanViable(world, pile, body, prefer)) {
				const step = planStep(world, pile);
				if (step && world.energy >= remainingHopCost(world, pile)) {
					this.plan = pile;
					this.deadDecisions = 0;
					logEvent('bot', 'assaultPile', { at: `${pile.col}_${pile.row}`, boulders: pile.boulders });
					return step;
				}
			}
		}

		const goal = errand ?? { col: plan_assault.col, row: plan_assault.row, tileHeight: plan_assault.tileHeight, boulders: plan_assault.boulders };
		const destination =
			this.plan ?? chooseDestination(world, goal, this.perch ? this.assaultField : this.hopField, prefer, world.energy, MAX_FIELD_CLIMB_BOULDERS);
		const walk = destination ? planStep(world, destination) : null;
		if (destination && walk && world.energy >= energyCostOf(createdType(walk.action))) {
			this.plan = destination;
			this.deadDecisions = 0;
			if (this.perch) this.harvestDecisions++;
			return walk;
		}
		// The body is up but still materialising, so it cannot be entered yet (planStep). Hold the
		// intention and do nothing for a tick rather than falling through to the hyperspace rung,
		// which would jump away from a hop already paid for.
		if (destination && !walk) {
			// Waiting for a body to finish materialising is not being stuck.
			this.plan = destination;
			this.deadDecisions = 0;
			return null;
		}

		/*
		 6. Nothing legal or affordable. Hyperspacing out is a real position, not a safety net: on the
		    map's floor with every neighbour higher there is no legal move at all.

		 Two conditions on it, both learned from landscape 35, where the bot jumped at energy 9 and was
		 dead four jumps later.

		 **Not on one bad decision.** The walk failing once is usually transient — a cone crossing the
		 only good tile, a body still materialising, a create the crosshair happened to refuse. On 35 the
		 bot had nine energy and a plan the decision before, hit one dead decision, and jumped. Wait for
		 the walk to fail STUCK_BEFORE_JUMPING times in a row so the answer is "there is nothing here"
		 rather than "there was nothing this second".

		 **And only if we can still play afterwards.** A jump costs 3 and lands somewhere random; arriving
		 with less than a body's worth in hand means arriving unable to do anything at all, which is not
		 an escape but a slower death — and worse, the landing may be another pocket, so the next rung
		 jumps again. On 35 that chain ran 9 -> 6 -> ... -> 2, each jump paid for with energy that was the
		 only thing that could have climbed.
		*/
		this.deadDecisions++;
		const canPlayOnLanding = world.energy >= HYPERSPACE_COST + energyCostOf(GameObjType.SYNTHOID);
		if (this.deadDecisions >= STUCK_BEFORE_JUMPING && canPlayOnLanding && !this.perch) {
			this.plan = null;
			this.deadDecisions = 0;
			return { action: 'hyperspace', col: body.col, row: body.row, aimHeight: body.height, label: 'boxed in — hyperspace out' };
		}
		// On the perch the answer is never to jump away from it — finish with what we have.
		if (onPerch) return planEndgame(world, body, plan_assault);
		return null;
	}

	/*
	 The key the driver watches for staleness — the one give-up test no planner can make for itself
	 (engine/bot.ts's MAX_PLAN_DECISIONS: a watcher eating a pile as fast as it is laid looks
	 tick-by-tick exactly like progress, and only elapsed time reveals it).

	 Deliberately *not* keyed on the phase, which it used to be. The phase is now re-derived every
	 decision and HARVEST and RETURN alternate freely as the bot walks out and back, so including it
	 made the key flicker — and a key that changes resets the driver's counter, which quietly switches
	 the backstop off exactly when a bot is thrashing. What does not flicker is whether the high ground
	 has been taken, so that is what prefixes the plan's cell: 'A' while still climbing, 'P' once the
	 perch is held. Monotone, with one reset, at a point where the reason for the plan genuinely changed.
	*/
	intention(): string | null {
		return this.plan ? `${this.perch ? 'P' : 'A'}:${this.plan.col}_${this.plan.row}` : null;
	}

	abandon(): void {
		this.plan = null;
	}

	/*
	 The committed assault tile, or null while still climbing.

	 Read-only, and for tests rather than for the driver: "has it committed yet, and to where" is the one
	 fact about B4 that cannot be inferred from the step a decision returns, and a test that cannot see it
	 can only assert the absence of some label — which is how the deleted re-survey test managed to pass
	 for its whole life without the mechanism it named ever existing.
	*/
	committedTile(): { col: number; row: number } | null {
		return this.assault ? { col: this.assault.col, row: this.assault.row } : null;
	}

	private isPerch(col: number, row: number): boolean {
		return this.perch !== null && this.perch.col === col && this.perch.row === row;
	}

	/*
	 The tile we would assault from if we had to choose now.

	 Cheapest pile first, nearest to break ties, sightline confirmed against the real raycast — and
	 recomputed every decision from where the bot currently stands, which is what makes it an aim rather
	 than a commitment. Affordable at 1 Hz because the candidate list is built once per landscape and the
	 sightline answers are cached: a tile's view of the pedestal top depends only on the height map.

	 Restricted to the band, so it can only ever propose a pile the bot could actually fund. Past the
	 ascent budget the restriction is dropped — at that point any answer beats none, and the rungs
	 downstream need a tile to reserve, clear and finish on.
	*/
	private aimAt(
		world: BotWorld,
		body: NonNullable<BotWorld['body']>,
		excludeStanding = false,
		prefer?: TilePreference
	): AssaultPlan | null {
		if (!this.pedestal) return null;
		const pool = this.decisions < ASCEND_BUDGET && this.band.length > 0 ? this.band : this.candidates;
		/*
		 The tile underfoot is not somewhere to aim — see the caller. Only ever set by the aim that the
		 rest of the decision navigates by, never by the commit gate above, which needs to know whether
		 there is anywhere worth assaulting from *including here*: excluding it there would have the bot
		 arrive on the only good tile in the landscape, with its pile built, and refuse to commit.
		*/
		const exclude = excludeStanding ? new Set([tileIndex(body.col, body.row)]) : undefined;
		return findAssaultTile(world, { candidates: pool, sightlines: this.sightlines, from: body, exclude, prefer });
	}

	/*
	 Nothing to aim at anywhere on the landscape — no band tile's sightline holds, and no candidate's
	 either. Rare, and previously the end of the run: the old guard returned null here and kept doing so.
	 Jumping is at least a fresh draw, and doing nothing is the one option guaranteed not to work.
	*/
	private lastResort(world: BotWorld, body: NonNullable<BotWorld['body']>): BotStep | null {
		if (world.energy < HYPERSPACE_COST || this.hatchJumps >= MAX_HATCH_JUMPS) return null;
		this.hatchJumps++;
		this.plan = null;
		logEvent('bot', 'hatch', { from: `${body.col}_${body.row}`, reason: 'no assault tile anywhere' });
		return { action: 'hyperspace', col: body.col, row: body.row, aimHeight: body.height, label: 'nowhere to assault — hyperspace out' };
	}

	// See the Phase comment: a readout derived from state plus what this decision did, never stored.
	private phaseOf(world: BotWorld, step: BotStep | null): Phase {
		const body = world.body;
		if (world.sentinelAbsorbed) return 'FINISH';
		if (!this.perch) return 'ASCEND';
		if (body && this.isPerch(body.col, body.row) && !this.errand) return 'FINISH';
		// Walking out to fetch something, or absorbing what an errand brought into reach, against
		// coming home to the perch with the landscape picked clean.
		if (this.errand || step?.label.startsWith('harvest')) return 'HARVEST';
		return 'RETURN';
	}

	/*
	 A body worth moving into: nearer the goal, higher than we stand, the one we are walking to, or
	 the perch we are coming home to.

	 Tested against the body's *tile*, not its own height. Transferring only needs the crosshair to
	 find the Synthoid — game/actions.ts applies no line-of-sight test of its own, and pickTarget
	 will happily resolve something above the eye where isCellVisibleFrom refuses outright. That is
	 exactly what makes the perch reachable from below.
	*/
	private chooseTransfer(world: BotWorld, body: BotBodyLike, assault: AssaultPlan): BotObject | null {
		const previous = world.previousBody;
		const home = this.perch;
		return (
			world.objects
				.filter(o => o.type === GameObjType.SYNTHOID && !isBody(o, body))
				.filter(o => !world.isBlocked(o.col, o.row, 'transfer'))
				.filter(o => world.canTarget(o.col, o.row))
				.filter(o => !(previous && o.col === previous.col && o.row === previous.row))
				.filter(o => topAt(world, o.col, o.row) === o)
				.find(o => {
					const goingHome = home !== null && o.col === home.col && o.row === home.row;
					const planned = this.plan !== null && o.col === this.plan.col && o.row === this.plan.row;
					/*
					 SOMEWHERE WE HAVE ALREADY STOOD BUYS NOTHING, and this is the guard that has to be a
					 set rather than a single cell.

					 Landscape 9194, reported from watching as three synthoids with the bot looping
					 through them (postscript 20). Three bodies at hops 0 — 7_13@8.5, 9_17@9, 10_9@9.5,
					 against an assault aim at 7_15 — and the two surviving clauses below order them in
					 OPPOSITE directions inside the band: 7_13 -> 9_17 -> 10_9 each accepted for being
					 higher though each is farther from the goal, and 10_9 -> 7_13 accepted for being
					 closer at equal hops. A cycle of length three, every leg free, and it ran for 67
					 seconds until a watcher ate one of the three bodies and left a pair the
					 `previousBody` filter could close.

					 That filter is the same guard one step deep — its own comment calls it "what stops a
					 two-body oscillation" — so this is not a new rule but the general form of the one
					 already here. And the argument is about POSITION, not about the loop: every option a
					 cell offers was on the table while we were standing in it, so returning cannot open
					 anything the decisions taken there did not already see. The exceptions are the two
					 moves that mean something on their own — the perch we are coming home to, and a body
					 we deliberately built at the plan's destination — and both are already named here.
					*/
					const stoodHere = this.visited.has(tileIndex(o.col, o.row));
					/*
					 CLOSER IN HOPS, NOT IN A STRAIGHT LINE — the same lesson computeHopField taught the
					 walk, in the one place that never learned it.

					 This read `distance(o, assault) < distance(body, assault)` until landscape 9950
					 (2026-08-25, reported from watching as "it insists on transferring to an abandoned
					 synthoid at the bottom of a pit"). It is exactly that: the pit sat five cells from the
					 pedestal in a straight line against the assault tile's ten, so a body abandoned down
					 there was permanently "closer" — and permanently unreachable, its tile having no entry
					 in the hop field at all. The bot climbed the whole ladder to hops 0, transferred down
					 into the pit, hyperspaced out, climbed back, and did it again. Three full cycles before
					 the clock ended it.

					 chooseDestination's own comment says why straight lines cannot be trusted here: hops
					 "stops the bot strolling into a pocket that is near the goal but not connected to it
					 (the old straight-line greedy did exactly that, then looped until the Sentinel killed
					 it)". Same pocket, same loop, reached by transferring rather than walking.

					 Lexicographic (hops, distance), matching that function exactly: an unreachable tile is
					 Infinity and so never closer than anywhere we can actually stand, and the straight-line
					 tiebreak still moves us along within a hop band — which is the half that has to stay,
					 since on open ground every tile in sight of the goal shares one hop count.

					 The field is chosen the way the walk chooses it: the band ladder while climbing, the
					 route home to the perch once one is held.
					*/
					const field = this.perch ? this.assaultField : this.hopField;
					const hopsOf = (col: number, row: number) => field.get(tileIndex(col, row)) ?? Infinity;
					const ourHops = hopsOf(body.col, body.row);
					const theirHops = hopsOf(o.col, o.row);
					const closer =
						theirHops < ourHops ||
						(theirHops === ourHops &&
							distance(o.col, o.row, assault.col, assault.row) <
								distance(body.col, body.row, assault.col, assault.row));
					return (
						(goingHome || planned || (!stoodHere && (closer || o.height > body.height))) &&
						world.canSeeFrom(body.col, body.row, body.height, o.col, o.row, 0) &&
						world.canHit(o.col, o.row, o.aimHeight)
					);
				}) ?? null
		);
	}

	/*
	 The most valuable thing we can actually shoot from here, ties broken by closeness.

	 Value first is the human rule ("absorb anything you can, in descending energy value order"), and
	 it costs nothing to follow: absorbing needs line of sight from where we already stand, so this
	 is a choice among things already in reach rather than a decision about where to go.

	 Anything load-bearing is off the list — the pile at our destination, the assault tile's pile,
	 and the perch body, which is the way back up.
	*/
	private reachable(world: BotWorld, body: BotBodyLike, want: (o: BotObject) => boolean): BotObject | null {
		/*
		 Load-bearing, so off the menu: the pile at our destination and the pile on the *committed*
		 assault tile are both there on purpose, and the perch body is the way home.

		 Reads `this.assault` rather than the decision's aim, and the difference matters now that the two
		 can disagree. An aim is a guess about where we might end up, and reserving a pile on a tile we have
		 not committed to would protect boulders that are not ours from a harvest that should eat them —
		 while the pile actually being built is `this.plan`, which is reserved on its own account.

		 Note *what* is reserved on those tiles rather than the tiles themselves. Only boulders and bodies
		 are ours; anything else standing there is an obstacle the landscape put in the way, and reserving
		 it is how landscape 42 deadlocked — a Sentry generated on the assault tile was skipped by the
		 Sentry rung and the harvest rung alike, so the one tile the whole plan depended on could never be
		 cleared, the perch was never reached, and the bot wandered until it took the hyperspace hatch.
		*/
		const assault = this.assault;
		const ours = (o: BotObject) => o.type === GameObjType.BOULDER || o.type === GameObjType.SYNTHOID;
		const reserved = (o: BotObject) =>
			ours(o) &&
			((assault !== null && o.col === assault.col && o.row === assault.row) ||
				this.isPerch(o.col, o.row) ||
				(this.plan !== null && o.col === this.plan.col && o.row === this.plan.row));

		const candidates = world.objects
			.filter(o => valueOf(o) > 0 && want(o))
			.filter(o => !isBody(o, body))
			.filter(o => !world.isBlocked(o.col, o.row, 'absorb'))
			.filter(o => world.canTarget(o.col, o.row))
			.filter(o => !reserved(o))
			.filter(o => topAt(world, o.col, o.row) === o)
			.map(o => ({ o, d: distance(o.col, o.row, body.col, body.row) }))
			.sort((a, b) => valueOf(b.o) - valueOf(a.o) || a.d - b.d);

		let tested = 0;
		for (const { o } of candidates) {
			if (tested++ >= MAX_VISIBILITY_TESTS) break;
			if (!world.canHit(o.col, o.row, o.aimHeight)) continue;
			const yOffset = o.height - world.map[tileIndex(o.col, o.row)];
			if (!world.canSeeFrom(body.col, body.row, body.height, o.col, o.row, yOffset)) continue;
			return o;
		}
		return null;
	}

	/*
	 Somewhere worth walking to for what is left on the ground, or null when the landscape is spent.

	 Deliberately cheap and greedy: the nearest tile holding something absorbable that we are not
	 standing on. The walk itself does the work of getting there, and the harvest rung collects
	 whatever comes into view on the way — so this only has to point roughly at the remaining value,
	 not plan a route around it.
	*/
	private nextErrand(
		world: BotWorld,
		body: BotBodyLike
	): { col: number; row: number; tileHeight: number } | null {
		if (world.energy < energyCostOf(GameObjType.SYNTHOID) + DETOUR_RESERVE) return null;
		// Only ever called from the perch, so the assault tile is committed by now — but read defensively
		// rather than asserted, since it is null for the whole of the climb.
		const assault = this.assault;
		const spoils = world.objects
			.filter(o => valueOf(o) > 0)
			.filter(o => !isBody(o, body))
			.filter(o => !this.isPerch(o.col, o.row))
			.filter(o => !(assault !== null && o.col === assault.col && o.row === assault.row))
			.filter(o => !world.isBlocked(o.col, o.row, 'absorb'))
			.filter(o => world.canTarget(o.col, o.row))
			.filter(o => !(o.col === body.col && o.row === body.row))
			.map(o => ({ o, d: distance(o.col, o.row, body.col, body.row) }))
			.sort((a, b) => a.d - b.d);
		const target = spoils[0];
		if (!target) return null;
		return { col: target.o.col, row: target.o.row, tileHeight: world.map[tileIndex(target.o.col, target.o.row)] };
	}
}

// The shape chooseTransfer/reachable need of the body — the same fields BotWorld['body'] carries.
type BotBodyLike = NonNullable<BotWorld['body']>;
