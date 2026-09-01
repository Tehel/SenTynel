import { Vector3 } from 'three';
import type { Mesh } from 'three';
import { GameObject, angle256ToRad } from './base';
import { game } from '../../game/state.svelte';
import { activeStats } from '../../game/stats.svelte';

const TURN_DURATION_MS = 500;
// Fixed turn period: one step (28.125°) every 12 seconds. timer (5–31) is a phase
// offset that staggers the first turn across the first period so watchers don't sync.
// Formula mirrors the original: initial delay = (1 + timer/64) × period.
const TURN_PERIOD_TICKS = 48; // 12 s × 4 Hz, before any per-completion speedup

// Replayability incentive: every full playthrough (win on landscape 9999) makes
// watchers rotate 5% faster, compounding — period *= 0.95^gameCompletions.
// Read off whichever stats record is playing (game/stats.svelte.ts's activeStats), so the demo
// bot compounds its own completions rather than inheriting the player's.
const ROTATION_SPEEDUP_PER_COMPLETION = 0.95;

type TurnMode = 'idle' | 'queued' | 'turning';

// Shared rotation + drain-lock behaviour for Sentinel and Sentry. Kept as a common base
// (rather than Sentry extending Sentinel) so `instanceof Watcher` reads as the intended
// "either kind of watcher" check instead of relying on an incidental subclass relationship.
export class Watcher extends GameObject {
	private mode: TurnMode = 'idle';
	/*
	 Rising edge of a turn, for whoever wants to react to one exactly once — the turn sound, today.
	 A flag rather than a callback because world/ must not reach into engine/ (that would invert the
	 dependency: engine imports world, never the reverse), and rather than polling the `turning`
	 getter because that stays true for the whole animation, so an observer would have to keep its
	 own per-watcher previous state just to find the edge.
	*/
	private turnStarted = false;

	consumeTurnStarted(): boolean {
		if (!this.turnStarted) return false;
		this.turnStarted = false;
		return true;
	}
	private turnStartTime = 0;
	private ticksUntilTurn: number;
	// Per-instance so a mid-game change to gameCompletions (only possible via a level
	// reload) can't desync an already-ticking watcher from the value it started with.
	private turnPeriodTicks: number;
	// Debug visualization mesh, attached lazily by the engine layer when the
	// `Show watcher cones` setting is on.
	coneMesh: Mesh | null = null;
	/*
	 Set by `engine/watcher.ts:runDrainPhase` after each 1 Hz drain phase. While true, the rotation
	 timer keeps decrementing but the queued turn is held — the original's "a watcher won't rotate
	 while it has something to drain" rule.

	 It tracks ACTUALLY DRAINING, not merely having a target. A watcher counting down its lock-on
	 stall (below) keeps turning on schedule, and loses the target if its beam carries it away —
	 confirmed against Augmentinel, and the reason waiting a beam out is as good an escape as
	 breaking line of sight.
	*/
	drainLocked = false;

	/*
	 The lock-on stall (RULES-FIDELITY.md C6, game/timing.ts's WATCHER_GRACE_MS).

	 A watcher's attention is a single exclusive slot. On acquiring a SYNTHOID it stares for the
	 grace period before taking the first point; boulders it takes at once. `lockTarget` is the
	 object it is currently fixed on and `lockStartedAt` the timestamp it fixed on it, so losing and
	 re-acquiring the same object costs the full stall again.

	 Owned here rather than in the drain module because it is per-watcher state with the same
	 lifetime as `drainLocked`, and because a watcher absorbed mid-stare takes its lock with it.
	*/
	lockTarget: GameObject | null = null;
	lockStartedAt = 0;

	constructor(...args: ConstructorParameters<typeof GameObject>) {
		super(...args);
		this.turnPeriodTicks = Math.max(
			1,
			Math.round(TURN_PERIOD_TICKS * Math.pow(ROTATION_SPEEDUP_PER_COMPLETION, activeStats().gameCompletions))
		);
		const t = this.timer ?? 16;
		this.ticksUntilTurn = Math.round((1 + t / 64) * this.turnPeriodTicks);
	}

	setConeVisible(visible: boolean): void {
		if (this.coneMesh) this.coneMesh.visible = visible;
	}

	/*
	 Rotation clock, read-only, for the demo bot's cone prediction (game/cone.ts, PLAN-BOT2.md B1).

	 The two fields stay private: this is a window onto the schedule, not a way to reach in and
	 reset it. `ticksUntilTurn` can be zero or negative while drain-locked — the turn is overdue and
	 fires on the first tick with nothing left to eat — and the bot reads that as "due now".
	*/
	get ticksToTurn(): number {
		return this.ticksUntilTurn;
	}

	get turnPeriod(): number {
		return this.turnPeriodTicks;
	}

	/*
	 Is a turn in flight right now — queued this tick, or part-way through its animation?

	 Exists because `ticksUntilTurn` and `rot` describe DIFFERENT MOMENTS during that window.
	 playTick resets the countdown the instant the turn is queued, but `rot` is not committed
	 until the animation finishes TURN_DURATION_MS later, so for half a second a reader sees a
	 fresh clock against a stale facing and concludes the next sector is a whole period away when
	 it is actually arriving. game/exposure.ts uses this to shift its schedule by one turn for the
	 duration; game/cone.ts does not, and documents the resulting ~2-tick lag instead.
	*/
	get turning(): boolean {
		return this.mode !== 'idle';
	}

	override playTick(_tick: number): void {
		// Dormant until the player takes their first action.
		if (!game.firstActionTaken) return;
		this.ticksUntilTurn--;
		if (this.ticksUntilTurn <= 0) {
			// Drain-locked watchers hold the queued turn; ticksUntilTurn keeps decrementing
			// (into negatives) so the turn fires immediately on the first unlocked tick.
			if (this.drainLocked) return;
			this.ticksUntilTurn = this.turnPeriodTicks;
			if (this.mode === 'idle') this.mode = 'queued';
			// If still 'turning' from a previous tick, drop this trigger (animation in flight).
		}
	}

	override play(time: number, playerPosition: Vector3): void {
		super.play(time, playerPosition);

		// Start turn animation when the game tick queued one.
		if (this.mode === 'queued') {
			this.mode = 'turning';
			this.turnStartTime = time;
			this.turnStarted = true;
		}

		// Skip rotation interpolation while spawning in or being absorbed — the squash/fade
		// style owns the object's transform during those windows.
		if (!this.ready || this.absorbedTime !== null) return;

		// Interpolate visual rotation toward the queued target.
		if (this.mode === 'turning') {
			const offset = Math.min(1, (time - this.turnStartTime) / TURN_DURATION_MS);
			this.object3D.rotation.y = angle256ToRad(this.rot + this.step! * offset);
			if (offset === 1) {
				this.rot = (this.rot + this.step!) % 256;
				this.mode = 'idle';
			}
		}
	}
}
