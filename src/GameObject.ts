import { getObject, ModelOptions } from './models';
import { GameObjType } from './sentland';

const appearDuration = 2000;
const appearSlice = 0.2;

export class GameObject {
	static typeName: string = 'base object';
	static type: GameObjType = null;
	creationTime: number;
	absorbedTime: number = null;
	ready: boolean = true;
	toRemove: boolean = false;
	object3D: THREE.Object3D = null;
	step: number = null;
	timer: number = null;
	faces: THREE.Mesh[] = [];
	constructor(
		public x: number,
		public y: number,
		public z: number,
		public rot: number,
		date: number,
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
		object.rotation.y = rot;
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
				const opacity = delta < start ? 1 : delta > start + appearSlice ? 0 : (start - delta) / appearSlice;
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
	static type: GameObjType = GameObjType.SENTINEL;
	play(time: number) {
		super.play(time);

		// try to detect player and absorbable items
		// absorb, spawn. Spawn meanie if needed
		// eventually turn
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
}
