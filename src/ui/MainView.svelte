<script lang="ts">
	import { PerspectiveCamera } from 'three';
	import { Disposer } from '../engine/disposer';
	import { RendererManager } from '../engine/renderer';
	import { InputManager } from '../engine/input';
	import { CameraController } from '../engine/camera';
	import { buildScene, type SceneData, type SceneOptions } from '../engine/scene';
	import { GameLoop } from '../engine/loop';
	import { handleClick, handleMouseAction } from '../engine/actions';
	import { GameObjType } from '../world/terrain';
	import { angleFacing, radToAngle256 } from '../world/objects/base';
	import { settings } from '../state.svelte';
	import { game, pauseGame, returnToMenu } from '../game/state.svelte';

	let canvas: HTMLCanvasElement | null = $state(null);

	// These three are $state so Effect 2 re-runs when Effect 1 makes them ready.
	// They must NEVER be read back inside Effect 2 after being written there (Svelte 5
	// infinite-loop guard: reading a $state that you just wrote in the same effect
	// schedules an immediate re-run).
	let disposer = $state<Disposer | null>(null);
	let input = $state<InputManager | null>(null);
	let camera = $state<PerspectiveCamera | null>(null);

	// Plain let: never read reactively, only read in event handlers and game loop.
	let sceneData: SceneData | null = null;
	let camCtrl: CameraController | null = null;
	let rendererMgr: RendererManager | null = null;
	let loop: GameLoop | null = null;

	let posCol = $state(0), posRow = $state(0), posHeight = $state(0);
	let direction = $state(0), vertical = $state(0);
	let deltaTime = $state(0), cameraFov = $state(60);

	// Effect 1: core engine lifecycle — only depends on canvas; never reads settings.
	$effect(() => {
		if (!canvas) return;

		const d = new Disposer();
		const i = new InputManager(canvas);
		i.onLockLost = () => {
			if (game.phase === 'PLAYING' || game.phase === 'TRANSFER') pauseGame();
			else if (game.phase === 'DEBUG') returnToMenu();
		};
		const rm = new RendererManager(canvas);
		const cam = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 2000);
		const gl = new GameLoop(
			cam,
			i,
			rm,
			() => ({ mapSize: settings.mapSize, mouseSpeed: settings.mouseSpeed }),
			s => {
				posCol = s.posCol; posRow = s.posRow; posHeight = s.posHeight;
				direction = s.direction; vertical = s.vertical;
				deltaTime = s.deltaTime; cameraFov = s.cameraFov;
			},
			() => game.phase
		);

		disposer = d; input = i; camera = cam;
		rendererMgr = rm; loop = gl;
		rm.start(t => gl.tick(t));
		window.onresize = () => {
			rm.resize();
			cam.aspect = window.innerWidth / window.innerHeight;
			cam.updateProjectionMatrix();
		};

		return () => {
			rm.stop(); i.destroy(); d.disposeAll();
			disposer = null; input = null; camera = null;
			rendererMgr = null; loop = null;
			window.onresize = null;
		};
	});

	// Effect 2: rebuild scene when settings or engine readiness changes.
	// CRITICAL: use local variables (sd, cc) — never read sceneData/camCtrl back
	// after writing them, or Svelte detects the write as a changed dependency and
	// immediately re-schedules this effect → infinite loop.
	$effect(() => {
		const opts: SceneOptions = {
			dim: settings.mapSize, smooths: settings.smooths, despikes: settings.despikes,
			showGrid: settings.showGrid, showSurfaces: settings.showSurfaces, showAxis: settings.showAxis,
		};
		const levelId = settings.levelId;
		// Reactive dep: bump game.levelEpoch from triggerLost() to force a same-levelId rebuild.
		game.levelEpoch;

		if (!disposer || !camera || !input || !loop) return;

		sceneData?.allObjects.forEach(o => o.dispose());
		disposer.disposeAll();
		const sd = buildScene(levelId, opts, disposer);
		const cc = new CameraController(camera, sd.map, opts.dim, input);

		// Store in plain lets (no reactive read-back risk)
		sceneData = sd;
		camCtrl = cc;
		loop.sceneData = sd;
		loop.camCtrl = cc;
		loop.resetTime();
	});

	// Effect 3a: snap camera to the player synthoid on each new game-start or DEBUG entry.
	// Watches the sum of both counters so it fires on either without duplicating logic.
	// Also hides the starting synthoid (player is inside it — rendering it would block view).
	// Initial orientation: face the centre of the landscape, vertical neutral.
	$effect(() => {
		if (game.startCount + game.debugCount === 0) return;
		const sd = sceneData;
		const start = sd?.level.objects.find(o => o.type === GameObjType.SYNTHOID);
		if (camCtrl && start) {
			camCtrl.resetToPosition(start.x, start.z);
			camCtrl.lookAtCell(settings.mapSize / 2, settings.mapSize / 2);
			// Hide starting synthoid body — player view is from inside it.
			if (sd) {
				const startObj = sd.allObjects.find(
					o => o.object3D.userData.type === 'SYNTHOID' && o.col === start.x && o.row === start.z
				);
				if (startObj) startObj.object3D.visible = false;
			}
		} else {
			camCtrl?.resetToCenter();
		}
	});

	// Effect 3c: snap camera to the new active body after each transfer. Also rotates the
	// old body's model to face the new body, and aims the new camera back at the old body.
	// Reads activeSynthoidCol/Row (set by beginTransfer) — no circular dependency since
	// neither this effect nor any other effect writes those fields.
	$effect(() => {
		if (game.transferCount === 0) return;
		const col = game.activeSynthoidCol;
		const row = game.activeSynthoidRow;
		if (col === null || row === null || !camCtrl || !sceneData) return;

		// Old body location: previousSynthoid* set by beginTransfer, falling back to the
		// level's starting synthoid for the very first transfer.
		let oldCol = game.previousSynthoidCol;
		let oldRow = game.previousSynthoidRow;
		if (oldCol === null || oldRow === null) {
			const start = sceneData.level.objects.find(o => o.type === GameObjType.SYNTHOID);
			if (start) { oldCol = start.x; oldRow = start.z; }
		}

		// Rotate the old body's model to face the new body.
		if (oldCol !== null && oldRow !== null) {
			const oldObj = sceneData.allObjects.find(
				o => o.object3D.userData.type === 'SYNTHOID' && o.col === oldCol && o.row === oldRow && !o.absorbedTime
			);
			if (oldObj) {
				const theta = angleFacing(oldCol, oldRow, col, row);
				oldObj.rot = radToAngle256(theta);
				oldObj.object3D.rotation.y = theta;
			}
		}

		// Find the target synthoid to get its actual height (may be on a boulder stack).
		const activeObj = sceneData.allObjects.find(
			o => o.object3D.userData.type === 'SYNTHOID' && o.col === col && o.row === row && !o.absorbedTime
		);
		camCtrl.resetToPosition(col, row, activeObj?.height);

		// Show all non-absorbed synthoids (old body becomes visible shell), hide new active one.
		sceneData.allObjects.forEach(o => {
			if (o.object3D.userData.type !== 'SYNTHOID' || o.absorbedTime !== null) return;
			o.object3D.visible = o.col !== col || o.row !== row;
		});

		// Aim the new camera back at the old body's mid-height.
		if (oldCol !== null && oldRow !== null) {
			const oldObj = sceneData.allObjects.find(
				o => o.object3D.userData.type === 'SYNTHOID' && o.col === oldCol && o.row === oldRow && !o.absorbedTime
			);
			camCtrl.lookAtCell(oldCol, oldRow, (oldObj?.height ?? 0) + 0.5);
		}
	});

	// Effect 3b: acquire pointer lock when entering PLAYING or DEBUG.
	// input is $state so it's tracked, but changes only on engine teardown (rare).
	$effect(() => {
		if (game.phase !== 'PLAYING' && game.phase !== 'DEBUG') return;
		input?.requestLock();
	});

	// Effect 3d: release pointer lock when entering WON or LOST so the placeholder orbit
	// camera takes over and key/mouse input stops affecting the game.
	$effect(() => {
		if (game.phase === 'WON' || game.phase === 'LOST') input?.releaseLock();
	});

	// PLAYING: left=absorb, middle=synthoid, right=boulder. DEBUG: legacy click flow.
	// Use mousedown so all buttons fire (the standard `click` event is left-only).
	function onMouseDown(event: MouseEvent) {
		if (!input?.isLocked || !sceneData || !camera || !loop) return;
		event.preventDefault();
		if (game.phase === 'PLAYING') {
			handleMouseAction(event.button, camera, sceneData, settings.mapSize, loop.lastTimestamp);
		} else if (game.phase === 'DEBUG') {
			handleClick(event, input, camera, sceneData, settings.mapSize, loop.lastTimestamp);
		}
	}
</script>

<main>
	<div id="mainView">
		<canvas
			bind:this={canvas}
			id="mainViewCanvas"
			onmousedown={onMouseDown}
			oncontextmenu={(e) => e.preventDefault()}
			tabindex="0"
		></canvas>
		<div id="visor"></div>
	</div>
	<div id="internals">
		{#if settings.showPosition}
			<pre>col={posCol.toFixed(1)} row={posRow.toFixed(1)} height={posHeight.toFixed(1)}
horizontal={Math.floor((direction * 180) / Math.PI)}° vertical={Math.floor((vertical * 180) / Math.PI)}°</pre>
		{/if}
		{#if settings.showFPS}
			<pre>{Math.round(1000 / deltaTime)} FPS  FOV:{cameraFov}</pre>
		{/if}
	</div>
</main>

<style>
	#mainView { position: relative; }
	#mainViewCanvas { image-rendering: pixelated; }
	#visor {
		position: absolute; left: 49.9%; top: 49.8%;
		width: 0.2%; height: 0.4%; background-color: white;
	}
	#internals { position: fixed; left: 10px; top: 10px; }
</style>
