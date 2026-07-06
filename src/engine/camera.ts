import { PerspectiveCamera, Vector3 } from 'three';
import type { InputManager } from './input';
import { MAP_SIZE } from '../world/terrain';

const MOVE_SPEED = 0.003;
// Camera eye height above the synthoid's base (or terrain surface for free-flight).
// Approximates the synthoid model's eye line at unit scale.
const EYE_HEIGHT = 0.875;
// Vertical look limit — keeps the camera from flipping at the poles.
const VERT_CLAMP = Math.PI / 2 - 0.1;
// FOV bounds and orbit/overview tunables.
const FOV_MIN = 30;
const FOV_MAX = 120;
const ORBIT_HEIGHT = 15;
const ORBIT_RADIUS_RATIO = 0.8; // fraction of MAP_SIZE
const ORBIT_PERIOD_MS = 6000;
// Bird's-eye view. Height is an absolute world Y, not an offset from the player's current
// eye level — keeps the overview at a consistent altitude regardless of local terrain height
// or boulder stacks.
const BIRDSEYE_HEIGHT = 20;
const BIRDSEYE_VERTICAL = -(60 * Math.PI) / 180;
const BIRDSEYE_TRANSITION_MS = 1000;

interface BirdsEyePose {
	height: number;
	direction: number;
	vertical: number;
	fov: number;
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

// Shortest-path angle interpolation — avoids spinning the long way around when direction
// has wrapped past ±π (e.g. the player spun around while settled at the top).
function lerpAngle(a: number, b: number, t: number): number {
	const diff = (((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
	return a + diff * t;
}

function easeInOutCubic(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Y-up: position.x=col (EW), position.y=height, position.z=row (NS)
// posCol and posRow are horizontal grid coordinates; posHeight is the vertical position.
export class CameraController {
	posCol = 0;
	posRow = 0;
	posHeight = 10;
	direction = Math.PI / 2;
	vertical = 0;
	fov: number;

	private birdsEye: { from: BirdsEyePose; to: BirdsEyePose; startTime: number; reversing: boolean } | null = null;
	private birdsEyeSettled = false;
	// Set true for exactly one frame once the fly-back-down transition finishes.
	// engine/loop.ts consumes it (calls completeBirdsEyeExit()) and clears it.
	birdsEyeExitComplete = false;
	// 0 = ground pose (player is "inside" their synthoid, body hidden), 1 = fully at the
	// bird's-eye overview (body should be fully visible). Tracks the same eased progress
	// driving the camera transition; MainView.svelte reads this each frame to fade the
	// active synthoid's opacity in lockstep with the climb/descent instead of popping
	// visible/invisible and clipping through the camera mid-flight.
	birdsEyeProgress = 0;

	constructor(
		private camera: PerspectiveCamera,
		private map: number[],
		private input: InputManager
	) {
		this.fov = camera.fov;
	}

	// Called each frame when the player has pointer lock.
	updateFlight(deltaTime: number, mouseSpeed: number): void {
		this.applyMouseLook(mouseSpeed);

		const increment = this.input.isKeyDown('Shift') ? MOVE_SPEED * 2 : MOVE_SPEED;
		// forward = (cos(dir), 0, sin(dir)) in XZ horizontal plane
		const fwdCol = Math.cos(this.direction) * deltaTime * increment;
		const fwdRow = Math.sin(this.direction) * deltaTime * increment;

		if (this.input.isKeyDown('w')) {
			this.posCol += fwdCol;
			this.posRow += fwdRow;
		}
		if (this.input.isKeyDown('s')) {
			this.posCol -= fwdCol;
			this.posRow -= fwdRow;
		}
		// strafe: rotate 90° CCW → (-sin, 0, cos)
		if (this.input.isKeyDown('a')) {
			this.posCol -= fwdRow;
			this.posRow += fwdCol;
		}
		if (this.input.isKeyDown('d')) {
			this.posCol += fwdRow;
			this.posRow -= fwdCol;
		}

		this.posCol = Math.max(0, Math.min(MAP_SIZE - 1.01, this.posCol));
		this.posRow = Math.max(0, Math.min(MAP_SIZE - 1.01, this.posRow));

		// Snap height to terrain surface (eye level)
		this.posHeight = this.terrainHeightAt(this.posCol, this.posRow) + EYE_HEIGHT;

		// Y-up: position.x=col, position.y=height, position.z=(dim-1)-row
		const dirX = Math.cos(this.direction) * Math.cos(this.vertical);
		const dirY = Math.sin(this.vertical);
		const dirZ = Math.sin(this.direction) * Math.cos(this.vertical);

		this.camera.position.set(this.posCol, this.posHeight, (MAP_SIZE - 1) - this.posRow);
		this.camera.lookAt(
			this.posCol + dirX * 0.1,
			this.posHeight + dirY * 0.1,
			(MAP_SIZE - 1) - this.posRow - dirZ * 0.1
		);
	}

	// Called each frame when there is no pointer lock (overview orbit).
	updateOrbit(time: number): void {
		const radius = MAP_SIZE * ORBIT_RADIUS_RATIO;
		const phase = time / ORBIT_PERIOD_MS;
		this.posCol = MAP_SIZE / 2 + radius * Math.cos(phase);
		this.posRow = MAP_SIZE / 2 + radius * Math.sin(phase);
		this.posHeight = ORBIT_HEIGHT;
		this.camera.position.set(this.posCol, this.posHeight, (MAP_SIZE - 1) - this.posRow);
		this.camera.lookAt(MAP_SIZE / 2, 0, (MAP_SIZE - 1) / 2);
	}

	// Aim the camera at the centre of grid cell (col, row), optionally at a specific Y.
	// Without targetY: vertical=0 (horizon). Used by initial-start (centre of landscape) and
	// post-transfer (look back at the old body, with its mid-height as targetY).
	lookAtCell(col: number, row: number, targetY?: number): void {
		const dCol = (col + 0.5) - this.posCol;
		const dRow = (row + 0.5) - this.posRow;
		const horiz = Math.sqrt(dCol * dCol + dRow * dRow);
		if (horiz < 1e-6) return;
		this.direction = Math.atan2(dRow, dCol);
		const v = targetY !== undefined ? Math.atan2(targetY - this.posHeight, horiz) : 0;
		this.vertical = Math.max(-VERT_CLAMP, Math.min(VERT_CLAMP, v));
		this.applyToCamera();
	}

	resetToCenter(): void {
		this.posCol = MAP_SIZE / 2;
		this.posRow = MAP_SIZE / 2;
		this.direction = 0;
		this.vertical = 0;
		this.posHeight = this.terrainHeightAt(this.posCol, this.posRow) + EYE_HEIGHT;
		this.applyToCamera();
	}

	// objectHeight: the base height of the synthoid (from its GameObject.height).
	// Provide it when the synthoid is on a boulder stack so the camera clears the stack.
	// Omit for synthoids at terrain level — terrainHeightAt is used as fallback.
	resetToPosition(col: number, row: number, objectHeight?: number): void {
		this.posCol = col + 0.5;
		this.posRow = row + 0.5;
		this.direction = 0;
		this.vertical = 0;
		const baseHeight = objectHeight !== undefined ? objectHeight : this.terrainHeightAt(this.posCol, this.posRow);
		this.posHeight = baseHeight + EYE_HEIGHT;
		this.applyToCamera();
	}

	// Called each frame in PLAYING/TRANSFER: pointer-locked mouse updates orientation only.
	// Position stays fixed; WASD movement is exclusive to DEBUG (updateFlight).
	updateLook(mouseSpeed: number): void {
		this.applyMouseLook(mouseSpeed);
		this.applyToCamera();
	}

	// Mouse delta → direction/vertical, plus FOV bracket keys. Shared by updateLook
	// (PLAYING/TRANSFER) and updateFlight (DEBUG); the latter applies movement after.
	private applyMouseLook(mouseSpeed: number): void {
		const { dx, dy } = this.input.consumeMouseDelta();
		if (dx !== 0 || dy !== 0) {
			const sensitivity = (11 - mouseSpeed) * 100;
			this.direction = (this.direction - dx / sensitivity) % (2 * Math.PI);
			this.vertical = Math.min(Math.max(this.vertical - dy / sensitivity, -VERT_CLAMP), VERT_CLAMP);
		}
		if (this.input.isKeyDown('[')) {
			this.fov = Math.max(FOV_MIN, this.fov - 1);
			this.camera.fov = this.fov;
			this.camera.updateProjectionMatrix();
		}
		if (this.input.isKeyDown(']')) {
			this.fov = Math.min(FOV_MAX, this.fov + 1);
			this.camera.fov = this.fov;
			this.camera.updateProjectionMatrix();
		}
	}

	// Begin the scripted fly-up: captures the current pose as the eventual return target and
	// interpolates height/vertical/fov toward the fixed overview pose. Direction is carried
	// through unchanged (from === to) — the transition never spins the camera, only lifts
	// and tilts it; free look-around only starts once settled at the top.
	enterBirdsEye(time: number): void {
		const pose = this.currentPose();
		this.birdsEye = {
			from: pose,
			to: { height: BIRDSEYE_HEIGHT, direction: pose.direction, vertical: BIRDSEYE_VERTICAL, fov: 75 },
			startTime: time,
			reversing: false,
		};
		this.birdsEyeSettled = false;
		this.birdsEyeExitComplete = false;
		this.birdsEyeProgress = 0;
	}

	// Begin the scripted fly-back-down to the pose captured by enterBirdsEye, discarding
	// whatever look-around happened while settled at the top — except pitch, which targets
	// level (0) rather than the original (necessarily steep, sky-facing) pitch that triggered
	// entry: restoring that would leave the player staring at empty sky again, which is more
	// disorienting than useful. Safe to call repeatedly — a second call while already
	// reversing is a no-op so a fast double-click doesn't restart the timer from a slightly
	// different current pose.
	exitBirdsEye(time: number): void {
		if (!this.birdsEye || this.birdsEye.reversing) return;
		this.birdsEye = {
			from: this.currentPose(),
			to: { ...this.birdsEye.from, vertical: 0 },
			startTime: time,
			reversing: true,
		};
		this.birdsEyeSettled = false;
	}

	// Instantly abandon any in-progress bird's-eye transition and snap back to the ground
	// pose — used when pointer lock is lost mid-flight (alt-tab) so the player doesn't get
	// stranded 30 units up; see MainView.svelte's onLockLost. Pitch is forced level for the
	// same reason exitBirdsEye targets 0 — resuming PLAYING staring at empty sky (the
	// original entry pitch, necessarily steep) is disorienting, not just mid-transition.
	cancelBirdsEye(): void {
		if (!this.birdsEye) return;
		const ground = this.birdsEye.reversing ? this.birdsEye.to : this.birdsEye.from;
		this.applyPose({ ...ground, vertical: 0 });
		this.birdsEye = null;
		this.birdsEyeSettled = false;
		this.birdsEyeProgress = 0;
	}

	// Called each frame while phase === 'BIRDSEYE'. Drives the scripted fly up/down; once
	// settled at the top, hands full mouse-look control back — matches "no action possible
	// except camera rotation" (WASD never applies here; updateFlight isn't called for this
	// phase).
	updateBirdsEye(time: number, mouseSpeed: number): void {
		if (!this.birdsEye) return;
		if (this.birdsEyeSettled) {
			this.birdsEyeProgress = 1;
			this.applyMouseLook(mouseSpeed);
			this.applyToCamera();
			return;
		}
		this.input.consumeMouseDelta(); // drain so it doesn't jump the view once settled
		const { from, to, startTime, reversing } = this.birdsEye;
		const e = easeInOutCubic(Math.min(1, (time - startTime) / BIRDSEYE_TRANSITION_MS));
		this.birdsEyeProgress = reversing ? 1 - e : e;
		this.applyPose({
			height: lerp(from.height, to.height, e),
			direction: lerpAngle(from.direction, to.direction, e),
			vertical: lerp(from.vertical, to.vertical, e),
			fov: lerp(from.fov, to.fov, e),
		});
		if (e >= 1) {
			if (reversing) {
				this.birdsEyeExitComplete = true;
				this.birdsEye = null;
			} else {
				this.birdsEyeSettled = true;
			}
		}
	}

	private currentPose(): BirdsEyePose {
		return { height: this.posHeight, direction: this.direction, vertical: this.vertical, fov: this.fov };
	}

	private applyPose(pose: BirdsEyePose): void {
		this.posHeight = pose.height;
		this.direction = pose.direction;
		this.vertical = pose.vertical;
		this.fov = pose.fov;
		this.camera.fov = this.fov;
		this.camera.updateProjectionMatrix();
		this.applyToCamera();
	}

	get position(): Vector3 {
		return new Vector3(this.posCol, this.posHeight, (MAP_SIZE - 1) - this.posRow);
	}

	// Bilinearly interpolated terrain height at fractional grid coords. Callers add
	// EYE_HEIGHT themselves when they want eye-level rather than ground-level.
	private terrainHeightAt(posCol: number, posRow: number): number {
		const cx = Math.floor(posCol);
		const cdx = posCol - cx;
		const cr = Math.floor(posRow);
		const cdr = posRow - cr;
		const d = MAP_SIZE;
		const hs = [
			this.map[cr * d + cx] ?? 1,
			this.map[cr * d + Math.min(cx + 1, d - 1)] ?? 1,
			this.map[Math.min(cr + 1, d - 1) * d + Math.min(cx + 1, d - 1)] ?? 1,
			this.map[Math.min(cr + 1, d - 1) * d + cx] ?? 1,
		];
		return hs[0] * (1 - cdx) * (1 - cdr) + hs[1] * cdx * (1 - cdr) + hs[2] * cdx * cdr + hs[3] * (1 - cdx) * cdr;
	}

	private applyToCamera(): void {
		const dirX = Math.cos(this.direction) * Math.cos(this.vertical);
		const dirY = Math.sin(this.vertical);
		const dirZ = Math.sin(this.direction) * Math.cos(this.vertical);
		this.camera.position.set(this.posCol, this.posHeight, (MAP_SIZE - 1) - this.posRow);
		this.camera.lookAt(
			this.posCol + dirX * 0.1,
			this.posHeight + dirY * 0.1,
			(MAP_SIZE - 1) - this.posRow - dirZ * 0.1
		);
	}
}
