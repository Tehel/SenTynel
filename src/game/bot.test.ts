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
		canPlace: (col, row) => objects.filter(o => o.col === col && o.row === row).length === 0,
		// Optimistic by default: everything is in sight. Tests that care override it.
		canSeeFrom: () => true,
		isWatched: () => false,
		isBlocked: () => false,
		energy: 30,
		body: { col: 10, row: 10, height: base, onPedestal: false },
		previousBody: null,
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
		const world = makeWorld({ isBlocked: nearGoal });
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
		const step = planNextStep(world, assault, computeHopField(world, assault))!;
		expect(step.action).toBe('absorb');
		expect({ col: step.col, row: step.row }).toEqual({ col: 9, row: 10 });
	});

	it('will not reclaim once the Sentinel is gone and absorption is locked', () => {
		const world = makeWorld({
			objects: [obj(GameObjType.SYNTHOID, 9, 10, 4), obj(GameObjType.SYNTHOID, 10, 10, 4)],
			previousBody: { col: 9, row: 10 },
			sentinelAbsorbed: true,
		});
		expect(planNextStep(world, assault, computeHopField(world, assault))!.action).not.toBe('absorb');
	});

	it('transfers into a body standing closer to the assault tile', () => {
		const world = makeWorld({
			objects: [obj(GameObjType.SYNTHOID, 10, 10, 4), obj(GameObjType.SYNTHOID, 6, 6, 4)],
		});
		const step = planNextStep(world, assault, computeHopField(world, assault))!;
		expect(step.action).toBe('transfer');
		expect({ col: step.col, row: step.row }).toEqual({ col: 6, row: 6 });
	});

	it('harvests when short of what the endgame will cost', () => {
		const world = makeWorld({
			energy: 4,
			objects: [obj(GameObjType.SYNTHOID, 10, 10, 4), obj(GameObjType.TREE, 12, 10, 4)],
		});
		const step = planNextStep(world, assault, computeHopField(world, assault))!;
		expect(step.action).toBe('absorb');
		expect({ col: step.col, row: step.row }).toEqual({ col: 12, row: 10 });
	});

	it('leaves the trees alone once it has banked enough', () => {
		const world = makeWorld({
			energy: 40,
			objects: [obj(GameObjType.SYNTHOID, 10, 10, 4), obj(GameObjType.TREE, 12, 10, 4)],
		});
		expect(planNextStep(world, assault, computeHopField(world, assault))!.action).not.toBe('absorb');
	});

	it('never harvests the Sentinel', () => {
		const world = makeWorld({
			energy: 4,
			objects: [obj(GameObjType.SYNTHOID, 10, 10, 4), obj(GameObjType.SENTINEL, 20, 20, 9)],
		});
		expect(planNextStep(world, assault, computeHopField(world, assault))!.action).not.toBe('absorb');
	});

	it('walks by putting a body down at the destination', () => {
		const world = makeWorld({ energy: 40, objects: [obj(GameObjType.SYNTHOID, 10, 10, 4)] });
		expect(planNextStep(world, assault, computeHopField(world, assault))!.action).toBe('create-synthoid');
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
		const step = planNextStep(world, climbAssault, computeHopField(world, climbAssault))!;
		expect(step.action).toBe('create-boulder');
		expect({ col: step.col, row: step.row }).toEqual({ col: 9, row: 10 });
	});

	it('does nothing without a body', () => {
		expect(planNextStep(makeWorld({ body: null }), assault, new Map())).toBeNull();
	});
});
