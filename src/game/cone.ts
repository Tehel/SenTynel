/*
 Watcher cone prediction: when will a given bearing fall inside a watcher's cone?

 Pure and three-free (see PLAN-BOT2.md, B1). engine/bot.ts feeds it the live rotation state and
 pairs the answer with a line-of-sight test; nothing here knows about the scene.

 The whole thing rests on one piece of arithmetic that turns out to be exact rather than
 approximate:

   - the cone is 20 of the 256 rotation units wide  (engine/watcher.ts's CONE_HALF_ANGLE_RAD is
     (10/128)π, i.e. 10 units either side of the facing)
   - every watcher's rotation step is ±20 units     (world/terrain.ts: `object.step = r & 1 ? -20 : 20`)
   - one step every `turnPeriodTicks`               (world/objects/watcher.ts: 48 ticks = 12 s at
     4 Hz, scaled by 0.95^gameCompletions)

 So a cone advances by exactly its own width each turn: adjacent sectors, no overlap and no gap. A
 cell inside the cone now is guaranteed outside it after the next step, and the full future schedule
 follows from `rot`, `step` and the tick clock without simulating anything.

 That is worth a lot more to the bot than to a human. A player estimates cone timing from memory and
 partial information; this is closed-form, so "build where the Sentinel has just looked away" becomes
 an exact quantity — often the better part of a minute of guaranteed cover.
*/

// The original game's 256-step circle, as used by GameObject.rot everywhere.
export const ROT_UNITS = 256;
// Half the cone's angular width, in those units. Mirrors engine/watcher.ts's CONE_HALF_ANGLE_RAD,
// which is (10/128)π — and since 256 units span 2π, that is exactly 10 units.
export const CONE_HALF_ANGLE_UNITS = 10;
// Comparisons happen on floating-point bearings, so a cell sitting exactly on the cone edge must
// not fall on the far side of the engine's own inclusive `<=`.
const EDGE_EPSILON = 1e-9;

/*
 Everything about a watcher's rotation that prediction needs. Snapshotted by the caller, so this
 module never touches a live object.

 `ticksUntilTurn` may be zero or negative: a drain-locked watcher keeps decrementing it while
 holding the turn, so that the turn fires on the first tick it has nothing left to eat
 (world/objects/watcher.ts). Treated as "due now" below.
*/
export interface ConeState {
	col: number;
	row: number;
	// Current facing, 0..255.
	rot: number;
	// Signed rotation step, ±20 in practice. null for a watcher that never turns, which the
	// generator doesn't produce but the type allows.
	step: number | null;
	ticksUntilTurn: number;
	turnPeriodTicks: number;
}

const mod = (value: number, m: number) => ((value % m) + m) % m;

/*
 Bearing from a watcher to a cell, in rotation units — the value `rot` would have to hold to point
 straight at it.

 Derived from engine/watcher.ts's inWatcherCone rather than guessed at. There, a watcher facing
 `rot` has a forward vector of (sin θ, cos θ) with θ = angle256ToRad(rot) = π − rot·2π/256, and the
 target direction is (col − wCol, −(row − wRow)) because world Z runs opposite to row. Expanding
 sin(π − φ) = sin φ and cos(π − φ) = −cos φ collapses both sign flips into one expression:

     bearing = atan2(Δcol, Δrow) · 128/π

 Returns null for the watcher's own cell, where there is no bearing at all — matching inWatcherCone,
 which refuses a zero-length direction.
*/
export function bearingUnits(fromCol: number, fromRow: number, toCol: number, toRow: number): number | null {
	const dCol = toCol - fromCol;
	const dRow = toRow - fromRow;
	if (dCol === 0 && dRow === 0) return null;
	return mod((Math.atan2(dCol, dRow) * 128) / Math.PI, ROT_UNITS);
}

// Shortest distance between two bearings, in units: 0..128.
export function angleDeltaUnits(a: number, b: number): number {
	const delta = mod(a - b, ROT_UNITS);
	return Math.min(delta, ROT_UNITS - delta);
}

// Is that bearing inside the cone of a watcher facing `rot`? The unit-space comparison is exact
// rather than an approximation of the engine's radian one: the map from units to radians is affine,
// so equal unit differences are equal angular differences.
export function coversBearing(rot: number, bearing: number): boolean {
	return angleDeltaUnits(rot, bearing) <= CONE_HALF_ANGLE_UNITS + EDGE_EPSILON;
}

/*
 Ticks until this watcher's cone covers that bearing: 0 if it does already, otherwise the tick of
 the turn that brings it round.

 `horizonTicks` bounds the search. Beyond it the answer is reported as Infinity, which is what the
 planner wants anyway — a cell that stays clear for the length of any plan we would commit to is
 simply safe, and there is nothing to gain by ranking one far-off exposure against another.

 The loop is bounded by ROT_UNITS regardless: the reachable facings are `rot + k·step (mod 256)`,
 which repeat after at most 256 steps, so a bearing not covered within one cycle is never covered.

 Two deliberate simplifications, both erring towards predicting exposure *earlier* than it happens,
 which is the safe direction for a planner deciding where to stand:

  - A drain-locked watcher's clock is frozen, and whether it stays locked depends on the whole
    board. This assumes the clock runs. The caller (engine/bot.ts) documents the same approximation.
  - `rot` is only committed when the turn animation finishes, roughly 500 ms (2 ticks) after the
    tick that queues it, so the cone actually arrives about two ticks later than reported.
*/
export function ticksUntilBearingCovered(state: ConeState, bearing: number, horizonTicks: number): number {
	if (coversBearing(state.rot, bearing)) return 0;
	if (!state.step) return Infinity;

	// Negative means the turn is overdue (held by a drain lock), so it fires at the first opportunity.
	const firstTurn = Math.max(0, state.ticksUntilTurn);
	const period = Math.max(1, state.turnPeriodTicks);

	for (let k = 1; k <= ROT_UNITS; k++) {
		const at = firstTurn + (k - 1) * period;
		if (at > horizonTicks) return Infinity;
		if (coversBearing(mod(state.rot + k * state.step, ROT_UNITS), bearing)) return at;
	}
	return Infinity;
}
