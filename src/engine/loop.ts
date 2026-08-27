import type { PerspectiveCamera } from 'three';
import type { CameraController } from './camera';
import type { InputManager } from './input';
import type { RendererManager } from './renderer';
import { applyTerrainStyle, finishUnsupportedCorpses, type SceneData } from './scene';
import type { BotDriver } from './bot';
import { handleKeyActions } from './actions';
import { runDrainPhase, DRAIN_TICK_PERIOD } from './watcher';
import { handleExposureKeys, refreshExposureOverlay } from './exposureOverlay';
import { liveWatchersOf } from './exposureSensor';
import { save, settings } from '../settings.svelte';
import { runMeaniePhase } from './meanie';
import { TurnDriver } from '../game/turn';
import { game, completeBirdsEyeExit, completeTransfer } from '../game/state.svelte';
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
	// Rebuilt alongside sceneData/camCtrl (MainView Effect 2), since it holds both. Ticked only
	// while game.demo — outside demo mode it just sits there.
	bot: BotDriver | null = null;
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
		if (
			this.lastTime !== null &&
			Math.floor(this.lastTime / FPS_SAMPLE_PERIOD_MS) !== Math.floor(time / FPS_SAMPLE_PERIOD_MS)
		) {
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
				/*
				 Exposure overlay, on the tick rather than the frame: a cell's colour is a
				 function of the watchers' clocks, and nothing else can move it. That also
				 makes a drain-locked watcher's frozen sector visible for free — its clock
				 stops, so its colours stop with it.
				*/
				if (settings.showExposureMap) {
					refreshExposureOverlay(sd.exposureOverlay, sd.exposure.view(liveWatchersOf(sd.allObjects)));
				}
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

		// Nothing outlives what it stands on (engine/scene.ts, RULES-FIDELITY.md A5b): an object
		// leaving the scene takes any corpse it was holding up with it. Only worth asking on a frame
		// that actually removed something — a mesh disappearing is the one event that can lower a
		// surface. This is where the deferred-spawn queue used to be processed, before drain morphs
		// became atomic and there was nothing left to defer.
		if (toRemove.length > 0) finishUnsupportedCorpses(sd);

		// Create/absorb particle bursts (engine/particles.ts). Unconditional like the object
		// play() loop above — they run off elapsed real time, not the game clock, so they
		// aren't phase-gated.
		if (sd.particleBursts.length > 0) {
			sd.particleBursts = sd.particleBursts.filter(burst => {
				if (burst.update(time)) {
					burst.dispose();
					return false;
				}
				return true;
			});
		}

		// Demo bot runs before the camera block on purpose: it writes camCtrl.direction/vertical,
		// which updateLook() below flushes to the camera in this same frame.
		if (game.demo) this.bot?.tick(time, dt);

		const { mouseSpeed } = this.getSettings();
		// Pointer lock is the human's "I am driving" signal; in demo mode the bot drives instead
		// and no lock is ever requested, so it stands in for one. This gate is load-bearing well
		// beyond mouse-look: updateTransfer/updateBirdsEye are what call completeTransfer/
		// completeBirdsEyeExit, so a bot locked out here would wedge the phase machine the first
		// time it transferred.
		// Scoped to the phases the bot actually drives — otherwise WON/LOST would take the
		// updateLook branch below instead of falling through to the orbit the end screens expect.
		const botDriving = game.demo && (phase === 'PLAYING' || phase === 'TRANSFER' || phase === 'BIRDSEYE');
		if (this.input.isLocked || botDriving) {
			if (phase === 'DEBUG') {
				cc.updateFlight(dt, mouseSpeed);
			} else if (phase === 'BIRDSEYE') {
				cc.updateBirdsEye(time, mouseSpeed);
				if (cc.birdsEyeExitComplete) {
					cc.birdsEyeExitComplete = false;
					completeBirdsEyeExit();
				}
			} else if (phase === 'TRANSFER') {
				// Body-transfer glide: position eased toward the new body, orientation frozen,
				// mouse input drained but not applied. Only reachable while pointer-locked, so
				// pausing (which drops the lock) naturally freezes the glide until resumed.
				if (cc.updateTransfer(dt)) completeTransfer();
			} else {
				// PLAYING: mouse steers orientation; no WASD movement.
				cc.updateLook(mouseSpeed);
			}
		} else if (phase === 'MENU' || phase === 'WON' || phase === 'LOST') {
			cc.updateOrbit(time);
		}
		// In PLAYING/TRANSFER/PAUSED without lock: camera stays frozen at last player pose,
		// so Resume seamlessly returns to the same view.

		// Still lock-gated, not `botDriving`: the bot acts by calling the engine action path
		// directly (engine/bot.ts), never by synthesising keypresses — clearJustPressed() below
		// would eat them anyway. So this stays purely the human's channel.
		if (phase === 'PLAYING' && this.input.isLocked) {
			handleKeyActions(this.input, this.camera, sd, time);
		}

		/*
		 Exposure-map height stepper (engine/exposureOverlay.ts). Not a game action — it costs no
		 energy and takes no cooldown — so it sits outside handleKeyActions, and it is allowed in
		 BIRDSEYE as well as PLAYING because looking down at the whole map is exactly when stepping
		 through pile heights is worth doing.
		*/
		if (settings.showExposureMap && this.input.isLocked && (phase === 'PLAYING' || phase === 'BIRDSEYE')) {
			// Repaint here rather than inside the handler: the 4 Hz tick does not run in BIRDSEYE or
			// before the first action, which is exactly when someone stands still stepping heights.
			if (handleExposureKeys(this.input, sd.exposureOverlay)) {
				refreshExposureOverlay(sd.exposureOverlay, sd.exposure.view(liveWatchersOf(sd.allObjects)));
			}
		}

		/*
		 End toggles the whole new look live — ground textures and object models together.

		 Deliberately gated on NOTHING — not on the pointer lock, not on the phase. It is a display
		 setting rather than a game action: it costs no energy, takes no cooldown, and comparing the
		 two looks is just as reasonable from the menu, a pause, or an attract-mode demo as it is
		 mid-game. The lock gate it originally carried made it dead in exactly those states, and
		 worse, a demo swallowed the keypress through MainView's "any key ends the demo" handler and
		 dropped the player back to the menu's orbit camera — which reads as the view jumping to a
		 corner. MainView and PauseOverlay now both let End through untouched.

		 It swaps the four terrain materials in place rather than rebuilding, so a landscape can be
		 judged with everything the player has built still standing.
		*/
		if (this.input.consumeJustPressed('End')) {
			// Both halves move together, and only fall back to classic when both are already
			// enhanced — so a key press from any mixed state gives you the full new look first,
			// which is what someone comparing wants to see.
			const next = settings.visualStyle === 'enhanced' && settings.modelStyle === 'enhanced' ? 'classic' : 'enhanced';
			settings.visualStyle = next;
			settings.modelStyle = next;
			save();
			applyTerrainStyle(sd);
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
