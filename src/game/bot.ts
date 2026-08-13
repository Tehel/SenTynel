/*
 The v1 demo-mode planner: a priority ladder over one snapshot of the world.

 Pure — no `three` at runtime, no scene access. Everything it needs arrives through BotWorld
 (game/botWorld.ts), which engine/bot.ts builds per decision, so this file is testable against a
 synthetic landscape with no renderer involved. The shared arithmetic — pile formulas, the assault
 survey, the reachability field — lives in game/botGeometry.ts, so a challenger planner can use the
 same definitions without importing this one.

 The bot's planning is omniscient: it reads the whole landscape, not just what it can see. Its
 *execution* is not — every step it returns still has to survive the crosshair raycast, the
 energy rules and the 1 Hz cadence on the engine side.
*/

import { GameObjType, MAP_SIZE } from '../world/terrain';
import { energyCostOf } from './rules';
import { logEvent } from './log';
import {
	bouldersToOutrank,
	bouldersToSee,
	distance,
	endgameCost,
	eyeHeightOn,
	computeHopField,
	findAssaultTile,
	tileIndex,
	BOULDER_HEIGHT,
	EYE_HEIGHT,
	HYPERSPACE_COST,
	MAX_VISIBILITY_TESTS,
	type AssaultPlan,
} from './botGeometry';
import type { BotAction, BotBody, BotObject, BotPlanner, BotStep, BotWorld } from './botWorld';
import {
	aimAt,
	chooseDestination,
	createdType,
	isBody,
	isPlanViable,
	planStep,
	topAt,
	type BotPlan,
} from './botMovement';
import { inAssaultPosition, planEndgame } from './botEndgame';

export type { BotPlan };

// Energy kept in hand beyond what the endgame strictly costs. Covers the transient 3 of each
// create-synthoid before the body left behind is absorbed back, plus a watcher drain or two.
const ENERGY_MARGIN = 8;

// What the ladder decided: the action to take now, and what it means to be doing next tick.
// LadderPlanner below holds the plan; the functions stay pure.
export interface BotDecision {
	step: BotStep | null;
	plan: BotPlan | null;
}

// Absorbing this would be worth doing: trees (1), sentries (3, and they stop draining us once
// gone) and boulders (2). Never the Sentinel — that's the endgame's, and taking it locks
// absorption for the rest of the level — and never a pedestal, which can't be absorbed at all.
//
// Boulders matter more than they look: every climb strands the one it stood on, and a landscape
// walked end to end can leave a dozen of them lying around. That's 20-odd energy abandoned on
// the floor by a bot that then dies two points short of the endgame.
// Synthoids are on the list too, and for the same reason as boulders. Reclaiming the body we
// just left is rung 2, but that only ever tracks *one* cell — game.previousSynthoidCol/Row is
// overwritten by the next transfer, so a body left two hops back is orphaned for good at 3
// energy a time. Anything genuinely worth standing in has already been taken by rung 1, so a
// synthoid still on the list here is one the bot has no further use for.
const isHarvestable = (o: BotObject) =>
	o.type === GameObjType.TREE ||
	o.type === GameObjType.SENTRY ||
	o.type === GameObjType.BOULDER ||
	o.type === GameObjType.SYNTHOID;

/*
 The decision itself, as a priority ladder. Each rung is one 1 Hz action; the bot re-plans from
 scratch afterwards, so nothing here has to be remembered between calls and a step that fails
 simply isn't chosen again next time.

 Returns null when there's nothing useful to do — the driver treats that as idling, not failure.
*/
export function planNextStep(
	world: BotWorld,
	assault: AssaultPlan | null,
	hopField: Map<number, number>,
	// What we were doing last tick, or null to decide freely. An argument rather than a field on
	// BotWorld: the world is what the driver can see, and this is the planner's own memory — see
	// LadderPlanner, which is where it is actually kept.
	current: BotPlan | null = null
): BotDecision {
	const body = world.body;
	if (!body) return { step: null, plan: null };
	const previous = world.previousBody;
	// The plan survives every rung below except the ones that finish or invalidate it — a Sentry
	// worth taking or a body worth reclaiming is a detour, not a change of mind.
	const plan = current && isPlanViable(world, current, body) ? current : null;
	const carry = (step: BotStep | null): BotDecision => ({ step, plan });

	// 0. The endgame, once we're standing high enough on the assault tile to look down on the
	//    pedestal. Everything below is about getting here; this is the five actions that finish
	//    the landscape, and it outranks the lot.
	//
	//    sentinelAbsorbed keeps it in charge for the rest of the run. Without it the bot steps
	//    onto the pedestal, is no longer "in assault position", and hands control back to the
	//    walk — which promptly transfers it off the pedestal again, having no idea it was one
	//    action from winning.
	if (assault && (world.sentinelAbsorbed || inAssaultPosition(body, assault))) {
		// The walk is over; anything it was still intending is irrelevant now.
		const endgame = planEndgame(world, body, assault);
		if (endgame) return { step: endgame, plan: null };
	}

	/*
	 A flee rung sat here: when a watcher's cone was on our tile, transfer into a body already in
	 cover, or build one somewhere safe. It reads like an obvious win. Five variants were measured
	 and every one of them lost ground:

	     flee whenever a cone touches us          -4 landscapes of 20
	     the same, only below 8 energy            -1 of 20
	     only into cover that already exists       0 of 20, and never once fired
	     only when the alternative is break-even  -6 of 102
	     refuge chosen by predicted cover         -6 of 102  (45 against 51)
	     the walk takes cover instead of progress -6 of 102, and -11 of 250 on 3000-3249

	 The fourth is the sharpest trigger there is — standing in a cone costs a point a second and a
	 tree pays a point a second, so harvesting trees under fire nets exactly nothing, and a watcher
	 with something to drain never rotates away. Even that lost six landscapes (1700, 3000, 3100,
	 4200, 5800, 9900) and gained none.

	 The fifth answered the obvious objection to the other four: with only a present-tense exposure
	 test the bot could not tell a second of cover from a minute of it, so it was fleeing blind.
	 BotWorld.ticksUntilSeen removes that excuse — the schedule is exact rather than estimated, see
	 game/cone.ts — and the result did not move.

	 Counted from a trace of 4200, which the baseline wins and this loses: the rung fired eleven
	 times against four pile-raises and dropped the plan six times. Every landscape it lost shows
	 the same signature, more transfers than the baseline and no more progress.

	 So the cost is not the energy, which reclaiming mostly returns, and it was never where the bot
	 ran to. It is the action budget and the plan: at 1 Hz a flight is two or three seconds not
	 spent advancing, and it discards the intention this planner exists to hold. Prediction earns
	 its keep ranking tiles the bot was going to visit anyway; it cannot make an extra journey pay.

	 The sixth was the narrowest form there is: no rung at all, just the walk allowed to accept a
	 covered tile that makes no progress, while standing in a cone. It reuses the hop, the plan and
	 the reclaim, so it adds no journey — and it still lost six of 102 and eleven of 250. Whatever
	 the mechanism, retreat does not pay in this game, and it has now been asked six ways.
	*/

	/*
	 1. Move into a Synthoid that improves our position — the one we built last tick, or one the
	    landscape came with. Free, so it outranks everything below.

	    This has to come before reclaiming, not after. game.previousSynthoidCol/Row is never
	    cleared, so once we've transferred out of a cell it stays flagged as "a body of ours"
	    forever — and that cell is often exactly the one we next want to move to. Reclaiming
	    first meant building a body at the destination and immediately absorbing it as though it
	    were the old one, over and over, burning every action slot while the watchers drained us.
	    Checking the move first means a body that's worth standing in gets stood in; only a body
	    we have no use for falls through to be reclaimed.
	*/
	const move = world.objects
		.filter(o => o.type === GameObjType.SYNTHOID && !isBody(o, body))
		// A body the crosshair has already proved it can't reach — occluded by a tree or a fold
		// of ground, say. Without this the rung re-picks it every single decision and the bot
		// stands there aiming at the obstacle forever, which is exactly what it did.
		.filter(o => !world.isBlocked(o.col, o.row, 'transfer'))
		// Never target the cell we came from: it's behind us by construction, and taking it
		// would just walk the bot back and forth forever.
		.filter(o => !(previous && o.col === previous.col && o.row === previous.row))
		.filter(o => topAt(world, o.col, o.row) === o)
		.find(o => {
			if (!assault) return false;
			const closer =
				distance(o.col, o.row, assault.col, assault.row) < distance(body.col, body.row, assault.col, assault.row);
			// Against the body's *tile*, not the body's own height. Transferring only needs the
			// crosshair to find the Synthoid (game/actions.ts applies no line-of-sight test of its
			// own), and pickTarget will happily hit something above the eye — where
			// isCellVisibleFrom refuses outright. Testing the occupied height would rule out every
			// body standing on a pile, which is exactly the one the endgame has to reach.
			return (
				// The body standing at our own destination is always worth entering, whatever the
				// geometry says — it is there because we put it there. Normally redundant, since a
				// destination is chosen for being nearer or higher and its body inherits that; it
				// covers the case where a drain eats part of the pile before we move in, leaving a
				// body that is neither, which would otherwise be 3 energy nothing ever collects.
				(closer || o.height > body.height || (plan !== null && o.col === plan.col && o.row === plan.row)) &&
				world.canSeeFrom(body.col, body.row, body.height, o.col, o.row, 0) &&
				world.canHit(o.col, o.row, o.aimHeight)
			);
		});
	if (move) {
		// Moving into the body at our target is the plan completing.
		const completes = plan !== null && move.col === plan.col && move.row === plan.row;
		return { step: { action: 'transfer', ...aimAt(move), label: 'transfer onward' }, plan: completes ? null : plan };
	}

	// 2. Reclaim the body we just left: 3 energy back, which is what makes the create-and-
	//    transfer walk cost nothing net.
	if (previous && !world.sentinelAbsorbed) {
		const top = topAt(world, previous.col, previous.row);
		if (top && top.type === GameObjType.SYNTHOID && !isBody(top, body)) {
			return carry({ action: 'absorb', ...aimAt(top), label: 'reclaim previous body' });
		}
	}

	if (!assault) return carry(null);

	/*
	 2b. Clear the assault tile if a drain has fouled it.

	 A watcher chewing on our half-built pile turns the top boulder into a tree, and canPlaceAt
	 refuses a stack that isn't all boulders — so the one tile the whole plan depends on becomes
	 permanently unbuildable. chooseDestination then filters it out as a candidate, the bot heads
	 somewhere else, inAssaultPosition never comes true, and it circles for the rest of the run
	 while the junk stack sits there blocking the strategic cell.

	 A tree on the assault tile is always drain residue: the bot only ever builds boulders and
	 bodies, so anything else up there came from a watcher. Absorbing the top is both the fix and
	 a point of energy back.
	*/
	const fouled = world
		.objectsAt(assault.col, assault.row)
		.some(o => o.type !== GameObjType.BOULDER && o.type !== GameObjType.SYNTHOID);
	if (fouled && !world.sentinelAbsorbed) {
		const top = topAt(world, assault.col, assault.row);
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
			!world.isBlocked(assault.col, assault.row, 'absorb') &&
			world.canHit(top.col, top.row, top.aimHeight) &&
			world.canSeeFrom(body.col, body.row, body.height, top.col, top.row, top.height - assault.tileHeight);
		if (canClear) {
			return carry({ action: 'absorb', ...aimAt(top), label: 'clear the assault tile' });
		}
	}

	/*
	 Where we're headed. An intention already in hand is followed; only without one do we choose
	 afresh. That single line is what stops the destination oscillating, and with it the whole
	 family of loops that came from re-deciding every second: laying a boulder and harvesting it
	 back, building a body and eating it as though it were an old one.
	*/
	const destination = plan ?? chooseDestination(world, assault, hopField);
	const walk = destination ? planStep(world, destination) : null;
	// Absorbing is free and only ever gains, so an unaffordable walk is a reason to harvest in
	// its own right, quite apart from banking for the endgame. Without this the bot would sit at
	// 1 energy proposing 2-energy boulders, cycling through every candidate tile and blacklisting
	// each in turn — a busy, expensive way to stand still until the watchers finished it off.
	const affordable = walk !== null && world.energy >= energyCostOf(createdType(walk.action));
	const needed = endgameCost(assault.boulders) + ENERGY_MARGIN;

	/*
	 3. Take out a Sentry whenever one is in range, whatever the purse says. Three energy is the
	    same as a Synthoid, but a Sentry is also one fewer thing sweeping the ground we have to
	    cross — and it will not stop draining us while we save up for something else. Gating this
	    behind "am I short of energy" had the bot walking past live Sentries it could see.
	*/
	if (!world.sentinelAbsorbed) {
		const sentry = findHarvest(world, body, assault, destination, o => o.type === GameObjType.SENTRY);
		if (sentry) return carry({ action: 'absorb', ...aimAt(sentry), label: 'absorb SENTRY' });
	}

	// 4. Top up. The endgame is unforgiving — absorption locks the moment the Sentinel goes — so
	//    the bot banks what it needs before committing to the assault.
	if (!world.sentinelAbsorbed && (world.energy < needed || !affordable)) {
		const harvest = findHarvest(world, body, assault, destination);
		if (harvest) return carry({ action: 'absorb', ...aimAt(harvest), label: `absorb ${GameObjType[harvest.type]}` });
	}

	// 5. Walk. Raise the pile first if this hop is a climb, then put a body on top of it — the
	//    transfer itself comes back around on rung 1 next tick.
	if (affordable && walk && destination) return { step: walk, plan: destination };

	// The body at the destination is up but not yet enterable — see planStep. Nothing to do but
	// hold the intention for a tick and let the transfer rung take it next time round. Falling
	// through from here would reach the hyperspace rung and jump away from a hop already paid for.
	if (destination && walk === null) return { step: null, plan: destination };

	/*
	 6. Nothing left to try: hyperspace out and start again somewhere else.

	 This is the escape hatch for being boxed in, and it is a real one — a player low in a hollow
	 has no legal move at all. Nothing higher than the eye can be targeted, which rules out both
	 building on the surrounding ground and absorbing anything standing on it, and a tile at the
	 map's floor has neighbours only at its own level or above. Nine landscapes in a hundred ended
	 with the bot simply standing there for four minutes: survey fine, purse untouched at 10, not
	 one action ever attempted, the watchers never even waking because nothing triggered them.

	 pickHyperspaceTile raises its height ceiling until something fits, so this always lands us
	 somewhere flat and empty. Three energy is a real price, but standing still is a certain loss.
	*/
	if (world.energy >= HYPERSPACE_COST) {
		// Wherever we land, the old intention is meaningless.
		return {
			step: { action: 'hyperspace', col: body.col, row: body.row, aimHeight: body.height, label: 'boxed in — hyperspace out' },
			plan: null,
		};
	}
	return carry(null);
}

// Nearest absorbable thing we can actually see, skipping anything load-bearing: the pile we're
// standing up at the destination and whatever sits on the assault tile are both there on
// purpose, and eating them would undo the walk one boulder at a time.
function findHarvest(
	world: BotWorld,
	body: BotBody,
	assault: AssaultPlan,
	destination: { col: number; row: number } | null,
	want: (o: BotObject) => boolean = isHarvestable
): BotObject | null {
	// The pile we are standing up and whatever sits on the assault tile are both there on purpose.
	// With a plan in hand this is exact rather than a guess about which boulders are ours.
	// Only boulders and bodies on those tiles are ours. Anything else standing there is an obstacle
	// the landscape put in the way — a Sentry generated on the assault tile deadlocked landscape 42
	// outright, since reserving it meant neither the Sentry rung nor the harvest rung would take it
	// and the tile could never be cleared to build on.
	const ours = (o: BotObject) => o.type === GameObjType.BOULDER || o.type === GameObjType.SYNTHOID;
	const reserved = (o: BotObject) =>
		ours(o) &&
		((o.col === assault.col && o.row === assault.row) ||
			(destination !== null && o.col === destination.col && o.row === destination.row));

	const candidates = world.objects
		.filter(want)
		.filter(o => !isBody(o, body))
		.filter(o => !world.isBlocked(o.col, o.row, 'absorb'))
		.filter(o => !reserved(o))
		.filter(o => topAt(world, o.col, o.row) === o)
		.map(o => ({ o, d: distance(o.col, o.row, body.col, body.row) }))
		.sort((a, b) => a.d - b.d);

	let tested = 0;
	for (const { o } of candidates) {
		if (tested++ >= MAX_VISIBILITY_TESTS) break;
		// Cheapest disqualifier first: one ray, and it rejects the "knows it's there, can't
		// actually shoot it" case outright.
		if (!world.canHit(o.col, o.row, o.aimHeight)) continue;
		const yOffset = o.height - world.map[tileIndex(o.col, o.row)];
		if (!world.canSeeFrom(body.col, body.row, body.height, o.col, o.row, yOffset)) continue;
		return o;
	}
	return null;
}


/*
 The v1 planner as a BotPlanner: the ladder above, plus the memory it needs and the survey it
 depends on.

 This is bookkeeping the driver used to do on the planner's behalf — holding the plan between
 decisions, computing the assault tile and the hop field once per landscape, and threading the plan
 back in through BotWorld. Moving it here is what lets a second planner keep memory of an entirely
 different shape (phases, a perch, a route) without the driver knowing anything about it.

 The survey is the single most expensive thing the bot does — up to 64 line-of-sight sweeps — and
 the terrain never moves, so it happens once.
*/
export class LadderPlanner implements BotPlanner {
	private plan: BotPlan | null = null;
	private assault: AssaultPlan | null = null;
	private hopField = new Map<number, number>();

	survey(world: BotWorld): void {
		this.assault = findAssaultTile(world);
		if (this.assault) this.hopField = computeHopField(world, this.assault);
		logEvent('bot', 'survey', { ...this.assault, reachableTiles: this.hopField.size });
	}

	decide(world: BotWorld): BotStep | null {
		const decision = planNextStep(world, this.assault, this.hopField, this.plan);
		if (this.plan && !decision.plan) logEvent('bot', 'planDropped', { ...this.plan });
		else if (decision.plan && !samePlan(decision.plan, this.plan)) logEvent('bot', 'plan', { ...decision.plan });
		this.plan = decision.plan;
		return decision.step;
	}

	// Only the tile, not the pile height: raising the pile *is* progress on the same intention, and
	// counting a boulder as a change of mind would reset the staleness clock every time it worked.
	intention(): string | null {
		return this.plan ? `${this.plan.col}_${this.plan.row}` : null;
	}

	abandon(): void {
		this.plan = null;
	}
}

const samePlan = (a: BotPlan, b: BotPlan | null) => b !== null && a.col === b.col && a.row === b.row;
