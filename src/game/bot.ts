/*
 Demo-mode planner: decides what the bot should do next. Pure — no `three` at runtime, no scene
 access. Everything it needs about the world arrives through BotWorld, which engine/bot.ts
 builds per decision (the same injection shape actions.ts uses for ActionContext), so this file
 is testable against a synthetic landscape with no renderer involved.

 The bot's planning is omniscient: it reads the whole landscape, not just what it can see. Its
 *execution* is not — every step it returns still has to survive the crosshair raycast, the
 energy rules and the 1 Hz cadence on the engine side.
*/

import { GameObjType, MAP_SIZE } from '../world/terrain';
import type { GameAction } from './actions';
import { energyCostOf } from './rules';

// A boulder is half a unit tall (world/objects/models/boulder.ts; engine/scene.ts stacks them
// at objects.length / 2). The pile arithmetic below is all downstream of this one number.
const BOULDER_HEIGHT = 0.5;
// Eye height above the feet, matching engine/camera.ts's EYE_HEIGHT. Only used for the
// can-I-see-that-height arithmetic; actual line-of-sight tests go through BotWorld.canSeeFrom,
// which owns the real eye position.
const EYE_HEIGHT = 0.875;

// Energy kept in hand beyond what the endgame strictly costs. Covers the transient 3 of each
// create-synthoid before the body left behind is absorbed back, plus a watcher drain or two.
const ENERGY_MARGIN = 8;
// Candidate tiles line-of-sight tested per decision. Candidates are scored before testing, so
// the good ones are tried first and the cap only ever truncates a tail of bad options. Bounds
// the per-decision raycast cost — decisions happen at 1 Hz, not per frame.
const MAX_VISIBILITY_TESTS = 64;
// Of the visible candidates, how many to run the pricier watcher-exposure test on (one sweep
// per live watcher) before settling for the best exposed one.
//
// Generous on purpose — equal to the visibility budget, so the exposed fallback is only ever
// reached when *every* reachable candidate is watched.
//
// Candidates are ordered by distance to the goal, so the best ones are all neighbours, and when
// that neighbourhood is covered it tends to be covered wholesale. A small budget samples a dozen
// tiles from inside one watched patch, learns nothing, and walks in anyway. That is expensive in
// a way that isn't obvious: a body built on a watched tile can be eaten by the drain phase in the
// second between building it and transferring in, and the rules refuse a transfer into a body
// already being drained — so the bot pays 5 energy for a stepping stone it never gets to use.
// Half the starting purse, and it can happen twice before there's anything left to notice with.
//
// The budget is only spent when the bot is genuinely boxed in: with any unwatched tile among the
// front-runners the very first test returns, which is the overwhelmingly common case.
const MAX_SAFETY_TESTS = 64;
// Longest hop considered when building the reachability field. Bounds an O(tiles²) sweep, and
// hops much longer than this are rare in practice — the terrain gets in the way first.
const MAX_FIELD_HOP = 16;
// What a hyperspace costs (game/actions.ts). Not in the ENERGY_COST table — it creates nothing.
const HYPERSPACE_COST = 3;

export interface BotObject {
	type: GameObjType;
	col: number;
	row: number;
	// World altitude of the object's base — already includes any stack it sits on.
	height: number;
	// World Y to point the crosshair at: the middle of the model's own silhouette, so the ray
	// has the whole body to hit. Supplied by the engine adaptor, which has the mesh.
	aimHeight: number;
}

export interface BotBody {
	col: number;
	row: number;
	height: number;
	onPedestal: boolean;
}

export interface BotWorld {
	// Vertex heights, indexed row * MAP_SIZE + col — the same array as SceneData.map.
	map: number[];
	// Tile is flat (shape 0) and inside the usable 0..MAP_SIZE-2 range.
	isFlat(col: number, row: number): boolean;
	// Active objects only (absorbed-but-fading ones excluded).
	objects: BotObject[];
	objectsAt(col: number, row: number): BotObject[];
	canPlace(col: number, row: number, type: GameObjType): boolean;
	// Line of sight from a body standing on (fromCol, fromRow) with its feet at standHeight, to
	// cell (col, row) at yOffset above that cell's terrain. The adaptor adds the eye height and
	// the from-cell exclusion, so eye geometry stays in one place (engine/bot.ts).
	canSeeFrom(
		fromCol: number,
		fromRow: number,
		standHeight: number,
		col: number,
		row: number,
		yOffset: number
	): boolean;
	// Would any live watcher see a body standing on this tile? Cone direction is deliberately
	// ignored: watchers rotate, so anything in their line of sight is only safe until they turn
	// to face it. Hiding in the line-of-sight shadow is the only durable cover.
	isWatched(col: number, row: number): boolean;
	/*
	 Sharper, present-tense version: is a watcher's cone pointed at this cell *now*, with line of
	 sight? Then whatever stands here is on the drain phase's list for the next tick — a body
	 built here is likely to be eaten in the second before we can transfer into it, and the rules
	 refuse a transfer into a body already being drained. If it's true of the cell we're standing
	 on, we are the thing being drained.

	 No prediction: this is where the cones point at this instant, nothing about where they will
	 point next.
	*/
	isInSight(col: number, row: number): boolean;
	/*
	 Would the crosshair, aimed at this point, actually arrive? Not "is it visible" — that is
	 canSeeFrom, which is generous by design (it asks whether any corner of a cell is reachable).
	 This is the single centre ray the game itself resolves an action against, so it answers the
	 question that decides whether an action can work at all.

	 Worth its raycast: the bot is omniscient about where things are, so without this it will
	 happily turn to a Sentry it knows about but cannot hit, and spend a second of its 1 Hz budget
	 aiming into a hillside. That reads as a cheat from the outside, and it wastes the slot.
	*/
	canHit(col: number, row: number, aimHeight: number): boolean;
	/*
	 Has this exact action already failed at this cell? The planner has no memory between calls,
	 so without it the same losing step gets re-derived forever; the driver records failures and
	 clears them whenever the body moves and the geometry changes.

	 Keyed by action as well as cell, which matters more than it looks. A transfer can fail at a
	 cell for reasons that say nothing about absorbing there — a watcher starting to drain the
	 body a moment before we could move in, say. Blocking the whole cell then strands the five
	 energy we just spent on the pile and the body standing on it, which is half the starting
	 purse and, twice over, the entire game.
	*/
	isBlocked(col: number, row: number, action: BotAction): boolean;
	energy: number;
	body: BotBody | null;
	// Where the body we just transferred out of is standing, if it's still there — worth 3
	// energy back once we can see it.
	previousBody: { col: number; row: number } | null;
	// What we were doing last tick, or null to decide freely. See BotPlan.
	plan: BotPlan | null;
	sentinelAbsorbed: boolean;
}

// Hyperspace isn't one of the rules layer's targeted actions — it has no target at all — but
// it is one of the things the bot can decide to do, so the planner's vocabulary includes it.
export type BotAction = GameAction | 'hyperspace';

export interface BotStep {
	action: BotAction;
	col: number;
	row: number;
	aimHeight: number;
	label: string;
}

/*
 What the bot is in the middle of doing: occupy (col, row) standing on `boulders` boulders.

 This is the memory the planner spent a long time doing without, and every loop worth the name
 came from its absence. Deciding afresh each tick means inferring past intent from present world
 state, and the world does not record intent: boulders on a tile could be a pile being built or
 a pile half eaten, a Synthoid could be the body we are walking to or one we abandoned two hops
 back. Each of those cost a rewrite and a heuristic constant to paper over. Holding the intention
 makes them facts.

 An intention rather than a script of three actions, deliberately. The next action is re-derived
 from it every tick, so a boulder eaten mid-sequence is simply rebuilt, where a recorded list of
 actions would march on regardless. Same commitment, no brittleness.
*/
export interface BotPlan {
	col: number;
	row: number;
	boulders: number;
}

// What the planner decided: the action to take now, and what it means to be doing next tick.
// The driver stores the plan; the planner stays pure.
export interface BotDecision {
	step: BotStep | null;
	plan: BotPlan | null;
}

// Where the Sentinel will be taken from, and how tall the pile there has to be.
export interface AssaultPlan {
	col: number;
	row: number;
	tileHeight: number;
	boulders: number;
	// Pedestal cell, kept for the endgame (D3) — the pile only exists to see its top.
	pedestalCol: number;
	pedestalRow: number;
	pedestalHeight: number;
}

// A destination under consideration, scored before any raycast is spent on it.
interface Candidate {
	col: number;
	row: number;
	tileHeight: number;
	hops: number;
	score: number;
}

const tileIndex = (col: number, row: number) => row * MAP_SIZE + col;
const distance = (aCol: number, aRow: number, bCol: number, bRow: number) =>
	Math.hypot(aCol - bCol, aRow - bRow);

/*
 Boulders needed on a tile at `tileHeight` before the eye clears `targetHeight`.

 Standing on n boulders the eye sits at tileHeight + n·0.5 + 0.875, and it has to be strictly
 above targetHeight to see it at all (engine/visibility.ts bails when eye <= target), so

     n > 2·(targetHeight − tileHeight) − 1.75

 For integer heights that lands on n = 2·diff − 1: one boulder to look one level up, three for
 two levels, five for three. The Sentinel case is the same formula with targetHeight = the
 pedestal top (its tile + 1), which is where the familiar n = 2·gap + 1 comes from.
*/
export function bouldersToSee(tileHeight: number, targetHeight: number): number {
	const needed = (targetHeight - tileHeight - EYE_HEIGHT) / BOULDER_HEIGHT;
	if (needed < 0) return 0;
	// Strictly above, so a value landing exactly on an integer still needs one more.
	return Math.floor(needed) + 1;
}

// Height of the eye of a body standing on `boulders` boulders on a tile.
export const eyeHeightOn = (tileHeight: number, boulders: number) =>
	tileHeight + boulders * BOULDER_HEIGHT + EYE_HEIGHT;

/*
 Boulders needed on a tile before standing on them puts the feet strictly higher than
 `standHeight` — the minimum for a climb to have gained anything, since the eye rises with the
 feet. One boulder from a tile level with us, two from half a level down, three from a full one.

 Deliberately the *smallest* n that works, because overshooting doesn't just waste boulders, it
 strands the body: we have to be able to see the thing we're about to transfer into, and
 engine/visibility.ts refuses any target at or above the eye. The window is therefore

     standHeight  <  tileHeight + n·0.5  <  standHeight + EYE_HEIGHT

 and since one boulder is 0.5 against an eye height of 0.875, the smallest n clearing the lower
 bound always clears the upper one too. Take one more and the new body sits above our eye line,
 invisible and unreachable — three energy spent on a body that can never be entered.

 Zero is a legitimate answer: a tile already higher than our feet is a climb all by itself.

 Assumes the tile is targetable in the first place (below our eye) — chooseDestination filters
 for that before asking, and no pile height could rescue a tile that isn't.
*/
export function bouldersToOutrank(tileHeight: number, standHeight: number): number {
	return Math.max(0, Math.floor((standHeight - tileHeight) / BOULDER_HEIGHT) + 1);
}

// What the endgame costs from here: the pile (2 each, never recovered — absorb locks the
// moment the Sentinel goes), the Synthoid for the pedestal, and the final hyperspace.
export const endgameCost = (boulders: number) => boulders * 2 + energyCostOf(GameObjType.SYNTHOID) + HYPERSPACE_COST;

/*
 Pick the tile to take the Sentinel from: the one needing the shortest pile, breaking ties by
 closeness to the body so the walk there is short.

 Candidates are every flat tile except the pedestal's own, scored by pile height and tested in
 that order, so the cheap options are always tried first and the visibility budget is spent on
 them. Tiles occupied by something absorbable are allowed — clearing them is the endgame's
 problem (D3) — but a tile holding a Pedestal never is.
*/
export function findAssaultTile(world: BotWorld): AssaultPlan | null {
	const pedestal = world.objects.find(o => o.type === GameObjType.PEDESTAL);
	if (!pedestal) return null;
	const pedestalHeight = world.map[tileIndex(pedestal.col, pedestal.row)];
	// The Sentinel's base sits one unit up, on top of the pedestal — that's what we must see.
	const targetHeight = pedestalHeight + 1;

	const from = world.body;
	const candidates: { col: number; row: number; tileHeight: number; boulders: number; distance: number }[] = [];
	for (let row = 0; row < MAP_SIZE - 1; row++) {
		for (let col = 0; col < MAP_SIZE - 1; col++) {
			if (col === pedestal.col && row === pedestal.row) continue;
			if (!world.isFlat(col, row)) continue;
			if (world.objectsAt(col, row).some(o => o.type === GameObjType.PEDESTAL)) continue;
			const tileHeight = world.map[tileIndex(col, row)];
			candidates.push({
				col,
				row,
				tileHeight,
				boulders: bouldersToSee(tileHeight, targetHeight),
				distance: from ? distance(col, row, from.col, from.row) : 0,
			});
		}
	}
	candidates.sort((a, b) => a.boulders - b.boulders || a.distance - b.distance);

	let tested = 0;
	for (const c of candidates) {
		if (tested++ >= MAX_VISIBILITY_TESTS) break;
		// Would a body on top of that pile actually see the pedestal top, or does the terrain
		// between get in the way?
		const standHeight = c.tileHeight + c.boulders * BOULDER_HEIGHT;
		if (!world.canSeeFrom(c.col, c.row, standHeight, pedestal.col, pedestal.row, 1)) continue;
		return {
			col: c.col,
			row: c.row,
			tileHeight: c.tileHeight,
			boulders: c.boulders,
			pedestalCol: pedestal.col,
			pedestalRow: pedestal.row,
			pedestalHeight,
		};
	}
	return null;
}

/*
 Terrain-only line of sight, over the height map alone — no scene, no raycast, no objects.

 Deliberately an approximation of engine/visibility.ts, and it does not replace it: this is what
 makes it affordable to ask the question hundreds of thousands of times while building the
 reachability field below, where a real raycast sweep would take minutes. Objects are ignored
 (they come and go anyway) and the answer is re-checked for real by the crosshair before the bot
 commits to anything.
*/
export function terrainVisible(
	map: number[],
	fromCol: number,
	fromRow: number,
	eyeHeight: number,
	toCol: number,
	toRow: number,
	targetHeight: number
): boolean {
	if (eyeHeight <= targetHeight) return false;
	const dCol = toCol - fromCol;
	const dRow = toRow - fromRow;
	// Two samples per cell crossed — enough to catch a one-tile ridge between the two ends.
	const steps = Math.ceil(Math.max(Math.abs(dCol), Math.abs(dRow)) * 2);
	for (let i = 1; i < steps; i++) {
		const t = i / steps;
		const col = Math.floor(fromCol + dCol * t);
		const row = Math.floor(fromRow + dRow * t);
		if (col < 0 || row < 0 || col >= MAP_SIZE || row >= MAP_SIZE) continue;
		// The ray descends (or climbs) linearly between the two ends; terrain blocks if it pokes
		// through. A shallow tolerance keeps a coplanar run of tiles from blocking itself.
		if (map[tileIndex(col, row)] > eyeHeight + (targetHeight - eyeHeight) * t + 1e-6) return false;
	}
	return true;
}

/*
 Hops from every flat tile to the goal, over the graph the bot can actually walk.

 This exists because straight-line distance is a lie on this terrain. Scoring destinations by it
 makes the bot a greedy hill-climber that strolls into a pocket — a dead end that is *near* the
 goal but not connected to it — and then stands there, because no reachable tile is any nearer.
 That is the "gets partway then loops aimlessly until the Sentinel kills it" behaviour. A tile's
 hop count encodes real connectivity, so descending it can't strand the bot.

 Edges use the reach of a body that has raised one boulder under itself, which is the cheapest
 climb available (see bouldersToOutrank): eye at tileHeight + 0.5 + 0.875, so a tile up to one
 whole level above is targetable. Reversed, since we want distance *to* the goal: expanding tile
 X looks for tiles Y that could reach X.

 Computed once per landscape by the driver — the terrain never moves.
*/
export function computeHopField(world: BotWorld, goal: { col: number; row: number }): Map<number, number> {
	const tiles: { col: number; row: number; height: number; index: number }[] = [];
	for (let row = 0; row < MAP_SIZE - 1; row++) {
		for (let col = 0; col < MAP_SIZE - 1; col++) {
			if (!world.isFlat(col, row)) continue;
			tiles.push({ col, row, height: world.map[tileIndex(col, row)], index: tileIndex(col, row) });
		}
	}

	const hops = new Map<number, number>();
	hops.set(tileIndex(goal.col, goal.row), 0);
	let frontier = tiles.filter(t => t.index === tileIndex(goal.col, goal.row));
	let remaining = tiles.filter(t => t.index !== tileIndex(goal.col, goal.row));

	for (let depth = 1; frontier.length > 0 && remaining.length > 0; depth++) {
		const reached: typeof tiles = [];
		const stillOut: typeof tiles = [];
		for (const candidate of remaining) {
			const eye = candidate.height + BOULDER_HEIGHT + EYE_HEIGHT;
			const canReach = frontier.some(
				target =>
					Math.abs(target.col - candidate.col) <= MAX_FIELD_HOP &&
					Math.abs(target.row - candidate.row) <= MAX_FIELD_HOP &&
					terrainVisible(world.map, candidate.col, candidate.row, eye, target.col, target.row, target.height)
			);
			if (canReach) {
				hops.set(candidate.index, depth);
				reached.push(candidate);
			} else {
				stillOut.push(candidate);
			}
		}
		frontier = reached;
		remaining = stillOut;
	}
	return hops;
}

/*
 Is a plan still worth pursuing? The give-up conditions, in the order they're cheapest to test.

 Only the ones that make the plan *impossible* or *pointless* belong here. Being short of energy
 does not: the harvest rung earns it and the plan waits. Nor does a better destination appearing —
 changing target every time something marginally better turns up is the oscillation this whole
 mechanism exists to stop.
*/
export function isPlanViable(world: BotWorld, plan: BotPlan, body: BotBody): boolean {
	// Achieved: we're standing on it.
	if (plan.col === body.col && plan.row === body.row) return false;

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
function planStep(world: BotWorld, plan: BotPlan): BotStep {
	const stack = world.objectsAt(plan.col, plan.row);
	const top = topAt(world, plan.col, plan.row);
	const aimHeight = top ? top.aimHeight : world.map[tileIndex(plan.col, plan.row)];
	const { col, row } = plan;
	return stack.length < plan.boulders
		? { action: 'create-boulder', col, row, aimHeight, label: `raise pile ${stack.length + 1}/${plan.boulders}` }
		: { action: 'create-synthoid', col, row, aimHeight, label: 'body at destination' };
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

// Top of the stack on a cell, or null. Mirrors engine/scene.ts's topObjectAt over the snapshot.
function topAt(world: BotWorld, col: number, row: number): BotObject | null {
	const stack = world.objectsAt(col, row);
	return stack.length > 0 ? stack[stack.length - 1] : null;
}

const isBody = (o: BotObject, body: BotBody | null) => body !== null && o.col === body.col && o.row === body.row;

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
export function chooseDestination(
	world: BotWorld,
	goal: { col: number; row: number; tileHeight: number; boulders?: number },
	hopField: Map<number, number>
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
	let approach = pickVisible(world, body, candidates, improves);

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
		approach = pickVisible(world, body, byProximity, improves);
	}
	if (approach) {
		/*
		 Climb while you walk. If the goal is above us we are going to have to gain height sooner
		 or later, and a boulder on the tile we're moving to anyway is far cheaper than a separate
		 trip: the bot used to hop onto higher ground, then spend a whole second cycle (boulder,
		 body, transfer) raising itself on a neighbouring tile. One boulder folded into the hop
		 does both at once. bouldersToOutrank already returns 0 for a tile above our feet, so the
		 floor of 1 is what makes the hop gain the extra half level rather than just the terrain's.
		*/
		const tileHeight = world.map[tileIndex(approach.col, approach.row)];
		const climbing = body.height < goal.tileHeight ? Math.max(1, bouldersToOutrank(tileHeight, body.height)) : 0;
		return { col: approach.col, row: approach.row, boulders: pileAt(approach, goal, climbing) };
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
		const step = pickVisible(world, body, byHeight, () => true);
		if (step) {
			const tileHeight = world.map[tileIndex(step.col, step.row)];
			const climb = bouldersToOutrank(tileHeight, body.height);
			return { col: step.col, row: step.row, boulders: pileAt(step, goal, climb) };
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
	accept: (c: Candidate) => boolean
): { col: number; row: number } | null {
	let tested = 0;
	let safetyTests = 0;
	// Two grades of bad, kept apart. `watched` is in some watcher's line of sight but not
	// currently looked at — survivable, since cones sweep. `inSight` is being looked at right
	// now, so anything we put there is on the next drain tick's list; it is the last resort of
	// last resorts, taken only when the whole reachable set is under the cones.
	let watchedFallback: { col: number; row: number } | null = null;
	let inSightFallback: { col: number; row: number } | null = null;

	for (const c of candidates) {
		if (!accept(c)) continue;
		if (tested++ >= MAX_VISIBILITY_TESTS) break;
		if (!world.canSeeFrom(body.col, body.row, body.height, c.col, c.row, 0)) continue;
		if (world.isInSight(c.col, c.row)) {
			inSightFallback ??= { col: c.col, row: c.row };
			continue;
		}
		if (!world.isWatched(c.col, c.row)) return { col: c.col, row: c.row };
		watchedFallback ??= { col: c.col, row: c.row };
		// Every candidate we return has been exposure-checked; once the budget for those runs
		// out we stop and take the fallback, rather than returning an unchecked tile that might
		// be worse than the one we already rejected.
		if (++safetyTests >= MAX_SAFETY_TESTS) break;
	}
	return watchedFallback ?? inSightFallback;
}

/*
 The decision itself, as a priority ladder. Each rung is one 1 Hz action; the bot re-plans from
 scratch afterwards, so nothing here has to be remembered between calls and a step that fails
 simply isn't chosen again next time.

 Returns null when there's nothing useful to do — the driver treats that as idling, not failure.
*/
export function planNextStep(
	world: BotWorld,
	assault: AssaultPlan | null,
	hopField: Map<number, number>
): BotDecision {
	const body = world.body;
	if (!body) return { step: null, plan: null };
	const previous = world.previousBody;
	// The plan survives every rung below except the ones that finish or invalidate it — a Sentry
	// worth taking or a body worth reclaiming is a detour, not a change of mind.
	const plan = world.plan && isPlanViable(world, world.plan, body) ? world.plan : null;
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
	 cover, or build one somewhere safe. It reads like an obvious win. Four variants were measured
	 and every one of them lost ground:

	     flee whenever a cone touches us          -4 landscapes of 20
	     the same, only below 8 energy            -1 of 20
	     only into cover that already exists       0 of 20, and never once fired
	     only when the alternative is break-even  -6 of 102

	 The last is the sharpest trigger there is — standing in a cone costs a point a second and a
	 tree pays a point a second, so harvesting trees under fire nets exactly nothing, and a watcher
	 with something to drain never rotates away. Even that lost six landscapes (1700, 3000, 3100,
	 4200, 5800, 9900) and gained none.

	 The arithmetic is why. A flight costs three for the body plus the slots to build it, move in
	 and reclaim what's left — three or four seconds of not advancing, from a purse that is short
	 precisely when the trigger fires. Treading water is a slow loss; running is a faster one.

	 Worth another look only with something the planner cannot currently see: where the cones will
	 point *next*, so it can wait a second instead of paying to move. Not as it stood.
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
				(closer || o.height > body.height) &&
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
		.some(o => o.type === GameObjType.TREE || o.type === GameObjType.MEANIE);
	if (fouled && !world.sentinelAbsorbed) {
		const top = topAt(world, assault.col, assault.row);
		if (top && !world.isBlocked(assault.col, assault.row, 'absorb') && world.canHit(top.col, top.row, top.aimHeight)) {
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

const createdType = (action: BotAction) =>
	action === 'create-boulder' ? GameObjType.BOULDER : action === 'create-tree' ? GameObjType.TREE : GameObjType.SYNTHOID;

/*
 Standing on the assault tile, high enough to see the top of the pedestal.

 That height is the whole point of the pile: the Sentinel's base sits a unit above its own tile,
 and absorbing anything on a pedestal needs line of sight to the pedestal top
 (engine/scene.ts's removeObjectFromScene), so the eye has to clear pedestalHeight + 1.
*/
export function inAssaultPosition(body: BotBody, assault: AssaultPlan): boolean {
	return (
		body.col === assault.col &&
		body.row === assault.row &&
		body.height + EYE_HEIGHT > assault.pedestalHeight + 1
	);
}

/*
 The finish, in order: take the Sentinel, stand a body on the empty pedestal, move into it, and
 hyperspace out from there — which is what game/actions.ts turns into a win.

 Absorption locks the instant the Sentinel goes (game.sentinelAbsorbed), so from the first step
 here nothing can be recovered and every remaining cost has to already be affordable. That is
 what endgameCost + ENERGY_MARGIN was being banked for during the walk.
*/
function planEndgame(world: BotWorld, body: BotBody, assault: AssaultPlan): BotStep | null {
	const onPedestal = world.objectsAt(assault.pedestalCol, assault.pedestalRow);
	const sentinel = onPedestal.find(o => o.type === GameObjType.SENTINEL);
	if (sentinel) {
		return { action: 'absorb', ...aimAt(sentinel), label: 'absorb the Sentinel' };
	}

	// The pedestal is clear. A body goes on it — canPlaceAt allows nothing else up there, for
	// exactly this reason: with absorption locked, a boulder left on the pedestal would make the
	// landscape permanently unwinnable.
	const occupant = onPedestal.find(o => o.type === GameObjType.SYNTHOID);
	if (!occupant) {
		const pedestal = onPedestal.find(o => o.type === GameObjType.PEDESTAL);
		if (!pedestal) return null;
		return { action: 'create-synthoid', ...aimAt(pedestal), label: 'body onto the pedestal' };
	}

	if (!isBody(occupant, body)) {
		return { action: 'transfer', ...aimAt(occupant), label: 'transfer onto the pedestal' };
	}

	// Standing on the pedestal: hyperspacing from here is the win. No target to aim at, so the
	// driver fires this one without a head turn.
	return { action: 'hyperspace', col: body.col, row: body.row, aimHeight: body.height, label: 'hyperspace out — win' };
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
	const reserved = (o: BotObject) =>
		(o.col === assault.col && o.row === assault.row) ||
		(destination !== null && o.col === destination.col && o.row === destination.row);

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

const aimAt = (o: BotObject) => ({ col: o.col, row: o.row, aimHeight: o.aimHeight });
