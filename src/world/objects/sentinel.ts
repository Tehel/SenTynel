import { Vector3 } from 'three';
import { GameObjType } from '../terrain';
import { GameObject, angle256ToRad } from './base';

const turnPeriod = 10000;
const turnDuration = 500;

export class Sentinel extends GameObject {
	lastTurn: number | null = null;
	turning: boolean = false;

	static type: GameObjType = GameObjType.SENTINEL;

	play(time: number, playerPosition: Vector3) {
		super.play(time, playerPosition);
		if (this.lastTurn === null) {
			this.lastTurn = time + (this.timer! / 64) * turnPeriod;
		}

		let scale = 1;
		if (!this.turning) {
			const toPlayer = playerPosition.clone().sub(this.object3D.position);
			toPlayer.y = 0;

			// Models face +Z locally; world forward = R_y(θ) * (0,0,+1) = (sin(θ), 0, cos(θ))
			const theta = angle256ToRad(this.rot);
			const facing = new Vector3(Math.sin(theta), 0, Math.cos(theta));
			const angle = facing.angleTo(toPlayer);
			if ((angle * 128) / Math.PI < 10) {
				scale = 2;
			}
		}

		this.object3D.scale.set(scale, scale, scale);

		if (!this.turning && time - this.lastTurn! > turnPeriod) {
			this.turning = true;
			this.lastTurn = time;
		}
		if (this.turning) {
			const timeFromTurnStart = time - this.lastTurn!;
			const offset = Math.min(1, timeFromTurnStart / turnDuration);
			this.object3D.rotation.y = angle256ToRad(this.rot + this.step! * offset);
			if (offset === 1) {
				this.turning = false;
				this.rot = (this.rot + this.step!) % 256;
			}
		}
	}
}
