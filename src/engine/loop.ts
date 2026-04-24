import type { PerspectiveCamera } from 'three';
import type { CameraController } from './camera';
import type { InputManager } from './input';
import type { RendererManager } from './renderer';
import type { SceneData } from './scene';
import { TurnDriver } from '../game/turn';
import type { GamePhase } from '../game/state.svelte';

export interface FrameStats {
	posCol: number;
	posRow: number;
	posHeight: number;
	direction: number;
	vertical: number;
	deltaTime: number;
	cameraFov: number;
}

export class GameLoop {
	sceneData: SceneData | null = null;
	camCtrl: CameraController | null = null;
	private lastTime: number | null = null;
	private displayDelta = 0;
	private turnDriver = new TurnDriver();

	constructor(
		private camera: PerspectiveCamera,
		private input: InputManager,
		private rendererMgr: RendererManager,
		private getSettings: () => { mapSize: number; mouseSpeed: number },
		public onStats: (s: FrameStats) => void,
		private getGamePhase: () => GamePhase
	) {}

	tick(time: number): void {
		const sd = this.sceneData;
		const cc = this.camCtrl;
		if (!sd || !cc) return;

		const dt = this.lastTime !== null ? time - this.lastTime : 16;
		if (this.lastTime !== null && Math.floor(this.lastTime / 200) !== Math.floor(time / 200)) {
			this.displayDelta = dt;
		}
		this.lastTime = time;

		// Game ticks at 4 Hz — drives Sentinel rotation, AI, etc.
		// Runs in all phases for now; Phase 3 will gate dormancy on player first-action.
		this.turnDriver.update(dt, tick => {
			sd.allObjects.forEach(o => o.playTick(tick));
		});

		const playerPos = cc.position;
		const toRemove: number[] = [];
		sd.allObjects.forEach((o, i) => {
			o.play(time, playerPos);
			if (o.toRemove) {
				toRemove.push(i);
				sd.scene.remove(o.object3D);
				o.dispose();
			}
		});
		toRemove.reverse().forEach(i => sd.allObjects.splice(i, 1));

		const { mapSize, mouseSpeed } = this.getSettings();
		if (this.input.isLocked) {
			cc.updateFlight(dt, mouseSpeed);
		} else if (this.getGamePhase() !== 'PLAYING' && this.getGamePhase() !== 'PAUSED') {
			cc.updateOrbit(time);
		}
		// In PLAYING/PAUSED without pointer-lock: camera stays at current position.

		sd.sunLight.position.set(
			mapSize / 2 + 20 * Math.cos(Math.PI / 3 + time / 6000),
			30,
			(mapSize - 1) / 2 - 20 * Math.sin(Math.PI / 3 + time / 6000)
		);

		this.rendererMgr.render(sd.scene, this.camera);

		this.onStats({
			posCol: cc.posCol,
			posRow: cc.posRow,
			posHeight: cc.posHeight,
			direction: cc.direction,
			vertical: cc.vertical,
			deltaTime: this.displayDelta,
			cameraFov: cc.fov,
		});
	}

	resetTime(): void {
		this.lastTime = null;
		this.turnDriver.reset();
	}

	get lastTimestamp(): number {
		return this.lastTime ?? 0;
	}
}
