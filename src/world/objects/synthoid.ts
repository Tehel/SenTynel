import { Vector3 } from 'three';
import { GameObjType } from '../terrain';
import { GameObject } from './base';

export class Synthoid extends GameObject {
	static type: GameObjType = GameObjType.SYNTHOID;

	play(time: number, playerPosition: Vector3) {
		super.play(time, playerPosition);
	}
}
