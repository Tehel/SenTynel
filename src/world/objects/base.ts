import { Material, Mesh, MeshPhongMaterial, Object3D, Vector3 } from 'three';
import { getObject, type ModelOptions } from './models/index';
import { GameObjType } from '../terrain';

const appearDuration = 2000;
const appearSlice = 0.2;

export const angle256ToRad = (angle: number) => Math.PI - (angle * 2 * Math.PI) / 256;

export class GameObject {
	static typeName: string = 'base object';
	static type: GameObjType | null = null;
	creationTime!: number;
	absorbedTime: number | null = null;
	ready: boolean = true;
	toRemove: boolean = false;
	object3D!: Object3D;
	faces: Mesh[] = [];

	// Y-up grid coordinates: col=East-West, row=North-South, height=vertical
	constructor(
		date: number,
		public col: number,
		public row: number,
		public height: number,
		public rot: number,
		public step: number | null = null,
		public timer: number | null = null,
		dim: number,
		modelOptions: ModelOptions
	) {
		const type = (this.constructor as any).type;
		const object = getObject(type, modelOptions);
		if (!object) throw new Error(`No model for GameObjType ${type}`);
		if (date > 0) {
			this.creationTime = date;
			this.ready = false;
		} else {
			object.children.forEach(o => (((o as Mesh).material as MeshPhongMaterial).opacity = 1));
		}
		this.faces = object.children
			.map(o => o as Mesh)
			.sort((m1, m2) => m1.geometry.userData.highest - m2.geometry.userData.highest);

		// Y-up: position.x=col, position.y=height, position.z=(dim-1)-row
		// Models are defined in Y-up local space, no X-rotation needed.
		object.userData = { type: GameObjType[type], col, row };
		object.position.set(col + 0.5, height, (dim - 1) - (row + 0.5));
		object.rotation.y = angle256ToRad(rot);
		this.object3D = object;
	}

	remove(time: number) {
		this.absorbedTime = time;
	}

	dispose(): void {
		this.object3D.traverse(obj => {
			const mesh = obj as Mesh;
			if (mesh.isMesh) {
				mesh.geometry.dispose();
				if (Array.isArray(mesh.material)) {
					(mesh.material as Material[]).forEach(m => m.dispose());
				} else {
					(mesh.material as Material).dispose();
				}
			}
		});
	}

	// Called at fixed 4 Hz game tick rate. Override in subclasses for game logic.
	playTick(_tick: number): void {}

	play(time: number, playerPosition: Vector3) {
		if (!this.ready) {
			const timeFromCreation = time - this.creationTime;
			const delta = Math.min(timeFromCreation / appearDuration, 1);
			for (let i = 0; i < this.faces.length; i++) {
				const face = this.faces[i];
				const start = (i / (this.faces.length - 1)) * (1 - appearSlice);
				const opacity = delta < start ? 0 : delta > start + appearSlice ? 1 : (delta - start) / appearSlice;
				(face.material as MeshPhongMaterial).opacity = opacity;
			}
			if (delta >= 1) this.ready = true;
		}
		if (this.absorbedTime) {
			const timeFromRemoval = time - this.absorbedTime;
			const delta = Math.min(timeFromRemoval / appearDuration, 1);
			for (let i = 0; i < this.faces.length; i++) {
				const face = this.faces[i];
				const start = (1 - i / (this.faces.length - 1)) * (1 - appearSlice);
				const opacity = delta < start ? 1 : delta > start + appearSlice ? 0 : 1 - (delta - start) / appearSlice;
				(face.material as MeshPhongMaterial).opacity = opacity;
			}
			if (delta >= 1) this.toRemove = true;
		}
	}
}
