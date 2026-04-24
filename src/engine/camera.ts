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
	private pendingReset: { col: number; row: number } | null = null;

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
		if (this.pendingReset) {
			this.posCol = this.pendingReset.col;
			this.posRow = this.pendingReset.row;
			this.pendingReset = null;
		}

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
		const cx = Math.floor(this.posCol);
		const cdx = this.posCol - cx;
		const cr = Math.floor(this.posRow);
		const cdr = this.posRow - cr;
		const d = this.dim;
		const hs = [
			this.map[cr * d + cx],
			this.map[cr * d + cx + 1],
			this.map[(cr + 1) * d + cx + 1],
			this.map[(cr + 1) * d + cx],
		];
		this.posHeight =
			0.875 +
			hs[0] * (1 - cdx) * (1 - cdr) +
			hs[1] * cdx * (1 - cdr) +
			hs[2] * cdx * cdr +
			hs[3] * (1 - cdx) * cdr;

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

	resetToCenter(): void {
		const { dim } = this;
		this.pendingReset = { col: dim / 2, row: dim / 2 };
		this.direction = 0;
		this.vertical = 0;
	}

	resetToPosition(col: number, row: number): void {
		this.pendingReset = { col: col + 0.5, row: row + 0.5 };
		this.direction = 0;
		this.vertical = 0;
	}

	get position(): Vector3 {
		return new Vector3(this.posCol, this.posHeight, (this.dim - 1) - this.posRow);
	}
}
