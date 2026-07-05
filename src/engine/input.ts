import { logEvent } from '../game/log';

export class InputManager {
	private keyPressed: Record<string, boolean> = {};
	private _justPressed: Set<string> = new Set();
	private _isLocked = false;
	mouseDx = 0;
	mouseDy = 0;

	get isLocked(): boolean {
		return this._isLocked;
	}

	constructor(private canvas: HTMLCanvasElement) {
		// Keys go on window so they fire regardless of focus — pointer-lock does not
		// focus the canvas, and the menu's own <svelte:window> handler proves the pattern.
		window.addEventListener('keydown', this.onKeydown);
		window.addEventListener('keyup', this.onKeyup);
		canvas.addEventListener('mousemove', this.onMouseMove);
		document.addEventListener('pointerlockchange', this.onPointerLockChange);
		document.addEventListener('pointerlockerror', this.onPointerLockError);
		window.addEventListener('blur', this.onWindowBlur);
	}

	private onKeydown = (e: KeyboardEvent) => {
		// Only suppress browser defaults while pointer-locked; otherwise menu/HUD/devtools
		// shortcuts (Tab, F-keys, etc.) must keep working.
		if (this._isLocked) e.preventDefault();
		if (!this.keyPressed[e.key]) this._justPressed.add(e.key);
		this.keyPressed[e.key] = true;
	};

	private onKeyup = (e: KeyboardEvent) => {
		if (this._isLocked) e.preventDefault();
		delete this.keyPressed[e.key];
	};

	private onMouseMove = (e: MouseEvent) => {
		if (this._isLocked) {
			this.mouseDx += e.movementX;
			this.mouseDy += e.movementY;
		}
	};

	// Set by the caller to react to lock loss OR a failed (re)acquisition (e.g. trigger
	// PAUSED or return to MENU).
	onLockLost: (() => void) | null = null;

	private onPointerLockChange = () => {
		const locked = document.pointerLockElement === this.canvas;
		logEvent('input', 'pointerLockChange', { locked })
		if (!locked && this._isLocked) {
			this._isLocked = false;
			this.keyPressed = {};
			this._justPressed.clear();
			this.onLockLost?.();
		} else if (locked) {
			this._isLocked = true;
			this._justPressed.clear(); // don't let menu keypresses bleed into PLAYING
		}
	};

	// A failed (re)acquisition — e.g. requestLock() firing while the window is mid-blur — left
	// the game stuck in PLAYING/DEBUG with no lock and no UI to recover from, since nothing
	// else reverted the phase. Routes through the same onLockLost callback as an actual lock
	// loss so the caller falls back to PAUSED/MENU regardless of why the lock never engaged.
	private onPointerLockError = () => {
		console.warn('Pointer lock failed');
		this._isLocked = false;
		this.keyPressed = {};
		this._justPressed.clear();
		this.onLockLost?.();
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

	consumeJustPressed(key: string): boolean {
		return this._justPressed.delete(key);
	}

	clearJustPressed(): void {
		this._justPressed.clear();
	}

	consumeMouseDelta(): { dx: number; dy: number } {
		const d = { dx: this.mouseDx, dy: this.mouseDy };
		this.mouseDx = 0;
		this.mouseDy = 0;
		return d;
	}

	destroy(): void {
		window.removeEventListener('keydown', this.onKeydown);
		window.removeEventListener('keyup', this.onKeyup);
		this.canvas.removeEventListener('mousemove', this.onMouseMove);
		document.removeEventListener('pointerlockchange', this.onPointerLockChange);
		document.removeEventListener('pointerlockerror', this.onPointerLockError);
		window.removeEventListener('blur', this.onWindowBlur);
	}
}
