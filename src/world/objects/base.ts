import { Material, Mesh, MeshPhongMaterial, Object3D, Vector3 } from 'three';
import { getObject, type ModelOptions } from './models/index';
import { GameObjType, MAP_SIZE } from '../terrain';
import { settings } from '../../settings.svelte';

// Fade animation (legacy / default): opacity ramps face-by-face.
const FADE_DURATION_MS = 2000;
const FADE_SLICE = 0.2;
// Squash animation: object3D.scale.y interpolates between 0 and 1 in discrete steps.
// 1 second total at 50 ms per step → 20 visible steps. Per-frame reads of
// `settings.animationStyle` mean toggling the menu setting takes effect immediately
// for any future animation; in-progress animations may glitch through the switch.
const SQUASH_DURATION_MS = 1000;
const SQUASH_STEP_MS = 50;

// Ease-in: slow at t=0 (derivative 0), fastest at t=1 (derivative π/2). Used by
// the squash so the object grows tentatively then shoots up at the end, and similarly
// for absorb (mirrored as `1 - easeIn(t)` = `cos(π/2 · t)` — slow start, fast finish).
// Trivially swappable: replace with `t * t` for ease in Quad (snappier) or `t * t * t`
// for ease in Cubic (more dramatic, near-flat for the first ~⅓).
function easeIn(t: number): number {
	// return 1 - Math.cos((Math.PI / 2) * t);
	// return t;
	return t * t;
	// return t * t * t;
}

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
	// Multiplier on elapsed time for spawn/absorb animations. 1 = normal speed
	// (player actions); watcher drains use 2 to fit absorb + spawn into 1 second.
	animationScale: number = 1;

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
			// Initial visual state for runtime spawns depends on the active animation style:
			// - fade: keep material opacity at the model's default 0; play() ramps it up.
			// - squash: opaque from frame 1, but scale.y starts at 0 and grows.
			if (settings.animationStyle === 'squash') {
				object.scale.y = 0;
				object.children.forEach(o => (((o as Mesh).material as MeshPhongMaterial).opacity = 1));
			}
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

	play(_time: number, _playerPosition: Vector3) {
		if (settings.animationStyle === 'squash') this.playSquash(_time);
		else this.playFade(_time);
	}

	// Per-face opacity fade-in (creation) and fade-out (absorb). Faces are sorted by
	// height, so creation reveals bottom-up and absorption hides top-down.
	private playFade(time: number) {
		if (!this.ready) {
			const timeFromCreation = (time - this.creationTime) * this.animationScale;
			const delta = Math.min(timeFromCreation / FADE_DURATION_MS, 1);
			for (let i = 0; i < this.faces.length; i++) {
				const face = this.faces[i];
				const start = (i / (this.faces.length - 1)) * (1 - FADE_SLICE);
				const opacity = delta < start ? 0 : delta > start + FADE_SLICE ? 1 : (delta - start) / FADE_SLICE;
				(face.material as MeshPhongMaterial).opacity = opacity;
			}
			if (delta >= 1) this.ready = true;
		}
		if (this.absorbedTime !== null) {
			const timeFromRemoval = (time - this.absorbedTime) * this.animationScale;
			const delta = Math.min(timeFromRemoval / FADE_DURATION_MS, 1);
			for (let i = 0; i < this.faces.length; i++) {
				const face = this.faces[i];
				const start = (1 - i / (this.faces.length - 1)) * (1 - FADE_SLICE);
				const opacity = delta < start ? 1 : delta > start + FADE_SLICE ? 0 : 1 - (delta - start) / FADE_SLICE;
				(face.material as MeshPhongMaterial).opacity = opacity;
			}
			if (delta >= 1) this.toRemove = true;
		}
	}

	// Vertical scale animation: object3D.scale.y goes 0→1 (creation) or 1→0 (absorb)
	// in discrete SQUASH_STEP_MS jumps, giving a chunky, retro-flavoured stretch.
	// All vertex Y values share a common pivot at the model's local y=0 (its base),
	// so scaling collapses the model down toward its footprint. Each step's *value*
	// follows the easeIn curve, so the object accelerates from rest then snaps
	// into place (or out of it, on absorb).
	private playSquash(time: number) {
		const totalSteps = Math.ceil(SQUASH_DURATION_MS / SQUASH_STEP_MS);
		if (!this.ready) {
			const elapsed = (time - this.creationTime) * this.animationScale;
			if (elapsed >= SQUASH_DURATION_MS) {
				this.object3D.scale.y = 1;
				this.ready = true;
			} else {
				const step = Math.max(0, Math.floor(elapsed / SQUASH_STEP_MS));
				this.object3D.scale.y = easeIn(step / totalSteps);
			}
		}
		if (this.absorbedTime !== null) {
			const elapsed = (time - this.absorbedTime) * this.animationScale;
			if (elapsed >= SQUASH_DURATION_MS) {
				this.object3D.scale.y = 0;
				this.toRemove = true;
			} else {
				const step = Math.max(0, Math.floor(elapsed / SQUASH_STEP_MS));
				this.object3D.scale.y = 1 - easeIn(step / totalSteps);
			}
		}
	}
}
