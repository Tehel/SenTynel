import { Vector3 } from 'three';
import type { Mesh } from 'three';
import { GameObjType } from '../terrain';
import { GameObject, angle256ToRad } from './base';
import { game } from '../../game/state.svelte';

const TURN_DURATION_MS = 500;
// Fixed turn period: one step (28.125°) every 12 seconds. timer (5–31) is a phase
// offset that staggers the first turn across the first period so sentinels don't sync.
// Formula mirrors the original: initial delay = (1 + timer/64) × period.
const TURN_PERIOD_TICKS = 48; // 12 s × 4 Hz
// View cone half-angle in 256-step units. (10 / 128) × π ≈ 14° half-angle (28° full cone).
const CONE_HALF_ANGLE_256 = 10;

type TurnMode = 'idle' | 'queued' | 'turning';

export class Sentinel extends GameObject {
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

	static type: GameObjType = GameObjType.SENTINEL;

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

		// View-cone detection — subtle scale pulse when the player is in the cone.
		// (Scale 1.15 reads as "alert" without the goofy giant-watcher of the old marker.)
		// Skipped while the base class is animating spawn/absorb — the squash style owns
		// scale.y during those windows; touching it here would fight that animation.
		if (!this.ready || this.absorbedTime !== null) return;
		let scale = 1;
		if (this.mode !== 'turning') {
			const toPlayer = playerPosition.clone().sub(this.object3D.position);
			toPlayer.y = 0;
			const theta = angle256ToRad(this.rot);
			const facing = new Vector3(Math.sin(theta), 0, Math.cos(theta));
			const angle = facing.angleTo(toPlayer);
			if ((angle * 128) / Math.PI < CONE_HALF_ANGLE_256) scale = 1.15;
		}
		this.object3D.scale.set(scale, scale, scale);

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
