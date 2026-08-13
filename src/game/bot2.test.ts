import { describe, it, expect } from 'vitest';
import { GameObjType, MAP_SIZE } from '../world/terrain';
import { PhasePlanner, coverPreference } from './bot2';
import type { BotObject, BotWorld } from './botWorld';

/*
 Coverage for what makes v2 v2 — the phase split, value-ordered harvesting, the perch, and cover
 graded by time rather than by "is anything looking now". The machinery it shares with v1 (the walk,
 the pile arithmetic, the endgame) is covered by bot.test.ts and not repeated here.
*/

// A flat synthetic landscape with a pedestal at (20,20) on an 8-high mound, one tile level with it
// at (5,5) — so the assault tile is (5,5) with a single boulder — and the body wherever the test
// puts it. Same shape as bot.test.ts's, kept local so the two can drift apart if they need to.
function makeWorld(options: Partial<BotWorld> & { heights?: Record<string, number> } = {}): BotWorld {
	const map = new Array(MAP_SIZE * MAP_SIZE).fill(7);
	const heights = { '20_20': 8, '5_5': 8, ...(options.heights ?? {}) };
	for (const [key, height] of Object.entries(heights)) {
		const [col, row] = key.split('_').map(Number);
		map[row * MAP_SIZE + col] = height;
	}
	const objects = options.objects ?? [];
	return {
		map,
		isFlat: () => true,
		objects,
		objectsAt: (col, row) => objects.filter(o => o.col === col && o.row === row),
		canPlace: (col, row) => {
			const stack = objects.filter(o => o.col === col && o.row === row);
			return stack.length === 0 || stack.every(o => o.type === GameObjType.BOULDER);
		},
		canSeeFrom: () => true,
		isWatched: () => false,
		isInSight: () => false,
		ticksUntilSeen: () => Infinity,
		willBeSeenWithin: () => false,
		canHit: () => true,
		isBlocked: () => false,
		energy: 30,
		body: { col: 10, row: 10, height: 7, onPedestal: false },
		previousBody: null,
		sentinelAbsorbed: false,
		targetJump: null,
		...options,
	};
}

const obj = (type: GameObjType, col: number, row: number, height: number): BotObject => ({
	type,
	col,
	row,
	height,
	aimHeight: height + 0.5,
});

const pedestal = obj(GameObjType.PEDESTAL, 20, 20, 8);
const sentinel = obj(GameObjType.SENTINEL, 20, 20, 9);

// A planner that has already surveyed, which every decision depends on.
function planner(world: BotWorld): PhasePlanner {
	const p = new PhasePlanner();
	p.survey(world);
	return p;
}

// Standing on the assault tile (5,5) on its one boulder — high enough to see the pedestal top,
// which is what latches the perch.
const onAssault = { col: 5, row: 5, height: 8.5, onPedestal: false };

describe('coverPreference', () => {
	// The distinction v1 cannot draw: its middle tier lumps "clear for the next forty seconds" in
	// with "a cone arrives next second", and only the first is somewhere to build.
	it('separates durable cover from a tile about to be looked at', () => {
		const world = makeWorld({ ticksUntilSeen: (col: number) => (col === 1 ? 0 : col === 2 ? 4 : 200) });
		const prefer = coverPreference(world);
		expect(prefer.grade(1, 0)).toBe(2); // looked at right now
		expect(prefer.grade(2, 0)).toBe(1); // cover expires before we could finish
		expect(prefer.grade(3, 0)).toBe(0); // clear for long enough
	});

	/*
	 Landscape 60: the bot kept starting towers on tiles a cone reached before they were finished.
	 A fixed cover figure is wrong at both ends — what matters is how many actions the job takes,
	 four ticks each, so a taller pile demands proportionally longer cover.
	*/
	it('demands longer cover for a taller tower', () => {
		const world = makeWorld({ ticksUntilSeen: () => 20 });
		// A bare hop (12 ticks of work) is happy with 20 ticks of cover; a three-boulder tower
		// (24 ticks) is not.
		expect(coverPreference(world, 0).grade(3, 3)).toBe(0);
		expect(coverPreference(world, 3).grade(3, 3)).toBe(1);
	});
});

describe('phases', () => {
	it('climbs toward the assault tile before it starts banking', () => {
		// Trees everywhere within reach, a full purse, and no perch yet: the answer is to get on
		// with the climb, not to shop.
		const world = makeWorld({
			energy: 40,
			objects: [pedestal, sentinel, obj(GameObjType.TREE, 9, 10, 7), obj(GameObjType.TREE, 11, 10, 7)],
		});
		const step = planner(world).decide(world)!;
		expect(step.label).not.toMatch(/harvest/);
		expect(step.action).toMatch(/create-/);
	});

	it('tops up when it cannot afford to move', () => {
		const world = makeWorld({
			energy: 1,
			objects: [pedestal, sentinel, obj(GameObjType.TREE, 9, 10, 7)],
		});
		const step = planner(world).decide(world)!;
		expect(step.action).toBe('absorb');
		expect({ col: step.col, row: step.row }).toEqual({ col: 9, row: 10 });
	});

	/*
	 The change this planner exists for. v1 stops harvesting once it can afford the endgame and goes
	 straight to the pedestal, banking 41% of what the landscape could fund; the jump you win is the
	 energy you have left, so from the perch everything reachable goes in the purse.
	*/
	it('harvests from the perch even with the endgame already affordable', () => {
		const world = makeWorld({
			energy: 40,
			body: onAssault,
			objects: [pedestal, sentinel, obj(GameObjType.BOULDER, 5, 5, 8), obj(GameObjType.TREE, 9, 10, 7)],
		});
		const step = planner(world).decide(world)!;
		expect(step.label).toMatch(/harvest/);
		expect({ col: step.col, row: step.row }).toEqual({ col: 9, row: 10 });
	});

	it('takes the most valuable thing in reach first', () => {
		// A tree is nearer, but a boulder is worth twice as much and absorbing needs no travel.
		const world = makeWorld({
			energy: 40,
			body: onAssault,
			objects: [
				pedestal,
				sentinel,
				obj(GameObjType.BOULDER, 5, 5, 8),
				obj(GameObjType.TREE, 6, 5, 7),
				obj(GameObjType.BOULDER, 9, 9, 7),
			],
		});
		const step = planner(world).decide(world)!;
		expect({ col: step.col, row: step.row }).toEqual({ col: 9, row: 9 });
	});

	it('finishes once the landscape is picked clean', () => {
		const world = makeWorld({
			energy: 40,
			body: onAssault,
			objects: [pedestal, sentinel, obj(GameObjType.BOULDER, 5, 5, 8)],
		});
		const step = planner(world).decide(world)!;
		// Nothing left to fetch, so the endgame starts: the Sentinel goes first.
		expect(step.action).toBe('absorb');
		expect({ col: step.col, row: step.row }).toEqual({ col: 20, row: 20 });
	});
});

describe('the perch', () => {
	const perchBody = obj(GameObjType.SYNTHOID, 5, 5, 8.5);

	// Latched on arrival and held for the rest of the landscape: stepping off to collect something
	// makes inAssaultPosition false, and a planner that re-derived its phase from that would decide
	// it was back to climbing and start again somewhere else.
	const arrived = (world: BotWorld) => {
		const p = new PhasePlanner();
		p.survey(world);
		p.decide(makeWorld({ ...world, body: onAssault } as Partial<BotWorld>));
		return p;
	};

	it('never eats the body it left standing on the pile', () => {
		// Off the perch, collecting: previousBody points at the perch, and the reclaim rung would
		// otherwise absorb the one thing that is the way back up.
		const world = makeWorld({
			energy: 40,
			body: { col: 9, row: 9, height: 7, onPedestal: false },
			previousBody: { col: 5, row: 5 },
			objects: [pedestal, sentinel, obj(GameObjType.BOULDER, 5, 5, 8), perchBody],
		});
		const step = arrived(world).decide(world)!;
		const eatsPerch = step.action === 'absorb' && step.col === 5 && step.row === 5;
		expect(eatsPerch).toBe(false);
	});

	it('goes home to the perch rather than treating it as just another body', () => {
		// Nothing left on the ground, so the only thing to do is get back up and finish. The perch
		// is neither nearer the goal in a straight line nor higher than a body standing next to it,
		// so it is chosen because it is the perch.
		const world = makeWorld({
			energy: 40,
			body: { col: 9, row: 9, height: 7, onPedestal: false },
			objects: [pedestal, sentinel, obj(GameObjType.BOULDER, 5, 5, 8), perchBody],
		});
		const step = arrived(world).decide(world)!;
		expect(step.action).toBe('transfer');
		expect({ col: step.col, row: step.row }).toEqual({ col: 5, row: 5 });
	});
});

/*
 Landscape 42, reported from watching the demo: the bot stood in front of a Sentry it could plainly
 shoot, refused, built a body beside it instead, and eventually hyperspaced away.

 The Sentry had been generated *on the assault tile*. Reserving that tile is right for the pile the
 bot builds there and wrong for anything the landscape put there first: neither the Sentry rung nor
 the harvest rung would touch it, so the one tile the whole plan depends on could never be cleared,
 the perch was never reached, and the walk had nowhere left to go.
*/
describe('an obstacle on the assault tile', () => {
	const sentryOnAssault = obj(GameObjType.SENTRY, 5, 5, 8);

	it('absorbs a Sentry standing on it rather than reserving it', () => {
		const world = makeWorld({ energy: 30, objects: [pedestal, sentinel, sentryOnAssault] });
		const step = planner(world).decide(world)!;
		expect(step.action).toBe('absorb');
		expect({ col: step.col, row: step.row }).toEqual({ col: 5, row: 5 });
	});

	it('still protects its own pile there', () => {
		const world = makeWorld({
			energy: 30,
			objects: [pedestal, sentinel, obj(GameObjType.BOULDER, 5, 5, 8), obj(GameObjType.TREE, 9, 9, 7)],
		});
		const step = planner(world).decide(world)!;
		const eatsOwnPile = step.action === 'absorb' && step.col === 5 && step.row === 5;
		expect(eatsOwnPile).toBe(false);
	});
});

/*
 Landscape 106: a drain turned the assault pile into a tree while a forced hyperspace dropped the bot
 below the tile, and absorbing a tree needs line of sight — which the picker does not — so the bot
 proposed an absorb the rules could never accept. The failure blacklist clears whenever the body
 moves, so it re-proposed it for the rest of the landscape.
*/
describe('an assault tile it cannot clear', () => {
	const fouled = obj(GameObjType.TREE, 5, 5, 8);

	it('does not propose a clear it has no line of sight for', () => {
		const world = makeWorld({
			energy: 30,
			objects: [pedestal, sentinel, fouled],
			// Everything visible except the assault tile itself.
			canSeeFrom: (_fc, _fr, _sh, col, row) => !(col === 5 && row === 5),
		});
		const step = planner(world).decide(world);
		const clearing = step?.label === 'clear the assault tile';
		expect(clearing).toBe(false);
	});

	// With one there is nothing to fall back to; the point is that it keeps playing rather than
	// standing in front of an impossible absorb until the clock runs out.
	it('takes a different assault tile when it keeps failing to clear this one', () => {
		const world = makeWorld({
			energy: 30,
			heights: { '20_20': 8, '5_5': 8, '7_7': 8 },
			objects: [pedestal, sentinel, fouled],
			canSeeFrom: (_fc, _fr, _sh, col, row) => !(col === 5 && row === 5),
		});
		const p = planner(world);
		for (let i = 0; i < 8; i++) p.decide(world);
		// It has moved on to the other tile level with the pedestal.
		const step = p.decide(world);
		expect(step).not.toBeNull();
		expect(step!.label).not.toBe('clear the assault tile');
	});
});

/*
 Landscape 106, reported from watching: the bot reached a winning position beside the pedestal and
 then walked away from it, building a bare synthoid and eventually hyperspacing.

 It was standing one tile over from the one the survey had nominated. The old test asked "am I on
 that tile"; what the finish actually needs is a sightline to the pedestal top from an eye above it,
 which the bot already had. It was pursuing a goal it had achieved somewhere else.
*/
describe('recognising a winning position', () => {
	// A second tile level with the pedestal, which the survey did not pick.
	const elsewhere = { col: 7, row: 7, height: 8.5, onPedestal: false };

	it('starts the endgame from any tile that can see the pedestal top', () => {
		const world = makeWorld({
			energy: 30,
			heights: { '20_20': 8, '5_5': 8, '7_7': 8 },
			body: elsewhere,
			objects: [pedestal, sentinel, obj(GameObjType.BOULDER, 7, 7, 8)],
		});
		const step = planner(world).decide(world)!;
		expect(step.action).toBe('absorb');
		expect({ col: step.col, row: step.row }).toEqual({ col: 20, row: 20 });
	});

	it('does not start it from a tile too low to see over the pedestal', () => {
		const world = makeWorld({
			energy: 30,
			heights: { '20_20': 8, '5_5': 8, '7_7': 8 },
			// On the tile but with no pile: eye at 8.875, pedestal top at 9.
			body: { col: 7, row: 7, height: 8, onPedestal: false },
			objects: [pedestal, sentinel],
		});
		const step = planner(world).decide(world)!;
		const absorbingSentinel = step.action === 'absorb' && step.col === 20 && step.row === 20;
		expect(absorbingSentinel).toBe(false);
	});

	it('respects line of sight, not just height', () => {
		const world = makeWorld({
			energy: 30,
			heights: { '20_20': 8, '5_5': 8, '7_7': 8 },
			body: elsewhere,
			objects: [pedestal, sentinel, obj(GameObjType.BOULDER, 7, 7, 8)],
			// High enough, but from *this* tile the pedestal top is behind something. Blocking it
			// globally would leave the survey with no assault tile at all and prove nothing.
			canSeeFrom: (fromCol, fromRow, _sh, col, row) =>
				!(fromCol === 7 && fromRow === 7 && col === 20 && row === 20),
		});
		const step = planner(world).decide(world)!;
		const absorbingSentinel = step.action === 'absorb' && step.col === 20 && step.row === 20;
		expect(absorbingSentinel).toBe(false);
	});
});

/*
 Landscape 246, reported from watching: the demo reached it unaided from landscape 0 and died in the
 first five seconds. The start is watched and every tile with cover is *below* it, so the walk found
 nothing acceptable and took its least-bad option — a tile a cone was on — twice, losing both bodies
 to the drain before it could transfer in. Ten energy, gone, in five seconds.

 A tile under a cone right now is not a bad choice but an impossible one: the drain phase runs at
 1 Hz and takes the topmost Synthoid, so the body is eaten before the transfer completes. Refusing it
 outright leaves the walk with nothing, which is the correct answer — the bot then hyperspaces out.
*/
describe('a tile under a cone right now', () => {
	it('is refused even when it is the only thing reachable', () => {
		const inSight = (col: number, row: number) => !(col === 10 && row === 10);
		const world = makeWorld({
			energy: 10,
			objects: [pedestal, sentinel],
			// Everything except where we stand is being looked at.
			ticksUntilSeen: (col, row) => (inSight(col, row) ? 0 : Infinity),
			isInSight: (col, row) => inSight(col, row),
		});
		const step = planner(world).decide(world);
		// Nothing worth building, so it does not spend five energy feeding the drain.
		const buildsIntoACone = step !== null && step.action.startsWith('create-');
		expect(buildsIntoACone).toBe(false);
	});

	it('still accepts a tile that is merely watched, not looked at', () => {
		const world = makeWorld({
			energy: 10,
			objects: [pedestal, sentinel],
			// Seen eventually, but not now — survivable, and better than standing still.
			ticksUntilSeen: () => 6,
			isInSight: () => false,
		});
		const step = planner(world).decide(world)!;
		expect(step.action).toMatch(/create-/);
	});
});
