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
	bouldersToSee,
	computeHopField,
	distance,
	endgameCost,
	findAssaultTile,
	tileIndex,
	HYPERSPACE_COST,
	MAX_VISIBILITY_TESTS,
	type AssaultPlan,
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
 How many times the assault tile may be abandoned for another. Each re-survey is the most expensive
 thing the planner does (a line-of-sight sweep over every flat tile), and a landscape that has burnt
 three of them is not one more choice away from being won.
*/
const MAX_RESURVEYS = 3;
// Consecutive decisions spent unable to clear a fouled assault tile before it is written off. Two
// is a coincidence — a watcher mid-drain, a moment out of line — and five is a wall.
const CLEAR_ATTEMPTS_BEFORE_GIVING_UP = 5;

// What absorbing something is worth, which is what "descending energy value order" ranks by.
const VALUE: Partial<Record<GameObjType, number>> = {
	[GameObjType.SENTRY]: 3,
	[GameObjType.SYNTHOID]: 3,
	[GameObjType.MEANIE]: 3,
	[GameObjType.BOULDER]: 2,
	[GameObjType.TREE]: 1,
};
const valueOf = (o: BotObject) => VALUE[o.type] ?? 0;

type Phase = 'ASCEND' | 'CLEAR' | 'HARVEST' | 'RETURN' | 'FINISH';

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
	private harvestDecisions = 0;
	private phase: Phase = 'ASCEND';
	/*
	 Assault tiles proved unusable, and how many times we may give up on one.

	 There is exactly one assault tile and every plan aims at it, so a tile that cannot be cleared is
	 otherwise the end of the landscape — which is what 106 looked like: a drain turned the pile into
	 a tree, the bot was hyperspaced below it, and it then proposed the same impossible absorb until
	 the clock ran out. Re-surveying costs a full sweep of line-of-sight tests, hence the cap.
	*/
	private rejectedTiles = new Set<number>();
	private blockedClears = 0;
	private resurveys = 0;

	survey(world: BotWorld): void {
		this.assault = findAssaultTile(world, this.rejectedTiles);
		if (this.assault) this.hopField = computeHopField(world, this.assault);
		logEvent('bot', 'survey', {
			...this.assault,
			reachableTiles: this.hopField.size,
			planner: 'v2',
			attempt: this.resurveys,
		});
	}

	/*
	 Give up on the current assault tile and find another.

	 Everything derived from it goes: the hop field is a distance map *to* that tile, the plan was a
	 step towards it, and the perch was it. Returns false when there is nothing left to try, which
	 leaves the caller to play on with the tile it has rather than with none at all.
	*/
	private resurvey(world: BotWorld): boolean {
		if (!this.assault || this.resurveys >= MAX_RESURVEYS) return false;
		logEvent('bot', 'resurvey', { col: this.assault.col, row: this.assault.row, reason: 'unclearable' });
		this.rejectedTiles.add(tileIndex(this.assault.col, this.assault.row));
		this.resurveys++;
		const previous = this.assault;
		this.plan = null;
		this.perch = null;
		this.survey(world);
		if (!this.assault) {
			// Nothing better exists — put the old one back rather than being left with no goal.
			this.assault = previous;
			return false;
		}
		return true;
	}

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
			phase: this.phase,
			energy: world.energy,
			at: body ? `${body.col}_${body.row}@${body.height}` : null,
			perch: this.perch ? `${this.perch.col}_${this.perch.row}` : null,
			inPos: body && assault ? inAssaultPosition(body, assault) : null,
			// Why the endgame is or isn't available, which is the question from here on.
			needs: assault ? `${assault.col}_${assault.row}>${assault.pedestalHeight + 1}` : null,
			plan: this.plan ? `${this.plan.col}_${this.plan.row}x${this.plan.boulders}` : null,
			did: step?.label ?? 'nothing',
		});
		return step;
	}

	private choose(world: BotWorld): BotStep | null {
		const body = world.body;
		const assault = this.assault;
		if (!body || !assault) return null;

		// Absorption is locked from the Sentinel onwards, so the finish owns the rest of the run.
		if (world.sentinelAbsorbed) {
			this.setPhase('FINISH');
			this.plan = null;
			return planEndgame(world, body, assault);
		}

		/*
		 The perch is wherever the endgame becomes possible, not the tile the survey nominated: the
		 climb often ends somewhere else that sees the pedestal just as well, and insisting on the
		 nominated tile makes the bot walk away from a winning position (canAssaultFrom).

		 When that place *isn't* the nominated tile, the survey is re-pointed at it rather than just
		 remembered. Everything downstream reads the assault plan — where the walk goes home to, which
		 tile must be kept clear, which pile is load-bearing — and leaving those aimed at the old tile
		 is worse than not having moved at all: measured on landscape 600, the bot latched a perch one
		 tile over, went harvesting, and then spent 147 decisions walking back to a tile it could not
		 use. The hop field is a distance map *to* the goal, so it has to be rebuilt with it.
		*/
		if (!this.perch && canAssaultFrom(world, body, assault)) {
			this.perch = { col: body.col, row: body.row };
			if (body.col !== assault.col || body.row !== assault.row) {
				const tileHeight = world.map[tileIndex(body.col, body.row)];
				this.assault = {
					...assault,
					col: body.col,
					row: body.row,
					tileHeight,
					boulders: bouldersToSee(tileHeight, assault.pedestalHeight + 1),
				};
				this.hopField = computeHopField(world, this.assault);
				logEvent('bot', 'repoint', { from: `${assault.col}_${assault.row}`, to: `${body.col}_${body.row}` });
			}
		}
		// The assault plan as it now stands, which the re-point above may just have moved.
		const plan_assault = this.assault!;
		// Sized to the work: climbing to the assault tile means laying its whole pile, while an
		// errand is a bare body and a transfer.
		const prefer = coverPreference(world, this.perch ? 0 : plan_assault.boulders);
		const onPerch = this.perch !== null && body.col === this.perch.col && body.row === this.perch.row;

		// A viable intention survives every rung below: a Sentry worth taking or a body worth
		// reclaiming is a detour, not a change of mind.
		if (this.plan && !isPlanViable(world, this.plan, body)) this.plan = null;

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

		// 2. Reclaim the body just left behind, +3 — what makes the create-and-transfer walk cost
		//    nothing net. Never the perch body: that one is the way back up.
		const previous = world.previousBody;
		if (previous && !this.isPerch(previous.col, previous.row)) {
			const top = topAt(world, previous.col, previous.row);
			if (top && top.type === GameObjType.SYNTHOID && !isBody(top, body) && world.canHit(top.col, top.row, top.aimHeight)) {
				return { action: 'absorb', ...aimAt(top), label: 'reclaim previous body' };
			}
		}

		// 2b. Clear the assault tile of anything that isn't ours — drain residue (a tree, a meanie)
		//     or, on landscape 42, a Sentry the generator put there. The bot only ever builds
		//     boulders and bodies, so anything else up there is in the way, and while it stays the
		//     one tile the whole plan depends on cannot be built on at all.
		const fouled = world
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
		if (sentry) {
			this.setPhase(this.perch ? 'CLEAR' : this.phase);
			return { action: 'absorb', ...aimAt(sentry), label: 'absorb SENTRY' };
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
				this.setPhase('HARVEST');
				this.harvestDecisions++;
				return { action: 'absorb', ...aimAt(pick), label: `harvest ${GameObjType[pick.type]} (+${valueOf(pick)})` };
			}
		}

		/*
		 5. Walk. Where to depends on the phase: up to the assault tile while the high ground is
		    still to be taken, out to whatever is left to collect once it is held, and back to the
		    perch when the landscape is empty.
		*/
		const errand = this.perch && this.harvestDecisions < HARVEST_BUDGET ? this.nextErrand(world, body) : null;
		if (this.perch && errand === null && !onPerch) this.setPhase('RETURN');
		else if (this.perch && errand) this.setPhase('HARVEST');
		else if (!this.perch) this.setPhase('ASCEND');

		// Standing on the perch with nothing left to fetch: this is the finish.
		if (onPerch && !errand) {
			this.setPhase('FINISH');
			this.plan = null;
			return planEndgame(world, body, plan_assault);
		}

		const goal = errand ?? { col: plan_assault.col, row: plan_assault.row, tileHeight: plan_assault.tileHeight, boulders: plan_assault.boulders };
		const destination = this.plan ?? chooseDestination(world, goal, this.hopField, prefer);
		const walk = destination ? planStep(world, destination) : null;
		if (destination && walk && world.energy >= energyCostOf(createdType(walk.action))) {
			this.plan = destination;
			if (this.perch) this.harvestDecisions++;
			return walk;
		}
		// The body is up but still materialising, so it cannot be entered yet (planStep). Hold the
		// intention and do nothing for a tick rather than falling through to the hyperspace rung,
		// which would jump away from a hop already paid for.
		if (destination && !walk) {
			this.plan = destination;
			return null;
		}

		// 6. Nothing legal or affordable. Hyperspacing out is a real position, not a safety net: on
		//    the map's floor with every neighbour higher there is no legal move at all.
		if (world.energy >= HYPERSPACE_COST && !this.perch) {
			this.plan = null;
			return { action: 'hyperspace', col: body.col, row: body.row, aimHeight: body.height, label: 'boxed in — hyperspace out' };
		}
		// On the perch the answer is never to jump away from it — finish with what we have.
		if (onPerch) return planEndgame(world, body, plan_assault);
		return null;
	}

	intention(): string | null {
		return this.plan ? `${this.phase}:${this.plan.col}_${this.plan.row}` : null;
	}

	abandon(): void {
		this.plan = null;
	}

	private isPerch(col: number, row: number): boolean {
		return this.perch !== null && this.perch.col === col && this.perch.row === row;
	}

	private setPhase(phase: Phase): void {
		if (phase === this.phase) return;
		logEvent('bot', 'phase', { from: this.phase, to: phase });
		this.phase = phase;
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
				.filter(o => !(previous && o.col === previous.col && o.row === previous.row))
				.filter(o => topAt(world, o.col, o.row) === o)
				.find(o => {
					const goingHome = home !== null && o.col === home.col && o.row === home.row;
					const planned = this.plan !== null && o.col === this.plan.col && o.row === this.plan.row;
					const closer =
						distance(o.col, o.row, assault.col, assault.row) < distance(body.col, body.row, assault.col, assault.row);
					return (
						(goingHome || planned || closer || o.height > body.height) &&
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
		const assault = this.assault!;
		/*
		 Load-bearing, so off the menu: the pile at our destination and the pile on the assault tile
		 are both there on purpose, and the perch body is the way home.

		 Note *what* is reserved on those tiles rather than the tiles themselves. Only boulders and
		 bodies are ours; anything else standing there is an obstacle the landscape put in the way,
		 and reserving it is how landscape 42 deadlocked — a Sentry generated on the assault tile was
		 skipped by the Sentry rung and the harvest rung alike, so the one tile the whole plan
		 depends on could never be cleared, the perch was never reached, and the bot wandered until
		 it took the hyperspace hatch.
		*/
		const ours = (o: BotObject) => o.type === GameObjType.BOULDER || o.type === GameObjType.SYNTHOID;
		const reserved = (o: BotObject) =>
			ours(o) &&
			((o.col === assault.col && o.row === assault.row) ||
				this.isPerch(o.col, o.row) ||
				(this.plan !== null && o.col === this.plan.col && o.row === this.plan.row));

		const candidates = world.objects
			.filter(o => valueOf(o) > 0 && want(o))
			.filter(o => !isBody(o, body))
			.filter(o => !world.isBlocked(o.col, o.row, 'absorb'))
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
		const assault = this.assault!;
		const spoils = world.objects
			.filter(o => valueOf(o) > 0)
			.filter(o => !isBody(o, body))
			.filter(o => !this.isPerch(o.col, o.row))
			.filter(o => !(o.col === assault.col && o.row === assault.row))
			.filter(o => !world.isBlocked(o.col, o.row, 'absorb'))
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
