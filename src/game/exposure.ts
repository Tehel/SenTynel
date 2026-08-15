/*
 The exposure map: for every cell, when will each watcher next be able to drain what stands there?

 Full design in PLAN-EXPOSURE.md. The short version, because the shape of this file only makes
 sense with it:

 "Watcher w can drain what stands on cell c" is `inWatcherCone(w, c)` AND `isCellVisibleFrom(...)`,
 and those two halves depend on disjoint variables:

                     depends on orientation   depends on target height
   cone                      yes                        no
   line of sight             no                         yes

 So the map is built once per landscape as, per (watcher, cell):

   - a 64-bit CONE MASK. A watcher steps +/-20 of the 256 rotation units per turn and gcd(20,256)=4,
     so it visits exactly 64 distinct facings before repeating; bit k says "the facing k turns from
     now covers this cell's bearing". Orientation-dependent, height-independent, exact.
   - a HEIGHT WINDOW [minVisibleHeight, eyeY): the lowest target height at which the watcher's eye
     can see this cell past the terrain, and — from engine/visibility.ts's own "eye must be strictly
     above the target" rule — the height at which the target rises above the eye and becomes
     untouchable again. Height-dependent, orientation-independent.

 Two consequences worth stating out loud, because a boolean "is this cell watched" map gets both
 wrong in the dangerous direction:

   - the drain phase tests line of sight to the target's FOOT height (engine/watcher.ts's
     `yOffset = cand.height - map[cell]`), so a cell with no ground-level sightline can become
     fully exposed the moment a pile is built on it;
   - and conversely a pile whose foot rises to or above the watcher's eye cannot be drained by it
     at all.

 Nothing here mutates after `buildExposureMap`. A watcher's rotation and its drain-lock stall are
 both read out of its LIVE clock at query time (see resolveClocks), so there is no incremental
 update, nothing to invalidate, and a stalled watcher is handled exactly rather than approximated.

 Three-free by construction (game/ rule, see CLAUDE.md): terrain heights in, numbers out.
*/

import { MAP_SIZE } from '../world/terrain';
import { bearingUnits, coversBearing, ROT_UNITS } from './cone';

// A watcher visits this many distinct facings before repeating: 256 / gcd(20, 256).
export const TURN_CYCLE = 64;

// Watcher eye height above its base. Mirrors engine/watcher.ts's EYE_HEIGHT_LOCAL — duplicated
// rather than imported because that module loads three, and this one must not. The probe in
// engine/bot.harness.test.ts is what keeps the two honest.
export const WATCHER_EYE_HEIGHT = 0.9;

// Terrain samples per cell crossed along a sightline. The engine casts a continuous ray; this
// marches the height field, so the sample rate is the fidelity knob. Four is enough to catch a
// one-cell ridge and cheap enough to sweep the whole map inside the pre-first-action window.
const SAMPLES_PER_CELL = 4;

// Tolerance on the "terrain pokes through the sightline" test, matching the spirit of
// engine/visibility.ts's EPS: a coplanar run of tiles must not block itself.
const CLEARANCE_EPS = 1e-6;

/*
 How far BELOW the computed threshold a cell is still reported as visible — the analytic model's
 own uncertainty band, spent deliberately on the safe side.

 Two things put a sightline's true verdict inside a band rather than on a knife edge. The march
 samples the height field at SAMPLES_PER_CELL rather than solving it continuously, and it
 interpolates each cell bilinearly where the mesh is triangulated. Both are worth a few
 hundredths of a level near a grazing sightline, and the engine's raycaster has its own answer
 there: measured over 50 landscapes, every disagreement where the engine could see a cell this
 map called hidden was a graze, all but one of them by less than 0.06.

 Erring towards "exposed" is the direction that costs the bot caution rather than its life, so
 the band is resolved that way. See engine/exposure.harness.test.ts, which measures what this
 buys and what it costs.
*/
export const SIGHTLINE_MARGIN = 0.1;

/*
 A watcher as the map needs it at BUILD time: where it stands, which way it faces, how it steps.
 Snapshotted by the caller so nothing here touches a live object.
*/
export interface ExposureWatcher {
	col: number;
	row: number;
	// Terrain height the watcher stands on. Its eye is WATCHER_EYE_HEIGHT above this.
	height: number;
	// Facing at build time, 0..255. Bit 0 of every mask is measured against this.
	rot: number;
	// Signed rotation step, +/-20. null for a watcher that never turns.
	step: number | null;
}

/*
 A watcher's LIVE clock at QUERY time. `rot` re-syncs the mask against the build-time facing every
 read, so the map can never drift out of step with the engine — there is no turn counter to keep.

 `ticksToTurn` may be zero or negative: a drain-locked watcher keeps decrementing it while holding
 the turn (world/objects/watcher.ts), so the turn fires on the first tick it has nothing left to
 eat. Treated as imminent — but never as *now*, which is reserved for the facing the watcher
 actually holds. `drainLocked` is what lets a caller tell those two apart.
*/
export interface WatcherClock {
	rot: number;
	ticksToTurn: number;
	turnPeriodTicks: number;
	/*
	 Whether this watcher is currently holding its turn because it has something to eat
	 (engine/watcher.ts sets it every drain phase). While it holds, `ticksToTurn` keeps
	 decrementing into negatives and the turn does NOT fire — so the schedule is paused, not
	 merely overdue, and a reader that cannot tell the difference reports the next sector as
	 already watched. See ExposureReading.held.
	*/
	drainLocked: boolean;
	/*
	 Whether a turn is in flight — queued or mid-animation (world/objects/watcher.ts's `turning`).

	 During that window `rot` still reports the OLD facing while `ticksToTurn` has already been
	 reset to a full period, so the two describe different moments. Taken at face value the sector
	 the watcher is currently rotating INTO reads as a whole period away, when in fact it is
	 arriving right now — which made every ramped cell jump one sector greener for half a second
	 and then snap back. See nextExposureByWatcher.
	*/
	turning: boolean;
}

// A WatcherClock with the mask offset already worked out — see resolveClocks.
export interface ResolvedClock {
	turnIndex: number;
	ticksToTurn: number;
	turnPeriodTicks: number;
	// A watcher that never turns is frozen at bit 0 for the rest of the landscape.
	turns: boolean;
	/*
	 False once this watcher has been absorbed — the one thing about a landscape that genuinely
	 changes, and the reason the caller passes null for it rather than the map being rebuilt.
	 Absorbing a Sentry mid-run would otherwise leave its cone painted on the map forever, and a
	 rebuild costs ~58 ms in the middle of play, which is the one place the design cannot afford
	 it. Handled at READ time instead, so the map itself stays immutable.
	*/
	alive: boolean;
	// Mirrors WatcherClock.drainLocked — the turn is held, not merely overdue.
	drainLocked: boolean;
	// Mirrors WatcherClock.turning — a turn is in flight, so `turnIndex` is one behind the truth.
	turning: boolean;
}

export interface ExposureMap {
	readonly watchers: readonly ExposureWatcher[];
	// Eye height of each watcher, in world units. A target at or above this can never be drained
	// by that watcher, whatever the terrain does (engine/visibility.ts refuses it outright).
	readonly eyeHeights: Float64Array;
	/*
	 Per watcher, per cell: the lowest target height with a clear line to that watcher's eye,
	 -Infinity when nothing blocks even at ground level and +Infinity when no height helps.
	 Indexed [watcher][row * MAP_SIZE + col].
	*/
	readonly minVisibleHeight: readonly Float64Array[];
	/*
	 Per watcher, per cell: the 64-bit cone mask, as two 32-bit words at [cell * 2] (bits 0..31)
	 and [cell * 2 + 1] (bits 32..63). Bit k set means the facing k turns after build covers this
	 cell's bearing.
	*/
	readonly coneMask: readonly Uint32Array[];
}

const mod = (value: number, m: number) => ((value % m) + m) % m;

const tileIndex = (col: number, row: number) => row * MAP_SIZE + col;

/*
 Terrain height at a continuous point in GRID space — (gc, gr) where gc is the world x and gr the
 row axis, i.e. the same coordinates the height map is indexed by. Bilinear over the cell's four
 vertex heights, which is exact for a flat cell and a close approximation of the triangulated quad
 on a slope.
*/
function terrainHeightAt(map: number[], gc: number, gr: number): number {
	const c0 = Math.max(0, Math.min(MAP_SIZE - 2, Math.floor(gc)));
	const r0 = Math.max(0, Math.min(MAP_SIZE - 2, Math.floor(gr)));
	const fc = Math.max(0, Math.min(1, gc - c0));
	const fr = Math.max(0, Math.min(1, gr - r0));
	const h00 = map[tileIndex(c0, r0)];
	const h10 = map[tileIndex(c0 + 1, r0)];
	const h01 = map[tileIndex(c0, r0 + 1)];
	const h11 = map[tileIndex(c0 + 1, r0 + 1)];
	return h00 * (1 - fc) * (1 - fr) + h10 * fc * (1 - fr) + h01 * (1 - fc) * fr + h11 * fc * fr;
}

/*
 The lowest target height at which the eye can see one corner past the terrain — the whole reason
 this sweep is analytic rather than a raycast, since a raycast returns a boolean and would have to
 be bisected over heights to get the same answer.

 Along the segment the sightline sits at `eyeY + (targetY - eyeY) * t`. Terrain at sample t blocks
 when it pokes above that, so clearing THAT blocker needs

     targetY  >=  eyeY + (terrain(t) - eyeY) / t

 and clearing all of them is the maximum of that over the samples. One march, one number, and the
 horizontal path does not depend on targetY at all — which is what makes the closed form work.
*/
function cornerThreshold(
	map: number[],
	eyeGc: number,
	eyeGr: number,
	eyeY: number,
	targetGc: number,
	targetGr: number,
	skipCol: number,
	skipRow: number,
	fromCol: number,
	fromRow: number
): number {
	const dGc = targetGc - eyeGc;
	const dGr = targetGr - eyeGr;
	const span = Math.max(Math.abs(dGc), Math.abs(dGr));
	const steps = Math.max(1, Math.ceil(span * SAMPLES_PER_CELL));

	let threshold = -Infinity;
	for (let i = 1; i < steps; i++) {
		const t = i / steps;
		const gc = eyeGc + dGc * t;
		const gr = eyeGr + dGr * t;
		const col = Math.max(0, Math.min(MAP_SIZE - 2, Math.floor(gc)));
		const row = Math.max(0, Math.min(MAP_SIZE - 2, Math.floor(gr)));
		// engine/visibility.ts skips hits on the target cell and on the watcher's own cell.
		if (col === skipCol && row === skipRow) continue;
		if (col === fromCol && row === fromRow) continue;
		const terrain = terrainHeightAt(map, gc, gr) - CLEARANCE_EPS;
		// Blockers below the eye need a target height under it, and the nearer the blocker the
		// less it asks for. A blocker ABOVE the eye needs a target above the eye too, which comes
		// out of the same expression and is then refused by the eyeY ceiling in canEverSee — no
		// special case, and the number stays meaningful for the visualisation.
		const needed = eyeY + (terrain - eyeY) / t;
		if (needed > threshold) threshold = needed;
	}
	return threshold;
}

/*
 The lowest target height on (col, row) with a clear line to this watcher's eye.

 engine/visibility.ts is optimistic — the cell is visible if ANY of its four grid corners is
 reachable — so the answer is the minimum over the four corners, all taken at the cell's own
 height. That "any corner" rule is one of the two documented reasons the older single-centre-ray
 `terrainVisible` disagreed with the engine by ~20% in the unsafe direction; the other was the eye
 height, which is WATCHER_EYE_HEIGHT above the watcher's tile at the CELL CENTRE.
*/
export function minVisibleHeightFor(
	map: number[],
	watcher: ExposureWatcher,
	col: number,
	row: number,
	margin: number = SIGHTLINE_MARGIN
): number {
	const eyeGc = watcher.col + 0.5;
	const eyeGr = watcher.row + 0.5;
	const eyeY = watcher.height + WATCHER_EYE_HEIGHT;
	let best = Infinity;
	for (const [vc, vr] of [
		[col, row],
		[col + 1, row],
		[col, row + 1],
		[col + 1, row + 1],
	]) {
		const threshold = cornerThreshold(map, eyeGc, eyeGr, eyeY, vc, vr, col, row, watcher.col, watcher.row);
		if (threshold < best) best = threshold;
	}
	return best === Infinity ? Infinity : best - margin;
}

/*
 The 64-bit cone mask for one bearing, as [low word, high word].

 Rather than testing all 64 facings, note that the reachable ones are exactly the values congruent
 to `rot` modulo 4 (since the step is +/-20 and gcd(20, 256) = 4), and a cone covers a 21-unit-wide
 window of bearings. So walk the ~5 or 6 facings inside that window and map each back to its turn
 index. Turn index from facing is closed-form — with a step of +20, `rot_k = rot0 + 4m` where
 `m = 5k mod 64`, invertible as `k = 13m mod 64` because 5*13 = 65 = 1 (mod 64) — but the search
 below is used instead: it costs 64 iterations once per (watcher, cell) at BUILD time only, it does
 not assume the step is +/-20, and it cannot be silently wrong.
*/
export function coneMaskFor(rot: number, step: number | null, bearing: number): [number, number] {
	let low = 0;
	let high = 0;
	const turns = step ? TURN_CYCLE : 1;
	for (let k = 0; k < turns; k++) {
		if (!coversBearing(mod(rot + (step ?? 0) * k, ROT_UNITS), bearing)) continue;
		if (k < 32) low |= 1 << k;
		else high |= 1 << (k - 32);
	}
	return [low >>> 0, high >>> 0];
}

/*
 Build the whole map. Called once per landscape, in the window before the player's first action
 where the watchers are frozen (engine/watcher.ts returns on !game.firstActionTaken and so does
 Watcher.playTick), so this may take its time — the clock it would otherwise eat into has not
 started.
*/
export function buildExposureMap(
	map: number[],
	watchers: ExposureWatcher[],
	options: { margin?: number } = {}
): ExposureMap {
	const margin = options.margin ?? SIGHTLINE_MARGIN;
	const cells = MAP_SIZE * MAP_SIZE;
	const eyeHeights = new Float64Array(watchers.length);
	const minVisibleHeight: Float64Array[] = [];
	const coneMask: Uint32Array[] = [];

	for (let w = 0; w < watchers.length; w++) {
		const watcher = watchers[w];
		const heights = new Float64Array(cells).fill(Infinity);
		const masks = new Uint32Array(cells * 2);
		eyeHeights[w] = watcher.height + WATCHER_EYE_HEIGHT;

		// Playable cells only: MAP_SIZE-1 is the far vertex row/column, which has no cell.
		for (let row = 0; row < MAP_SIZE - 1; row++) {
			for (let col = 0; col < MAP_SIZE - 1; col++) {
				const cell = tileIndex(col, row);
				const bearing = bearingUnits(watcher.col, watcher.row, col, row);
				// The watcher's own cell has no bearing at all, and inWatcherCone refuses it too.
				if (bearing === null) continue;
				const [low, high] = coneMaskFor(watcher.rot, watcher.step, bearing);
				// A bearing this watcher never faces is worth no sightline: the cone half already
				// says never, whatever the terrain does.
				if (low === 0 && high === 0) continue;
				masks[cell * 2] = low;
				masks[cell * 2 + 1] = high;
				heights[cell] = minVisibleHeightFor(map, watcher, col, row, margin);
			}
		}

		minVisibleHeight.push(heights);
		coneMask.push(masks);
	}

	return { watchers, eyeHeights, minVisibleHeight, coneMask };
}

/*
 Line up each watcher's live facing with the mask that was built against its facing at build time.

 Done once per query batch rather than per cell: the search is up to 64 iterations, negligible for
 <=8 watchers but not something to repeat 961 times. Reading the turn index back OUT of `rot`, and
 not tracking it, is what makes the map self-synchronising — a watcher whose rotation was held by a
 drain lock simply has not advanced, and nothing here needs to know that happened.
*/
export function resolveClocks(exposure: ExposureMap, clocks: readonly (WatcherClock | null)[]): ResolvedClock[] {
	return exposure.watchers.map((watcher, w) => {
		const clock = clocks[w];
		// null means absorbed since the map was built — see ResolvedClock.alive.
		if (!clock)
			return {
				turnIndex: 0,
				ticksToTurn: 0,
				turnPeriodTicks: 1,
				turns: false,
				alive: false,
				drainLocked: false,
				turning: false,
			};
		let turnIndex = 0;
		if (watcher.step) {
			for (let k = 0; k < TURN_CYCLE; k++) {
				if (mod(watcher.rot + watcher.step * k, ROT_UNITS) === mod(clock.rot, ROT_UNITS)) {
					turnIndex = k;
					break;
				}
			}
		}
		return {
			turnIndex,
			ticksToTurn: clock.ticksToTurn,
			turnPeriodTicks: clock.turnPeriodTicks,
			turns: watcher.step !== null && watcher.step !== 0,
			alive: true,
			drainLocked: clock.drainLocked,
			turning: clock.turning,
		};
	});
}

// Can this watcher ever drain a target standing at `height` on this cell, at any facing?
export function canEverSee(exposure: ExposureMap, w: number, col: number, row: number, height: number): boolean {
	const cell = tileIndex(col, row);
	const masks = exposure.coneMask[w];
	if (masks[cell * 2] === 0 && masks[cell * 2 + 1] === 0) return false;
	return height >= exposure.minVisibleHeight[w][cell] && height < exposure.eyeHeights[w];
}

/*
 Ticks until this watcher's cone reaches a target standing at `height` on this cell: 0 if it is
 covered right now, Infinity if never or beyond the horizon.

 Same convention as game/cone.ts's ticksUntilBearingCovered, which this replaces for map-wide
 questions: the turn `ticksToTurn` away is the first that can change anything, and each subsequent
 one is a further `turnPeriodTicks`.
*/
export function nextExposureByWatcher(
	exposure: ExposureMap,
	resolved: readonly ResolvedClock[],
	w: number,
	col: number,
	row: number,
	height: number,
	horizonTicks: number = Infinity
): number {
	if (!resolved[w].alive) return Infinity;
	if (!canEverSee(exposure, w, col, row, height)) return Infinity;

	const cell = tileIndex(col, row);
	const masks = exposure.coneMask[w];
	const low = masks[cell * 2];
	const high = masks[cell * 2 + 1];
	const clock = resolved[w];
	/*
	 Floored at ONE tick, not zero. A turn that is overdue — held by a drain lock, so ticksToTurn
	 has run negative — still cannot resolve in no time at all, and flooring at zero made the
	 watcher's NEXT sector report 0 ticks, i.e. indistinguishable from the sector it is actually
	 looking at. Reserving 0 for "the current facing covers this cell" is what lets a caller tell
	 "being watched" from "would be watched the moment that turn fires" (see ExposureReading).

	 game/cone.ts's ticksUntilBearingCovered still floors at zero, deliberately: it has no
	 drain-lock signal to work with, its caller only wants a conservative number, and changing it
	 would move the existing bot planners' behaviour for no benefit.
	*/
	const firstTurn = Math.max(1, clock.ticksToTurn);
	const period = Math.max(1, clock.turnPeriodTicks);
	const turns = clock.turns ? TURN_CYCLE : 1;

	for (let j = 0; j < turns; j++) {
		/*
		 j is turns-from-now, and `turnIndex` is read off `rot`. While a turn is IN FLIGHT that
		 index is one behind: the facing at j = 1 is the one being rotated into as we speak, not
		 one whose countdown has yet to start. So the schedule shifts by a turn for the duration —
		 j = 1 arrives imminently (reported as the 1-tick floor, since 0 is reserved for "already
		 in the cone"), and j = 2 inherits the countdown j = 1 would otherwise have had.

		 Without this the clock is fresh while the facing is stale, and every cell beyond the cone
		 briefly reports a whole extra period — the visible symptom being the entire ramp jumping
		 one sector greener mid-rotation and snapping back when `rot` finally commits.
		*/
		const at =
			j === 0 ? 0 : clock.turning ? (j === 1 ? 1 : firstTurn + (j - 2) * period) : firstTurn + (j - 1) * period;
		if (at > horizonTicks) return Infinity;
		const k = (clock.turnIndex + j) % TURN_CYCLE;
		const set = k < 32 ? (low >>> k) & 1 : (high >>> (k - 32)) & 1;
		if (set) return at;
	}
	return Infinity;
}

/*
 Everything a caller needs about one cell, in one pass — because "how long until this is watched"
 has three answers that must not be collapsed into one number:

   - **in sight now**: a watcher's CURRENT facing covers it and can see it at this height. This is
     the one that is actually costing energy.
   - **exposed in N ticks**: a turn has to fire first, and it is scheduled.
   - **held**: a turn has to fire first, and the watcher that owns it is drain-locked, so the turn
     is PAUSED rather than merely overdue. `ticks` still reports the earliest it could possibly
     happen, which is the safe assumption for a planner (the lock breaks the moment the watcher
     runs out of food) — but a caller that shows this to a human must say so, because "the turn is
     held" and "you are being watched" look identical in a bare countdown and are opposite
     situations to be in.

 That last case is not an edge case: a watcher only stops rotating because it found something to
 eat, so it happens whenever the landscape is busy.
*/
export interface ExposureReading {
	// Earliest tick a watcher could drain what stands here; 0 means right now, Infinity never.
	ticks: number;
	// Index into ExposureMap.watchers of whoever gets there first, -1 if nobody ever does.
	by: number;
	// Some watcher's current facing already covers it — equivalently, ticks === 0.
	inSightNow: boolean;
	// The earliest exposure waits on a turn that is currently held by a drain lock.
	held: boolean;
}

export function readExposure(
	exposure: ExposureMap,
	resolved: readonly ResolvedClock[],
	col: number,
	row: number,
	height: number,
	horizonTicks: number = Infinity
): ExposureReading {
	let ticks = Infinity;
	let by = -1;
	for (let w = 0; w < exposure.watchers.length; w++) {
		const t = nextExposureByWatcher(exposure, resolved, w, col, row, height, Math.min(ticks, horizonTicks));
		if (t >= ticks) continue;
		ticks = t;
		by = w;
		if (ticks === 0) break;
	}
	return {
		ticks,
		by,
		inSightNow: ticks === 0,
		held: ticks > 0 && by >= 0 && resolved[by].drainLocked,
	};
}

/*
 Ticks until ANY watcher can drain a target standing at `height` on this cell — the map's headline
 answer. `readExposure` above is the fuller one; this stays for callers that only want the number.
*/
export function nextExposure(
	exposure: ExposureMap,
	resolved: readonly ResolvedClock[],
	col: number,
	row: number,
	height: number,
	horizonTicks: number = Infinity
): number {
	let best = Infinity;
	for (let w = 0; w < exposure.watchers.length; w++) {
		const ticks = nextExposureByWatcher(exposure, resolved, w, col, row, height, Math.min(best, horizonTicks));
		if (ticks < best) best = ticks;
		if (best === 0) break;
	}
	return best;
}
