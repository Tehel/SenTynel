/*
 Headless bot observatory.

 Runs the real GameLoop — real scene, real raycasts, real rules — with the renderer and input
 manager stubbed out, so the bot's behaviour here is the behaviour in the browser. Raycasting in
 Three.js is pure CPU; only the WebGL context and the DOM are missing, and nothing the bot
 touches needs either.

 Set BOT_TRACE=1 to dump every decision, BOT_SECONDS to change the run length:
   BOT_TRACE=1 BOT_SECONDS=400 npx vitest run src/engine/bot.harness

 WHERE THE BOT STANDS: 51 of the 102 sweep landscapes (below). The asserted cases here are four
 it wins comfortably. Since game/random.ts seeded gameplay randomness these are reproducible, so
 a failure here is real and repeatable rather than something that may or may not recur.
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
import { game, startDemo, advanceDemo, setStartingSynthoid, currentLevelId } from '../game/state.svelte';
import { settings } from '../settings.svelte';
import { demoProgress } from '../game/demo.svelte';
import { demoStats, setStatsTarget } from '../game/stats.svelte';
import { isPlayableLanding } from '../game/route';
import { DEMO_LEVEL_LIMIT_MS } from '../game/timing';

const FRAME_MS = 16;
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const TRACE = !!env?.BOT_TRACE;
const SWEEP = !!env?.BOT_SWEEP;
/*
 Every hundredth landscape, plus 9999. A hundred samples rather than a handful because the
 differences being chased are a landscape or two wide: at twenty, two configurations can score
 the same total while disagreeing about which landscapes they win, and a change that trades one
 for another is indistinguishable from one that does nothing.

 Spread uniformly on purpose. Landscape number is not a difficulty ordering — 9999 has seven
 secondary sentries and is one of the easier ones, its ground being flat apart from the
 Sentinel's mound — so a contiguous block would sample one kind of terrain, not the space.

 272 is on the end because it was reported from play: heightGap 1, and the landscape where a
 drain fouling the assault tile was first seen to deadlock the bot.
*/
const SWEEP_LANDSCAPES = [...Array(100).keys()].map(i => i * 100).concat(9999, 272);

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
	won: boolean;
	jump: number;
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

		// startDemo() seeds game/random.ts from currentLevelId(), which in demo mode is the bot's
		// own cursor — so point that at the landscape under test, or every run here would share
		// landscape 0's sequence. settings.levelId is deliberately left elsewhere: a demo touching
		// the player's progress is exactly what the sandbox exists to prevent, and if this file
		// ever starts depending on it that has regressed.
		demoProgress.levelId = levelId;
		settings.levelId = 0;
		game.levelEpoch = 0;
		// Watcher rotation speed compounds with completed games (world/objects/watcher.ts), which
		// would otherwise leak between cases in this file once one of them wins landscape 9999.
		setStatsTarget('demo');
		demoStats.gameCompletions = 0;
		demoStats.completedGameThisRun = false;
		startDemo();

		// MainView Effect 3a: put the camera in the starting body and hide it from itself.
		const start = sceneData.allObjects.find(o => o instanceof Synthoid)!;
		camCtrl.resetToPosition(start.col, start.row, start.height);
		camCtrl.lookAtCell(16, 16);
		setStartingSynthoid(start.col, start.row);
		start.setViewOpacity(0);

		let time = 0;
		let seenTransfers = game.transferCount;
		let energyLow = game.energy;
		let won = false;
		let jump = 0;
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

			/*
			 App.svelte's demo supervisor holds the end screen for a beat and then either advances
			 (a win) or drops to the menu (a loss). Nothing here needs the hold, so the phase is
			 left standing: advanceDemo() requires WON, which is what lets the chain test below step
			 from one landscape to the next through the real advance path.
			*/
			if (game.phase === 'WON') { won = true; jump = game.energy; break; }
			if (game.phase === 'LOST') break;
		}

		return { sceneData, camCtrl, seconds, events, energyLow, transfers: game.transferCount, phase: game.phase, won, jump };
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
	console.log('outcome       :', run.won ? `WON, jumping ${run.jump} landscapes` : run.phase);
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
	// A step the rules refuse means the planner asked for something impossible — a few are fine
	// (a watcher can eat the target between planning and acting), a torrent is a broken planner.
	expect(failed).toBeLessThan(steps * 0.15);
	// Never went bankrupt on the way: dropping below zero is a loss, and the endgame is
	// unrecoverable once absorption locks.
	expect(run.energyLow).toBeGreaterThanOrEqual(0);
	// The whole point. Deliberately not a transfer count or a distance travelled — wandering
	// inflates both, and the old greedy planner managed a healthy 20 transfers while arriving
	// nowhere at all. Finishing the landscape is the only measure that can't be gamed.
	expect(run.won).toBe(true);
	expect(run.jump).toBeGreaterThan(0);
}

describe('bot demo run', () => {
	const seconds = Number(env?.BOT_SECONDS ?? 90);

	/*
	 Win-rate sweep. Minutes to run, so it is opt-in rather than part of `npm test`:
	   BOT_SWEEP=1 npx vitest run src/engine/bot.harness -t sweep

	 Last measured: 53 wins from 102. The progression that got there, each step measured against
	 the last on this same set:

	     39   before cone-aware destinations
	     43   preferring tiles no watcher is currently looking at (+8 landscapes, -4)
	     46   hyperspacing out when boxed in, and the nearest-first retry (+3, -0)
	     53   canHit before committing, Sentries taken on sight, fouled assault tile cleared (+6, -0)

	     51   the plan-based planner (+1, -3 — a wash on wins, see below)

	 Two things measured at 53 and were kept or dropped on the evidence rather than on how they
	 read: committing to a half-built pile over any rival destination was exactly neutral (0
	 gained, 0 lost) but removed a visible absurdity, and is now subsumed by the plan. Fleeing a
	 watcher lost six landscapes in its sharpest form and is out; see the note where its rung
	 would go in game/bot.ts.

	 The plan-based planner is worth its two landscapes and they are within noise anyway (four
	 discordant pairs). What it bought is visible in the failure mix rather than the total —
	 landscapes where the bot never got going fell from 9 to 1 — and in what could be deleted:
	 two tuned constants and an inference that was wrong twice. It also makes pathologies
	 legible: its first version tripped this file's failure-rate guard with 25 aim misses on one
	 tile, a stubbornness the stateless planner had been hiding by drifting away instead.

	 Pile height is not the wall (wins run from one to seven boulders) and neither is sentry count
	 — 9999 has seven secondary sentries and is one of the easier ones, its ground flat apart from
	 the Sentinel's mound. Landscape number is not a difficulty ordering at all. Geometry and
	 watcher exposure are what decide it, which is why the sample is spread across the range.

	 Where the remaining 55 go, from the run that scored 43:

	     25   spent the purse on actions that didn't stick
	     15   still alive when the clock ran out
	     10   died later, having got going
	      1   never got going at all  (was 9 before the plan and the hyperspace escape hatch)

	 It asserts nothing; it is a yardstick to move, and the shape of the failures is the useful
	 part. Twenty samples was too few to tell two configurations apart — two of them scored an
	 identical 12 while disagreeing about which landscapes they won.
	*/
	it.skipIf(!SWEEP).each(SWEEP_LANDSCAPES)(
		'sweep %i',
		id => {
			const run = runDemo(id, 240);
			console.log(`sweep ${id}:`, run.won ? `WON +${run.jump}` : run.phase, '| transfers', run.transfers, '| failures',
				countOf(run, 'stepFailed') + countOf(run, 'aimMissed'), '| retries', countOf(run, 'aimRetry'));
			// One line each is right for a 20-landscape sweep; with BOT_TRACE on you want the
			// whole story for the one landscape you're chasing.
			if (TRACE) report(`sweep ${id}`, run);
		},
		300_000
	);

	/*
	 The property everything else here rests on. Gameplay randomness comes from game/random.ts,
	 seeded per landscape by startGame(), so two runs of the same landscape must be identical
	 action for action. Without it a failure seen once might not be seen again — which is exactly
	 what made landscape 53 uncommittable: it won inside the suite and died run alone.
	*/
	it('plays a landscape the same way twice', () => {
		const fingerprint = (run: RunResult) =>
			run.events
				.filter(e => e.category === 'action' || (e.category === 'bot' && e.event === 'step'))
				.map(e => `${e.at}|${e.event}|${JSON.stringify(e.detail ?? {})}`)
				.join('\n');

		const first = fingerprint(runDemo(1, 60));
		const second = fingerprint(runDemo(1, 60));
		expect(first).toBe(second);
		expect(first.length).toBeGreaterThan(0);
	}, 300_000);

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

	// heightGap 1 and 2 (utils/all.csv), so the assault pile is three and five boulders rather
	// than one. Same loop, taller stack — and the taller it gets the more of it is spent standing
	// next to the Sentinel, so these are the runs where the pile arithmetic has to be exactly
	// right or the bot builds a body above its own eye line and strands itself.
	it('wins landscape 2, where the pile is three boulders', () => {
		const run = runDemo(2, seconds);
		report('landscape 2 (heightGap 1)', run);
		expectHealthy(run);
	}, 300_000);

	// Reported from play: the bot got most of the way and then circled for the rest of the run.
	// A watcher had chewed the top boulder off its half-built pile into a tree, which canPlaceAt
	// refuses — so the assault tile was unbuildable and nothing else would do.
	it('wins landscape 272, where a drain fouls the assault tile', () => {
		const run = runDemo(272, 240);
		report('landscape 272 (fouled assault tile)', run);
		expectHealthy(run);
	}, 300_000);

	/*
	 The watchdog, on a landscape the bot genuinely cannot finish.

	 1300 is one of the eleven sweep landscapes still in PLAYING when the 240 s budget runs out, and
	 it is the *busy* kind of failure: 26 transfers, plenty of accepted actions, simply never
	 arriving. That matters, because it is the case the no-progress limb cannot see — something is
	 always working, so game.lastActionAt keeps moving — and only DEMO_LEVEL_LIMIT_MS closes it out.
	 An attract mode with no ceiling would sit here forever, which is exactly what this asserts
	 against.

	 Run past the ceiling on purpose; the sweep's own 240 s budget is deliberately under it.
	*/
	it('gives up on a landscape it cannot finish', () => {
		const run = runDemo(1300, DEMO_LEVEL_LIMIT_MS / 1000 + 20);
		console.log('landscape 1300:', run.phase, '| lostReason', game.lostReason, '| transfers', run.transfers);
		expect(run.won).toBe(false);
		// LOST, not left running — and captioned as the stall it is, since the bot is nowhere near
		// bankrupt (LoseScreen would otherwise claim "Energy Depleted" over a healthy purse).
		expect(run.phase).toBe('LOST');
		expect(game.lostReason).toBe('stalled');
		expect(countOf(run, 'watchdog')).toBe(1);
	}, 900_000);

	/*
	 Attract mode: landscape after landscape through the real advance path, which is what separates
	 a demo from a sequence of demos.

	 Each hop goes through advanceDemo() — the same function App.svelte's supervisor calls once the
	 win screen has had its beat — so what is under test is the whole chain: the bot steering its
	 purse to a landing worth playing (game/route.ts, spending the surplus down in planEndgame), the
	 cursor moving on the bot's own record rather than the player's, and the next landscape starting
	 without a trip through MENU.

	 Starting from 0 because the run is then reproducible from the top, and because the walk out of
	 landscape 0 is the one every other test here already trusts.
	*/
	it('plays a chain of landscapes, steering each landing', () => {
		const HOPS = 3;
		demoProgress.levelId = 0;
		demoProgress.levelIds = [0];
		settings.levelId = 0;
		settings.levelIds = [0];

		const landings: number[] = [];
		for (let hop = 0; hop < HOPS; hop++) {
			const from = demoProgress.levelId;
			const run = runDemo(from, 240);
			console.log(`chain hop ${hop}: landscape ${from} ->`, run.won ? `WON +${run.jump}` : run.phase);
			expectHealthy(run);
			// The advance the supervisor performs, and the only way the cursor should ever move in
			// demo mode.
			advanceDemo();
			landings.push(demoProgress.levelId);
			expect(currentLevelId()).toBe(demoProgress.levelId);
		}

		console.log('chain landings :', JSON.stringify(landings));
		expect(landings).toHaveLength(HOPS);
		// Always forward, and never onto a landscape the steering is supposed to skip — the point of
		// the whole exercise.
		let previous = 0;
		for (const landing of landings) {
			expect(landing).toBeGreaterThan(previous);
			expect(isPlayableLanding(landing)).toBe(true);
			previous = landing;
		}
		// The player's record is untouched throughout: this is the leak the sandbox exists to stop,
		// and a chain of wins is exactly what would expose it.
		expect(settings.levelId).toBe(0);
		expect(settings.levelIds).toEqual([0]);
		// The bot's own record, on the other hand, should show the run.
		expect(demoStats.victories).toBeGreaterThanOrEqual(HOPS);
		expect(demoProgress.levelIds).toEqual([0, ...landings]);
	}, 900_000);
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
