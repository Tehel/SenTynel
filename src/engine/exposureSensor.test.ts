/*
 The engine half of the exposure map: the bridge from live Watcher objects to game/exposure.ts's
 pure snapshots, and the once-per-landscape build behind it.

 What is worth testing here is precisely what the overlay used to own and no longer does — the map
 being built once and reused, and an absorbed watcher dropping out at READ time rather than by a
 rebuild, which is the one thing about a landscape that genuinely changes.

 No renderer, no DOM, no WebGL: all of this is arithmetic.
*/

import { describe, it, expect } from 'vitest';
import { Sentry, Tree } from '../world/objects';
import { MAP_SIZE } from '../world/terrain';
import { ExposureSensor, liveWatchersOf, type LiveWatcher } from './exposureSensor';

const PERIOD = 48;
const flatMap = (height = 1) => new Array(MAP_SIZE * MAP_SIZE).fill(height);

const watcher = (over: Partial<LiveWatcher> = {}): LiveWatcher => ({
	col: 5,
	row: 5,
	height: 1,
	rot: 0,
	step: 20,
	ticksToTurn: PERIOD,
	turnPeriod: PERIOD,
	drainLocked: false,
	turning: false,
	absorbed: false,
	...over,
});

describe('reading live watchers out of the scene', () => {
	it('takes the watchers and leaves everything else', () => {
		// GameObject is (date, col, row, height, rot, ...) — date 0 skips the spawn animation.
		const sentry = new Sentry(0, 3, 4, 2, 0, 20, 16);
		const tree = new Tree(0, 6, 7, 1, 0);
		const live = liveWatchersOf([sentry, tree]);
		expect(live).toHaveLength(1);
		expect(live[0].col).toBe(3);
		expect(live[0].row).toBe(4);
		expect(live[0].absorbed).toBe(false);
		sentry.dispose();
		tree.dispose();
	});

	it('finds nothing in a scene with no watchers', () => {
		expect(liveWatchersOf([])).toEqual([]);
	});
});

describe('the sensor', () => {
	it('builds nothing until something asks a question', () => {
		const sensor = new ExposureSensor(flatMap());
		expect(sensor.map).toBeNull();
		sensor.view([watcher()]);
		expect(sensor.map).not.toBeNull();
	});

	it('builds once and reuses it, however many views are taken', () => {
		const sensor = new ExposureSensor(flatMap());
		const first = sensor.view([watcher()]);
		const second = sensor.view([watcher({ rot: 40, ticksToTurn: 12 })]);
		// Same map object: only the clocks move, which is the whole design — see PLAN-EXPOSURE.md.
		expect(second.map).toBe(first.map);
	});

	it('re-syncs to the live facing without touching the map', () => {
		const sensor = new ExposureSensor(flatMap());
		// rot 0 faces row-increasing, so 5,12 is in the cone and 5,0 is not.
		const facing = sensor.view([watcher()]);
		expect(facing.read(5, 12, 1).inSightNow).toBe(true);
		expect(facing.read(5, 0, 1).inSightNow).toBe(false);

		// Wind the watcher round to face the other cell. The map is the same object throughout.
		let turned = sensor.view([watcher({ rot: 128 })]);
		for (let rot = 0; rot < 256 && !turned.read(5, 0, 1).inSightNow; rot += 4) {
			turned = sensor.view([watcher({ rot })]);
		}
		expect(turned.read(5, 0, 1).inSightNow).toBe(true);
		expect(turned.map).toBe(facing.map);
	});

	/*
	 The one genuine mutation in a landscape. Handled at read time — a watcher whose tile no longer
	 holds it resolves to a null clock — because a rebuild costs ~58 ms and would land mid-run.
	*/
	it('drops an absorbed watcher without rebuilding the map', () => {
		const sensor = new ExposureSensor(flatMap());
		const before = sensor.view([watcher()]);
		expect(before.read(5, 12, 1).inSightNow).toBe(true);

		const after = sensor.view([watcher({ absorbed: true })]);
		expect(after.map).toBe(before.map);
		expect(after.clocks[0].alive).toBe(false);
		expect(after.read(5, 12, 1).ticks).toBe(Infinity);
	});

	it('reports a height above every live eye as permanently out of reach', () => {
		const sensor = new ExposureSensor(flatMap());
		const view = sensor.view([watcher({ height: 1 })]);
		// Eye is 1 + WATCHER_EYE_HEIGHT = 1.9.
		expect(view.aboveEveryEye(1)).toBe(false);
		expect(view.aboveEveryEye(1.9)).toBe(true);
		expect(view.read(5, 12, 1).aboveEveryEye).toBe(false);
		expect(view.read(5, 12, 3).aboveEveryEye).toBe(true);
	});

	it('has nothing to be out of reach of once every watcher is gone', () => {
		const sensor = new ExposureSensor(flatMap());
		const view = sensor.view([watcher({ absorbed: true })]);
		expect(view.aboveEveryEye(99)).toBe(false);
		expect(view.read(5, 12, 1).ticks).toBe(Infinity);
	});
});
