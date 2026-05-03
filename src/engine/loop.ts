import type { PerspectiveCamera } from 'three';
import type { CameraController } from './camera';
import type { InputManager } from './input';
import type { RendererManager } from './renderer';
import type { SceneData } from './scene';
import { handleKeyActions } from './actions';
import { runDrainPhase, DRAIN_TICK_PERIOD } from './watcher';
import { runMeaniePhase } from './meanie';
import { TurnDriver } from '../game/turn';
import { game } from '../game/state.svelte';
import type { GamePhase } from '../game/state.svelte';
import { MAP_SIZE } from '../world/terrain';

// Sun orbit. The light circles the landscape at fixed height, offset by a
// quarter turn so it never starts directly above the player.
const SUN_HEIGHT = 30;
const SUN_RADIUS = 20;
const SUN_PERIOD_MS = 6000;
const SUN_PHASE_OFFSET = Math.PI / 3;
// FPS readout sample period — the per-frame dt is too noisy to render directly.
const FPS_SAMPLE_PERIOD_MS = 200;
// Fallback dt for the very first frame, before lastTime is initialised.
const INITIAL_FRAME_DT_MS = 16;

export interface FrameStats {
	posCol: number;
	posRow: number;
	posHeight: number;
	direction: number;
	vertical: number;
	deltaTime: number;
	cameraFov: number;
	drawCalls: number;
	triangles: number;
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
		private getSettings: () => { mouseSpeed: number },
		public onStats: (s: FrameStats) => void,
		private getGamePhase: () => GamePhase
	) {}

	tick(time: number): void {
		const sd = this.sceneData;
		const cc = this.camCtrl;
		if (!sd || !cc) return;

		const dt = this.lastTime !== null ? time - this.lastTime : INITIAL_FRAME_DT_MS;
		if (this.lastTime !== null &&
			Math.floor(this.lastTime / FPS_SAMPLE_PERIOD_MS) !== Math.floor(time / FPS_SAMPLE_PERIOD_MS)) {
			this.displayDelta = dt;
		}
		this.lastTime = time;

		// Game ticks at 4 Hz — drives Sentinel rotation, AI, etc.
		// Only runs while the game clock is active (PLAYING or TRANSFER).
		// Watchers are dormant until the player's first action; checked inside playTick
		// (per-watcher) and at the drain-phase boundary (global).
		const phase = this.getGamePhase();
		if (phase === 'PLAYING' || phase === 'TRANSFER') {
			this.turnDriver.update(dt, tick => {
				sd.allObjects.forEach(o => o.playTick(tick));
				// Drain phase fires at 1 Hz (every 4th tick).
				if (game.firstActionTaken && tick % DRAIN_TICK_PERIOD === 0) {
					runDrainPhase(sd, time);
				}
				// Meanie phase: every game tick (4 Hz). Internally gates on PLAYING so
				// it doesn't double-fire during the TRANSFER following a forced jump.
				runMeaniePhase(sd, time);
			});
		}

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

		// Deferred spawns: scheduled by watcher drains 500 ms after the absorb starts.
		// Processed AFTER the play loop has spliced out objects whose absorb just
		// completed, so the cell is empty when the spawn lands.
		if (sd.deferredSpawns.length > 0) {
			sd.deferredSpawns = sd.deferredSpawns.filter(d => {
				if (time >= d.executeAt) {
					d.spawn();
					return false;
				}
				return true;
			});
		}

		const { mouseSpeed } = this.getSettings();
		if (this.input.isLocked) {
			if (phase === 'DEBUG') {
				cc.updateFlight(dt, mouseSpeed);
			} else {
				// PLAYING / TRANSFER: mouse steers orientation; no WASD movement.
				cc.updateLook(mouseSpeed);
			}
		} else if (phase === 'MENU' || phase === 'WON' || phase === 'LOST') {
			cc.updateOrbit(time);
		}
		// In PLAYING/TRANSFER/PAUSED without lock: camera stays frozen at last player pose,
		// so Resume seamlessly returns to the same view.

		if (phase === 'PLAYING' && this.input.isLocked) {
			handleKeyActions(this.input, this.camera, sd, time);
		}

		const sunPhase = SUN_PHASE_OFFSET + time / SUN_PERIOD_MS;
		sd.sunLight.position.set(
			MAP_SIZE / 2 + SUN_RADIUS * Math.cos(sunPhase),
			SUN_HEIGHT,
			(MAP_SIZE - 1) / 2 - SUN_RADIUS * Math.sin(sunPhase)
		);

		this.rendererMgr.render(sd.scene, this.camera);

		// renderer.info.render is repopulated by each render() call; read it here so the
		// reported numbers match the frame we just submitted.
		const info = this.rendererMgr.renderer.info.render;

		this.onStats({
			posCol: cc.posCol,
			posRow: cc.posRow,
			posHeight: cc.posHeight,
			direction: cc.direction,
			vertical: cc.vertical,
			deltaTime: this.displayDelta,
			cameraFov: cc.fov,
			drawCalls: info.calls,
			triangles: info.triangles,
		});

		this.input.clearJustPressed();
	}

	resetTime(): void {
		this.lastTime = null;
		this.turnDriver.reset();
	}

	get lastTimestamp(): number {
		return this.lastTime ?? 0;
	}
}
