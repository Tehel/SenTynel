import { Vector3 } from 'three';
import type { Mesh } from 'three';
import { GameObject, angle256ToRad } from './base';
import { game } from '../../game/state.svelte';

const TURN_DURATION_MS = 500;
// Fixed turn period: one step (28.125°) every 12 seconds. timer (5–31) is a phase
// offset that staggers the first turn across the first period so watchers don't sync.
// Formula mirrors the original: initial delay = (1 + timer/64) × period.
const TURN_PERIOD_TICKS = 48; // 12 s × 4 Hz

type TurnMode = 'idle' | 'queued' | 'turning';

// Shared rotation + drain-lock behaviour for Sentinel and Sentry. Kept as a common base
// (rather than Sentry extending Sentinel) so `instanceof Watcher` reads as the intended
// "either kind of watcher" check instead of relying on an incidental subclass relationship.
export class Watcher extends GameObject {
	private mode: TurnMode = 'idle';
	private turnStartTime = 0;
	private ticksUntilTurn: number;
	// Debug visualization mesh, attached lazily by the engine layer when the
	// `Show watcher cones` setting is on.
	coneMesh: Mesh | null = null;
	// Set by `engine/watcher.ts:runDrainPhase` after each 1 Hz drain phase. While true,
	// the rotation timer keeps decrementing but the queued turn is held — matching the
	// original game's "watcher won't rotate while it has something to drain" rule.
	drainLocked = false;

	constructor(...args: ConstructorParameters<typeof GameObject>) {
		super(...args);
		const t = this.timer ?? 16;
		this.ticksUntilTurn = Math.round((1 + t / 64) * TURN_PERIOD_TICKS);
	}

	setConeVisible(visible: boolean): void {
		if (this.coneMesh) this.coneMesh.visible = visible;
	}

	override playTick(_tick: number): void {
		// Dormant until the player takes their first action.
		if (!game.firstActionTaken) return;
		this.ticksUntilTurn--;
		if (this.ticksUntilTurn <= 0) {
			// Drain-locked watchers hold the queued turn; ticksUntilTurn keeps decrementing
			// (into negatives) so the turn fires immediately on the first unlocked tick.
			if (this.drainLocked) return;
			this.ticksUntilTurn = TURN_PERIOD_TICKS;
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
