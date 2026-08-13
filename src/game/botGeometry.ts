/*
 The arithmetic and terrain analysis every demo-bot planner needs, whatever strategy it plays.

 Split out of game/bot.ts (PLAN-BOT2.md, B2) so a challenger planner shares one definition of the
 pile formulas and the reachability field rather than growing a second, subtly different set. What
 lives here is what is true of *the game*; what lives in a planner is what it has decided to do
 about it.

 Pure and three-free, like everything under game/.
*/

import { GameObjType, MAP_SIZE } from '../world/terrain';
import { energyCostOf } from './rules';
import type { BotWorld } from './botWorld';

// A boulder is half a unit tall (world/objects/models/boulder.ts; engine/scene.ts stacks them
// at objects.length / 2). The pile arithmetic below is all downstream of this one number.
export const BOULDER_HEIGHT = 0.5;
// Eye height above the feet, matching engine/camera.ts's EYE_HEIGHT. Only used for the
// can-I-see-that-height arithmetic; actual line-of-sight tests go through BotWorld.canSeeFrom,
// which owns the real eye position. Also used by game/route.ts, which asks the same
// can-I-see-that-height question about a landscape that hasn't been built yet.
export const EYE_HEIGHT = 0.875;
// What a hyperspace costs (game/actions.ts). Not in the ENERGY_COST table — it creates nothing.
// Exported because the winning jump is what's left *after* paying it, so engine/bot.ts needs the
// same number to work out how far the run could reach.
export const HYPERSPACE_COST = 3;
/*
 Candidate tiles line-of-sight tested per decision. Candidates are scored before testing, so the
 good ones are tried first and the cap only ever truncates a tail of bad options. Bounds the
 per-decision raycast cost — decisions happen at 1 Hz, not per frame.
*/
export const MAX_VISIBILITY_TESTS = 64;
// Longest hop considered when building the reachability field. Bounds an O(tiles²) sweep, and
// hops much longer than this are rare in practice — the terrain gets in the way first.
const MAX_FIELD_HOP = 16;

// Where the Sentinel will be taken from, and how tall the pile there has to be.
export interface AssaultPlan {
	col: number;
	row: number;
	tileHeight: number;
	boulders: number;
	// Pedestal cell, kept for the endgame — the pile only exists to see its top.
	pedestalCol: number;
	pedestalRow: number;
	pedestalHeight: number;
}

export const tileIndex = (col: number, row: number) => row * MAP_SIZE + col;
export const distance = (aCol: number, aRow: number, bCol: number, bRow: number) =>
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

 Assumes the tile is targetable in the first place (below our eye) — a caller filters for that
 before asking, and no pile height could rescue a tile that isn't.
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
 them. Tiles occupied by something absorbable are allowed — clearing them is the caller's problem —
 but a tile holding a Pedestal never is.

 `exclude` lets a caller rule out tiles it has already proved it cannot use, so that a second call
 returns the next best rather than the same answer. Without it, a chosen tile that turns out to be
 unclearable is the end of the landscape: there is one assault tile and every plan aims at it.
*/
export function findAssaultTile(world: BotWorld, exclude: Set<number> = new Set()): AssaultPlan | null {
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
			// Tiles a caller has already tried and found unusable — see the re-survey in bot2.ts.
			if (exclude.has(tileIndex(col, row))) continue;
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

 Computed once per landscape — the terrain never moves.
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
