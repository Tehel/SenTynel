import { describe, it, expect, beforeEach } from 'vitest';
import { Vector3 } from 'three';
import { Sentry } from './index';
import { game } from '../../game/state.svelte';
import { ticksUntilBearingCovered, type ConeState } from '../../game/cone';

/*
 The demo bot predicts cone timing off Watcher's rotation clock (game/cone.ts, PLAN-BOT2.md B1), and
 the arithmetic there is only worth anything if `ticksToTurn` really is the number of ticks before
 `rot` moves. That is the half the cone-vs-bearing cross-check in game/cone.test.ts cannot reach: it
 proves the bot agrees with the drain phase about *where* a cone points, not about *when* it moves.

 So this drives a real Watcher through real ticks and frames, and checks the clock against what
 actually happens to `rot`.
*/

// world/objects/watcher.ts's TURN_DURATION_MS — the animation that commits the new rot.
const TURN_MS = 500;
const HERE = new Vector3(0, 0, 0);

// Run one 4 Hz tick and then a frame late enough for any queued turn animation to have finished.
function advance(watcher: Sentry, tick: number): number {
	const time = tick * 250;
	watcher.playTick(tick);
	watcher.play(time, HERE);
	watcher.play(time + TURN_MS, HERE);
	return time;
}

describe('Watcher rotation clock', () => {
	beforeEach(() => {
		// Watchers are dormant until the player acts, which is the state a real run reaches within
		// its first second — and the bot's prediction assumes the clock is running.
		game.firstActionTaken = true;
	});

	it('turns exactly when ticksToTurn says it will, then every turnPeriod after', () => {
		const watcher = new Sentry(0, 5, 5, 3, 0, 20, 16);
		const first = watcher.ticksToTurn;
		const period = watcher.turnPeriod;
		// The generator's stagger: (1 + timer/64) × period, so the first turn is later than the rest.
		expect(first).toBe(Math.round((1 + 16 / 64) * period));

		const turnedAt: number[] = [];
		let previous = watcher.rot;
		for (let tick = 1; tick <= first + 3 * period; tick++) {
			advance(watcher, tick);
			if (watcher.rot !== previous) {
				turnedAt.push(tick);
				previous = watcher.rot;
			}
		}

		expect(turnedAt.slice(0, 4)).toEqual([first, first + period, first + 2 * period, first + 3 * period]);
	});

	it('advances rot by exactly one step per turn, in the generator’s direction', () => {
		const clockwise = new Sentry(0, 5, 5, 3, 100, 20, 16);
		const anticlockwise = new Sentry(0, 5, 5, 3, 100, -20, 16);
		// Captured, not read in the loop condition — it counts down as the ticks go in.
		const first = clockwise.ticksToTurn;
		for (let tick = 1; tick <= first; tick++) {
			advance(clockwise, tick);
			advance(anticlockwise, tick);
		}
		expect(clockwise.rot).toBe(120);
		expect(anticlockwise.rot).toBe(80);
	});

	/*
	 The end-to-end claim, and the one the planner will lean on: ask the predictor when a bearing
	 comes under the cone, run the watcher that many ticks, and it should be looking at it.

	 Checked one tick early too — a prediction that is merely *eventually* right would let the bot
	 build on a tile the cone is already sweeping onto.
	*/
	it('matches the prediction game/cone.ts makes from it', () => {
		const watcher = new Sentry(0, 5, 5, 3, 0, 20, 16);
		const state: ConeState = {
			col: watcher.col,
			row: watcher.row,
			rot: watcher.rot,
			step: watcher.step,
			ticksUntilTurn: watcher.ticksToTurn,
			turnPeriodTicks: watcher.turnPeriod,
		};
		// Three steps round from a facing of 0, so a genuine wait rather than "already there".
		const bearing = 60;
		const predicted = ticksUntilBearingCovered(state, bearing, 10_000);
		expect(predicted).toBeGreaterThan(0);
		expect(predicted).toBeLessThan(Infinity);

		const seenAt: number[] = [];
		for (let tick = 1; tick <= predicted; tick++) {
			advance(watcher, tick);
			// Same test the drain phase applies, in the units game/cone.ts works in.
			const delta = Math.min(Math.abs(watcher.rot - bearing), 256 - Math.abs(watcher.rot - bearing));
			if (delta <= 10) seenAt.push(tick);
		}
		expect(seenAt[0]).toBe(predicted);
	});
});
