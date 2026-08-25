/*
 How the bot moves: the intention it holds, and how it picks the next tile.

 Shared by every planner (PLAN-BOT2.md, B3), because none of this is strategy — it is what the game
 makes possible. Two facts define the whole movement model and neither is negotiable:

  - A tile above the eye can't be targeted at all, so the bot can never hop upward. Height is only
    ever gained by piling boulders on a tile it can already see and transferring onto them.
  - Piling is cheap per level but not free (2 energy a boulder, recoverable only if the pile is
    still visible later), so climbing one level at a time beats one tall pile: three single-level
    climbs cost 3 boulders where one three-level pile costs 5.

 What a planner *does* choose is where it would rather stand, which arrives as a TilePreference —
 v1 ranks by present exposure, v2 by how long the cover lasts.
*/

import { GameObjType, MAP_SIZE } from '../world/terrain';
import { energyCostOf } from './rules';
import { bouldersToOutrank, distance, tileIndex, EYE_HEIGHT, MAX_VISIBILITY_TESTS } from './botGeometry';
import type { BotAction, BotBody, BotObject, BotStep, BotWorld } from './botWorld';

/*
 Of the visible candidates, how many to run the pricier exposure test on before settling for the
 best exposed one.

 Generous on purpose — equal to the visibility budget, so the exposed fallback is only ever reached
 when *every* reachable candidate is watched.

 Candidates are ordered by distance to the goal, so the best ones are all neighbours, and when that
 neighbourhood is covered it tends to be covered wholesale. A small budget samples a dozen tiles
 from inside one watched patch, learns nothing, and walks in anyway. That is expensive in a way that
 isn't obvious: a body built on a watched tile can be eaten by the drain phase in the second between
 building it and transferring in, and the rules refuse a transfer into a body already being drained
 — so the bot pays 5 energy for a stepping stone it never gets to use.
*/
const MAX_SAFETY_TESTS = 64;

/*
 How much a planner would like to stand on a tile, purely on exposure: 0 is best.

 The seam between "how movement works" and "what this planner is afraid of". v1 grades in three
 present-tense steps (unwatched / in some watcher's line of sight / under a cone right now); v2 asks
 how many ticks of cover the tile still has. Anything above `reject` is taken only when nothing
 better exists at all, since standing still is worse than being seen.
*/
export interface TilePreference {
	grade(col: number, row: number): number;
	reject: number;
	/*
	 Grades at or above this are never chosen, even when nothing else is available.

	 The difference between a bad tile and an impossible one. Normally the walk takes the least-bad
	 candidate, because standing still is worse than being seen — but a tile a cone is on *right now*
	 is not merely bad: the drain phase runs at 1 Hz and takes the topmost Synthoid, so a body built
	 there is eaten before the transfer can complete. Five energy for nothing, every time, and on
	 landscape 246 that is the entire opening purse spent twice over in five seconds.

	 Omitted means no ceiling, which is v1's behaviour unchanged.
	*/
	avoid?: number;
}

// v1's grading, kept as the default so the incumbent's behaviour is unchanged by the split.
export const presentExposure = (world: BotWorld): TilePreference => ({
	grade: (col, row) => (world.isInSight(col, row) ? 2 : world.isWatched(col, row) ? 1 : 0),
	reject: 0,
});

/*
 What the bot is in the middle of doing: occupy (col, row) standing on `boulders` boulders.

 This is the memory the ladder spent a long time doing without, and every loop worth the name came
 from its absence. Deciding afresh each tick means inferring past intent from present world state,
 and the world does not record intent: boulders on a tile could be a pile being built or a pile half
 eaten, a Synthoid could be the body we are walking to or one we abandoned two hops back. Each of
 those cost a rewrite and a heuristic constant to paper over. Holding the intention makes them facts.

 An intention rather than a script of three actions, deliberately. The next action is re-derived
 from it every tick, so a boulder eaten mid-sequence is simply rebuilt, where a recorded list of
 actions would march on regardless. Same commitment, no brittleness.
*/
export interface BotPlan {
	col: number;
	row: number;
	boulders: number;
}

// A destination under consideration, scored before any raycast is spent on it.
interface Candidate {
	col: number;
	row: number;
	tileHeight: number;
	hops: number;
	score: number;
}

/*
 Is a plan still worth pursuing? The give-up conditions, in the order they're cheapest to test.

 Only the ones that make the plan *impossible* or *pointless* belong here. Being short of energy
 does not: the harvest rung earns it and the plan waits. Nor does a better destination appearing —
 changing target every time something marginally better turns up is the oscillation this whole
 mechanism exists to stop.

 `prefer` is optional and opt-in, because it changes behaviour and v1's sweep is the yardstick every
 measurement in PLAN-BOT2.md is compared against. Supplied, it adds the exposure test below.
*/
export function isPlanViable(world: BotWorld, plan: BotPlan, body: BotBody, prefer?: TilePreference): boolean {
	// Achieved: we're standing on it.
	if (plan.col === body.col && plan.row === body.row) return false;

	/*
	 Exposed: a cone has arrived on the destination since we chose it.

	 The gap this closes, reported from watching the demo: "it insists on building on a watched cell
	 where what it builds gets absorbed immediately". Destination cover *is* graded — coverPreference
	 refuses a tile a cone is on outright — but only by chooseDestination, and chooseDestination is not
	 re-run while a plan holds. So a plan latched on a tile that was clear went on being built after a
	 watcher turned onto it, one boulder a second into a drain that ate them just as fast.

	 Not fatal on its own, which is why it survived: the pile is rebuilt rather than lost, and the
	 staleness backstop eventually breaks the loop. But it is an unbounded energy leak at 2 a boulder,
	 and energy is options — every point spent here is a body not built somewhere safe later.

	 Graded against the work *remaining*, not the whole job: `prefer` is built with the pile height the
	 caller cares about, so a plan two boulders from done is not abandoned for cover that outlasts it.
	*/
	if (prefer?.avoid !== undefined && prefer.grade(plan.col, plan.row) >= prefer.avoid) return false;

	const stack = world.objectsAt(plan.col, plan.row);
	// Fouled: a drain has turned part of our pile into a tree, or a meanie has wandered on. The
	// stack can never take another boulder, so the plan is dead however much of it we built.
	if (stack.some(o => o.type !== GameObjType.BOULDER && o.type !== GameObjType.SYNTHOID)) return false;
	// Note there is no "stolen" test: a body a watcher has started eating leaves the snapshot at
	// once (engine/bot.ts filters absorbed objects out), so theft shows up as the stack simply
	// being shorter than we left it — and planStep rebuilds, which is the right answer to losing
	// one boulder. Losing them faster than we can lay them is caught by the driver's staleness
	// backstop instead, since no single tick of that looks like failure.
	// Overbuilt: something else got there first and the pile can't be finished as planned.
	if (stack.length > plan.boulders + 1) return false;
	/*
	 Refused: the crosshair has already proved it can't put anything there. Commitment without
	 this is stubbornness — the plan holds the bot on the tile and it re-aims at the same
	 obstruction every decision. Cheap to detect, since the driver is recording these anyway, and
	 the record clears whenever the body moves and the geometry changes.
	*/
	if (world.isBlocked(plan.col, plan.row, 'create-boulder')) return false;
	if (world.isBlocked(plan.col, plan.row, 'create-synthoid')) return false;
	// Unreachable: we've been moved (a forced hyperspace, say) and can no longer work on it.
	if (world.map[tileIndex(plan.col, plan.row)] >= body.height + EYE_HEIGHT) return false;
	if (!world.canSeeFrom(body.col, body.row, body.height, plan.col, plan.row, 0)) return false;
	return true;
}

// The action that advances a plan: another boulder while the pile is short, then the body that
// goes on top. Moving into it is rung 1's business on a later tick.
export function planStep(world: BotWorld, plan: BotPlan): BotStep | null {
	const stack = world.objectsAt(plan.col, plan.row);
	const top = topAt(world, plan.col, plan.row);
	const aimHeight = top ? top.aimHeight : world.map[tileIndex(plan.col, plan.row)];
	const { col, row } = plan;
	if (stack.length < plan.boulders) {
		return { action: 'create-boulder', col, row, aimHeight, label: `raise pile ${stack.length + 1}/${plan.boulders}` };
	}
	/*
	 The body is already standing there and the only thing left is to move into it, which is the
	 transfer rung's business — so there is nothing to do this tick.

	 Null rather than proposing the create again, which is what this used to do and cost a slot on
	 every hop of every landscape. A body spends about a second growing into place (the spawn
	 animation), and for that second the crosshair cannot resolve it, so the transfer rung declines
	 and the walk was asked what to do next. It answered "build the body" — an action the rules then
	 refused, because a stack takes only one item. That much was merely wasteful; the damage was what
	 followed, since a refused step blacklists (create-synthoid, cell), and isPlanViable treats a
	 blacklisted cell as a dead plan. The bot therefore threw away its own intention immediately
	 after achieving it, once per hop, for as long as this planner has existed.
	*/
	if (top && top.type === GameObjType.SYNTHOID) return null;
	return { action: 'create-synthoid', col, row, aimHeight, label: 'body at destination' };
}

// Top of the stack on a cell, or null. Mirrors engine/scene.ts's topObjectAt over the snapshot.
export function topAt(world: BotWorld, col: number, row: number): BotObject | null {
	const stack = world.objectsAt(col, row);
	return stack.length > 0 ? stack[stack.length - 1] : null;
}

export const isBody = (o: BotObject, body: BotBody | null) => body !== null && o.col === body.col && o.row === body.row;

/*
 Choose where to move next.

 Two things constrain this and between them they define the whole movement model:

  - A tile above the eye can't be targeted at all, so the bot can never hop upward. Height is
    only ever gained by piling boulders on a tile it can already see and transferring onto them.
  - Piling is cheap per level but not free (2 energy a boulder, recoverable only if the pile is
    still visible later), so climbing one level at a time beats one tall pile: three single-level
    climbs cost 3 boulders where one three-level pile costs 5.

 So: prefer a lateral hop that gets closer to the goal, and climb only when no such hop exists.
 Returns the destination tile plus how many boulders to raise on it before moving in.
*/
/*
 How tall a pile the purse can actually finish, given the body still has to be paid for on top of it.

 Landscape 7398, reported from watching (2026-08-25): the opening needs a three-boulder tower, which
 leaves 1 energy; the bot transfers up, reclaims the body it left (+3) and, with FOUR in hand, plans a
 one-boulder hop — 2 for the boulder and 3 for the body, five, against four. It lays the boulder, is
 left with two, cannot pay for the body, and stops. Permanently: nothing clears `this.plan`, the
 harvest has nothing in reach, and rung 6's hyperspace needs six. A plain body on the same tile costs
 three, was affordable, and would have unstuck it — after the hop it reclaims the body (+3) and the
 boulder under it (+2) and is solvent again.

 The walk's own gate cannot catch this: it asks whether the NEXT action is payable, which is the
 mistake landscape 16 taught rungs 3b and 4b to stop making. But pricing the whole hop is not enough
 on its own either — at four energy every hop with a boulder in it is unaffordable, so a gate alone
 would refuse to move at all and stall just as hard. What is needed is a CHEAPER HOP, and that is this:
 the pile is sized to what is left after the body is paid for.

 Deliberately NOT the change PLAN-BOT2.md's postscript 8 measured and reverted, which dropped the climb
 boulder whenever the destination was already above our feet — a geometric rule, firing on every hop,
 that bought an opening at the cost of an ascent (`never-reached-assault-position` 123 -> 150). This is
 a solvency rule. It fires only when the purse genuinely cannot fund the pile, changes nothing whenever
 the bot has money, and its worst case is a hop that gains no height where the alternative is a hop
 that never completes.
*/
function affordablePile(budget: number | undefined, wanted: number, required: number): number {
	if (budget === undefined) return wanted;
	const priceOf = (n: number) => n * energyCostOf(GameObjType.BOULDER) + energyCostOf(GameObjType.SYNTHOID);
	if (budget >= priceOf(wanted)) return wanted;
	/*
	 ONLY THE DISCRETIONARY BOULDER MAY GO. Two earlier versions of this were wrong, both found on
	 landscape 6313 within minutes of shipping, and both worth recording because the arithmetic looked
	 obviously right each time.

	 Capping the count at what the purse could buy: bouldersToOutrank returns the SMALLEST pile that
	 lifts the feet above where we stand, so every count below it tops out at or under our own height
	 and gains NOTHING. On 6313 the climb needed five and eleven energy bought four — the bot spent
	 eight energy raising a tower exactly level with itself, stepped sideways onto it and arrived in a
	 pocket, broke. A shortened pile is the one option never worth buying.

	 Dropping the pile entirely instead: on the same landscape the destination sits two levels BELOW,
	 so without its pile the move is not a climb at all but a fall. The bot built a plain body down
	 there, transferred into a tile with no hop-field entry, and spent the rest of the run proposing a
	 hyperspace the rules refused fifty-nine times, nothing being at or below its new height.

	 What is genuinely optional is `chooseDestination`'s climb-while-you-walk floor — the Math.max(1, …)
	 that adds a boulder when bouldersToOutrank already returns 0, i.e. when the destination is at or
	 above our feet and the terrain is doing the climbing (see PLAN-BOT2.md postscript 8, which measured
	 that floor as load-bearing and kept it). Dropping THAT leaves a plain lateral hop, which is a real
	 move and pays for itself once the body and boulder left behind are reclaimed. It is the reported
	 7398 case exactly. Everything else is structural: keep it, and let the harvest top up.
	*/
	if (required < wanted && budget >= priceOf(required)) return required;
	return wanted;
}


export function chooseDestination(
	world: BotWorld,
	goal: { col: number; row: number; tileHeight: number; boulders?: number },
	hopField: Map<number, number>,
	prefer: TilePreference = presentExposure(world),
	// Purse to size piles against. Optional so v1 (game/bot.ts) is untouched, the same pattern
	// isPlanViable's `prefer` uses — omitted means "plan the pile the move wants and never mind
	// whether it can be paid for", which is the behaviour every call site had before 2026-08-25.
	budget?: number
): { col: number; row: number; boulders: number } | null {
	const body = world.body;
	if (!body) return null;
	const previous = world.previousBody;
	// Hops from where we stand. Unknown means the field never reached us, so fall back to
	// straight-line scoring rather than refusing to move at all.
	const hopsOf = (col: number, row: number) => hopField.get(tileIndex(col, row)) ?? Infinity;
	const currentHops = hopsOf(body.col, body.row);
	const currentDistance = distance(body.col, body.row, goal.col, goal.row);

	const candidates: Candidate[] = [];
	for (let row = 0; row < MAP_SIZE - 1; row++) {
		for (let col = 0; col < MAP_SIZE - 1; col++) {
			if (col === body.col && row === body.row) continue;
			// Never head back to the cell we just left. Rung 1 refuses to transfer there (that way
			// lies pacing back and forth), so choosing it as a destination would build a body rung
			// 1 won't enter and rung 2 will reclaim — the build-then-eat loop again, one cell over.
			if (previous !== null && col === previous.col && row === previous.row) continue;
			if (world.isBlocked(col, row, 'create-synthoid') || world.isBlocked(col, row, 'create-boulder')) continue;
			if (!world.isFlat(col, row)) continue;
			if (!world.canPlace(col, row, GameObjType.SYNTHOID)) continue;
			const tileHeight = world.map[tileIndex(col, row)];
			// Above the eye: unreachable however much we'd like it.
			if (tileHeight >= body.height + EYE_HEIGHT) continue;
			// Hops first — that's the one that knows about dead ends. Straight-line distance only
			// separates tiles the field considers equally far, and height breaks the rest.
			//
			// Nothing here tries to guess whether a pile on a tile is one we started: that was a
			// scoring bonus once, tuned twice, and wrong both times. Commitment is a plan now.
			candidates.push({
				col,
				row,
				tileHeight,
				hops: hopsOf(col, row),
				score: hopsOf(col, row) * 1000 + distance(col, row, goal.col, goal.row) - tileHeight * 0.5,
			});
		}
	}
	candidates.sort((a, b) => a.score - b.score);

	/*
	 Pass 1: a hop that gets us measurably closer along the graph we can actually walk.

	 Progress is lexicographic — fewer hops, or the same hops but a whole cell nearer. Both halves
	 earn their place. Hops alone is what stops the bot strolling into a pocket that is near the
	 goal but not connected to it, which is what left it looping until the Sentinel got it. But
	 hops alone is also far too coarse: on open ground every tile in sight of the goal is 1 hop
	 from it, so "strictly fewer hops" would only ever accept the goal tile itself, and the bot
	 would freeze the moment that one tile was watched or blocked. The distance tiebreak keeps it
	 moving within a hop band; the whole-cell threshold keeps that from becoming a shuffle.
	*/
	const improves = (c: Candidate) =>
		c.hops < currentHops ||
		(c.hops === currentHops && distance(c.col, c.row, goal.col, goal.row) <= currentDistance - 1);
	let approach = pickVisible(world, body, candidates, improves, prefer);

	/*
	 Nothing found — but that may mean nothing was *tried*. The ordering above is by progress, so
	 the front of the list is the tiles nearest the goal, which from a standing start are the far
	 side of the landscape and out of sight. The visibility budget gets spent proving we can't see
	 any of them and never reaches the perfectly good tile two cells away, so the bot returns no
	 step at all and idles until something kills it. Nine of a hundred landscapes ended that way:
	 survey fine, then not one action attempted in four minutes.

	 So try again nearest-first. Same acceptance test — every candidate still has to make progress
	 — but the budget now goes on tiles we have some prospect of reaching.
	*/
	if (!approach) {
		const byProximity = [...candidates].sort(
			(a, b) =>
				distance(a.col, a.row, body.col, body.row) - distance(b.col, b.row, body.col, body.row)
		);
		approach = pickVisible(world, body, byProximity, improves, prefer);
	}
	if (approach) {
		/*
		 Climb while you walk. If the goal is above us we are going to have to gain height sooner
		 or later, and a boulder on the tile we're moving to anyway is far cheaper than a separate
		 trip: the bot used to hop onto higher ground, then spend a whole second cycle (boulder,
		 body, transfer) raising itself on a neighbouring tile. One boulder folded into the hop
		 does both at once. bouldersToOutrank already returns 0 for a tile above our feet, so the
		 floor of 1 is what makes the hop gain the extra half level rather than just the terrain's.

		 The floor was made conditional once — skip the boulder where the destination is already above our
		 feet, since the terrain is doing the climbing — and reverted. It measured +3 of 1000 in
		 aggregate, which looked like a small win and was not: `never-reached-assault-position` went
		 123 -> 150 at the same time, and what the total was really showing was a saving in the opening
		 paid for by a bot that then could not climb. The original reasoning here was right; it was only
		 wrong to think it was unconditional.

		 What it costs is real and is the price of the rule: a boulder is 2 energy and is recoverable
		 only while something stands on it, so a hop that gains half a level on ground that was already
		 rising can strand 2 energy behind a ridge. See PLAN-BOT2.md's postscript 8, including one
		 explanation that was offered for the revert and then measured false — the boulder is *not* a
		 better aim anchor, because either way exactly one create per hop is aimed at bare terrain.
		*/
		const tileHeight = world.map[tileIndex(approach.col, approach.row)];
		const outrank = bouldersToOutrank(tileHeight, body.height);
		const climbing = body.height < goal.tileHeight ? Math.max(1, outrank) : 0;
		// `outrank` is the pile the move structurally needs; `climbing` may add the discretionary
		// climb-while-you-walk boulder on top. Only the difference between them is ever dropped.
		const boulders = affordablePile(budget, pileAt(approach, goal, climbing), pileAt(approach, goal, outrank));
		return { col: approach.col, row: approach.row, boulders };
	}

	// Pass 2: nothing closer is reachable, so we're walled in by height — climb.
	//
	// Ordered by height here, not by distance: a pile has to lift the eye above where it already
	// is to reveal anything new, and raising one on a tile below us wastes boulders doing nothing
	// but catching back up (three to climb from one level down, where a tile level with us needs
	// one). Highest first, nearest the goal to break ties.
	if (body.height < goal.tileHeight) {
		const byHeight = [...candidates].sort(
			(a, b) =>
				b.tileHeight - a.tileHeight ||
				distance(a.col, a.row, goal.col, goal.row) - distance(b.col, b.row, goal.col, goal.row)
		);
		const step = pickVisible(world, body, byHeight, () => true, prefer);
		if (step) {
			const tileHeight = world.map[tileIndex(step.col, step.row)];
			// No discretionary boulder on this path — pass 2 climbs only what it must — so the pile
			// here is structural throughout and affordablePile can never trim it.
			const climb = bouldersToOutrank(tileHeight, body.height);
			const pile = pileAt(step, goal, climb);
			return { col: step.col, row: step.row, boulders: affordablePile(budget, pile, pile) };
		}
	}
	return null;
}

/*
 How tall to raise the pile at a destination.

 Normally just what the move itself needs — nothing for a lateral hop, enough to out-rank our
 feet for a climb. The goal tile is the exception: arriving there is the assault, and the pile
 has to be tall enough to see over the pedestal, which the bot cannot fix afterwards because it
 would then be standing on the very tile it needs to build up.
*/
function pileAt(
	tile: { col: number; row: number },
	goal: { col: number; row: number; boulders?: number },
	needed: number
): number {
	return tile.col === goal.col && tile.row === goal.row ? Math.max(needed, goal.boulders ?? 0) : needed;
}

// Walk pre-scored candidates in order, testing line of sight (and then watcher exposure on the
// best few) until something usable turns up. Returns the first unwatched visible candidate, or
// the best visible one if they're all exposed — standing still is worse than being seen.
function pickVisible(
	world: BotWorld,
	body: BotBody,
	candidates: Candidate[],
	accept: (c: Candidate) => boolean,
	prefer: TilePreference
): { col: number; row: number } | null {
	let tested = 0;
	let safetyTests = 0;
	// Best candidate seen at each grade above the acceptable one, so that if nothing acceptable
	// turns up we take the least bad rather than nothing — standing still is worse than being seen.
	const fallbacks = new Map<number, { col: number; row: number }>();

	for (const c of candidates) {
		if (!accept(c)) continue;
		if (tested++ >= MAX_VISIBILITY_TESTS) break;
		if (!world.canSeeFrom(body.col, body.row, body.height, c.col, c.row, 0)) continue;
		const grade = prefer.grade(c.col, c.row);
		if (grade <= prefer.reject) return { col: c.col, row: c.row };
		// Not even as a last resort — see TilePreference.avoid.
		if (prefer.avoid !== undefined && grade >= prefer.avoid) continue;
		if (!fallbacks.has(grade)) fallbacks.set(grade, { col: c.col, row: c.row });
		// Every candidate returned has been exposure-checked; once the budget for those runs out we
		// stop and take a fallback, rather than returning an unchecked tile that might be worse than
		// one already rejected.
		if (++safetyTests >= MAX_SAFETY_TESTS) break;
	}
	const best = [...fallbacks.keys()].sort((a, b) => a - b)[0];
	return best === undefined ? null : fallbacks.get(best)!;
}


// Where to point the crosshair for a step aimed at an object.
export const aimAt = (o: BotObject) => ({ col: o.col, row: o.row, aimHeight: o.aimHeight });

// What a create-* action puts on the ground, for costing it.
export const createdType = (action: BotAction) =>
	action === 'create-boulder' ? GameObjType.BOULDER : action === 'create-tree' ? GameObjType.TREE : GameObjType.SYNTHOID;
