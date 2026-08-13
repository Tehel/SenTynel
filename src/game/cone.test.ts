import { describe, it, expect } from 'vitest';
import { inWatcherCone } from '../engine/watcher';
import {
	angleDeltaUnits,
	bearingUnits,
	coversBearing,
	ticksUntilBearingCovered,
	CONE_HALF_ANGLE_UNITS,
	ROT_UNITS,
	type ConeState,
} from './cone';

// The generator's rotation step, from world/terrain.ts: `object.step = r & 1 ? -20 : 20`.
const STEP = 20;
// world/objects/watcher.ts's TURN_PERIOD_TICKS — 12 s at 4 Hz.
const PERIOD = 48;
const FAR = 100_000;

const state = (over: Partial<ConeState> = {}): ConeState => ({
	col: 10,
	row: 10,
	rot: 0,
	step: STEP,
	ticksUntilTurn: PERIOD,
	turnPeriodTicks: PERIOD,
	...over,
});

describe('bearingUnits', () => {
	// A watcher facing rot=0 looks along +row (see angle256ToRad's π offset and the row/Z flip).
	it('reads the cardinal directions off the 256-step circle', () => {
		expect(bearingUnits(10, 10, 10, 15)).toBeCloseTo(0);
		expect(bearingUnits(10, 10, 15, 10)).toBeCloseTo(64);
		expect(bearingUnits(10, 10, 10, 5)).toBeCloseTo(128);
		expect(bearingUnits(10, 10, 5, 10)).toBeCloseTo(192);
	});

	it('has no bearing to the watcher’s own cell', () => {
		expect(bearingUnits(10, 10, 10, 10)).toBeNull();
	});

	it('is distance-independent', () => {
		expect(bearingUnits(10, 10, 12, 12)).toBeCloseTo(bearingUnits(10, 10, 17, 17)!);
	});
});

/*
 The load-bearing test of this module: the pure unit-space predicate has to agree with the radian
 one the drain phase actually resolves against, or every prediction downstream is a guess. Swept
 over a whole neighbourhood and a full circle of facings rather than spot-checked, since the two
 disagreeing anywhere would be a silent wrong answer, not a crash.

 One class of case is excluded, and deliberately: a cell sitting *exactly* on the cone edge — which
 is every cardinally-aligned cell at the right facing, so not a curiosity. There the engine computes
 an angle through Vector3.angleTo and lands a fraction of a float above the limit, failing its own
 `<=`, where the unit arithmetic here is exact and passes. Neither answer is more correct than the
 other; the tie is decided by rounding.

 So the sweep asserts exact agreement everywhere off the knife edge, and separately asserts the one
 property that actually matters for a predictor: it is never *less* cautious than the engine. Being
 told a cell is exposed when it turns out not to be costs a slightly worse choice of tile; the
 reverse costs a body.
*/
describe('agreement with engine/watcher.ts’s inWatcherCone', () => {
	it('matches for every cell around a watcher, at every facing', () => {
		const wCol = 10;
		const wRow = 10;
		let inCone = 0;
		let edgeTies = 0;
		for (let rot = 0; rot < ROT_UNITS; rot += 1) {
			for (let row = 4; row <= 16; row++) {
				for (let col = 4; col <= 16; col++) {
					if (col === wCol && row === wRow) continue;
					const bearing = bearingUnits(wCol, wRow, col, row)!;
					const mine = coversBearing(rot, bearing);
					const theirs = inWatcherCone({ col: wCol, row: wRow, rot }, col, row);
					// Never the dangerous direction, edge case or not.
					if (!mine && theirs) {
						throw new Error(`missed a live cone at rot=${rot} cell=${col},${row}`);
					}
					if (Math.abs(angleDeltaUnits(rot, bearing) - CONE_HALF_ANGLE_UNITS) < 1e-6) {
						edgeTies++;
						continue;
					}
					if (mine !== theirs) {
						throw new Error(`disagreed at rot=${rot} cell=${col},${row}: ${mine} vs ${theirs}`);
					}
					if (mine) inCone++;
				}
			}
		}
		// Sanity floors: the sweep exercised the true branch rather than agreeing on "no", and the
		// exclusion above skipped a handful of ties rather than quietly swallowing the comparison.
		expect(inCone).toBeGreaterThan(1000);
		expect(edgeTies).toBeLessThan(inCone / 10);
	});
});

describe('angleDeltaUnits', () => {
	it('takes the short way round', () => {
		expect(angleDeltaUnits(0, 10)).toBe(10);
		expect(angleDeltaUnits(10, 0)).toBe(10);
		expect(angleDeltaUnits(250, 6)).toBe(12);
		expect(angleDeltaUnits(0, 128)).toBe(128);
	});
});

/*
 The geometric fact the whole plan rests on (PLAN-BOT2.md, verified mechanics 1): the cone is 20
 units wide and the step is 20 units, so consecutive sectors are adjacent — no overlap, no gap.
*/
describe('cone width equals rotation step', () => {
	it('covers a full cone-width band and no more', () => {
		expect(coversBearing(0, CONE_HALF_ANGLE_UNITS)).toBe(true);
		expect(coversBearing(0, CONE_HALF_ANGLE_UNITS + 0.5)).toBe(false);
		expect(2 * CONE_HALF_ANGLE_UNITS).toBe(STEP);
	});

	it('drops anything it was watching as soon as it steps', () => {
		for (let bearing = -CONE_HALF_ANGLE_UNITS; bearing <= CONE_HALF_ANGLE_UNITS; bearing += 1) {
			expect(coversBearing(0, (bearing + ROT_UNITS) % ROT_UNITS)).toBe(true);
			// One step on, in either direction, and that bearing is behind the trailing edge.
			expect(coversBearing(STEP, (bearing + ROT_UNITS) % ROT_UNITS)).toBe(bearing === CONE_HALF_ANGLE_UNITS);
			expect(coversBearing(-STEP + ROT_UNITS, (bearing + ROT_UNITS) % ROT_UNITS)).toBe(
				bearing === -CONE_HALF_ANGLE_UNITS
			);
		}
	});
});

describe('ticksUntilBearingCovered', () => {
	it('reports 0 for a bearing already under the cone', () => {
		expect(ticksUntilBearingCovered(state({ rot: 0 }), 5, FAR)).toBe(0);
	});

	it('reports the next turn when one step brings it round', () => {
		// Facing 0, stepping +20: the sector 10..30 arrives on the next turn.
		expect(ticksUntilBearingCovered(state({ rot: 0, ticksUntilTurn: 12 }), 25, FAR)).toBe(12);
	});

	it('counts whole periods for a bearing several steps away', () => {
		// Three steps to reach 60 from 0 (20, 40, 60), so two full periods after the first turn.
		expect(ticksUntilBearingCovered(state({ rot: 0, ticksUntilTurn: 12 }), 60, FAR)).toBe(12 + 2 * PERIOD);
	});

	it('follows the rotation direction', () => {
		const clockwise = ticksUntilBearingCovered(state({ rot: 0, step: STEP, ticksUntilTurn: 0 }), 60, FAR);
		const anticlockwise = ticksUntilBearingCovered(state({ rot: 0, step: -STEP, ticksUntilTurn: 0 }), 60, FAR);
		expect(clockwise).toBe(2 * PERIOD);
		// The long way round: the same bearing takes far longer when turning away from it.
		expect(anticlockwise).toBeGreaterThan(clockwise);
	});

	it('treats an overdue turn (drain-locked) as due now', () => {
		expect(ticksUntilBearingCovered(state({ rot: 0, ticksUntilTurn: -7 }), 25, FAR)).toBe(0);
	});

	it('honours a shortened period, as a completed playthrough produces', () => {
		// world/objects/watcher.ts scales the period by 0.95^gameCompletions; one completion → 46.
		const faster = state({ rot: 0, ticksUntilTurn: 46, turnPeriodTicks: 46 });
		expect(ticksUntilBearingCovered(faster, 60, FAR)).toBe(46 + 2 * 46);
	});

	it('reports Infinity beyond the horizon rather than a far-off tick', () => {
		expect(ticksUntilBearingCovered(state({ rot: 0, ticksUntilTurn: 12 }), 60, 24)).toBe(Infinity);
	});

	it('never sees anything it isn’t already facing when it cannot turn', () => {
		expect(ticksUntilBearingCovered(state({ step: null, rot: 0 }), 5, FAR)).toBe(0);
		expect(ticksUntilBearingCovered(state({ step: null, rot: 0 }), 60, FAR)).toBe(Infinity);
	});

	/*
	 With a ±20 step the reachable facings sit on a 4-unit lattice (256/gcd(20,256)), so every
	 bearing eventually falls within 10 units of one. Nothing with line of sight is permanently
	 safe — cover is always a question of how long, which is what makes ranking by it worthwhile.
	*/
	it('eventually covers every bearing', () => {
		for (const step of [STEP, -STEP]) {
			for (let bearing = 0; bearing < ROT_UNITS; bearing += 0.5) {
				const ticks = ticksUntilBearingCovered(state({ rot: 0, step, ticksUntilTurn: 0 }), bearing, FAR);
				expect(ticks).toBeLessThan(Infinity);
			}
		}
	});
});
