import { PerspectiveCamera, Vector3 } from 'three';
import type { InputManager } from './input';

const MOVE_SPEED = 0.003;

// Y-up: position.x=col (EW), position.y=height, position.z=row (NS)
// posCol and posRow are horizontal grid coordinates; posHeight is the vertical position.
export class CameraController {
	posCol = 0;
	posRow = 0;
	posHeight = 10;
	direction = Math.PI / 2;
	vertical = 0;
	fov: number;

	constructor(
		private camera: PerspectiveCamera,
		private map: number[],
		private dim: number,
		private input: InputManager
	) {
		this.fov = camera.fov;
	}

	// Called each frame when the player has pointer lock.
	updateFlight(deltaTime: number, mouseSpeed: number): void {
		const { dx, dy } = this.input.consumeMouseDelta();
		if (dx !== 0 || dy !== 0) {
			const sensitivity = (11 - mouseSpeed) * 100;
			this.direction = (this.direction - dx / sensitivity) % (2 * Math.PI);
			this.vertical = Math.min(
				Math.max(this.vertical - dy / sensitivity, -Math.PI / 2 + 0.1),
				Math.PI / 2 - 0.1
			);
		}

		// FOV adjustment
		if (this.input.isKeyDown('[')) {
			this.fov = Math.max(30, this.fov - 1);
			this.camera.fov = this.fov;
			this.camera.updateProjectionMatrix();
		}
		if (this.input.isKeyDown(']')) {
			this.fov = Math.min(120, this.fov + 1);
			this.camera.fov = this.fov;
			this.camera.updateProjectionMatrix();
		}

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

		this.posCol = Math.max(0, Math.min(this.dim - 1.01, this.posCol));
		this.posRow = Math.max(0, Math.min(this.dim - 1.01, this.posRow));

		// Snap height to terrain surface
		this.posHeight = this.terrainHeightAt(this.posCol, this.posRow);

		// Y-up: position.x=col, position.y=height, position.z=(dim-1)-row
		const dirX = Math.cos(this.direction) * Math.cos(this.vertical);
		const dirY = Math.sin(this.vertical);
		const dirZ = Math.sin(this.direction) * Math.cos(this.vertical);

		this.camera.position.set(this.posCol, this.posHeight, (this.dim - 1) - this.posRow);
		this.camera.lookAt(
			this.posCol + dirX * 0.1,
			this.posHeight + dirY * 0.1,
			(this.dim - 1) - this.posRow - dirZ * 0.1
		);
	}

	// Called each frame when there is no pointer lock (overview orbit).
	updateOrbit(time: number): void {
		const { dim } = this;
		this.posCol = dim / 2 + dim * 0.8 * Math.cos(time / 6000);
		this.posRow = dim / 2 + dim * 0.8 * Math.sin(time / 6000);
		this.posHeight = 15;
		this.camera.position.set(this.posCol, this.posHeight, (dim - 1) - this.posRow);
		this.camera.lookAt(dim / 2, 0, (dim - 1) / 2);
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
		this.vertical = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, v));
		this.applyToCamera();
	}

	resetToCenter(): void {
		const { dim } = this;
		this.posCol = dim / 2;
		this.posRow = dim / 2;
		this.direction = 0;
		this.vertical = 0;
		this.posHeight = this.terrainHeightAt(this.posCol, this.posRow);
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
		const eyeOffset = 0.95; // TODO Phase 3: derive from active synthoid model height
		this.posHeight = objectHeight !== undefined
			? objectHeight + eyeOffset
			: this.terrainHeightAt(this.posCol, this.posRow, eyeOffset);
		this.applyToCamera();
	}

	// Called each frame in PLAYING/TRANSFER: pointer-locked mouse updates orientation only.
	// Position stays fixed; WASD movement is exclusive to DEBUG (updateFlight).
	updateLook(mouseSpeed: number): void {
		const { dx, dy } = this.input.consumeMouseDelta();
		if (dx !== 0 || dy !== 0) {
			const sensitivity = (11 - mouseSpeed) * 100;
			this.direction = (this.direction - dx / sensitivity) % (2 * Math.PI);
			this.vertical = Math.min(
				Math.max(this.vertical - dy / sensitivity, -Math.PI / 2 + 0.1),
				Math.PI / 2 - 0.1
			);
		}
		if (this.input.isKeyDown('[')) {
			this.fov = Math.max(30, this.fov - 1);
			this.camera.fov = this.fov;
			this.camera.updateProjectionMatrix();
		}
		if (this.input.isKeyDown(']')) {
			this.fov = Math.min(120, this.fov + 1);
			this.camera.fov = this.fov;
			this.camera.updateProjectionMatrix();
		}
		this.applyToCamera();
	}

	get position(): Vector3 {
		return new Vector3(this.posCol, this.posHeight, (this.dim - 1) - this.posRow);
	}

	private terrainHeightAt(posCol: number, posRow: number, eyeOffset = 0.875): number {
		const cx = Math.floor(posCol);
		const cdx = posCol - cx;
		const cr = Math.floor(posRow);
		const cdr = posRow - cr;
		const d = this.dim;
		const hs = [
			this.map[cr * d + cx] ?? 1,
			this.map[cr * d + Math.min(cx + 1, d - 1)] ?? 1,
			this.map[Math.min(cr + 1, d - 1) * d + Math.min(cx + 1, d - 1)] ?? 1,
			this.map[Math.min(cr + 1, d - 1) * d + cx] ?? 1,
		];
		return eyeOffset + hs[0] * (1 - cdx) * (1 - cdr) + hs[1] * cdx * (1 - cdr) + hs[2] * cdx * cdr + hs[3] * (1 - cdx) * cdr;
	}

	private applyToCamera(): void {
		const dirX = Math.cos(this.direction) * Math.cos(this.vertical);
		const dirY = Math.sin(this.vertical);
		const dirZ = Math.sin(this.direction) * Math.cos(this.vertical);
		this.camera.position.set(this.posCol, this.posHeight, (this.dim - 1) - this.posRow);
		this.camera.lookAt(
			this.posCol + dirX * 0.1,
			this.posHeight + dirY * 0.1,
			(this.dim - 1) - this.posRow - dirZ * 0.1
		);
	}
}
