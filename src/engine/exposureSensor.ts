/*
 The live half of the exposure map — the engine's bridge to game/exposure.ts (PLAN-EXPOSURE.md).

 Three layers, and the seam between them is the point of this file:

   game/exposure.ts        pure, three-free. Terrain heights and watcher snapshots in, numbers out.
                           Knows nothing about the scene, and is immutable once built.
   engine/exposureSensor.ts (here) owns the once-per-landscape build, turns the engine's live
                           Watcher objects into the snapshots the map wants, and hands out a view
                           resolved against their clocks as they are right now.
   engine/exposureOverlay.ts  draws it. A debug feature, switched off almost always.

 Anything that needs to KNOW about exposure goes through here. Only drawing goes through the
 overlay — so a planner can read the map without importing a visualisation, and switching the
 overlay off costs the sensor nothing.

 The build is lazy for a reason worth keeping: ~58 ms mean and 233 ms worst per landscape. That is
 free in the window before the player's first action, where the watchers are frozen and no clock
 the player can lose to has started — but there is no reason to spend it on a scene rebuild that
 nobody asks a question of.
*/

import { Watcher } from '../world/objects';
import type { GameObject } from '../world/objects';
import {
	buildExposureMap,
	readExposure,
	resolveClocks,
	type ExposureMap,
	type ExposureReading,
	type ExposureWatcher,
	type ResolvedClock,
	type WatcherClock,
} from '../game/exposure';

/*
 One live watcher, in the shape both halves of the map want. The engine's Watcher class arrives
 through this rather than being imported downstream, so game/exposure.ts stays three-free and a
 test can drive the whole thing with plain objects.
*/
export interface LiveWatcher {
	col: number;
	row: number;
	height: number;
	rot: number;
	step: number | null;
	ticksToTurn: number;
	turnPeriod: number;
	drainLocked: boolean;
	turning: boolean;
	absorbed: boolean;
}

/*
 Absorbed watchers are KEPT in the list rather than filtered out: clocksFor matches the map's own
 list by tile, and it has to see that the tile is now empty. Dropping an absorbed Sentry silently
 would let the match fall through to whatever else happens to be standing there.
*/
export function liveWatchersOf(allObjects: readonly GameObject[]): LiveWatcher[] {
	return allObjects
		.filter((o): o is Watcher => o instanceof Watcher)
		.map(w => ({
			col: w.col,
			row: w.row,
			height: w.height,
			rot: w.rot,
			step: w.step,
			ticksToTurn: w.ticksToTurn,
			turnPeriod: w.turnPeriod,
			drainLocked: w.drainLocked,
			turning: w.turning,
			absorbed: w.absorbedTime !== null,
		}));
}

// What the map says about one cell at one height, plus the one thing a caller cannot derive from
// the reading alone: why "never" is never.
export interface CellExposure extends ExposureReading {
	// The height is at or above EVERY live watcher's eye, so nothing standing here can be drained
	// by anyone — a different kind of "never" from "the terrain hides it".
	aboveEveryEye: boolean;
}

/*
 The map plus the watchers' clocks as of one moment. Resolving the clocks costs a short search per
 watcher, so it is done once per view and shared across every cell the caller then asks about —
 which is what makes a whole-map sweep (the overlay) and a many-cell decision (a planner) equally
 cheap.

 A view is a snapshot: take a fresh one when the clocks may have moved, i.e. on a game tick.
*/
export interface ExposureView {
	readonly map: ExposureMap;
	readonly clocks: readonly ResolvedClock[];
	read(col: number, row: number, height: number): CellExposure;
	aboveEveryEye(height: number): boolean;
}

export class ExposureSensor {
	private built: ExposureMap | null = null;

	// Terrain heights for the landscape — the same array engine/scene.ts hands around.
	constructor(private readonly heights: number[]) {}

	// Null until something has asked a question. Callers that only want to know whether the map
	// exists yet (the overlay's readout) use this rather than forcing a build.
	get map(): ExposureMap | null {
		return this.built;
	}

	view(live: readonly LiveWatcher[]): ExposureView {
		if (!this.built) {
			const watchers: ExposureWatcher[] = live.map(w => ({
				col: w.col,
				row: w.row,
				height: w.height,
				rot: w.rot,
				step: w.step,
			}));
			this.built = buildExposureMap(this.heights, watchers);
		}
		const map = this.built;
		const clocks = resolveClocks(map, clocksFor(map, live));
		return {
			map,
			clocks,
			read: (col, row, height) => ({
				...readExposure(map, clocks, col, row, height),
				aboveEveryEye: aboveEveryEye(map, clocks, height),
			}),
			aboveEveryEye: height => aboveEveryEye(map, clocks, height),
		};
	}
}

/*
 Match live watchers onto the map's own list by position. Watchers never move, so the tile is a
 stable identity — and one that survives the absorb which removes the object entirely. No match
 means absorbed, which resolveClocks turns into alive: false, so its cone stops counting without
 the map being rebuilt.
*/
function clocksFor(exposure: ExposureMap, live: readonly LiveWatcher[]): (WatcherClock | null)[] {
	return exposure.watchers.map(w => {
		const match = live.find(l => !l.absorbed && l.col === w.col && l.row === w.row);
		if (!match) return null;
		return {
			rot: match.rot,
			ticksToTurn: match.ticksToTurn,
			turnPeriodTicks: match.turnPeriod,
			drainLocked: match.drainLocked,
			turning: match.turning,
		};
	});
}

/*
 Is this height at or above EVERY live watcher's eye? engine/visibility.ts refuses a target level
 with the eye, so nothing standing there can ever be drained. Vacuously false once every watcher is
 gone: there is nothing left to be out of reach of.
*/
function aboveEveryEye(exposure: ExposureMap, clocks: readonly ResolvedClock[], height: number): boolean {
	let anyAlive = false;
	for (let w = 0; w < exposure.watchers.length; w++) {
		if (!clocks[w].alive) continue;
		anyAlive = true;
		if (height < exposure.eyeHeights[w]) return false;
	}
	return anyAlive;
}
