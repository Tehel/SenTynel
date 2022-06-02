import { getObject, ModelOptions } from './models';
import { GameObjType } from './sentland';

const appearDuration = 2000;
const appearSlice = 0.2;

const turnPeriod = 10000;
const turnDuration = 500;

const angle256Torad = (angle: number) => Math.PI - (angle * 2 * Math.PI) / 256;

export class GameObject {
	static typeName: string = 'base object';
	static type: GameObjType = null;
	creationTime: number;
	absorbedTime: number = null;
	ready: boolean = true;
	toRemove: boolean = false;
	object3D: THREE.Object3D = null;
	faces: THREE.Mesh[] = [];
	constructor(
		date: number,
		public x: number,
		public y: number,
		public z: number,
		public rot: number,
		public step: number = null,
		public timer: number = null,
		modelOptions: ModelOptions
	) {
		const type = (this.constructor as any).type;
		const object = getObject(type, modelOptions);
		if (date > 0) {
			this.creationTime = date;
			this.ready = false;
		} else {
			object.children.forEach(o => (((o as THREE.Mesh).material as THREE.MeshPhongMaterial).opacity = 1));
		}
		// build list of faces, sorted by ascending heighest vertex
		this.faces = object.children
			.map(o => o as THREE.Mesh)
			.sort((m1, m2) => m1.geometry.userData.highest - m2.geometry.userData.highest);

		object.userData = { type: GameObjType[type], x, y };
		object.position.set(x + 0.5, y + 0.5, z);
		object.rotation.x = Math.PI / 2;
		object.rotation.y = angle256Torad(rot);
		this.object3D = object;
	}

	remove(time) {
		this.absorbedTime = time;
	}

	// run a game round, should be overloaded by childen
	play(time: number) {
		if (!this.ready) {
			// apparition sequence
			const timeFromCreation = time - this.creationTime;
			const delta = Math.min(timeFromCreation / appearDuration, 1);
			for (let i = 0; i < this.faces.length; i++) {
				const face = this.faces[i];
				const start = (i / (this.faces.length - 1)) * (1 - appearSlice);
				const opacity = delta < start ? 0 : delta > start + appearSlice ? 1 : (delta - start) / appearSlice;
				const material = face.material as THREE.MeshPhongMaterial;
				material.opacity = opacity;
			}
			if (delta >= 1) this.ready = true;
		}
		if (this.absorbedTime) {
			// disparition sequence
			const timeFromRemoval = time - this.absorbedTime;
			const delta = Math.min(timeFromRemoval / appearDuration, 1);
			for (let i = 0; i < this.faces.length; i++) {
				const face = this.faces[i];
				const start = (1 - i / (this.faces.length - 1)) * (1 - appearSlice);
				const opacity = delta < start ? 1 : delta > start + appearSlice ? 0 : 1 - (delta - start) / appearSlice;
				const material = face.material as THREE.MeshPhongMaterial;
				material.opacity = opacity;
			}
			if (delta >= 1) this.toRemove = true;
		}
	}
}

export class Tree extends GameObject {
	static type: GameObjType = GameObjType.TREE;
	// nothing to do, trees do much
}

export class Pedestal extends GameObject {
	static type: GameObjType = GameObjType.PEDESTAL;
	// nothing to do, pedestal do much
}

export class Boulder extends GameObject {
	static type: GameObjType = GameObjType.BOULDER;
	// nothing to do, boulders do much
}

export class Sentinel extends GameObject {
	lastTurn: number = null;
	turning: boolean = false;

	static type: GameObjType = GameObjType.SENTINEL;

	play(time: number) {
		super.play(time);
		if (!this.lastTurn) {
			// timer is 0-32, so add 32th of the period
			this.lastTurn = time + (this.timer / 64) * turnPeriod;
		}

		// flag to be set to prevent turning if we have a target
		const turnStandby = false;

		// TODO: try to detect player and absorbable items
		// field of view is (20/256)*PI*2 (=28.125°)
		// regarless of height difference, so check angle between sentry->rot and sentry->player. abs value should be < 10/256*PI*2
		if (!this.turning) {
		}

		// absorb, spawn. Spawn meanie if needed

		// periodically turn
		if (!this.turning && !turnStandby && time - this.lastTurn > turnPeriod) {
			// TODO: play turn sound
			this.turning = true;
			this.lastTurn = time;
		}
		if (this.turning) {
			const timeFromTurnStart = time - this.lastTurn;
			const offset = Math.min(1, timeFromTurnStart / turnDuration);
			this.object3D.rotation.y = angle256Torad(this.rot + this.step * offset);
			if (offset === 1) {
				this.turning = false;
				this.rot = (this.rot + this.step) % 256;
			}
		}
		// they rotate by 20/256ths of a complete turn each time, which is 28.125
	}
}

export class Sentry extends Sentinel {
	static type: GameObjType = GameObjType.SENTRY;
	// sentries behave exactly like the main sentinel
}

export class Synthoid extends GameObject {
	static type: GameObjType = GameObjType.SYNTHOID;
	// ?
}

export class Meanie extends GameObject {
	static type: GameObjType = GameObjType.MEANIE;
	// ?

	// TODO: meanie turns toward player. If facing and close enough, hyperspace him.
}
