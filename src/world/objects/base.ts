import { Material, Mesh, MeshPhongMaterial, Object3D, Vector3 } from 'three';
import { getObject, type ModelOptions } from './models/index';
import { GameObjType, MAP_SIZE } from '../terrain';

const appearDuration = 2000;
const appearSlice = 0.2;

export const angle256ToRad = (angle: number) => Math.PI - (angle * 2 * Math.PI) / 256;
export const radToAngle256 = (theta: number) => (((Math.PI - theta) * 128) / Math.PI + 256) % 256;

// Y rotation (radians) so a model at (fromCol, fromRow) faces (toCol, toRow).
// Models face +Z locally → world forward = (sin θ, 0, cos θ). Z = (MAP_SIZE-1) - row so
// the row delta is sign-flipped relative to world Z.
export function angleFacing(fromCol: number, fromRow: number, toCol: number, toRow: number): number {
	return Math.atan2(toCol - fromCol, fromRow - toRow);
}

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
		modelOptions: ModelOptions = {}
	) {
		const type = (this.constructor as any).type;
		const object = getObject(type, modelOptions);
		if (date > 0) {
			this.creationTime = date;
			this.ready = false;
		} else {
			object.children.forEach(o => (((o as Mesh).material as MeshPhongMaterial).opacity = 1));
		}
		this.faces = object.children
			.map(o => o as Mesh)
			.sort((m1, m2) => m1.geometry.userData.highest - m2.geometry.userData.highest);

		// Y-up: position.x=col, position.y=height, position.z=(MAP_SIZE-1)-row
		// Models are defined in Y-up local space, no X-rotation needed.
		// userData.gameObject is the back-reference used by the picker; col/row are also
		// stored so visibility.ts can skip target-cell hits without unwrapping the back-ref.
		object.userData = { gameObject: this, col, row };
		object.position.set(col + 0.5, height, (MAP_SIZE - 1) - (row + 0.5));
		object.rotation.y = angle256ToRad(rot);
		this.object3D = object;
	}

	remove(time: number) {
		this.absorbedTime = time;
	}

	// Rotate this object so its model faces the centre of cell (col, row). Updates both
	// the abstract `rot` (256-step) and the live `object3D.rotation.y` so the change is
	// visible immediately and persists across saves/snapshots of the GameObject state.
	faceTowards(col: number, row: number): void {
		const theta = angleFacing(this.col, this.row, col, row);
		this.rot = radToAngle256(theta);
		this.object3D.rotation.y = theta;
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
		if (this.absorbedTime !== null) {
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
