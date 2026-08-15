import { describe, it, expect } from 'vitest';
import { MAP_SIZE } from '../world/terrain';
import { bearingUnits, ticksUntilBearingCovered, type ConeState } from './cone';
import {
	buildExposureMap,
	canEverSee,
	minVisibleHeightFor,
	nextExposure,
	nextExposureByWatcher,
	readExposure,
	resolveClocks,
	TURN_CYCLE,
	WATCHER_EYE_HEIGHT,
	type ExposureWatcher,
	type WatcherClock,
} from './exposure';

// The generator's rotation step (world/terrain.ts) and turn period (world/objects/watcher.ts).
const STEP = 20;
const PERIOD = 48;
const FAR = 100_000;

const flatMap = (height = 1) => new Array(MAP_SIZE * MAP_SIZE).fill(height);

const watcherAt = (over: Partial<ExposureWatcher> = {}): ExposureWatcher => ({
	col: 5,
	row: 5,
	height: 1,
	rot: 0,
	step: STEP,
	...over,
});

const clockFor = (w: ExposureWatcher, over: Partial<WatcherClock> = {}): WatcherClock => ({
	rot: w.rot,
	ticksToTurn: PERIOD,
	turnPeriodTicks: PERIOD,
	drainLocked: false,
	turning: false,
	...over,
});

describe('the cone half of the map', () => {
	/*
	 The load-bearing test. On flat ground every cell has a clear sightline, so the map's answer
	 must reduce to game/cone.ts's already-verified closed form for every cell and every facing.
	 That checks the mask build, the 64-bit packing, the turn-index resolution and the read
	 arithmetic in one go, against an independent implementation rather than against itself.
	*/
	// Eight full map builds over every cell — the heaviest test in the file by a wide margin, so
	// it carries its own timeout rather than living under the 5 s default.
	it('reproduces ticksUntilBearingCovered on open ground', () => {
		const map = flatMap();
		for (const step of [STEP, -STEP]) {
			for (const rot of [0, 37, 128, 251]) {
				const w = watcherAt({ rot, step });
				const exposure = buildExposureMap(map, [w]);
				const resolved = resolveClocks(exposure, [clockFor(w)]);
				const state: ConeState = {
					col: w.col,
					row: w.row,
					rot,
					step,
					ticksUntilTurn: PERIOD,
					turnPeriodTicks: PERIOD,
				};
				for (let row = 0; row < MAP_SIZE - 1; row += 3) {
					for (let col = 0; col < MAP_SIZE - 1; col += 3) {
						if (col === w.col && row === w.row) continue;
						const bearing = bearingUnits(w.col, w.row, col, row)!;
						expect(nextExposure(exposure, resolved, col, row, 1, FAR)).toBe(
							ticksUntilBearingCovered(state, bearing, FAR)
						);
					}
				}
			}
		}
	}, 60_000);

	it('is read against the live facing, so a turned watcher needs no update', () => {
		const map = flatMap();
		const w = watcherAt({ rot: 0 });
		const exposure = buildExposureMap(map, [w]);

		// A cell the watcher is not facing at build time, but will be after some turns.
		const target = { col: 5, row: 0 };
		const atBuild = nextExposure(exposure, resolveClocks(exposure, [clockFor(w)]), target.col, target.row, 1, FAR);
		expect(atBuild).toBeGreaterThan(0);
		expect(atBuild).toBeLessThan(Infinity);

		// Wind the watcher forward to exactly the facing that covers it. The map is untouched:
		// only the clock moved, and the answer must fall to "in sight now".
		const turns = (atBuild - PERIOD) / PERIOD + 1;
		const turned = clockFor(w, { rot: (w.rot + STEP * turns) % 256 });
		expect(nextExposure(exposure, resolveClocks(exposure, [turned]), target.col, target.row, 1, FAR)).toBe(0);
	});

	/*
	 A drain-locked watcher holds its turn, so the engine's countdown runs to zero and past it.
	 The map has nothing to compensate for — it reads the frozen clock and reports the turn as
	 imminent, which is what the engine will do on the first tick the watcher goes idle.
	*/
	it('treats an overdue turn as due now rather than as time already served', () => {
		const map = flatMap();
		const w = watcherAt({ rot: 0 });
		const exposure = buildExposureMap(map, [w]);
		const ontime = nextExposure(exposure, resolveClocks(exposure, [clockFor(w)]), 5, 0, 1, FAR);
		const stalled = nextExposure(
			exposure,
			resolveClocks(exposure, [clockFor(w, { ticksToTurn: -12 })]),
			5,
			0,
			1,
			FAR
		);
		// One tick, not zero: a turn cannot resolve in no time, and zero is reserved for "the
		// watcher is looking at this cell right now" — see the next test.
		expect(stalled).toBe(ontime - PERIOD + 1);
	});

	/*
	 Reported from watching the overlay: a drain-locked Sentinel froze correctly, but the sector it
	 was ABOUT to turn into went fully red at 0.0 s while the turn was still held. A held turn is
	 "overdue" in the clock and "paused" in fact, and collapsing both onto zero made "you are being
	 watched" and "you would be watched the moment that watcher stops eating" indistinguishable —
	 opposite situations to be standing in.
	*/
	it('separates being watched from waiting on a held turn', () => {
		const map = flatMap();
		const w = watcherAt({ rot: 0 });
		const exposure = buildExposureMap(map, [w]);
		// rot 0 faces row-increasing, so 5,12 is in the cone now and 5,0 is not.
		const watched = { col: 5, row: 12 };
		const next = { col: 5, row: 0 };

		const held = resolveClocks(exposure, [clockFor(w, { ticksToTurn: -12, drainLocked: true })]);

		const onIt = readExposure(exposure, held, watched.col, watched.row, 1, FAR);
		expect(onIt.inSightNow).toBe(true);
		expect(onIt.ticks).toBe(0);
		// Being looked at is not "held", whatever the watcher is doing with its turn.
		expect(onIt.held).toBe(false);

		const pending = readExposure(exposure, held, next.col, next.row, 1, FAR);
		expect(pending.inSightNow).toBe(false);
		expect(pending.held).toBe(true);
		// The number stays conservative — earliest it could possibly happen — because the lock
		// breaks the moment the watcher runs out of food. Only the label says it is paused.
		expect(pending.ticks).toBeGreaterThan(0);

		// Same clock, lock released: the cell is no longer "held", just counting down.
		const running = resolveClocks(exposure, [clockFor(w, { ticksToTurn: -12, drainLocked: false })]);
		const released = readExposure(exposure, running, next.col, next.row, 1, FAR);
		expect(released.held).toBe(false);
		expect(released.ticks).toBe(pending.ticks);
	});

	/*
	 Reported from watching the overlay: mid-rotation, every ramped cell briefly jumped a whole
	 sector's worth further from red and then snapped back.

	 The cause is that `ticksToTurn` and `rot` describe different moments while a turn is in flight.
	 playTick resets the countdown the instant the turn is QUEUED; `rot` is not committed until the
	 animation ends TURN_DURATION_MS later. So for half a second the clock is fresh and the facing
	 is stale, and the sector the watcher is visibly rotating INTO reads as a whole period away.

	 The test walks the boundary the way the engine does — countdown expires, turn queues and the
	 clock resets while `rot` holds, then `rot` commits — and asserts the reported time never jumps
	 backwards. A smooth countdown is the whole point of the ramp.
	*/
	it('stays continuous across a turn that is still animating', () => {
		const map = flatMap();
		const w = watcherAt({ rot: 0 });
		const exposure = buildExposureMap(map, [w]);

		// Find a cell genuinely TWO turns out rather than guessing at one: with the countdown at
		// its last tick, that reads as 1 + one whole period. Clocks resolved once, not per cell.
		const ticking = resolveClocks(exposure, [clockFor(w, { ticksToTurn: 1 })]);
		const cell = (() => {
			for (let row = 0; row < MAP_SIZE - 1; row++)
				for (let col = 0; col < MAP_SIZE - 1; col++) {
					if (col === w.col && row === w.row) continue;
					if (nextExposure(exposure, ticking, col, row, 1, FAR) === 1 + PERIOD) return { col, row };
				}
			throw new Error('no cell two turns out — the fixture changed');
		})();

		const at = (clock: WatcherClock) =>
			nextExposure(exposure, resolveClocks(exposure, [clock]), cell.col, cell.row, 1, FAR);
		const twoTurnsOut = nextExposure(exposure, ticking, cell.col, cell.row, 1, FAR);
		expect(twoTurnsOut).toBe(1 + PERIOD);

		// The tick the turn queues: the clock resets to a full period, `rot` has NOT moved yet.
		const queued = at(clockFor(w, { ticksToTurn: PERIOD, turning: true }));
		// It must not have grown — that jump is exactly the flicker.
		expect(queued).toBeLessThanOrEqual(twoTurnsOut);

		// A couple of ticks later the animation finishes and `rot` commits, advancing the facing.
		const committed = at(clockFor(w, { rot: (w.rot + STEP) % 256, ticksToTurn: PERIOD - 2 }));
		expect(committed).toBeLessThanOrEqual(queued);

		// Without the `turning` correction the queued reading is a whole period too far out —
		// this is the bug, pinned, so a regression is unmistakable rather than merely a bit off.
		const uncorrected = at(clockFor(w, { ticksToTurn: PERIOD, turning: false }));
		expect(uncorrected - queued).toBe(PERIOD);
	});

	it('reports a cell the cone has already reached as zero ticks', () => {
		const map = flatMap();
		// rot 0 faces row-increasing (see game/cone.ts's bearing derivation).
		const w = watcherAt({ rot: 0 });
		const exposure = buildExposureMap(map, [w]);
		const resolved = resolveClocks(exposure, [clockFor(w)]);
		expect(nextExposure(exposure, resolved, 5, 12, 1, FAR)).toBe(0);
	});

	it('gives every cell 5 or 6 of the 64 facings — the duty cycle the map exists to expose', () => {
		const map = flatMap();
		const w = watcherAt();
		const exposure = buildExposureMap(map, [w]);
		const masks = exposure.coneMask[0];
		for (const [col, row] of [
			[5, 12],
			[12, 5],
			[0, 0],
			[20, 20],
			[5, 0],
		]) {
			const cell = row * MAP_SIZE + col;
			let bits = 0;
			for (let k = 0; k < TURN_CYCLE; k++) {
				const word = k < 32 ? masks[cell * 2] : masks[cell * 2 + 1];
				bits += (word >>> (k % 32)) & 1;
			}
			expect(bits).toBeGreaterThanOrEqual(5);
			expect(bits).toBeLessThanOrEqual(6);
		}
	});
});

describe('the height half of the map', () => {
	/*
	 A ridge lower than the watcher's eye. Terrain 1 everywhere, watcher standing at 4 (eye 4.9),
	 a flat-topped bank of height 3 across rows 7-8, target cell well beyond it.

	 This is the case a boolean "is this cell watched" map gets wrong in the dangerous direction:
	 the cell is hidden at ground level and exposed once something is built on it, because the
	 drain phase tests line of sight to the target's FOOT height (engine/watcher.ts).
	*/
	const ridgeWorld = () => {
		const map = flatMap();
		for (let col = 0; col < MAP_SIZE; col++) {
			for (const row of [7, 8]) map[row * MAP_SIZE + col] = 3;
			// The watcher's own plateau, so its eye really is at 4 + WATCHER_EYE_HEIGHT.
			for (const row of [1, 2, 3]) map[row * MAP_SIZE + col] = 4;
		}
		return map;
	};
	const ridgeWatcher = watcherAt({ col: 5, row: 2, height: 4 });

	it('hides the ground behind a ridge but not a pile built on it', () => {
		const map = ridgeWorld();
		const threshold = minVisibleHeightFor(map, ridgeWatcher, 5, 12);
		// Strictly above the ground there, and below the eye — so height decides it, both ways.
		expect(threshold).toBeGreaterThan(1);
		expect(threshold).toBeLessThan(ridgeWatcher.height + WATCHER_EYE_HEIGHT);

		const exposure = buildExposureMap(map, [ridgeWatcher]);
		expect(canEverSee(exposure, 0, 5, 12, 1)).toBe(false);
		expect(canEverSee(exposure, 0, 5, 12, 3)).toBe(true);
	});

	/*
	 engine/visibility.ts refuses any target at or above the eye outright ("standing level with a
	 tile shouldn't see it"), so the window has a ceiling as well as a floor. A pile tall enough
	 lifts its occupant out of a watcher's reach entirely — which is why the map stores a window
	 and not a threshold.
	*/
	it('puts a target at or above the eye out of reach', () => {
		const map = ridgeWorld();
		const exposure = buildExposureMap(map, [ridgeWatcher]);
		const eye = ridgeWatcher.height + WATCHER_EYE_HEIGHT;
		expect(canEverSee(exposure, 0, 5, 12, eye - 0.5)).toBe(true);
		expect(canEverSee(exposure, 0, 5, 12, eye)).toBe(false);
		expect(canEverSee(exposure, 0, 5, 12, eye + 2)).toBe(false);
	});

	it('never reports a time for a cell no height makes visible', () => {
		const map = flatMap();
		// A wall taller than the eye, right in front of the watcher: nothing behind it is ever
		// drainable, whatever is built there.
		for (let col = 0; col < MAP_SIZE; col++) {
			for (const row of [7, 8]) map[row * MAP_SIZE + col] = 9;
		}
		const w = watcherAt({ col: 5, row: 5, height: 1 });
		const exposure = buildExposureMap(map, [w]);
		const resolved = resolveClocks(exposure, [clockFor(w)]);
		expect(canEverSee(exposure, 0, 5, 12, 1)).toBe(false);
		expect(nextExposure(exposure, resolved, 5, 12, 1, FAR)).toBe(Infinity);
		// ...while the near side of the wall is unaffected.
		expect(canEverSee(exposure, 0, 5, 6, 1)).toBe(true);
	});
});

describe('several watchers', () => {
	it('reports the earliest exposure, and which watcher owns it', () => {
		const map = flatMap();
		const near = watcherAt({ col: 5, row: 5, rot: 0 });
		const far = watcherAt({ col: 20, row: 20, rot: 128 });
		const exposure = buildExposureMap(map, [near, far]);
		const resolved = resolveClocks(exposure, [clockFor(near), clockFor(far)]);
		const col = 5;
		const row = 12;
		const each = [0, 1].map(w => nextExposureByWatcher(exposure, resolved, w, col, row, 1, FAR));
		expect(nextExposure(exposure, resolved, col, row, 1, FAR)).toBe(Math.min(...each));
	});

	it('honours the horizon', () => {
		const map = flatMap();
		const w = watcherAt({ rot: 0 });
		const exposure = buildExposureMap(map, [w]);
		const resolved = resolveClocks(exposure, [clockFor(w)]);
		const full = nextExposure(exposure, resolved, 5, 0, 1, FAR);
		expect(full).toBeGreaterThan(0);
		expect(nextExposure(exposure, resolved, 5, 0, 1, full - 1)).toBe(Infinity);
		expect(nextExposure(exposure, resolved, 5, 0, 1, full)).toBe(full);
	});

	/*
	 Absorbing a Sentry is the ONE thing about a landscape that genuinely changes, and the only
	 case the map's immutability has to answer for. It is answered at read time — a null clock —
	 rather than by rebuilding, which mid-run would cost the ~58 ms the design spends only in the
	 frozen window before the first action.
	*/
	it('drops a watcher absorbed since the map was built, without rebuilding', () => {
		const map = flatMap();
		const near = watcherAt({ col: 5, row: 5, rot: 0 });
		const far = watcherAt({ col: 20, row: 20, rot: 0 });
		const exposure = buildExposureMap(map, [near, far]);
		const col = 5;
		const row = 12;

		const both = resolveClocks(exposure, [clockFor(near), clockFor(far)]);
		expect(nextExposureByWatcher(exposure, both, 0, col, row, 1, FAR)).toBe(0);

		// Same map object, one watcher gone.
		const after = resolveClocks(exposure, [null, clockFor(far)]);
		expect(after[0].alive).toBe(false);
		expect(nextExposureByWatcher(exposure, after, 0, col, row, 1, FAR)).toBe(Infinity);
		expect(nextExposure(exposure, after, col, row, 1, FAR)).toBe(
			nextExposureByWatcher(exposure, after, 1, col, row, 1, FAR)
		);

		// And with every watcher gone the whole landscape reads as permanently safe.
		const none = resolveClocks(exposure, [null, null]);
		expect(nextExposure(exposure, none, col, row, 1, FAR)).toBe(Infinity);
	});
});
