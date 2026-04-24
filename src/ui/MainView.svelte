<script lang="ts">
	import { PerspectiveCamera } from 'three';
	import { Disposer } from '../engine/disposer';
	import { RendererManager } from '../engine/renderer';
	import { InputManager } from '../engine/input';
	import { CameraController } from '../engine/camera';
	import { buildScene, type SceneData, type SceneOptions } from '../engine/scene';
	import { GameLoop } from '../engine/loop';
	import { handleClick } from '../engine/actions';
	import { GameObjType } from '../world/terrain';
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
	$effect(() => {
		if (game.startCount + game.debugCount === 0) return;
		const start = sceneData?.level.objects.find(o => o.type === GameObjType.SYNTHOID);
		if (camCtrl && start) camCtrl.resetToPosition(start.x, start.z);
		else camCtrl?.resetToCenter();
	});

	// Effect 3b: acquire pointer lock when entering PLAYING or DEBUG.
	// input is $state so it's tracked, but changes only on engine teardown (rare).
	$effect(() => {
		if (game.phase !== 'PLAYING' && game.phase !== 'DEBUG') return;
		input?.requestLock();
	});

	// DEBUG: dispatch click actions. PLAYING: no-op until Phase 3 game actions land.
	function onClick(event: MouseEvent) {
		if (!input?.isLocked || !sceneData || !camera || !loop) return;
		if (game.phase === 'DEBUG') {
			handleClick(event, input, camera, sceneData, settings.mapSize, loop.lastTimestamp);
		}
	}
</script>

<main>
	<div id="mainView">
		<canvas bind:this={canvas} id="mainViewCanvas" onclick={onClick} tabindex="0"></canvas>
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
