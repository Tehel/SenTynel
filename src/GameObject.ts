import type { GameObjType } from './sentland';

export class GameObject {
	constructor(
		public type: GameObjType,
		public x: number,
		public y: number,
		public rot: number,
		public step: number,
		public timer: number,
		public object3D: THREE.Object3D
	) {}
	// run a game round
	play(time: number) {}
}
