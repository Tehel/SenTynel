/*
 The contract between a demo-bot planner and the engine that drives it.

 Split out of game/bot.ts so that a second planner can be written against the same seam without
 importing the first (PLAN-BOT2.md, B2). Three-free by construction, which is what lets any planner
 be tested against a synthetic landscape with no renderer involved.

 The division of labour, unchanged from the original: the *world* is what the driver can see and do
 (engine/bot.ts builds it fresh per decision, the same injection shape game/actions.ts uses for
 ActionContext), and the *planner* is whatever decides what to do with it. Planning is omniscient —
 BotWorld hands over the whole landscape, not just the visible part — but execution is not: every
 step still has to survive the crosshair raycast, the energy rules and the 1 Hz cadence.
*/

import type { GameObjType } from '../world/terrain';
import type { GameAction } from './actions';

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
	*/
	isInSight(col: number, row: number): boolean;
	/*
	 The predictive version of the two above: how many 4 Hz ticks until *any* watcher's cone covers
	 this cell with line of sight to it. Zero means it is being looked at right now (so isInSight is
	 `ticksUntilSeen === 0`), and Infinity means nothing reaches it inside the driver's horizon.

	 Knowable exactly rather than by estimation — the cone is 20 rotation units wide and every
	 watcher steps ±20 units per period, so cones advance by exactly their own width and the
	 schedule is closed-form. See game/cone.ts for the arithmetic and the two approximations the
	 driver makes on top of it.

	 Worth knowing what this is and isn't for. It is free when it *ranks tiles the planner was going
	 to visit anyway*; it does not pay for extra journeys, which is what the fifth and last flee
	 experiment established (BOT.md).
	*/
	ticksUntilSeen(col: number, row: number): number;
	/*
	 Would this cell be under a cone within `ticks`? Sugar over ticksUntilSeen, for the common
	 question: will this tile still be clear long enough to finish what I want to do on it.
	*/
	willBeSeenWithin(col: number, row: number, ticks: number): boolean;
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
	 The SURFACE RULE: are we allowed to absorb, or transfer into, the top object at this cell?

	 Distinct from both neighbours above. canSeeFrom asks about a cell, canHit asks whether the
	 crosshair arrives — this asks whether the RULES permit the action once it does. What an object
	 stands on decides the answer: feet on bare ground need that tile in view, feet on a boulder need
	 nothing (a boulder is itself a targetable surface), feet on the pedestal need its top. A boulder
	 is always takeable.

	 Injected rather than derived, for the same reason as everything else on this interface: the rule
	 lives in engine/scene.ts's canTargetTopObject, and a planner reimplementing it would drift from
	 it. Any rung that proposes 'absorb' or 'transfer' must consult this, or it will re-propose a step
	 the rules refuse for as long as the body stays put.
	*/
	canTarget(col: number, row: number): boolean;
	/*
	 Has this exact action already failed at this cell? The driver records failures and clears them
	 whenever the body moves and the geometry changes, so a planner with no memory of its own still
	 stops re-deriving a step that cannot work.

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
	sentinelAbsorbed: boolean;
	/*
	 How many landscapes the run should jump when it wins, or null for "however many it happens
	 to be".

	 Winning jumps ahead by exactly the energy left over, so the landing is a consequence of the
	 purse. Demo mode wants a say in it (game/route.ts picks a landscape worth playing), and the
	 only lever is to spend the surplus down before the final hyperspace.

	 The driver supplies it, and only once the Sentinel is down: choosing a landing costs a
	 landscape generation or two, and until then the eventual purse is unknown anyway. Always null
	 outside demo mode — a player's leftover energy is their own business.
	*/
	targetJump: number | null;
}

/*
 A planner: whatever turns a BotWorld into the next thing to do.

 Stateful on purpose, unlike the pure decision functions underneath it. The world does not record
 intent — boulders on a tile are equally a pile being built or one half eaten — so anything that
 decides afresh each tick has to infer its own past from the present, and every loop in this bot's
 history came from that gap. Memory lives here, and its shape is the planner's own business: the
 driver stores nothing on its behalf and cannot inspect it.

 Two hooks exist only for the driver's staleness backstop, which is the one give-up condition no
 planner can observe for itself: a watcher eating a pile as fast as it is laid looks, tick by tick,
 exactly like ordinary progress, and only elapsed time gives it away. Keeping it out here means
 every planner gets the safety net without having to remember to build one.
*/
export interface BotPlanner {
	// Once per landscape, before the first decision — the expensive survey goes here.
	survey(world: BotWorld): void;
	// One decision, at the 1 Hz cadence. Null means "nothing useful to do", which the driver
	// treats as idling rather than as failure.
	decide(world: BotWorld): BotStep | null;
	// What is being pursued, as a key that stays equal while the intention does, or null for
	// "nothing in particular". The driver watches it for staleness.
	intention(): string | null;
	// Give that up: the driver has decided it has gone on too long.
	abandon(): void;
}
