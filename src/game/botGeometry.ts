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

/*
 The pedestal, which is everything the *finish* needs to know.

 Split out of AssaultPlan because canAssaultFrom and planEndgame (game/botEndgame.ts) reference only
 these three fields — never the assault tile. The finish is pedestal-driven: the Sentinel stands here,
 the winning body goes here, and the hyperspace out is taken from here. A planner that has not yet
 decided where it will build its pile can still answer every question the endgame asks, which is what
 lets the choice be deferred to the top of the climb (PLAN-BOT2.md's B4).

 Free to obtain — findPedestal is an objects.find and one map read, with no line-of-sight sweep.
*/
export interface PedestalTarget {
	pedestalCol: number;
	pedestalRow: number;
	pedestalHeight: number;
}

// Where the Sentinel will be taken from, and how tall the pile there has to be.
export interface AssaultPlan extends PedestalTarget {
	col: number;
	row: number;
	tileHeight: number;
	boulders: number;
}

/*
 The pedestal cell and its height, or null on a landscape without one.

 The Sentinel's base sits one unit above this tile, so `pedestalHeight + 1` is what an assault has to
 see over — the number the pile arithmetic is always aimed at.
*/
export function findPedestal(world: BotWorld): PedestalTarget | null {
	const pedestal = world.objects.find(o => o.type === GameObjType.PEDESTAL);
	if (!pedestal) return null;
	return {
		pedestalCol: pedestal.col,
		pedestalRow: pedestal.row,
		pedestalHeight: world.map[tileIndex(pedestal.col, pedestal.row)],
	};
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
 Tallest assault pile worth aiming at, when a caller wants the band rather than one tile.

 Five boulders is heightGap 2 (the 2·gap + 1 rule), which game/route.ts already names as the deepest
 the bot is known to manage: gap 3 needs seven, exists on two of the ten thousand landscapes, and has
 never been played through. The bound matters for a second reason once it seeds a hop field — without
 it every tile on the map is "somewhere you could assault from given enough boulders", the seed
 swallows the landscape, and the field reports one hop from everywhere.
*/
export const MAX_ASSAULT_BOULDERS = 5;

/*
 Every flat tile the Sentinel could be taken from, scored by the pile it would need.

 Terrain and arithmetic only — no line-of-sight test, so this is position-independent and static for
 the landscape, which is what lets a planner compute it once and re-rank it per decision. Tiles
 occupied by something absorbable are included; clearing them is the caller's problem. A tile holding a
 Pedestal never is.

 Row-major order is load-bearing. The sort below is by (boulders, distance) and Array.sort is stable,
 so ties resolve in the order tiles are pushed here — which means changing this loop silently changes
 which tile a caller picks.
*/
export function assaultCandidates(
	world: BotWorld,
	pedestal: PedestalTarget,
	exclude: Set<number> = new Set()
): AssaultPlan[] {
	// The Sentinel's base sits one unit up, on top of the pedestal — that's what we must see.
	const targetHeight = pedestal.pedestalHeight + 1;
	const out: AssaultPlan[] = [];
	for (let row = 0; row < MAP_SIZE - 1; row++) {
		for (let col = 0; col < MAP_SIZE - 1; col++) {
			if (col === pedestal.pedestalCol && row === pedestal.pedestalRow) continue;
			// Tiles a caller has already tried and found unusable — see the survey in bot2.ts, which
			// rules out a tile the hop field says it has no route to.
			if (exclude.has(tileIndex(col, row))) continue;
			if (!world.isFlat(col, row)) continue;
			if (world.objectsAt(col, row).some(o => o.type === GameObjType.PEDESTAL)) continue;
			const tileHeight = world.map[tileIndex(col, row)];
			out.push({ col, row, tileHeight, boulders: bouldersToSee(tileHeight, targetHeight), ...pedestal });
		}
	}
	return out;
}

/*
 The subset of those tiles that could really launch an assault, by terrain alone.

 The right visibility question, asked from the top of the pile at the pedestal *top* — not the
 pedestal's own tile, which is a whole unit lower and so a different (and more lenient) question.
 Answered with terrainVisible rather than BotWorld.canSeeFrom because this is asked of every tile on
 the map: ~950 analytic sightlines against the height map, where the real raycast would be far too
 expensive. Objects are ignored, so this is optimistic — a caller that is about to *commit* must
 re-ask with the real thing.
*/
export function assaultBand(
	world: BotWorld,
	candidates: readonly AssaultPlan[],
	maxBoulders = MAX_ASSAULT_BOULDERS
): AssaultPlan[] {
	return candidates.filter(
		c =>
			c.boulders <= maxBoulders &&
			terrainVisible(
				world.map,
				c.col,
				c.row,
				eyeHeightOn(c.tileHeight, c.boulders),
				c.pedestalCol,
				c.pedestalRow,
				c.pedestalHeight + 1
			)
	);
}

export interface AssaultSearch {
	// Tiles already proved unusable, so a second call returns the next best rather than the same
	// answer. Without it, a chosen tile that turns out to be unusable is the end of the landscape.
	exclude?: Set<number>;
	// Only these tiles, pre-scored by assaultCandidates. Lets a caller that keeps a cached band avoid
	// rebuilding it every decision. Defaults to every candidate on the map.
	candidates?: readonly AssaultPlan[];
	// Where the approach would start, for the closeness tiebreak. Defaults to world.body.
	from?: { col: number; row: number } | null;
	/*
	 Pedestal-top sightline results by tile index, filled in as they are tested.

	 Sound to cache for the whole landscape because a tile's view of the pedestal top depends only on
	 the height map, which never changes — and it is what makes this affordable to call once a second
	 rather than once a landscape.
	*/
	sightlines?: Map<number, boolean>;
	/*
	 How much the caller minds standing here, if it minds at all.

	 Structurally the part of botMovement.ts's TilePreference this uses, spelled out rather than
	 imported: botMovement depends on this module, and it keeps the narrower contract honest — only
	 `avoid` is consulted, never `reject`, so this can reject an impossible tile but never reorder.

	 Applied ONLY after the sightline test has already accepted a tile, and never to sort the candidate
	 list. Both restrictions are about cost: grading is a line-of-sight sweep per watcher per tile and
	 the candidate list runs to the hundreds, so scoring it wholesale once a second is not affordable.
	 Behind the sightline test it is bounded by the same visibility budget as everything else here.

	 It exists because the assault tile is the LARGEST commitment in a run — up to five boulders and a
	 body, six seconds at the 1 Hz cadence — and until 2026-08-24 it was the one destination chosen with
	 no reference to watchers at all, while the ordinary walk two rungs below refused a tile a cone was
	 on outright. Measured at 9% of adopted assault piles standing on a tile that would be watched before
	 the pile could be finished, against 1% for the graded walk. Optional, so v1 is untouched.
	*/
	prefer?: { grade(col: number, row: number): number; avoid?: number };
}

/*
 Pick the tile to take the Sentinel from: the one needing the shortest pile, breaking ties by
 closeness so the walk there is short.

 Candidates are scored before testing, so the cheap options are always tried first and the visibility
 budget is spent on them rather than on a tail of bad ones.
*/
export function findAssaultTile(world: BotWorld, search: AssaultSearch = {}): AssaultPlan | null {
	const pedestal = findPedestal(world);
	if (!pedestal) return null;
	const from = search.from === undefined ? world.body : search.from;
	const exclude = search.exclude ?? new Set<number>();
	const pool = (search.candidates ?? assaultCandidates(world, pedestal)).filter(
		c => !exclude.has(tileIndex(c.col, c.row))
	);
	// A copy, because a cached candidate list must not be reordered under its owner — and because the
	// stability of this sort is what makes the row-major tiebreak in assaultCandidates meaningful.
	const candidates = [...pool]
		.map(c => ({ c, distance: from ? distance(c.col, c.row, from.col, from.row) : 0 }))
		.sort((a, b) => a.c.boulders - b.c.boulders || a.distance - b.distance);

	let tested = 0;
	// The best tile the preference refused, kept so a landscape whose every viable tile is watched still
	// gets an answer rather than none. Standing still is worse than being seen — the same reasoning, and
	// the same fallback shape, as botMovement.ts's pickVisible.
	let refused: AssaultPlan | null = null;
	for (const { c } of candidates) {
		const index = tileIndex(c.col, c.row);
		const cached = search.sightlines?.get(index);
		if (cached === false) continue;
		if (cached === undefined) {
			if (tested++ >= MAX_VISIBILITY_TESTS) break;
			// Would a body on top of that pile actually see the pedestal top, or does the terrain
			// between get in the way?
			const visible = world.canSeeFrom(
				c.col,
				c.row,
				c.tileHeight + c.boulders * BOULDER_HEIGHT,
				c.pedestalCol,
				c.pedestalRow,
				1
			);
			search.sightlines?.set(index, visible);
			if (!visible) continue;
		}
		// Not cached, because unlike the sightline this answer expires: it turns on where the watchers are
		// looking, which is the whole point of asking.
		const avoid = search.prefer?.avoid;
		if (avoid !== undefined && search.prefer!.grade(c.col, c.row) >= avoid) {
			refused ??= { ...c };
			continue;
		}
		// A copy: `c` may belong to a caller's cached candidate list, and a plan the caller then adjusts
		// must not write back into it.
		return { ...c };
	}
	return refused;
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
 The pile this tile needs before anything better than it is in sight.

 The companion to computeHopField's tall edge, and the reason that edge is usable rather than merely
 true. A field that says "there is a way out of this bowl" is worth nothing if the walk then climbs
 out of it the way it climbs everywhere else — with bouldersToOutrank, the SMALLEST pile that lifts
 the feet at all. That rule is right wherever the terrain is doing the climbing: a boulder on the ledge
 above is half a level bought for two energy, and three such hops cost three boulders where one
 three-level tower costs five. It is exactly wrong on flat ground, where the ledge above does not
 exist and each rung has to out-rank the last from the same floor — one boulder, then two, then three,
 an arithmetic series against a purse that only ever recovers the rung behind it. Landscape 86 is that
 series: the bot laddered 4 -> 4.5 -> 5.0 on the pit floor and went broke owing the fourth rung.

 So on a tile the cheap edges cannot leave, ask the other question — how tall must the pile be before
 something *better than here* comes into view — and take the answer whole. Better is by the field's own
 cost, not by height, so this cannot aim at a ledge that leads nowhere.

 Returns 0 when a pile buys nothing (no cheaper tile is in reach at any height this will consider), and
 never fires at all in the ordinary case, where the tile has a cheap edge and the ladder is correct.
*/
export function escapeClimb(
	world: BotWorld,
	hopField: Map<number, number>,
	col: number,
	row: number,
	maxBoulders: number
): number {
	const here = hopField.get(tileIndex(col, row)) ?? Infinity;
	const tileHeight = world.map[tileIndex(col, row)];
	for (let boulders = 1; boulders <= maxBoulders; boulders++) {
		const eye = eyeHeightOn(tileHeight, boulders);
		for (let r = 0; r < MAP_SIZE - 1; r++) {
			for (let c = 0; c < MAP_SIZE - 1; c++) {
				if ((hopField.get(tileIndex(c, r)) ?? Infinity) >= here) continue;
				if (!world.isFlat(c, r)) continue;
				if (terrainVisible(world.map, col, row, eye, c, r, world.map[tileIndex(c, r)])) return boulders;
			}
		}
	}
	return 0;
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

 `goal` may be a set of tiles rather than one, which makes this a multi-source BFS and costs nothing
 extra: the frontier starts wider and the layers mean "hops to the nearest of them". That is what a
 planner pursuing a *height* rather than a nominated tile needs — seed it with every tile the assault
 could be launched from and the field becomes a line-of-sight-validated ladder whose zero set is the
 whole winning band (see game/bot2.ts's survey and PLAN-BOT2.md's B4).

 One property worth stating, because a good deal rests on it: since every edge above requires the
 target to be under an eye at `height + 1.375` and terrain heights are integers, **no edge climbs more
 than one whole level**. A hop count is therefore a level count, and a field seeded at the top reads
 directly as "how many levels below the summit am I".

 `maxClimbBoulders` relaxes exactly that property, and only that one. At 1 — the default, and what v1
 uses — this is byte-identical to the one-boulder field described above. Above 1 a *second* kind of
 edge exists: a tile whose eye clears the target only after a taller pile, which is the two-level
 climb out of a bowl (landscape 86: a start at height 4 whose entire height-5 rim is sloped, so the
 nearest flat ground is two levels up and the one-boulder field called a perfectly playable landscape
 cut off, on decision zero). Those edges are charged a whole TALL_HOP_COST, which is larger than any
 route made of cheap ones can ever total, so **a cheap route always outranks an expensive one** and
 the tall edge is only ever consulted where nothing cheap reaches. That is deliberate: the tall climb
 is usually the shorter path in energy, and letting it compete on cost would have the bot habitually
 tower straight up the terrain rather than walk it, which is both a different game and a much duller
 one to watch.

 A cost therefore reads as a pair: `climbs · TALL_HOP_COST + hops`, i.e. how many expensive climbs
 the route needs, then how far it walks after the last of them. Lexicographic, which is what
 chooseDestination's grading wants — it only ever compares costs, never arithmetic on them.
*/
// Charged for an edge that needs a pile taller than one boulder. Larger than the longest possible
// route of cheap edges (there are fewer than MAP_SIZE² flat tiles), which is what makes the two
// components lexicographic rather than merely weighted.
export const TALL_HOP_COST = MAP_SIZE * MAP_SIZE;

export function computeHopField(
	world: BotWorld,
	goal: { col: number; row: number } | readonly { col: number; row: number }[],
	maxClimbBoulders = 1
): Map<number, number> {
	const tiles: { col: number; row: number; height: number; index: number }[] = [];
	for (let row = 0; row < MAP_SIZE - 1; row++) {
		for (let col = 0; col < MAP_SIZE - 1; col++) {
			if (!world.isFlat(col, row)) continue;
			tiles.push({ col, row, height: world.map[tileIndex(col, row)], index: tileIndex(col, row) });
		}
	}

	const goals = Array.isArray(goal) ? goal : [goal as { col: number; row: number }];
	const seeds = new Set(goals.map(g => tileIndex(g.col, g.row)));
	const hops = new Map<number, number>();
	for (const index of seeds) hops.set(index, 0);
	/*
	 Seed the frontier from the goals themselves rather than by looking them up in `tiles`.

	 Behaviourally identical wherever the goal is a flat tile inside the field's range, which is every
	 real call — the pedestal cell is flat on all 10000 landscapes, and assault tiles are chosen from
	 flat ones. But looking it up meant a goal that happened not to be in `tiles` produced an *empty*
	 frontier and a one-entry field, where every hopsOf is Infinity and the walk silently degrades to
	 straight-line scoring. That is a trapdoor rather than a failure, so close it.
	*/
	let frontier = goals.map(g => ({
		col: g.col,
		row: g.row,
		height: world.map[tileIndex(g.col, g.row)],
		index: tileIndex(g.col, g.row),
	}));
	let remaining = tiles.filter(t => !seeds.has(t.index));
	// Every tile that already has a cost. The cheap layers expand from the newest layer alone, which
	// is all a BFS needs; a tall edge may start from anywhere costed, so it needs the whole set.
	let costed = [...frontier];

	const reaches = (candidate: (typeof tiles)[number], targets: typeof tiles, boulders: number) => {
		const eye = candidate.height + boulders * BOULDER_HEIGHT + EYE_HEIGHT;
		return targets.some(
			target =>
				Math.abs(target.col - candidate.col) <= MAX_FIELD_HOP &&
				Math.abs(target.row - candidate.row) <= MAX_FIELD_HOP &&
				terrainVisible(world.map, candidate.col, candidate.row, eye, target.col, target.row, target.height)
		);
	};

	for (let climbs = 0; frontier.length > 0 && remaining.length > 0; climbs++) {
		const base = climbs * TALL_HOP_COST;
		// Cheap layers: one boulder under the foot. Unchanged, and the only thing that runs at all
		// when maxClimbBoulders is 1.
		for (let depth = 1; frontier.length > 0 && remaining.length > 0; depth++) {
			const reached: typeof tiles = [];
			const stillOut: typeof tiles = [];
			for (const candidate of remaining) {
				if (reaches(candidate, frontier, 1)) {
					hops.set(candidate.index, base + depth);
					reached.push(candidate);
				} else {
					stillOut.push(candidate);
				}
			}
			frontier = reached;
			remaining = stillOut;
			costed = costed.concat(reached);
		}
		if (remaining.length === 0 || maxClimbBoulders <= 1) break;
		/*
		 One tall layer, opening the next tier.

		 Charged flat rather than by the pile it needs: every tile reached here starts the next tier at
		 `base + TALL_HOP_COST` with a cheap-hop count of zero, whatever the pile was and however deep in
		 the previous tier the climb began. That is an approximation — a true Dijkstra would carry the
		 walk before the climb into the total — and it is the right one here, because the number the walk
		 actually navigates by is "how many climbs still ahead of me, then how far to the next one".
		 Assigned in strictly increasing tier order, so the field stays monotone along every route.
		*/
		const reached: typeof tiles = [];
		const stillOut: typeof tiles = [];
		for (const candidate of remaining) {
			if (reaches(candidate, costed, maxClimbBoulders)) {
				hops.set(candidate.index, base + TALL_HOP_COST);
				reached.push(candidate);
			} else {
				stillOut.push(candidate);
			}
		}
		if (reached.length === 0) break;
		frontier = reached;
		remaining = stillOut;
		costed = costed.concat(reached);
	}
	return hops;
}
