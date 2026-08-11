/*
 Headless bot observatory.

 Runs the real GameLoop — real scene, real raycasts, real rules — with the renderer and input
 manager stubbed out, so the bot's behaviour here is the behaviour in the browser. Raycasting in
 Three.js is pure CPU; only the WebGL context and the DOM are missing, and nothing the bot
 touches needs either.

 Set BOT_TRACE=1 to dump every decision, BOT_SECONDS to change the run length:
   BOT_TRACE=1 BOT_SECONDS=400 npx vitest run src/engine/bot.harness

 KNOWN LIMITATION: at BOT_SECONDS=400 the bot still dies on both landscapes, but only because
 there is no endgame yet (D3). It walks to the assault tile in about a minute and then has
 nothing left to do, so it stands there absorbing trees — and the assault tile is by construction
 in the Sentinel's line of sight, since seeing the pedestal top is what qualified it. The drain
 outpaces one tree a second and it eventually starves. Building the pile and taking the Sentinel
 is five actions from arrival, with energy to spare. These tests assert it navigates; they are
 not evidence it can finish a landscape.
*/

import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Scene } from 'three';
import { Disposer } from './disposer';
import { CameraController } from './camera';
import { GameLoop } from './loop';
import { BotDriver } from './bot';
import { buildScene, objectsAt, type SceneData } from './scene';
import { GameObject, Synthoid } from '../world/objects';
import { GameObjType } from '../world/terrain';
import { game, startGame, setStartingSynthoid, completeWon, completeLost } from '../game/state.svelte';

const FRAME_MS = 16;
const TRACE = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.BOT_TRACE;

// stats.svelte.ts persists on every absorb. In-memory is fine — nothing here reads it back.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, v),
	removeItem: (k: string) => void store.delete(k),
};

// The two collaborators the loop needs but the bot doesn't: no lock is ever held (demo mode), no
// keys are ever pressed, and "rendering" is just the matrix refresh that pickTarget depends on.
function makeStubs(scene: Scene, camera: PerspectiveCamera) {
	const input = {
		isLocked: false,
		isKeyDown: () => false,
		consumeJustPressed: () => false,
		clearJustPressed: () => {},
		consumeMouseDelta: () => ({ dx: 0, dy: 0 }),
	};
	const rendererMgr = {
		// WebGLRenderer.render() is what normally refreshes these, and pickTarget raycasts
		// through camera.matrixWorld — skip this and every pick reads a stale pose.
		render: () => {
			scene.updateMatrixWorld(true);
			camera.updateMatrixWorld(true);
		},
		renderer: { info: { render: { calls: 0, triangles: 0 } } },
	};
	return { input, rendererMgr };
}

interface RunResult {
	sceneData: SceneData;
	camCtrl: CameraController;
	seconds: number;
	events: { at: number; category: string; event: string; detail?: Record<string, unknown> }[];
	energyLow: number;
	transfers: number;
	phase: string;
}

const countOf = (run: RunResult, event: string) =>
	run.events.filter(e => e.category === 'bot' && e.event === event).length;

// Drive a landscape for `seconds` of simulated time and return what happened.
function runDemo(levelId: number, seconds: number): RunResult {
	const disposer = new Disposer();
	const sceneData = buildScene(levelId, { smooths: 2, despikes: 2, showGrid: false, showSurfaces: true, showAxis: false }, disposer);
	const camera = new PerspectiveCamera(60, 16 / 9, 0.01, 2000);
	const { input, rendererMgr } = makeStubs(sceneData.scene, camera);
	const camCtrl = new CameraController(camera, sceneData.map, input as never);

	const events: RunResult['events'] = [];
	const originalDebug = console.debug;
	console.debug = (message: string, detail?: Record<string, unknown>) => {
		const match = /^\[(\w+)\] (.+)$/.exec(message);
		if (match) events.push({ at: 0, category: match[1], event: match[2], detail });
	};

	try {
		const loop = new GameLoop(camera, input as never, rendererMgr as never, () => ({ mouseSpeed: 5 }), () => {}, () => game.phase);
		loop.sceneData = sceneData;
		loop.camCtrl = camCtrl;
		loop.bot = new BotDriver(camera, camCtrl, sceneData);

		startGame();
		game.demo = true;

		// MainView Effect 3a: put the camera in the starting body and hide it from itself.
		const start = sceneData.allObjects.find(o => o instanceof Synthoid)!;
		camCtrl.resetToPosition(start.col, start.row, start.height);
		camCtrl.lookAtCell(16, 16);
		setStartingSynthoid(start.col, start.row);
		start.setViewOpacity(0);

		let time = 0;
		let seenTransfers = game.transferCount;
		let energyLow = game.energy;
		const frames = Math.round((seconds * 1000) / FRAME_MS);

		for (let i = 0; i < frames; i++) {
			time += FRAME_MS;

			// MainView Effect 3b: a transfer needs its camera glide started, or updateTransfer
			// never reports completion and the phase machine wedges in TRANSFER forever.
			if (game.transferCount !== seenTransfers) {
				seenTransfers = game.transferCount;
				const active = bodyAt(sceneData, game.activeSynthoidCol, game.activeSynthoidRow);
				const previous = bodyAt(sceneData, game.previousSynthoidCol, game.previousSynthoidRow);
				previous?.setViewOpacity(1);
				camCtrl.beginTransferAnim(game.activeSynthoidCol!, game.activeSynthoidRow!, active?.height);
				active?.setViewOpacity(0);
			}

			loop.tick(time);
			for (const e of events) if (e.at === 0) e.at = time;
			energyLow = Math.min(energyLow, game.energy);

			// The end screens wait on a keypress; in demo mode App.svelte will auto-advance (D4).
			if (game.phase === 'WON') { completeWon(); break; }
			if (game.phase === 'LOST') { completeLost(); break; }
		}

		return { sceneData, camCtrl, seconds, events, energyLow, transfers: game.transferCount, phase: game.phase };
	} finally {
		console.debug = originalDebug;
		sceneData.allObjects.forEach(o => o.dispose());
		disposer.disposeAll();
	}
}

function bodyAt(sceneData: SceneData, col: number | null, row: number | null): GameObject | null {
	if (col === null || row === null) return null;
	return objectsAt(sceneData.allObjects, col, row).find(o => o instanceof Synthoid) ?? null;
}

const typeOf = (o: GameObject) => GameObjType[(o.constructor as typeof GameObject).type ?? GameObjType.TREE];

function report(label: string, run: RunResult) {
	const actions = run.events.filter(e => e.category === 'action');
	const tally: Record<string, number> = {};
	for (const a of actions) tally[a.event] = (tally[a.event] ?? 0) + 1;

	const live = run.sceneData.allObjects.filter(o => o.absorbedTime === null);
	const counts: Record<string, number> = {};
	for (const o of live) counts[typeOf(o)] = (counts[typeOf(o)] ?? 0) + 1;

	console.log(`\n=== ${label} — ${run.seconds}s simulated ===`);
	console.log('survey        :', JSON.stringify(run.events.find(e => e.event === 'survey')?.detail ?? null));
	console.log('actions       :', JSON.stringify(tally));
	console.log('steps chosen  :', JSON.stringify(stepTally(run)));
	console.log('failed steps  :', JSON.stringify(stepTally(run, 'stepFailed')));
	console.log('aim missed    :', JSON.stringify(stepTally(run, 'aimMissed')));
	console.log('missed onto   :', JSON.stringify(hitTally(run)));
	console.log('transfers     :', run.transfers, '| energy now', game.energy, '(low', run.energyLow + ')');
	console.log('phase         :', run.phase);
	console.log('objects left  :', JSON.stringify(counts));
	console.log('body ended at :', game.activeSynthoidCol, game.activeSynthoidRow, '| camera height', run.camCtrl.posHeight.toFixed(2));
	if (TRACE) {
		console.log('--- trace ---');
		for (const e of run.events.filter(e => e.category === 'bot' || e.category === 'action' || e.category === 'energy')) {
			console.log(`${(e.at / 1000).toFixed(1)}s [${e.category}] ${e.event}`, JSON.stringify(e.detail ?? {}));
		}
	}
}

function stepTally(run: RunResult, event = 'step') {
	const tally: Record<string, number> = {};
	for (const e of run.events.filter(e => e.category === 'bot' && e.event === event)) {
		const label = String(e.detail?.label ?? '?').replace(/\d+\/\d+/, 'n');
		tally[label] = (tally[label] ?? 0) + 1;
	}
	return tally;
}

/*
 Assert the properties that actually broke, rather than "it did something".

 Each was a real regression caught here: the bot looping build-then-eat on the same cell (no
 transfers), spending every slot on steps the rules refused (failures), and building bodies above
 its own eye line where they couldn't be entered (failures + no transfers). Watch the wall clock
 too — a healthy run is a couple of seconds, and a bot stuck in a retry loop re-plans every third
 frame, so a sudden slowdown of this file is itself the alarm.
*/
function expectHealthy(run: RunResult) {
	const steps = countOf(run, 'step');
	const failed = countOf(run, 'stepFailed') + countOf(run, 'aimMissed');
	const survey = run.events.find(e => e.event === 'survey')?.detail as { col?: number; row?: number } | undefined;

	// A step the rules refuse means the planner asked for something impossible — a few are fine
	// (a watcher can eat the target between planning and acting), a torrent is a broken planner.
	expect(failed).toBeLessThan(steps * 0.15);
	// Still standing. LOST routes through completeLost() to MENU, so MENU here means it died.
	expect(run.phase).not.toBe('MENU');
	expect(run.energyLow).toBeGreaterThanOrEqual(0);
	// The one that matters: it got where it was going. Deliberately not a transfer count —
	// wandering inflates that, and the old greedy planner scored a healthy 20 while never
	// arriving anywhere. Navigating well means *fewer* hops, not more.
	expect(survey?.col).toBeTypeOf('number');
	expect({ col: game.activeSynthoidCol, row: game.activeSynthoidRow }).toEqual({ col: survey!.col, row: survey!.row });
}

describe('bot demo run', () => {
	const seconds = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.BOT_SECONDS ?? 90);

	it('walks landscape 0 to its assault tile', () => {
		const run = runDemo(0, seconds);
		report('landscape 0', run);
		expectHealthy(run);
	}, 300_000);

	it('walks landscape 1 to its assault tile', () => {
		const run = runDemo(1, seconds);
		report('landscape 1', run);
		expectHealthy(run);
	}, 300_000);
});

// What the crosshair found instead, when it missed — 'nothing' means the ray left the world.
function hitTally(run: RunResult) {
	const tally: Record<string, number> = {};
	for (const e of run.events.filter(e => e.category === 'bot' && e.event === 'aimMissed')) {
		const hit = String(e.detail?.hit ?? '?').replace(/@.*/, '');
		tally[hit] = (tally[hit] ?? 0) + 1;
	}
	return tally;
}
