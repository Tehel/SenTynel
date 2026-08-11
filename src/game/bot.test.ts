import { describe, it, expect } from 'vitest';
import { GameObjType, MAP_SIZE } from '../world/terrain';
import {
	computeHopField,
	terrainVisible,
	bouldersToOutrank,
	bouldersToSee,
	chooseDestination,
	endgameCost,
	findAssaultTile,
	isPlanViable,
	planNextStep,
	type BotObject,
	type BotWorld,
} from './bot';

// A synthetic landscape: flat everywhere at `baseHeight`, with optional per-tile overrides.
// No Three.js, no scene — the planner only ever sees this.
function makeWorld(options: Partial<BotWorld> & { baseHeight?: number; heights?: Record<string, number> } = {}): BotWorld {
	const base = options.baseHeight ?? 4;
	const map = new Array(MAP_SIZE * MAP_SIZE).fill(base);
	for (const [key, height] of Object.entries(options.heights ?? {})) {
		const [col, row] = key.split('_').map(Number);
		map[row * MAP_SIZE + col] = height;
	}
	const objects = options.objects ?? [];
	const world: BotWorld = {
		map,
		isFlat: () => true,
		objects,
		objectsAt: (col, row) => objects.filter(o => o.col === col && o.row === row),
		// Mirrors engine/scene.ts's canPlaceAt: an empty cell, or a stack that is all boulders.
		// The cruder "must be empty" version quietly makes every pile test unbuildable.
		canPlace: (col, row) => {
			const stack = objects.filter(o => o.col === col && o.row === row);
			return stack.length === 0 || stack.every(o => o.type === GameObjType.BOULDER);
		},
		// Optimistic by default: everything is in sight. Tests that care override it.
		canSeeFrom: () => true,
		isWatched: () => false,
		isInSight: () => false,
		canHit: () => true,
		isBlocked: () => false,
		energy: 30,
		body: { col: 10, row: 10, height: base, onPedestal: false },
		previousBody: null,
		plan: null,
		sentinelAbsorbed: false,
		...options,
	};
	return world;
}

const obj = (type: GameObjType, col: number, row: number, height: number): BotObject => ({
	type,
	col,
	row,
	height,
	aimHeight: height + 0.5,
});

describe('bouldersToSee', () => {
	it('needs nothing to see level ground or below', () => {
		expect(bouldersToSee(5, 5)).toBe(0);
		expect(bouldersToSee(5, 3)).toBe(0);
	});

	// The eye sits 0.875 up and a boulder lifts it 0.5, so clearing a target one full unit above
	// the tile takes one boulder, two units takes three, three units takes five.
	it('follows 2*diff - 1 for whole-unit climbs', () => {
		expect(bouldersToSee(5, 6)).toBe(1);
		expect(bouldersToSee(5, 7)).toBe(3);
		expect(bouldersToSee(5, 8)).toBe(5);
	});

	// The Sentinel's base is a unit above its own tile, so the pile is sized against pedestal
	// height + 1 — which reproduces the n = 2*gap + 1 rule from utils/all-levels.js.
	it('reproduces the assault pile rule when aimed at a pedestal top', () => {
		for (const gap of [0, 1, 2, 3]) {
			const pedestalHeight = 8;
			expect(bouldersToSee(pedestalHeight - gap, pedestalHeight + 1)).toBe(2 * gap + 1);
		}
	});
});

describe('bouldersToOutrank', () => {
	it('takes one boulder to gain on a tile level with us', () => {
		expect(bouldersToOutrank(5, 5)).toBe(1);
	});

	// Three from a level down, five from two down — climbing from below wastes boulders just
	// catching back up, which is why the climb prefers the highest tile it can reach.
	it('costs more the further below us the tile sits', () => {
		expect(bouldersToOutrank(4, 5)).toBe(3);
		expect(bouldersToOutrank(3, 5)).toBe(5);
	});

	it('handles standing on a pile, where our own height is fractional', () => {
		expect(bouldersToOutrank(5, 5.5)).toBe(2);
	});

	// A tile already above our feet is a climb on its own, and adding a boulder anyway would lift
	// the new body above our eye line — where it can't be seen, so can't be transferred into.
	it('asks for nothing when the tile is already higher than we are', () => {
		expect(bouldersToOutrank(9, 5)).toBe(0);
		expect(bouldersToOutrank(5.5, 5)).toBe(0);
	});

	// The invariant that keeps a climb reachable: the pile must land the feet above where we
	// stand but still below our eye, or we've built a body we can never enter.
	//
	// Precondition is the same filter chooseDestination applies — a tile more than an eye-height
	// above us can't be targeted at all, so no pile height could rescue it.
	it('always lands the new feet inside the reachable window', () => {
		const EYE = 0.875;
		let checked = 0;
		for (const stand of [4, 4.5, 5, 5.5, 6]) {
			for (const tile of [3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5]) {
				if (tile >= stand + EYE) continue;
				const feet = tile + bouldersToOutrank(tile, stand) * 0.5;
				expect(feet).toBeGreaterThan(stand);
				expect(feet).toBeLessThan(stand + EYE);
				checked++;
			}
		}
		expect(checked).toBeGreaterThan(20);
	});
});

describe('endgameCost', () => {
	// Pile at 2 each, the pedestal Synthoid, and the hyperspace out. Matches the maxJump formula
	// in utils/all-levels.js: totalEnergy - 8 - 4*gap for a gap-0 single-boulder level.
	it('charges the pile, the pedestal body and the jump', () => {
		expect(endgameCost(1)).toBe(8);
		expect(endgameCost(3)).toBe(12);
		expect(endgameCost(7)).toBe(20);
	});
});

describe('findAssaultTile', () => {
	it('returns null with no pedestal on the landscape', () => {
		expect(findAssaultTile(makeWorld())).toBeNull();
	});

	it('prefers a tile level with the pedestal, needing a single boulder', () => {
		// Pedestal on an 8-high plateau; everything else sits at 7 except one tile also at 8.
		const world = makeWorld({
			baseHeight: 7,
			heights: { '20_20': 8, '5_5': 8 },
			objects: [obj(GameObjType.PEDESTAL, 20, 20, 8)],
		});
		const plan = findAssaultTile(world);
		expect(plan).not.toBeNull();
		expect({ col: plan!.col, row: plan!.row }).toEqual({ col: 5, row: 5 });
		expect(plan!.boulders).toBe(1);
		expect(plan!.pedestalHeight).toBe(8);
	});

	it('falls back to a taller pile when nothing sits level with the pedestal', () => {
		const world = makeWorld({
			baseHeight: 7,
			heights: { '20_20': 8 },
			objects: [obj(GameObjType.PEDESTAL, 20, 20, 8)],
		});
		// Every other tile is a unit below, so the gap is 1 and the pile is three boulders.
		expect(findAssaultTile(world)!.boulders).toBe(3);
	});

	it('skips tiles with no line of sight to the pedestal top', () => {
		const world = makeWorld({
			baseHeight: 7,
			heights: { '20_20': 8, '5_5': 8, '19_20': 8 },
			objects: [obj(GameObjType.PEDESTAL, 20, 20, 8)],
			// The nearer of the two level tiles is blind to the pedestal.
			canSeeFrom: (fromCol, fromRow) => !(fromCol === 19 && fromRow === 20),
		});
		const plan = findAssaultTile(world);
		expect({ col: plan!.col, row: plan!.row }).toEqual({ col: 5, row: 5 });
	});
});

describe('chooseDestination', () => {
	const goal = { col: 20, row: 10, tileHeight: 4 };

	it('hops toward the goal on level ground, with no pile', () => {
		const world = makeWorld();
		const destination = chooseDestination(world, goal, computeHopField(world, goal))!;
		expect(destination.boulders).toBe(0);
		// Strictly closer than where we started (10,10).
		expect(Math.hypot(destination.col - goal.col, destination.row - goal.row)).toBeLessThan(10);
	});

	it('never targets a tile above the eye — it climbs instead', () => {
		// A wall of 6s around a body standing at 4: nothing higher is reachable, and the goal is
		// up there, so the only move left is to raise a pile where we can still reach.
		const world = makeWorld({
			baseHeight: 6,
			heights: { '10_10': 4, '9_10': 4, '10_9': 4 },
			body: { col: 10, row: 10, height: 4, onPedestal: false },
		});
		const climbGoal = { col: 20, row: 10, tileHeight: 6 };
		const destination = chooseDestination(world, climbGoal, computeHopField(world, climbGoal))!;
		expect(world.map[destination.row * MAP_SIZE + destination.col]).toBeLessThan(4 + 0.875);
		expect(destination.boulders).toBeGreaterThanOrEqual(1);
	});

	// The tiles the bot most wants are the ones nearest the goal, so these two tests poison
	// exactly that neighbourhood — otherwise the goal tile itself is always the best hop on an
	// open map and the filter under test never gets consulted.
	const nearGoal = (col: number, row: number) => Math.hypot(col - goal.col, row - goal.row) < 3;

	it('gives up ground near the goal rather than stand where a watcher can see', () => {
		const world = makeWorld({ isWatched: nearGoal });
		const destination = chooseDestination(world, goal, computeHopField(world, goal))!;
		expect(nearGoal(destination.col, destination.row)).toBe(false);
		// Still progress: closer than the body's own distance of 10.
		expect(Math.hypot(destination.col - goal.col, destination.row - goal.row)).toBeLessThan(10);
	});

	it('accepts an exposed tile rather than standing still', () => {
		const world = makeWorld({ isWatched: () => true });
		expect(chooseDestination(world, goal, computeHopField(world, goal))).not.toBeNull();
	});

	it('skips cells whose step already failed', () => {
		const world = makeWorld({ isBlocked: (col, row) => nearGoal(col, row) });
		const destination = chooseDestination(world, goal, computeHopField(world, goal))!;
		expect(nearGoal(destination.col, destination.row)).toBe(false);
	});
});

describe('planNextStep', () => {
	const assault = {
		col: 5,
		row: 5,
		tileHeight: 8,
		boulders: 1,
		pedestalCol: 20,
		pedestalRow: 20,
		pedestalHeight: 8,
	};

	it('reclaims the body it just transferred out of first', () => {
		const world = makeWorld({
			objects: [obj(GameObjType.SYNTHOID, 9, 10, 4), obj(GameObjType.SYNTHOID, 10, 10, 4)],
			previousBody: { col: 9, row: 10 },
		});
		const step = planNextStep(world, assault, computeHopField(world, assault)).step!;
		expect(step.action).toBe('absorb');
		expect({ col: step.col, row: step.row }).toEqual({ col: 9, row: 10 });
	});

	it('will not reclaim once the Sentinel is gone and absorption is locked', () => {
		const world = makeWorld({
			objects: [obj(GameObjType.SYNTHOID, 9, 10, 4), obj(GameObjType.SYNTHOID, 10, 10, 4)],
			previousBody: { col: 9, row: 10 },
			sentinelAbsorbed: true,
		});
		expect(planNextStep(world, assault, computeHopField(world, assault)).step!.action).not.toBe('absorb');
	});

	it('transfers into a body standing closer to the assault tile', () => {
		const world = makeWorld({
			objects: [obj(GameObjType.SYNTHOID, 10, 10, 4), obj(GameObjType.SYNTHOID, 6, 6, 4)],
		});
		const step = planNextStep(world, assault, computeHopField(world, assault)).step!;
		expect(step.action).toBe('transfer');
		expect({ col: step.col, row: step.row }).toEqual({ col: 6, row: 6 });
	});

	it('harvests when short of what the endgame will cost', () => {
		const world = makeWorld({
			energy: 4,
			objects: [obj(GameObjType.SYNTHOID, 10, 10, 4), obj(GameObjType.TREE, 12, 10, 4)],
		});
		const step = planNextStep(world, assault, computeHopField(world, assault)).step!;
		expect(step.action).toBe('absorb');
		expect({ col: step.col, row: step.row }).toEqual({ col: 12, row: 10 });
	});

	it('leaves the trees alone once it has banked enough', () => {
		const world = makeWorld({
			energy: 40,
			objects: [obj(GameObjType.SYNTHOID, 10, 10, 4), obj(GameObjType.TREE, 12, 10, 4)],
		});
		expect(planNextStep(world, assault, computeHopField(world, assault)).step!.action).not.toBe('absorb');
	});

	it('never harvests the Sentinel', () => {
		const world = makeWorld({
			energy: 4,
			objects: [obj(GameObjType.SYNTHOID, 10, 10, 4), obj(GameObjType.SENTINEL, 20, 20, 9)],
		});
		expect(planNextStep(world, assault, computeHopField(world, assault)).step!.action).not.toBe('absorb');
	});

	it('walks by putting a body down at an ordinary destination', () => {
		// Goal level with the body, so no climbing is called for and the hop is a plain one.
		const level = { ...assault, tileHeight: 4 };
		const world = makeWorld({
			energy: 40,
			objects: [obj(GameObjType.SYNTHOID, 10, 10, 4)],
			// Short sight, so the goal is out of one hop's reach and the destination is an
			// intermediate tile — which needs no pile of its own, just a body.
			canSeeFrom: (fromCol, fromRow, _stand, col, row) => Math.hypot(col - fromCol, row - fromRow) <= 5,
		});
		const step = planNextStep(world, level, computeHopField(world, level)).step!;
		expect(step.action).toBe('create-synthoid');
		expect({ col: step.col, row: step.row }).not.toEqual({ col: level.col, row: level.row });
	});

	// Folding the climb into the hop: with the goal above us, the tile we're moving to gets a
	// boulder on the way in. The bot used to land on higher ground and only then spend a second
	// full cycle — boulder, body, transfer — lifting itself on a neighbouring tile.
	it('raises a boulder on the hop itself when the goal is above us', () => {
		const world = makeWorld({
			energy: 40,
			objects: [obj(GameObjType.SYNTHOID, 10, 10, 4)],
			canSeeFrom: (fromCol, fromRow, _stand, col, row) => Math.hypot(col - fromCol, row - fromRow) <= 5,
		});
		const step = planNextStep(world, assault, computeHopField(world, assault)).step!;
		expect(step.action).toBe('create-boulder');
		expect(step.label).toMatch(/^raise pile 1\//);
	});

	// The assault tile is the one destination that needs its pile raised before the body goes
	// down: once standing there, the bot can't build underneath itself, so arriving at ground
	// level would strand it a boulder short of seeing the pedestal top.
	it('raises the assault pile before stepping onto the assault tile', () => {
		const world = makeWorld({ energy: 40, objects: [obj(GameObjType.SYNTHOID, 10, 10, 4)] });
		const step = planNextStep(world, assault, computeHopField(world, assault)).step!;
		expect(step.action).toBe('create-boulder');
		expect({ col: step.col, row: step.row }).toEqual({ col: assault.col, row: assault.row });
	});
	it('raises the pile before the body when the destination is a climb', () => {
		// Body pinned in a hollow: the goal is above the surrounding ground, so the destination
		// needs boulders under the body before it can move in.
		const world = makeWorld({
			baseHeight: 6,
			heights: { '10_10': 4, '9_10': 4 },
			energy: 40,
			objects: [obj(GameObjType.SYNTHOID, 10, 10, 4)],
			body: { col: 10, row: 10, height: 4, onPedestal: false },
		});
		const climbAssault = { ...assault, col: 20, row: 10, tileHeight: 6 };
		const step = planNextStep(world, climbAssault, computeHopField(world, climbAssault)).step!;
		expect(step.action).toBe('create-boulder');
		expect({ col: step.col, row: step.row }).toEqual({ col: 9, row: 10 });
	});

	/*
	 Boxed in: standing on the map's floor with every neighbour higher. Nothing above the eye can
	 be targeted, which rules out building on the surrounding ground and absorbing anything on it
	 alike, so there is no legal move — except the one a player would reach for. Nine landscapes
	 in a hundred used to end with the bot standing here for four minutes, purse untouched.
	*/
	/*
	 A watcher chewing on the half-built pile turns its top boulder into a tree, and canPlaceAt
	 refuses any stack that isn't all boulders — so the assault tile becomes permanently
	 unbuildable and the bot circles for the rest of the run. Observed on landscape 272.
	*/
	it('clears the assault tile when a drain has fouled it', () => {
		const world = makeWorld({
			energy: 30,
			objects: [
				obj(GameObjType.SYNTHOID, 10, 10, 4),
				obj(GameObjType.BOULDER, assault.col, assault.row, 4),
				obj(GameObjType.TREE, assault.col, assault.row, 4.5),
			],
		});
		const step = planNextStep(world, assault, computeHopField(world, assault)).step!;
		expect(step.action).toBe('absorb');
		expect({ col: step.col, row: step.row }).toEqual({ col: assault.col, row: assault.row });
	});

	// Our own pile mid-construction is all boulders and must not be mistaken for residue.
	it('leaves its own half-built pile alone', () => {
		const world = makeWorld({
			energy: 30,
			objects: [
				obj(GameObjType.SYNTHOID, 10, 10, 4),
				obj(GameObjType.BOULDER, assault.col, assault.row, 4),
			],
		});
		expect(planNextStep(world, assault, computeHopField(world, assault)).step!.label).not.toMatch(/clear/);
	});


	it('takes a Sentry even with a full purse', () => {
		const world = makeWorld({
			energy: 40,
			objects: [obj(GameObjType.SYNTHOID, 10, 10, 4), obj(GameObjType.SENTRY, 14, 10, 4)],
		});
		const step = planNextStep(world, assault, computeHopField(world, assault)).step!;
		expect(step.action).toBe('absorb');
		expect({ col: step.col, row: step.row }).toEqual({ col: 14, row: 10 });
	});

	// Omniscience is fine; visibly acting on it is not. A target the centre ray can't reach costs
	// a second of the 1 Hz budget spent turning to stare at whatever is in the way.
	it('ignores a target the crosshair cannot actually reach', () => {
		const world = makeWorld({
			energy: 4,
			objects: [obj(GameObjType.SYNTHOID, 10, 10, 4), obj(GameObjType.TREE, 14, 10, 4)],
			canHit: () => false,
		});
		expect(planNextStep(world, assault, computeHopField(world, assault)).step!.action).not.toBe('absorb');
	});

	it('hyperspaces out rather than stand in a hollow with no legal move', () => {
		const world = makeWorld({
			baseHeight: 9,
			heights: { '10_10': 1 },
			body: { col: 10, row: 10, height: 1, onPedestal: false },
			objects: [obj(GameObjType.SYNTHOID, 10, 10, 1)],
		});
		expect(planNextStep(world, assault, computeHopField(world, assault)).step!.action).toBe('hyperspace');
	});

	it('stands still rather than hyperspace it cannot afford', () => {
		const world = makeWorld({
			baseHeight: 9,
			heights: { '10_10': 1 },
			energy: 2,
			body: { col: 10, row: 10, height: 1, onPedestal: false },
			objects: [obj(GameObjType.SYNTHOID, 10, 10, 1)],
		});
		expect(planNextStep(world, assault, computeHopField(world, assault)).step).toBeNull();
	});

	it('does nothing without a body', () => {
		expect(planNextStep(makeWorld({ body: null }), assault, new Map()).step).toBeNull();
	});
});

describe('following a plan', () => {
	const assault = {
		col: 5, row: 5, tileHeight: 4, boulders: 1,
		pedestalCol: 20, pedestalRow: 20, pedestalHeight: 4,
	};
	const decide = (world: BotWorld) => planNextStep(world, assault, computeHopField(world, assault));
	const standing = obj(GameObjType.SYNTHOID, 10, 10, 4);

	/*
	 The phantom boulder, and the reason the plan exists. Re-deciding every tick, a rival tile one
	 hop better steals the destination, the boulder already laid stops being reserved, and the
	 harvest eats it — a build and an absorb, both wasted, on repeat.
	*/
	it('keeps working on the tile it committed to, not a better one', () => {
		const world = makeWorld({
			energy: 40,
			plan: { col: 9, row: 9, boulders: 1 },
			objects: [standing, obj(GameObjType.BOULDER, 9, 9, 4)],
		});
		const decision = decide(world);
		expect({ col: decision.step!.col, row: decision.step!.row }).toEqual({ col: 9, row: 9 });
		expect(decision.plan).toEqual({ col: 9, row: 9, boulders: 1 });
	});

	it('forms a plan when it has none, and reports it', () => {
		const world = makeWorld({ energy: 40, objects: [standing] });
		const decision = decide(world);
		expect(decision.plan).not.toBeNull();
		expect({ col: decision.step!.col, row: decision.step!.row }).toEqual({
			col: decision.plan!.col,
			row: decision.plan!.row,
		});
	});

	it('rebuilds a boulder a watcher took, rather than abandoning the tile', () => {
		// Plan wants two boulders, the stack is empty again — the answer is another boulder, not
		// a new destination. A stolen boulder leaves the snapshot entirely, so this is what theft
		// actually looks like from the planner's side.
		const world = makeWorld({ energy: 40, plan: { col: 9, row: 9, boulders: 2 }, objects: [standing] });
		const decision = decide(world);
		expect(decision.step!.action).toBe('create-boulder');
		expect({ col: decision.step!.col, row: decision.step!.row }).toEqual({ col: 9, row: 9 });
	});

	describe('giving up', () => {
		const viable = (extra: Parameters<typeof makeWorld>[0], plan = { col: 9, row: 9, boulders: 1 }) => {
			const world = makeWorld({ energy: 40, plan, objects: [standing], ...extra });
			return isPlanViable(world, plan, world.body!);
		};

		it('holds while the tile is still workable', () => {
			expect(viable({})).toBe(true);
		});

		it('drops it on arrival', () => {
			expect(viable({ body: { col: 9, row: 9, height: 4, onPedestal: false } })).toBe(false);
		});

		// A drain turns our boulder into a tree and canPlaceAt will never accept the stack again.
		it('drops it when a drain fouls the tile', () => {
			expect(viable({ objects: [standing, obj(GameObjType.TREE, 9, 9, 4)] })).toBe(false);
		});

		it('drops it when the tile is built past what the plan wanted', () => {
			expect(
				viable({
					objects: [
						standing,
						obj(GameObjType.BOULDER, 9, 9, 4),
						obj(GameObjType.BOULDER, 9, 9, 4.5),
						obj(GameObjType.SYNTHOID, 9, 9, 5),
					],
				})
			).toBe(false);
		});

		// Pushed elsewhere by a forced hyperspace: the target is above the eye now, so no action
		// there is possible however much of the pile is standing.
		it('drops it when the tile is out of reach', () => {
			expect(viable({ heights: { '9_9': 9 } })).toBe(false);
		});

		it('drops it when the tile is no longer in sight', () => {
			expect(viable({ canSeeFrom: () => false })).toBe(false);
		});

		// Commitment without this is stubbornness: the plan pins the bot to a tile the crosshair
		// has already failed to reach, and it re-aims at the same obstruction every decision.
		it('drops it when the crosshair has already been refused there', () => {
			expect(viable({ isBlocked: (col, row) => col === 9 && row === 9 })).toBe(false);
		});
	});
});

describe('the endgame', () => {
	const assault = {
		col: 5,
		row: 5,
		tileHeight: 8,
		boulders: 1,
		pedestalCol: 20,
		pedestalRow: 20,
		pedestalHeight: 8,
	};
	// On the assault tile, up on its single boulder: eye at 8.5 + 0.875, clear of the pedestal
	// top at 9. This is the position the whole walk exists to reach.
	const inPosition = { col: 5, row: 5, height: 8.5, onPedestal: false };
	const pedestal = obj(GameObjType.PEDESTAL, 20, 20, 8);
	const endgameWorld = (objects: BotObject[], extra: Partial<BotWorld> = {}) =>
		makeWorld({ baseHeight: 8, energy: 20, body: inPosition, objects, ...extra });

	const plan = (world: BotWorld) => planNextStep(world, assault, computeHopField(world, assault)).step!;

	it('takes the Sentinel first', () => {
		const step = plan(endgameWorld([pedestal, obj(GameObjType.SENTINEL, 20, 20, 9)]));
		expect(step.action).toBe('absorb');
		expect({ col: step.col, row: step.row }).toEqual({ col: 20, row: 20 });
	});

	it('stands a body on the pedestal once it is clear', () => {
		const step = plan(endgameWorld([pedestal], { sentinelAbsorbed: true }));
		expect(step.action).toBe('create-synthoid');
		expect({ col: step.col, row: step.row }).toEqual({ col: 20, row: 20 });
	});

	it('moves into the body on the pedestal', () => {
		const step = plan(endgameWorld([pedestal, obj(GameObjType.SYNTHOID, 20, 20, 9)], { sentinelAbsorbed: true }));
		expect(step.action).toBe('transfer');
		expect({ col: step.col, row: step.row }).toEqual({ col: 20, row: 20 });
	});

	it('hyperspaces out once standing on the pedestal', () => {
		const world = endgameWorld([pedestal, obj(GameObjType.SYNTHOID, 20, 20, 9)], {
			sentinelAbsorbed: true,
			body: { col: 20, row: 20, height: 9, onPedestal: true },
		});
		expect(plan(world).action).toBe('hyperspace');
	});

	// Absorption locks the moment the Sentinel goes, so from then on the endgame must stay in
	// charge to the end. Handing back to the walk here cost a win: the bot stepped onto the
	// pedestal, stopped counting as "in assault position", and was promptly transferred off it.
	it('keeps control after the Sentinel is gone, even away from the assault tile', () => {
		const world = endgameWorld([pedestal, obj(GameObjType.SYNTHOID, 20, 20, 9)], {
			sentinelAbsorbed: true,
			body: { col: 12, row: 12, height: 8, onPedestal: false },
		});
		const step = plan(world);
		expect(step.action).toBe('transfer');
		expect({ col: step.col, row: step.row }).toEqual({ col: 20, row: 20 });
	});

});
