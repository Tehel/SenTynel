export class InputManager {
	private keyPressed: Record<string, boolean> = {};
	private _isLocked = false;
	mouseDx = 0;
	mouseDy = 0;

	get isLocked(): boolean {
		return this._isLocked;
	}

	constructor(private canvas: HTMLCanvasElement) {
		canvas.addEventListener('keydown', this.onKeydown);
		canvas.addEventListener('keyup', this.onKeyup);
		canvas.addEventListener('mousemove', this.onMouseMove);
		document.addEventListener('pointerlockchange', this.onPointerLockChange);
		document.addEventListener('pointerlockerror', this.onPointerLockError);
		window.addEventListener('blur', this.onWindowBlur);
	}

	private onKeydown = (e: KeyboardEvent) => {
		e.preventDefault();
		this.keyPressed[e.key] = true;
		if (e.key === 'r') document.exitPointerLock();
	};

	private onKeyup = (e: KeyboardEvent) => {
		e.preventDefault();
		delete this.keyPressed[e.key];
	};

	private onMouseMove = (e: MouseEvent) => {
		if (this._isLocked) {
			this.mouseDx += e.movementX;
			this.mouseDy += e.movementY;
		}
	};

	private onPointerLockChange = () => {
		this._isLocked = document.pointerLockElement === this.canvas;
		if (!this._isLocked) this.keyPressed = {};
	};

	private onPointerLockError = () => {
		console.warn('Pointer lock failed');
		this._isLocked = false;
	};

	private onWindowBlur = () => {
		document.exitPointerLock();
	};

	requestLock(): void {
		this.canvas.requestPointerLock();
	}

	releaseLock(): void {
		document.exitPointerLock();
	}

	isKeyDown(key: string): boolean {
		return !!this.keyPressed[key];
	}

	consumeMouseDelta(): { dx: number; dy: number } {
		const d = { dx: this.mouseDx, dy: this.mouseDy };
		this.mouseDx = 0;
		this.mouseDy = 0;
		return d;
	}

	destroy(): void {
		this.canvas.removeEventListener('keydown', this.onKeydown);
		this.canvas.removeEventListener('keyup', this.onKeyup);
		this.canvas.removeEventListener('mousemove', this.onMouseMove);
		document.removeEventListener('pointerlockchange', this.onPointerLockChange);
		document.removeEventListener('pointerlockerror', this.onPointerLockError);
		window.removeEventListener('blur', this.onWindowBlur);
	}
}
