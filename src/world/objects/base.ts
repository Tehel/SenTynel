import { Mesh, MeshPhongMaterial, Object3D, Vector3 } from 'three';
import {
	getObject,
	type FadeUniforms,
	type ModelOptions,
	FADE_MODE_PER_VERTEX_IN,
	FADE_MODE_PER_VERTEX_OUT,
	FADE_MODE_READY,
	FADE_MODE_UNIFORM_IN,
	FADE_MODE_UNIFORM_OUT,
} from './models/index';
import { GameObjType, MAP_SIZE } from '../terrain';
import { settings } from '../../settings.svelte';

// Fade animation: shader-driven per-vertex alpha. The `fade` style reveals bottom-up
// on creation and hides top-down on absorb (faces ranked by max-Y); the `dissolve`
// style ramps a uniform alpha across the whole mesh. Both share the same playback
// path (playFade); the mode is set in the constructor / remove() and stays put.
const FADE_DURATION_MS = 2000;
// Squash animation: object3D.scale.y interpolates between 0 and 1 in discrete steps.
// 1 second total at 50 ms per step → 20 visible steps. Per-frame reads of
// `settings.animationStyle` mean toggling the menu setting takes effect immediately
// for any future animation; in-progress animations may glitch through the switch.
const SQUASH_DURATION_MS = 1000;
const SQUASH_STEP_MS = 50;

// Ease-in: slow at t=0, fastest at t=1. Used by the squash so the object grows
// tentatively then shoots up at the end. Trivially swappable: replace with `t * t * t`
// for ease-in cubic (more dramatic) or `1 - cos(π/2 · t)` for ease-in sine.
function easeIn(t: number): number {
	return t * t;
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
		const mesh = getObject(type, modelOptions);
		if (date > 0) {
			this.creationTime = date;
			this.ready = false;
			// Style picked at construction; stays put for this animation. Squash uses
			// scale.y, fade/dissolve drive the shader through the FadeUniforms.
			const style = settings.animationStyle;
			if (style === 'squash') {
				mesh.scale.y = 0;
			} else {
				this.beginFade(mesh, style === 'fade' ? FADE_MODE_PER_VERTEX_IN : FADE_MODE_UNIFORM_IN);
			}
		}

		// Y-up: position.x=col, position.y=height, position.z=(MAP_SIZE-1)-row
		// userData.gameObject is the back-reference used by the picker; col/row are also
		// stored so visibility.ts can skip target-cell hits without unwrapping the back-ref.
		mesh.userData = { gameObject: this, col, row };
		mesh.position.set(col + 0.5, height, (MAP_SIZE - 1) - (row + 0.5));
		mesh.rotation.y = angle256ToRad(rot);
		this.object3D = mesh;
	}

	remove(time: number) {
		this.absorbedTime = time;
		// Fade absorbs need alpha blending; squash absorbs scale to 0 with the material
		// staying fully opaque, so leave the shader in READY mode in that case.
		const style = settings.animationStyle;
		if (style === 'fade' || style === 'dissolve') {
			this.beginFade(this.object3D as Mesh, style === 'fade' ? FADE_MODE_PER_VERTEX_OUT : FADE_MODE_UNIFORM_OUT);
		}
	}

	// Enable transparent rendering and reset the fade uniforms for a new animation.
	private beginFade(mesh: Mesh, mode: number): void {
		const material = mesh.material as MeshPhongMaterial;
		const uniforms = material.userData.uniforms as FadeUniforms;
		uniforms.fadeMode.value = mode;
		uniforms.fadeProgress.value = 0;
		if (!material.transparent) {
			material.transparent = true;
			material.needsUpdate = true;
		}
	}

	// End-of-spawn: shader back to READY (alpha=1) and material back to opaque so the
	// renderer can early-z this object's faces and the state-batching path picks them up.
	private endFadeIn(): void {
		const material = (this.object3D as Mesh).material as MeshPhongMaterial;
		const uniforms = material.userData.uniforms as FadeUniforms;
		uniforms.fadeMode.value = FADE_MODE_READY;
		if (material.transparent) {
			material.transparent = false;
			material.needsUpdate = true;
		}
	}

	// Manually drives the uniform-fade shader path to reflect this object's visibility
	// independent of the create/absorb animation lifecycle — used when the camera stops (or
	// starts) "looking through" this object's own body (bird's-eye lift-off/landing, winning)
	// so it fades into or out of view instead of popping and clipping through the camera
	// mid-flight. No-ops against playFade/playSquash: those only touch ready, non-absorbed
	// objects while an actual creation/absorb animation is running, which this object isn't.
	setViewOpacity(t: number): void {
		const mesh = this.object3D as Mesh;
		const material = mesh.material as MeshPhongMaterial;
		const uniforms = material.userData.uniforms as FadeUniforms;
		mesh.visible = t > 0;
		if (t <= 0 || t >= 1) {
			// Resting state at either extreme — same state a finished creation-fade leaves
			// the shader in (cheap to render, early-z eligible).
			uniforms.fadeMode.value = FADE_MODE_READY;
			if (material.transparent) {
				material.transparent = false;
				material.needsUpdate = true;
			}
			return;
		}
		uniforms.fadeMode.value = FADE_MODE_UNIFORM_IN;
		uniforms.fadeProgress.value = t;
		if (!material.transparent) {
			material.transparent = true;
			material.needsUpdate = true;
		}
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
		// Dispose ONLY the merged geometry/material owned by this object. The cone child
		// (when present) shares geometry+material with all watchers via SceneData.coneAssets;
		// those assets are owned by the disposer and freed once on scene rebuild.
		const mesh = this.object3D as Mesh;
		mesh.geometry.dispose();
		if (Array.isArray(mesh.material)) {
			mesh.material.forEach(m => m.dispose());
		} else {
			mesh.material.dispose();
		}
	}

	// Called at fixed 4 Hz game tick rate. Override in subclasses for game logic.
	playTick(_tick: number): void {}

	play(_time: number, _playerPosition: Vector3) {
		if (settings.animationStyle === 'squash') this.playSquash(_time);
		else this.playFade(_time);
	}

	// Drives the shader: fadeProgress 0→1 over FADE_DURATION_MS, mode picked at the
	// start of the animation. Both 'fade' and 'dissolve' come through here.
	private playFade(time: number) {
		const material = (this.object3D as Mesh).material as MeshPhongMaterial;
		const uniforms = material.userData.uniforms as FadeUniforms;
		if (!this.ready) {
			const elapsed = (time - this.creationTime) * this.animationScale;
			const delta = Math.min(elapsed / FADE_DURATION_MS, 1);
			uniforms.fadeProgress.value = delta;
			if (delta >= 1) {
				this.ready = true;
				this.endFadeIn();
			}
		}
		if (this.absorbedTime !== null) {
			const elapsed = (time - this.absorbedTime) * this.animationScale;
			const delta = Math.min(elapsed / FADE_DURATION_MS, 1);
			uniforms.fadeProgress.value = delta;
			if (delta >= 1) this.toRemove = true;
		}
	}

	// Vertical scale animation: object3D.scale.y goes 0→1 (creation) or 1→0 (absorb)
	// in discrete SQUASH_STEP_MS jumps. Each step's *value* follows the easeIn curve,
	// so the object accelerates from rest then snaps into place (or out of it, on
	// absorb). All vertex Y values share a common pivot at the model's local y=0, so
	// scaling collapses the model down toward its footprint.
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
