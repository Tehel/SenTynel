/*
 The finish, and the arithmetic of being in position to start it.

 Shared by every planner (PLAN-BOT2.md, B3): however a bot gets to the assault tile, the last five
 actions are the same, and they are the least forgiving part of the game. Absorption locks the
 instant the Sentinel goes (game.sentinelAbsorbed), so from the first step here nothing can be
 recovered and every remaining cost has to already be affordable.
*/

import { GameObjType, MAP_SIZE } from '../world/terrain';
import { energyCostOf } from './rules';
import { distance, tileIndex, EYE_HEIGHT, HYPERSPACE_COST, type AssaultPlan } from './botGeometry';
import { MAX_VISIBILITY_TESTS } from './botGeometry';
import { aimAt, createdType, isBody } from './botMovement';
import type { BotAction, BotBody, BotStep, BotWorld } from './botWorld';

/*
 Can the endgame start from where we are standing, wherever that is?

 The question the assault survey was standing in for. What the finish actually needs is a sightline:
 absorbing anything on a pedestal requires line of sight to the pedestal *top*
 (engine/scene.ts's removeObjectFromScene), and the eye has to clear it. The survey's tile is one
 place that qualifies — the cheapest one it could find before the run started — but it is not the
 only one, and by the time the bot has climbed it may well be standing somewhere else that does.

 inAssaultPosition below asks the narrower question, "am I on that particular tile", and that is a
 real difference rather than a pedantic one: a bot that has climbed to a winning position one tile
 over does not know it has won, walks off to the tile it was told to want, and can hyperspace away
 from the finish. Reported from watching landscape 106 as "it derails completely" once next to the
 pedestal — it was pursuing a goal it had already achieved somewhere else.
*/
export function canAssaultFrom(world: BotWorld, body: BotBody, assault: AssaultPlan): boolean {
	if (body.height + EYE_HEIGHT <= assault.pedestalHeight + 1) return false;
	if (!world.canSeeFrom(body.col, body.row, body.height, assault.pedestalCol, assault.pedestalRow, 1)) return false;
	/*
	 And the crosshair has to actually reach it, which is a stricter question than the sightline —
	 canSeeFrom is generous by design, true if *any corner* of the cell is reachable, while the game
	 resolves the absorb against a single centre ray.

	 Load-bearing, not belt-and-braces. Committing here is irreversible: the caller latches its perch,
	 which switches off the hyperspace escape and puts the finish in charge, so a position that looks
	 winning and cannot actually take the Sentinel is a landscape thrown away. Measured: without this
	 the sweep dropped from 74 to 71.
	*/
	const sentinel = world.objects.find(
		o => o.type === GameObjType.SENTINEL && o.col === assault.pedestalCol && o.row === assault.pedestalRow
	);
	return sentinel === undefined || world.canHit(sentinel.col, sentinel.row, sentinel.aimHeight);
}

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
export function planEndgame(world: BotWorld, body: BotBody, assault: AssaultPlan): BotStep | null {
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

	// Standing on the pedestal, so the purse is now final and the landing is whatever it buys.
	// Steer it by spending the difference (route steering — see BotWorld.targetJump).
	const burn = planSurplusBurn(world, body);
	if (burn) return burn;

	// Hyperspacing from here is the win. No target to aim at, so the driver fires this one without
	// a head turn.
	return { action: 'hyperspace', col: body.col, row: body.row, aimHeight: body.height, label: 'hyperspace out — win' };
}

// Biggest first — each costs a whole second of the 1 Hz cadence.
const BURN_ACTIONS: BotAction[] = ['create-synthoid', 'create-boulder', 'create-tree'];

/*
 Spend the surplus so the win lands on the landscape we chose rather than the one the purse
 happens to point at.

 The jump *is* the leftover energy, so the only way to aim it is to be poorer on purpose. A
 create is never refunded — nothing here will be absorbed back, absorption having locked with the
 Sentinel — which makes it an exact one-, two- or three-point sink. Biggest denomination first,
 because each costs a whole second of the 1 Hz cadence and we are standing next to whatever
 Sentries are still alive.

 Re-derived every decision like every other step, so a watcher draining the pool mid-burn simply
 leaves a smaller surplus to spend rather than throwing the sequence out. Returns null once there
 is nothing left to spend, or when nothing can be placed anywhere — in which case the win goes
 ahead and overshoots, which is a better outcome than standing on the pedestal forever.
*/
function planSurplusBurn(world: BotWorld, body: BotBody): BotStep | null {
	if (world.targetJump === null) return null;
	const surplus = world.energy - HYPERSPACE_COST - world.targetJump;
	if (surplus <= 0) return null;

	for (const action of BURN_ACTIONS) {
		const cost = energyCostOf(createdType(action));
		if (cost > surplus) continue;
		const tile = findBurnTile(world, body, action);
		if (!tile) continue;
		return {
			action,
			col: tile.col,
			row: tile.row,
			aimHeight: world.map[tileIndex(tile.col, tile.row)],
			label: `spend ${cost} of ${surplus} surplus`,
		};
	}
	return null;
}

// Nearest empty flat tile we can actually put this on. Everything is below us up here — the
// Sentinel's tile is the highest flat one there is — so candidates are plentiful; the work is
// finding one the centre ray reaches, past the mound the pedestal sits on.
function findBurnTile(world: BotWorld, body: BotBody, action: BotAction): { col: number; row: number } | null {
	const type = createdType(action);
	const candidates: { col: number; row: number; d: number }[] = [];
	for (let row = 0; row < MAP_SIZE - 1; row++) {
		for (let col = 0; col < MAP_SIZE - 1; col++) {
			if (col === body.col && row === body.row) continue;
			if (!world.isFlat(col, row)) continue;
			if (world.objectsAt(col, row).length > 0) continue;
			if (!world.canPlace(col, row, type)) continue;
			if (world.isBlocked(col, row, action)) continue;
			candidates.push({ col, row, d: distance(col, row, body.col, body.row) });
		}
	}
	candidates.sort((a, b) => a.d - b.d);

	let tested = 0;
	for (const c of candidates) {
		if (tested++ >= MAX_VISIBILITY_TESTS) break;
		if (world.canHit(c.col, c.row, world.map[tileIndex(c.col, c.row)])) return c;
	}
	return null;
}

