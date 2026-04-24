import { Vector3 } from 'three';
import { GameObjType } from '../terrain';
import { GameObject, angle256ToRad } from './base';

const turnDuration = 500;

// Fixed turn period: one step (28.125°) every 12 seconds. timer (5–31) is a phase
// offset that staggers the first turn across the first period so sentinels don't sync.
// Formula mirrors the original: initial delay = (1 + timer/64) × period.
const TURN_PERIOD_TICKS = 48; // 12 s × 4 Hz

export class Sentinel extends GameObject {
	turning = false;
	lastTurn: number | null = null;
	private turnQueued = false;
	private ticksUntilTurn: number;

	static type: GameObjType = GameObjType.SENTINEL;

	constructor(...args: ConstructorParameters<typeof GameObject>) {
		super(...args);
		const t = this.timer ?? 16;
		this.ticksUntilTurn = Math.round((1 + t / 64) * TURN_PERIOD_TICKS);
	}

	override playTick(_tick: number): void {
		this.ticksUntilTurn--;
		if (this.ticksUntilTurn <= 0) {
			this.ticksUntilTurn = TURN_PERIOD_TICKS;
			this.turnQueued = true;
		}
	}

	override play(time: number, playerPosition: Vector3): void {
		super.play(time, playerPosition);

		// Start turn animation when the game tick queued one
		if (this.turnQueued && !this.turning) {
			this.turning = true;
			this.turnQueued = false;
			this.lastTurn = time;
		}

		// View-cone detection — visual feedback only (scale doubles when player is in cone)
		let scale = 1;
		if (!this.turning) {
			const toPlayer = playerPosition.clone().sub(this.object3D.position);
			toPlayer.y = 0;
			const theta = angle256ToRad(this.rot);
			const facing = new Vector3(Math.sin(theta), 0, Math.cos(theta));
			const angle = facing.angleTo(toPlayer);
			if ((angle * 128) / Math.PI < 10) scale = 2;
		}
		this.object3D.scale.set(scale, scale, scale);

		// Interpolate visual rotation toward the queued target
		if (this.turning) {
			const elapsed = time - this.lastTurn!;
			const offset = Math.min(1, elapsed / turnDuration);
			this.object3D.rotation.y = angle256ToRad(this.rot + this.step! * offset);
			if (offset === 1) {
				this.turning = false;
				this.rot = (this.rot + this.step!) % 256;
			}
		}
	}
}
