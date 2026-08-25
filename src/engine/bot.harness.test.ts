/*
 Headless bot observatory.

 Runs the real GameLoop — real scene, real raycasts, real rules — with the renderer and input
 manager stubbed out, so the bot's behaviour here is the behaviour in the browser. Raycasting in
 Three.js is pure CPU; only the WebGL context and the DOM are missing, and nothing the bot
 touches needs either.

 Set BOT_TRACE=1 to dump every decision, BOT_SECONDS to change the run length:
   BOT_TRACE=1 BOT_SECONDS=400 npx vitest run src/engine/bot.harness

 WHERE THE BOT STANDS: v1 wins 69 of the 102 sweep landscapes, v2 73 (below). The asserted cases are four
 it wins comfortably. Since game/random.ts seeded gameplay randomness these are reproducible, so
 a failure here is real and repeatable rather than something that may or may not recur.
*/

import { describe, it, expect, afterAll } from 'vitest';
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { Disposer } from './disposer';
import { CameraController } from './camera';
import { GameLoop } from './loop';
import { BotDriver } from './bot';
import { buildScene, objectsAt, type SceneData } from './scene';
import { EYE_HEIGHT_LOCAL, inWatcherCone } from './watcher';
import { isCellVisibleFrom } from './visibility';
import { GameObject, Synthoid, Watcher } from '../world/objects';
import { generateLevel, GameObjType, MAP_SIZE } from '../world/terrain';
import { game, startDemo, advanceDemo, setStartingSynthoid, currentLevelId } from '../game/state.svelte';
import { settings } from '../settings.svelte';
import { demoProgress } from '../game/demo.svelte';
import { demoStats, setStatsTarget } from '../game/stats.svelte';
import { isPlayableLanding, heightGapOf } from '../game/route';
import { LadderPlanner } from '../game/bot';
import { PhasePlanner } from '../game/bot2';
import type { BotPlanner, BotWorld } from '../game/botWorld';
import type { Level } from '../world/terrain';
import { DEMO_LEVEL_LIMIT_MS } from '../game/timing';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
/*
 Simulated frame time. The browser runs on real rAF deltas, so a landscape that behaves one way here
 can behave another way there — the 1 Hz action cadence and the 4 Hz drain phase drift against each
 other by a few milliseconds a frame, and that decides whether a boulder is laid before or after the
 watcher looks. BOT_FRAME_MS re-runs a landscape at a different frame time, which is the cheapest way
 to tell a genuine bug from one that only bites on a particular alignment.
*/
const FRAME_MS = Number(env?.BOT_FRAME_MS ?? 16);
const TRACE = !!env?.BOT_TRACE;
const EPOCH = Number(env?.BOT_EPOCH ?? 0);
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
const DEFAULT_SWEEP_LANDSCAPES = [...Array(100).keys()].map(i => i * 100).concat(9999, 272);
/*
 BOT_LEVELS replaces that list, which is how a landscape reported from watching the demo gets
 replayed here — the harness seeds from the same per-landscape RNG as the browser, so what happened
 there happens here:

   BOT_SWEEP=1 BOT_LEVELS=42 BOT_PLANNER=v2 BOT_TRACE=1 npx vitest run src/engine/bot.harness -t sweep
*/
const SWEEP_LANDSCAPES = env?.BOT_LEVELS ? parseLevels(env.BOT_LEVELS) : DEFAULT_SWEEP_LANDSCAPES;

// "42", "42,106", "3000-3999", or any mixture — a systematic sweep of a whole block is the only way
// to tell whether the 102-landscape sample is representative.
function parseLevels(spec: string): number[] {
	const out: number[] = [];
	for (const part of spec.split(',')) {
		const range = /^(\d+)-(\d+)$/.exec(part.trim());
		if (range) {
			for (let id = Number(range[1]); id <= Number(range[2]); id++) out.push(id);
		} else {
			out.push(Number(part));
		}
	}
	return out;
}

/*
 The strategies under test. One row today; a challenger (PLAN-BOT2.md) adds a second, and the sweep
 then plays every landscape with each of them and prints the trade rather than the totals alone —
 two configurations can score the same while winning different landscapes, which is exactly the
 comparison that wasted tuning passes before.
*/
const ALL_PLANNERS: { id: string; make: () => BotPlanner }[] = [
	{ id: 'v1', make: () => new LadderPlanner() },
	{ id: 'v2', make: () => new PhasePlanner() },
];
// BOT_PLANNER picks one (comma-separated for a subset); unset runs them all, which is the
// side-by-side the comparison exists for.
const PLANNERS = env?.BOT_PLANNER
	? ALL_PLANNERS.filter(p => env.BOT_PLANNER!.split(',').includes(p.id))
	: ALL_PLANNERS;

/*
 The furthest this landscape could possibly send the bot: everything absorbable, minus what the
 endgame can never get back. A port of utils/all-levels.js's maxJump, kept honest by the assertion
 in the "measures a landscape's maximum jump" test below.

 Winning jumps ahead by exactly the leftover energy, so this is the other half of how far a run
 gets, and the half the sweep used not to look at: the bot wins about half the landscapes, and banks
 about 41% of what those landscapes could fund.
*/
function maxJumpOf(level: Level): number | null {
	const gap = heightGapOf(level);
	if (gap === null) return null;
	const trees = level.objects.filter(o => o.type === GameObjType.TREE).length;
	// 10 to start, 1 a tree, 3 a sentry, and 4 for the Sentinel — which nbSentries counts as one of
	// its own, hence the extra 1. Unrecoverable: 2 per pile boulder, 3 for the pedestal body, 3 for
	// the hyperspace out.
	const totalEnergy = 10 + trees + level.nbSentries * 3 + 1;
	return totalEnergy - 6 - 2 * (2 * gap + 1);
}

interface SweepRow {
	id: number;
	planner: string;
	won: boolean;
	jump: number;
	maxJump: number | null;
	bucket: string;
}
// Printed in this order rather than by frequency, so two runs' histograms line up for a diff.
const BUCKETS = [
	'won',
	'died-in-opening',
	'bled-out',
	'never-reached-assault-position',
	'burned-purse',
	'died-after-the-Sentinel',
	'watchdog-stalled',
	'out-of-clock',
];
const sweepRows: SweepRow[] = [];

afterAll(() => {
	if (sweepRows.length === 0) return;
	const wonBy = new Map<string, Set<number>>();
	console.log('\nsweep summary');
	for (const { id, make } of PLANNERS) {
		void make;
		const rows = sweepRows.filter(r => r.planner === id);
		if (rows.length === 0) continue;
		const wins = rows.filter(r => r.won);
		wonBy.set(id, new Set(wins.map(r => r.id)));
		const banked = wins.reduce((sum, r) => sum + r.jump, 0);
		// Against what those same landscapes could have funded, so the ratio isn't skewed by which
		// ones happened to be won.
		const available = wins.reduce((sum, r) => sum + (r.maxJump ?? 0), 0);
		const ratio = available > 0 ? Math.round((100 * banked) / available) : 0;
		console.log(
			`  ${id}: won ${wins.length}/${rows.length}` +
				` | mean jump ${(banked / Math.max(1, wins.length)).toFixed(1)}` +
				` of maxJump ${(available / Math.max(1, wins.length)).toFixed(1)} (${ratio}%)` +
				` | reached maxJump ${wins.filter(r => r.maxJump !== null && r.jump >= r.maxJump).length}`
		);
		/*
		 The shape of the failures, which is the part a total cannot show.

		 B4's target is `never-reached-assault-position` falling: the losses were diagnosed as "still
		 ascent" from a trace, and this is the first time that claim has been countable. Diff two
		 histograms rather than two totals — a change that trades one bucket for another at the same
		 win rate is a real finding, and used to be invisible.
		*/
		const histogram = BUCKETS.map(b => `${b} ${rows.filter(r => r.bucket === b).length}`).filter(s => !s.endsWith(' 0'));
		console.log(`    buckets: ${histogram.join(' | ')}`);
	}
	// The landscapes themselves, so a losing set can be gone through by hand.
	for (const [id, won] of wonBy) {
		const lost = sweepRows
			.filter(r => r.planner === id && !won.has(r.id))
			.map(r => r.id)
			.sort((a, b) => a - b);
		if (lost.length > 0) console.log(`  ${id} lost ${lost.length}: ${lost.join(' ')}`);
	}
	// The trade, which the totals hide.
	const ids = [...wonBy.keys()];
	for (let i = 1; i < ids.length; i++) {
		const base = wonBy.get(ids[0])!;
		const other = wonBy.get(ids[i])!;
		const gained = [...other].filter(id => !base.has(id)).sort((a, b) => a - b);
		const lost = [...base].filter(id => !other.has(id)).sort((a, b) => a - b);
		console.log(`  ${ids[i]} vs ${ids[0]}: +${gained.length} ${gained.join(' ')} | -${lost.length} ${lost.join(' ')}`);
	}
});

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
	// Everything below exists for bucketOf() — see the comment there for why a total is not enough.
	lostReason: string;
	sentinelDown: boolean;
	elapsedMs: number;
	/*
	 Anything seen standing on air during the run (RULES-FIDELITY.md A5b). Measured every frame
	 because the states it is looking for last a fraction of a second and are gone by the time the
	 run ends: a corpse whose support has left, or a morph's replacement on a rung that cannot hold
	 it. Deliberately recorded rather than thrown, so a sweep still reports win rates; expectHealthy
	 asserts on it for the pinned landscapes, and the sweep prints a line per offending landscape.
	*/
	floats: string[];
}

/*
 One frame's worth of that check. The surface is what is DRAWN — a boulder half-way through fading
 out is still visibly holding up whatever stands on it — so this is the same question
 engine/scene.ts's finishUnsupportedCorpses asks, arrived at independently.
*/
function floatingObjects(sceneData: SceneData): string[] {
	const found: string[] = [];
	const cells = new Map<string, GameObject[]>();
	for (const o of sceneData.allObjects) {
		const key = `${o.col}_${o.row}`;
		if (!cells.has(key)) cells.set(key, []);
		cells.get(key)!.push(o);
	}
	for (const [key, all] of cells) {
		const [col, row] = key.split('_').map(Number);
		let surface = sceneData.map[row * MAP_SIZE + col];
		for (const o of all) {
			if (o.constructor.name === 'Boulder') surface = Math.max(surface, o.height + 0.5);
			else if (o.constructor.name === 'Pedestal') surface = Math.max(surface, o.height + 1);
		}
		for (const o of all) {
			if (o.height > surface + 1e-6) found.push(`${typeOf(o)}@(${col},${row})h${o.height}`);
		}
	}
	return found;
}

const countOf = (run: RunResult, event: string) =>
	run.events.filter(e => e.category === 'bot' && e.event === event).length;

// Energy that moved, by direction. `gained` is what absorbing earned, `drained` what the watchers
// took off us — the two halves of whether a run was solvent, which is what separates a bot that
// overspent from one that was eaten while working.
const energySum = (run: RunResult, event: string, cause?: string) =>
	run.events
		.filter(e => e.category === 'energy' && e.event === event && (cause === undefined || e.detail?.cause === cause))
		.reduce((sum, e) => sum + Number(e.detail?.n ?? 0), 0);

/*
 Did the bot ever get into a position to finish?

 Read off planEndgame's own step labels rather than a flag, which makes it planner-agnostic: v1 and v2
 reach the endgame through different ladders but both go through planEndgame, so both bucket the same
 way and neither needs a new event. The first of these labels means the bot was standing somewhere it
 could take the Sentinel from — which is the thing B4 is trying to make more common, and the thing no
 previous measurement could count.
*/
const ENDGAME_LABELS = new Set([
	'absorb the Sentinel',
	'body onto the pedestal',
	'transfer onto the pedestal',
	'hyperspace out — win',
]);
const reachedAssault = (run: RunResult) =>
	run.events.some(e => e.category === 'bot' && e.event === 'step' && ENDGAME_LABELS.has(String(e.detail?.label)));

/*
 Why a landscape was lost, as one label.

 The plan asked for this before B4 and it kept not happening, because a win rate cannot show you
 *how* the losses fail — and the three obvious hypotheses (ran out of clock, spent the purse, never
 got high enough) call for completely different fixes. Every input is already logged; nothing here
 needs a new event.

 Order matters where buckets overlap, and there is one deliberate choice: `bled-out` is tested before
 `died-in-opening`, so an early death to an unbounded watcher drain is reported by its mechanism
 rather than by its timing. What is left in `died-in-opening` is then the honest "spent its purse
 before it got anywhere", which is a different bug with a different fix.
*/
function bucketOf(run: RunResult): string {
	if (run.won) return 'won';
	if (run.lostReason === 'stalled') return 'watchdog-stalled';
	// Still playing at the buzzer. The sweep's budget is deliberately under DEMO_LEVEL_LIMIT_MS, so
	// this is the harness giving up rather than the game doing so — possibly a win we cut short.
	if (run.phase !== 'LOST') return 'out-of-clock';
	// The worst loss there is: absorption locks the instant the Sentinel goes, so nothing after this
	// point is recoverable and the landscape was thrown away one action from home.
	if (run.sentinelDown) return 'died-after-the-Sentinel';
	/*
	 Eaten rather than overspent. A watcher draining us never rotates away (engine/watcher.ts's
	 drainLocked), so standing in a cone is an unbounded bleed rather than a passing squall, and a run
	 that lost more to the watchers than absorbing ever earned it failed for a different reason than
	 one that spent its purse.

	 A hypothesis, and deliberately a strict one. It was written expecting landscape 390 to land here,
	 since 390's last seconds are a 1/s pool drain — but measured over the whole run 390 gains 25,
	 spends 25 and loses only 5 to the pool (plus 6 to two Meanie-forced hyperspaces), so it is an
	 overspend that never got high enough, and it buckets as such. Treat a low count here as evidence
	 that the flee argument (PLAN-BOT2.md's B4b) has fewer candidates than expected, not as a reason
	 to loosen the threshold until the story fits.
	*/
	const drained = energySum(run, 'drain');
	const gained = energySum(run, 'gain');
	if (drained >= Math.max(10, gained)) return 'bled-out';
	if (run.transfers <= 2 && run.elapsedMs < 30_000) return 'died-in-opening';
	if (!reachedAssault(run)) return 'never-reached-assault-position';
	return 'burned-purse';
}

// Drive a landscape for `seconds` of simulated time and return what happened. `makePlanner` is
// which strategy plays it — a fresh one per landscape, since a planner carries per-landscape memory.
function runDemo(
	levelId: number,
	seconds: number,
	makePlanner: () => BotPlanner = () => new LadderPlanner(),
	frameMs: number = FRAME_MS,
	// The second seed axis — see the comment beside game.levelEpoch below. A pinned case that
	// reproduces a report from a retried landscape has to name its epoch, not inherit the env's.
	epoch: number = EPOCH
): RunResult {
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
		loop.bot = new BotDriver(camera, camCtrl, sceneData, makePlanner());

		// startDemo() seeds game/random.ts from currentLevelId(), which in demo mode is the bot's
		// own cursor — so point that at the landscape under test, or every run here would share
		// landscape 0's sequence. settings.levelId is deliberately left elsewhere: a demo touching
		// the player's progress is exactly what the sandbox exists to prevent, and if this file
		// ever starts depending on it that has regressed.
		demoProgress.levelId = levelId;
		settings.levelId = 0;
		/*
		 The second seed axis, alongside BOT_FRAME_MS. game/random.ts is seeded from
		 (currentLevelId, levelEpoch), so the epoch decides where every hyperspace lands and where every
		 conservation tree appears — one epoch is one sample of a landscape, exactly as one frame time is.

		 It matters for reproducing reports. A demo that has retried a landscape (or been rewound onto
		 one) is not on epoch 0 any more, so a run that fails in the browser can win here at the default
		 and look unreproducible. BOT_EPOCH is how you sweep that.
		*/
		game.levelEpoch = epoch;
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
		const floats: string[] = [];
		let seenTransfers = game.transferCount;
		let energyLow = game.energy;
		let won = false;
		let jump = 0;
		const frames = Math.round((seconds * 1000) / frameMs);

		for (let i = 0; i < frames; i++) {
			time += frameMs;

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
			// Cheap in the common case: nothing is mid-absorb on most frames, and a run this long
			// holds a hundred objects at most.
			if (floats.length < 8 && sceneData.allObjects.some(o => o.absorbedTime !== null)) {
				for (const f of floatingObjects(sceneData)) if (!floats.includes(f)) floats.push(f);
			}

			/*
			 App.svelte's demo supervisor holds the end screen for a beat and then either advances
			 (a win) or drops to the menu (a loss). Nothing here needs the hold, so the phase is
			 left standing: advanceDemo() requires WON, which is what lets the chain test below step
			 from one landscape to the next through the real advance path.
			*/
			if (game.phase === 'WON') { won = true; jump = game.energy; break; }
			if (game.phase === 'LOST') break;
		}

		return {
			sceneData,
			camCtrl,
			seconds,
			events,
			energyLow,
			transfers: game.transferCount,
			phase: game.phase,
			won,
			jump,
			lostReason: game.lostReason,
			sentinelDown: game.sentinelAbsorbed,
			// The loop's own clock, not the last event's timestamp: a run that ends by going quiet
			// still ends, and bucketOf needs to know how far in.
			elapsedMs: time,
			floats,
		};
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
	// Nothing was ever left standing on air — see RunResult.floats and RULES-FIDELITY.md A5b.
	expect(run.floats).toEqual([]);
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

	 The shape of the failures used to be hand-counted here and went stale immediately. It is now
	 printed per run: bucketOf() above labels every loss, and the summary prints a histogram. Diff two
	 histograms rather than two totals — a change that trades one bucket for another at an unchanged
	 win rate is a real finding, and was invisible for the whole of B1-B3.

	 It asserts nothing; it is a yardstick to move. Twenty samples was too few to tell two
	 configurations apart — two of them scored an identical 12 while disagreeing about which
	 landscapes they won — and 102 is by now a training set: every change in PLAN-BOT2.md has been
	 tuned against it and it reads about three points optimistic. Judge changes on a fresh block
	 (BOT_LEVELS=6000-6999, via utils/block-sweep.sh) and use this as a fast smoke test.
	*/
	it.skipIf(!SWEEP).each(SWEEP_LANDSCAPES)(
		'sweep %i',
		id => {
			for (const { id: planner, make } of PLANNERS) {
				const run = runDemo(id, 240, make);
				const tag = PLANNERS.length > 1 ? ` [${planner}]` : '';
				const bucket = bucketOf(run);
				const maxJump = maxJumpOf(run.sceneData.level);
				// bucket and max go on the line, not just into the summary, so that a chunked run can
				// be re-aggregated from the per-landscape lines alone — see utils/sweep-aggregate.js.
				console.log(`sweep ${id}${tag}:`, run.won ? `WON +${run.jump}` : run.phase, '| transfers', run.transfers,
					'| failures', countOf(run, 'stepFailed') + countOf(run, 'aimMissed'), '| retries', countOf(run, 'aimRetry'),
					'| bucket', bucket, '| max', maxJump ?? '?');
				// Ignored by utils/sweep-aggregate.js (it only reads the line above), so this is free to
				// carry a diagnosis a 1000-landscape run would otherwise have no way to report.
				if (run.floats.length > 0) console.log(`sweep-float ${id}${tag}:`, run.floats.join(' '));
				sweepRows.push({ id, planner, won: run.won, jump: run.jump, maxJump, bucket });
				// One line each is right for a 20-landscape sweep; with BOT_TRACE on you want the
				// whole story for the one landscape you're chasing.
				if (TRACE) report(`sweep ${id}${tag}`, run);
			}
		},
		300_000
	);

	/*
	 The property everything else here rests on. Gameplay randomness comes from game/random.ts,
	 seeded per landscape by startGame(), so two runs of the same landscape must be identical
	 action for action. Without it a failure seen once might not be seen again — which is exactly
	 what made landscape 53 uncommittable: it won inside the suite and died run alone.
	*/
	/*
	 maxJumpOf is a second copy of an economic rule that already exists in utils/all-levels.js, and a
	 second copy is a thing that drifts. These are that script's own numbers for two landscapes, read
	 out of utils/all.csv — 0 is the gap-0 baseline and 9999 is the one with seven secondary sentries.
	*/
	it('measures a landscape\'s maximum jump the same way utils/all-levels.js does', () => {
		expect(maxJumpOf(generateLevel(0))).toBe(22);
		expect(maxJumpOf(generateLevel(9999))).toBe(45);
	});

	const fingerprint = (run: RunResult) =>
		run.events
			.filter(e => e.category === 'action' || (e.category === 'bot' && e.event === 'step'))
			.map(e => `${e.at}|${e.event}|${JSON.stringify(e.detail ?? {})}`)
			.join('\n');

	it('plays a landscape the same way twice', () => {
		const first = fingerprint(runDemo(1, 60));
		const second = fingerprint(runDemo(1, 60));
		expect(first).toBe(second);
		expect(first.length).toBeGreaterThan(0);
	}, 300_000);

	/*
	 The same property for v2, which the case above does not cover: runDemo's default planner is v1.

	 Worth its own case because the two planners keep their memory differently. v1's ladder re-derives
	 almost everything each tick, while v2 latches — a survey, a perch, a plan — and anything latched is
	 somewhere an accidental dependency on iteration order can hide. A Set or Map whose insertion order
	 varies, or a sort that is not total, produces a planner that plays a landscape one way today and
	 another way tomorrow, and every measurement in PLAN-BOT2.md assumes that cannot happen.
	*/
	it('plays a landscape the same way twice with v2', () => {
		const first = fingerprint(runDemo(1, 60, () => new PhasePlanner()));
		const second = fingerprint(runDemo(1, 60, () => new PhasePlanner()));
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
	 v2 on the two landscapes reported from watching the demo, which is the only reason either was
	 ever looked at. Asserted rather than left to the sweep because both were *silent* failures — the
	 bot looked busy throughout — and both turned on a belief the trace did not print at the time.

	 106: it climbed to a winning position one tile from the one the survey nominated, did not
	 recognise it, and walked away to keep pursuing a goal it had already achieved (canAssaultFrom,
	 and the re-point that follows it in game/bot2.ts).

	 600: the same discovery made without re-pointing the plan, so the bot latched a perch it could
	 win from and then spent 147 decisions walking back to the old tile instead.

	 16: reported from a demo run started at landscape 0. Two bugs came out of the trace. The reclaim rung
	 tested `top.type === SYNTHOID`, so once the body was absorbed the boulder under it was left standing
	 for the rest of the run — five of them, at 2 apiece, against a maxJump of 22. And the move-on rung
	 was paying for a hop action by action rather than pricing what finishing it would cost: with seven
	 energy and a cone on it the bot laid a boulder, was drained, built the body, was drained again, and
	 died one action short of a transfer it had already spent five energy on. It now tops up first.

	 246: reported after the demo walked unaided from landscape 0 to it and then died in five seconds.
	 The start is watched and every tile with cover is below it, so the walk — correctly preferring the
	 least-bad tile, because standing still is worse than being seen — kept building bodies on tiles a
	 cone was already on, and the 1 Hz drain took each one before the transfer could complete.
	 TilePreference.avoid (game/bot2.ts) refuses that grade outright, the walk returns nothing, and the
	 bot hyperspaces out instead. Worth +4 on the 102 sweep, the largest single strategy change in
	 PLAN-BOT2.md, and it was asserted nowhere until this line — which matters because a change to how
	 the ascent chooses destinations can bypass the grading entirely without failing anything else.

	 All three are checked at two frame times. The 1 Hz action cadence and the 4 Hz drain phase drift
	 against each other differently depending on it, and 106 won at 16 ms while still failing at 15 —
	 a single frame time would have called this fixed while it was not.
	*/
	it.each([
		[106, 15],
		[106, 16],
		[600, 15],
		[600, 16],
		[246, 15],
		[246, 16],
		[16, 15],
		[16, 16],
		[35, 15],
		[35, 16],
		[233, 15],
		[233, 16],
		[7632, 15],
		[7632, 16],
		[7398, 15],
		[7398, 16],
	])('v2 wins landscape %i at a %i ms frame', (id, frameMs) => {
		const run = runDemo(id, 240, () => new PhasePlanner(), frameMs);
		console.log(`landscape ${id} @${frameMs}ms:`, run.won ? `WON +${run.jump}` : run.phase);
		expect(run.won).toBe(true);
	}, 300_000);

	/*
	 Landscape 7398 — planning a hop the purse cannot finish, reported from watching (2026-08-25).

	 Its opening needs a three-boulder tower, which leaves 1 energy. The bot transfers up, reclaims the
	 body it left (+3) and, with FOUR in hand, plans a one-boulder hop: 2 for the boulder and 3 for the
	 body, five against four. It lays the boulder, is left with two, and stops — permanently. Nothing
	 clears the plan, the harvest has nothing in reach, and rung 6's hyperspace needs six, so the bot
	 cannot even leave. One transfer in the whole run.

	 The walk's gate priced only the NEXT action, which is the mistake landscape 16 taught rungs 3b and
	 4b to stop making. But a gate alone would not have helped: at four energy every hop carrying a
	 boulder is unaffordable, so refusing them all stalls just as hard. The fix is a cheaper hop — the
	 pile is sized to what remains once the body is paid for, which is the reporter's own rule.

	 The jump is asserted, not just the win, because the landscape is worth 39 and a fix that merely
	 scrapes home would be missing the point. Same reason the run is checked at both frame times.
	*/
	it('wins landscape 7398, whose second hop it could not afford', () => {
		const run = runDemo(7398, 240, () => new PhasePlanner());
		console.log('landscape 7398:', run.won ? `WON +${run.jump}` : run.phase, '| transfers', run.transfers);
		expect(run.won).toBe(true);
		expect(run.jump).toBeGreaterThanOrEqual(30);
	}, 300_000);

	/*
	 Landscape 9950 — transferring by straight-line distance into a pit, reported from watching as
	 "it insists on transferring to an abandoned synthoid at the bottom of a pit". It is exactly that.

	 The pedestal sits at (11,5). A pit at (11,10) is FIVE cells from it in a straight line against the
	 assault tile's ten, and has no entry in the hop field at all — nothing walks out of it. So a body
	 abandoned down there was permanently "closer" by chooseTransfer's old straight-line test, and the
	 bot climbed the whole ladder to hops 0, transferred down into the pit, hyperspaced out, climbed
	 back, and did it again. Three full cycles before the clock ended it.

	 PINNED AT AN EPOCH, which is the point of the fixture. game/random.ts is seeded from
	 (levelId, levelEpoch), so the epoch decides where hyperspaces land and where conservation trees
	 appear — and at epoch 0 this landscape WINS. The reporter's demo had retried and been rewound, so
	 it was not on epoch 0, and the bug was invisible at the default. A landscape is not one sample.

	 The transfer count is asserted, not just the win: the failure was a loop that climbed all the way
	 up each time, so it read as busy rather than stuck (20 transfers against 10 here), and "won" alone
	 would not distinguish a fixed run from a lucky one.
	*/
	it('wins landscape 9950 without transferring into an unreachable pit', () => {
		const run = runDemo(9950, 240, () => new PhasePlanner(), 16, 7);
		console.log('landscape 9950 @epoch7:', run.won ? `WON +${run.jump}` : run.phase, '| transfers', run.transfers);
		expect(run.won).toBe(true);
		expect(run.transfers).toBeLessThanOrEqual(14);
	}, 300_000);

	/*
	 Landscape 7632 — the perch deadlock, and here because of the SHAPE of the failure rather than the
	 win. Reported from watching an unattended run fail it three times identically: all seven Sentries
	 absorbed, 37 energy against a maxJump of 44, the bot standing one square from its own perch, and
	 not one action taken until the watchdog wrote the landscape off.

	 A deadlock between two rules that are each correct. Having built a body beside the perch as an
	 errand destination and transferred into it, the perch was the bot's `previousBody` — which
	 chooseTransfer filters out to stop a two-body oscillation, while the reclaim rung protects it as
	 the way back up. The walk could not help either: getting home the ordinary way means building a
	 body on the perch tile, and the perch body was already standing there. Nothing but a transfer
	 clears previousBody, and no transfer was available.

	 What makes it worth a fixture is that it is invisible to the aggregate. All fifteen
	 watchdog-stalled losses on the 6000-6999 verdict block idle in ASCEND; not one is this. So no
	 win-rate measurement would have found it, and none will notice if it comes back.

	 The two assertions are separate claims. The jump, because the whole point is that the landscape
	 was already effectively won — a fix that got home but arrived poor would be missing it. And the
	 rung firing exactly once, because "went home" and "went home repeatedly" are the two outcomes
	 this fix has to be told apart from: the reason it lives after the harvest rather than inside
	 chooseTransfer is that the earlier placement can oscillate, and a win alone cannot see the
	 difference.
	*/
	it('wins landscape 7632, whose perch was the body it had just left', () => {
		const run = runDemo(7632, 240, () => new PhasePlanner());
		console.log('landscape 7632:', run.won ? `WON +${run.jump}` : run.phase, '| transfers', run.transfers);
		expect(run.won).toBe(true);
		// A floor, not a fingerprint: the point is that the landscape was already effectively won, so a
		// fix that got home but arrived poor would be missing it. The exact figure moves with unrelated
		// planner changes (it was 40 when this was written and is 37 since absorbing objects stopped
		// blocking placement), and pinning it would make this a test of whatever last touched the
		// opening. 35 of a maxJump of 44 is still the bot's ordinary ~81% share.
		expect(run.jump).toBeGreaterThanOrEqual(35);
		/*
		 THIS NO LONGER ASSERTS THE GO-HOME RUNG, and that is worth reading rather than skipping past.

		 It used to require exactly one `goHome`, because "went home" and "went home repeatedly" are the
		 two outcomes that fix has to be told apart from. Since absorbing objects stopped blocking
		 placement (engine/scene.ts) the bot takes a different route through 7632 and never reaches the
		 deadlock here at all — and a scan of 6000-6149 finds the rung firing ZERO times, so there is no
		 fixture in the sweep that exercises it any more.

		 The rung is kept: the deadlock it closes is real and its conditions (perched, errand list empty,
		 previousBody being the perch) are still reachable. But its only guard is now
		 bot2.test.ts's 'gets home even when the perch is the very body it just left', verified to fail
		 without it. That is the appropriate level for a rung this rare — and it is exactly the shape
		 CLAUDE.md's C9 lesson warns about, so it is written down rather than left to be rediscovered.
		*/
	}, 300_000);

	/*
	 Landscape 35, which is here for what it proves about AIMING rather than about strategy.

	 Reported from watching the demo, 2026-08-24, and it failed twice the same way. Two tiles the bot
	 wanted to build on had their centres hidden behind a fold of ground while most of their surface
	 was in plain view; the crosshair is a single ray, it resolved on the hillside in front, and both
	 tiles were written off as impossible. With its only two options gone the bot declared itself
	 boxed in, hyperspaced away at 9 energy, and was stranded. The opening of 35 is tight enough that
	 a miss there is fatal, which is what makes it a fixture rather than an anecdote — the same misses
	 happen elsewhere and are usually survivable, so nothing counted them.

	 It now wins, and on the way it does something no run in this project had ever done: it absorbs a
	 MEANIE. That rung (game/bot2.ts's 0b) was added on 2026-08-17 and had never once fired, because
	 the Meanie model is a head floating over a tripod foot with a hollow between them and canHit
	 aimed at the bounding-box midpoint — straight through the gap. Both assertions below are the
	 same bug at two scales: a cell is not a point, and a model is not a column.
	*/
	it('wins landscape 35, whose only two build tiles are visible at their edges', () => {
		const run = runDemo(35, 240, () => new PhasePlanner());
		console.log('landscape 35:', run.won ? `WON +${run.jump}` : run.phase, '| aim misses', countOf(run, 'aimMissed'));
		expect(run.won).toBe(true);
		// The tiles are reached by aiming off-centre, not by luck: no step is written off here.
		expect(countOf(run, 'aimMissed')).toBe(0);
		// And the Meanie that spawns mid-ascent is eaten rather than allowed to force a hyperspace.
		const absorbedTypes = run.events
			.filter(e => e.category === 'action' && e.event === 'absorb')
			.map(e => String(e.detail?.type));
		expect(absorbedTypes).toContain('MEANIE');
	}, 300_000);

	/*
	 Landscape 233 — the aim that pointed at the bot's own feet.

	 Reported from watching, 2026-08-24. `aimAt` is re-derived every decision and tie-broken by nearest
	 to where the bot stands, so the tile UNDERFOOT can win the tiebreak. Control only reaches that line
	 uncommitted, which means canAssaultFrom has just refused that tile — and a tile you stand on but
	 cannot assault from is the one place in the landscape that can never be made to work, because
	 height is only ever gained by building on ANOTHER tile and transferring up. Every rung deadlocked
	 at once and the ladder fell through to `boxed in — hyperspace out` holding twenty energy.

	 What made it a LOOP rather than one wasted jump is the body left standing on that tile: the bot
	 jumped, climbed back, and `transfer onward` moved it into that body — landing on the dead-end tile
	 again. Confirmed by how it ends when it does: over repeated runs the bot escapes exactly when a
	 watcher finally eats the abandoned body.

	 The transfer count is the assertion that would have caught it. A busy loop is invisible to the
	 no-progress watchdog (every jump moves `lastActionAt`), so it fails as `out-of-clock` — which is
	 where the whole of this fix's +10 on the verdict block came from, 27 losses down to 16.
	*/
	it('wins landscape 233 without aiming at the tile it is standing on', () => {
		const run = runDemo(233, 240, () => new PhasePlanner());
		console.log('landscape 233:', run.won ? `WON +${run.jump}` : run.phase, '| transfers', run.transfers);
		expect(run.won).toBe(true);
		// It used to reach 34, shuttling between a dead-end tile and the body it left there. A healthy
		// run of this landscape is under a dozen; anything approaching the old figure is the loop back.
		expect(run.transfers).toBeLessThan(15);
	}, 300_000);

	/*
	 Landscape 86 — the bowl the reachability field called a dead end, reported from playing
	 (2026-08-25): "the bot starts at the bottom of a 2-levels pit, not watched; there is a clear way
	 to ascend with a 3-boulders tower, but the bot chooses to hyperspace".

	 It did, on decision zero, and the field was why. computeHopField's edges were all built from one
	 eye — a body standing on ONE boulder — so no edge could climb more than a whole level. The body
	 starts at (12,18) height 4 in a bowl whose entire height-5 rim is SLOPED, and sloped tiles are not
	 in the graph at all, so the nearest flat ground is two levels up and unreachable by any edge the
	 field could express. Measured pocket: three tiles, 12_18, 13_18 and 12_19, all height 4, with no
	 way out. `connected` was false, the hatch fired, and it landed in another pocket.

	 The game's own arithmetic disagreed the whole time: bouldersToSee(4, 6) is 3, and a three-boulder
	 pile there sees twelve flat height-6 tiles, every one of them two cheap hops from the winning band.

	 Two assertions, because the win alone would not distinguish the fix from a lucky hyperspace. The
	 jump, since 22 of a maxJump of 26 is the bot taking the landscape properly rather than scraping it;
	 and no hyperspace at all, which is the actual claim — this landscape is walkable from the floor.
	*/
	it('wins landscape 86 by climbing out of a bowl rather than hyperspacing', () => {
		const run = runDemo(86, 240, () => new PhasePlanner());
		console.log('landscape 86:', run.won ? `WON +${run.jump}` : run.phase, '| transfers', run.transfers);
		expect(run.won).toBe(true);
		expect(run.jump).toBeGreaterThanOrEqual(18);
		// The whole point: it climbs. A hyperspace here is the old behaviour, whatever the outcome.
		expect(run.events.filter(e => e.category === 'action' && e.event === 'hyperspace')).toHaveLength(0);
	}, 300_000);

	/*
	 Landscape 6161 — the small tower that spent the purse the big one needed.

	 The regression the hop field's tall edge caused, and the more instructive half of the pair it was
	 reported in. Watching two bowl landscapes side by side: on 6150 the bowl is a genuine dead end and
	 hyperspacing out is correct play, while here the three-boulder tower opens ground that opens more
	 ground and the landscape is winnable on foot. The bot failed BOTH, and for one reason.

	 It opened with a ONE-boulder lateral hop across the pit floor, taken by chooseDestination's pass 1
	 on the distance tiebreak — same hop cost, a whole cell nearer the aim. Inside a pocket that
	 tiebreak is a false gradient: nothing but the climb changes the cost, so "nearer the goal" is
	 nearer to something no walk reaches. It arrived with eight energy against the nine the escape then
	 needed, and spent the rest of the run laying piles it could not top and absorbing them back —
	 forty-two boulders for two transfers.

	 What makes that worth a fixture is why no sweep ever saw it. Rung 6's stuck counter has existed
	 since landscape 35 and would have hyperspaced out of 6150 correctly, but it never accumulated: the
	 shuffle returned a step every single second, so churn read as progress. A bot busily laying and
	 reclaiming boulders scores as PLAYING, not as stalled. The fix was not a churn detector but
	 removing the fake progress — after which 6150 wins BY hyperspacing and this one wins on foot.

	 So both are asserted here, one apiece, and neither alone is the property: 6161 must win without
	 jumping, and 6150 must win having jumped.
	*/
	it('wins landscape 6161 on foot, and 6150 by hyperspacing out of a dead bowl', () => {
		const climbed = runDemo(6161, 240, () => new PhasePlanner());
		console.log('landscape 6161:', climbed.won ? `WON +${climbed.jump}` : climbed.phase, '| transfers', climbed.transfers);
		expect(climbed.won).toBe(true);
		// It used to churn: 42 boulders laid for 2 transfers. A healthy run is single figures.
		expect(climbed.transfers).toBeLessThan(15);
		expect(climbed.events.filter(e => e.category === 'action' && e.event === 'hyperspace')).toHaveLength(0);

		const jumped = runDemo(6150, 240, () => new PhasePlanner());
		console.log('landscape 6150:', jumped.won ? `WON +${jumped.jump}` : jumped.phase, '| transfers', jumped.transfers);
		expect(jumped.won).toBe(true);
		// The bowl here has one cell two levels up, no purse to tower onto it, and nothing beyond it.
		// Confirmed by playing it: the hatch is the correct move, so the fix must not have removed it.
		expect(jumped.events.filter(e => e.category === 'action' && e.event === 'hyperspace').length).toBeGreaterThan(0);
	}, 300_000);

	/*
	 The watchdog, on a landscape the bot genuinely cannot finish.

	 900 is a landscape the bot never gets going on: one transfer in four minutes. An attract mode
	 with no watchdog would sit here until someone closed the tab, which is what this asserts against.

	 It replaced 1300, which used to be the busy kind of stall — 26 transfers, always working, never
	 arriving, and so visible only to DEMO_LEVEL_LIMIT_MS rather than to the no-progress limb. The
	 assault-tile and planStep fixes (see game/bot2.ts and game/botMovement.ts) turned 1300 into a
	 win, along with 1600 and 2600. Worth knowing if this test ever needs a new landscape again: the
	 candidates are whatever the sweep still leaves in PLAYING, and the list keeps shrinking.

	 Run past the ceiling on purpose; the sweep's own 240 s budget is deliberately under it.
	*/
	/*
	 The landscape number here is a FIXTURE, not a property of the watchdog, and it goes stale: it has
	 to be one the bot genuinely cannot finish, and the set of those shrinks every time the planner or
	 the rules improve. 900 was the original choice and the rules-fidelity work (PLAN-RULES.md) turned
	 it into a win, which failed this test for the best possible reason.

	 6706 replaces it, picked from the post-R5 sweep as a landscape the bot leaves on the table with
	 zero transfers. When this fails again, check whether the bot simply got better before assuming
	 the watchdog broke: `grep "bucket watchdog-stalled" out/<sweep>/chunk-*.log` picks a new one.
	*/
	it('gives up on a landscape it cannot finish', () => {
		const run = runDemo(6706, DEMO_LEVEL_LIMIT_MS / 1000 + 20);
		console.log('landscape 6706:', run.phase, '| lostReason', game.lostReason, '| transfers', run.transfers);
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

/*
 Exposure probe: what the bot believes about the tiles around its starting position, next to what
 the drain phase would actually do about a body standing on each of them.

   BOT_PROBE=390 npx vitest run src/engine/bot.harness -t probe

 Written for a report that the bot failed to use a plainly safe tile, with the suspicion that
 isWatched was lying. That is worth being able to check directly rather than by inference: the
 planner's exposure answers and the drain's own targeting rule are computed by different code paths
 over the same primitive, so a disagreement between them is a bug and an agreement moves the
 question to the planner instead.

 `drains` below replays engine/watcher.ts's own test — cone, then line of sight to the body's foot
 height — which is the ground truth for "would something standing here be eaten this tick".
*/
const PROBE = Number(env?.BOT_PROBE ?? 0);
describe('exposure probe', () => {
	it.skipIf(!PROBE)('probe', () => {
		const disposer = new Disposer();
		const sceneData = buildScene(PROBE, { smooths: 2, despikes: 2, showGrid: false, showSurfaces: true, showAxis: false }, disposer);
		const camera = new PerspectiveCamera(60, 16 / 9, 0.01, 2000);
		const { input } = makeStubs(sceneData.scene, camera);
		const camCtrl = new CameraController(camera, sceneData.map, input as never);
		demoProgress.levelId = PROBE;
		game.levelEpoch = 0;
		setStatsTarget('demo');
		demoStats.gameCompletions = 0;
		startDemo();
		const start = sceneData.allObjects.find(o => o instanceof Synthoid)!;
		camCtrl.resetToPosition(start.col, start.row, start.height);
		setStartingSynthoid(start.col, start.row);
		start.setViewOpacity(0);
		sceneData.scene.updateMatrixWorld(true);
		camera.updateMatrixWorld(true);

		const driver = new BotDriver(camera, camCtrl, sceneData, new PhasePlanner());
		const world = (driver as unknown as { buildWorld(): BotWorld }).buildWorld();
		const watchers = sceneData.allObjects.filter(
			(o): o is Watcher => o instanceof Watcher && o.absorbedTime === null
		);
		console.log(`probe ${PROBE}: start ${start.col},${start.row} h=${start.height}, watchers:`);
		for (const w of watchers) {
			console.log(`  ${w.constructor.name} at ${w.col},${w.row} h=${w.height} rot=${w.rot} step=${w.step} turnsIn=${w.ticksToTurn}`);
		}

		// engine/watcher.ts's own targeting test, for a body standing on the bare tile.
		const drains = (col: number, row: number) =>
			watchers.some(
				w =>
					inWatcherCone(w, col, row) &&
					isCellVisibleFrom(
						new Vector3(w.col + 0.5, w.height + EYE_HEIGHT_LOCAL, MAP_SIZE - 1 - (w.row + 0.5)),
						sceneData.scene,
						sceneData.map,
						MAP_SIZE,
						col,
						row,
						0,
						w.col,
						w.row
					)
			);

		const R = 6;
		let disagreements = 0;
		const safe: string[] = [];
		console.log('  cell     h    watched inSight ticksUntilSeen  drainsNow  reachable');
		for (let row = start.row - R; row <= start.row + R; row++) {
			for (let col = start.col - R; col <= start.col + R; col++) {
				if (col < 0 || row < 0 || col >= MAP_SIZE - 1 || row >= MAP_SIZE - 1) continue;
				if (!world.isFlat(col, row)) continue;
				if (col === start.col && row === start.row) continue;
				const h = world.map[row * MAP_SIZE + col];
				const inSight = world.isInSight(col, row);
				const truth = drains(col, row);
				if (inSight !== truth) disagreements++;
				// Could the bot build there at all: below the eye, placeable, and visible from here.
				const reachable =
					h < start.height + 0.875 &&
					world.canPlace(col, row, GameObjType.SYNTHOID) &&
					world.canSeeFrom(start.col, start.row, start.height, col, row, 0);
				const ticks = world.ticksUntilSeen(col, row);
				if (reachable && !truth && ticks > 20) safe.push(`${col},${row}`);
				if (Math.abs(col - start.col) <= 3 && Math.abs(row - start.row) <= 3) {
					console.log(
						`  ${String(col).padStart(2)},${String(row).padStart(2)}  ${String(h).padStart(4)}   ` +
							`${String(world.isWatched(col, row)).padEnd(7)} ${String(inSight).padEnd(7)} ` +
							`${String(ticks).padEnd(15)} ${String(truth).padEnd(10)} ${reachable}`
					);
				}
			}
		}
		console.log(`  isInSight vs drain-truth disagreements within ${R}: ${disagreements}`);
		console.log(`  reachable tiles with lasting cover: ${safe.length ? safe.join(' ') : 'NONE'}`);
		sceneData.allObjects.forEach(o => o.dispose());
		disposer.disposeAll();
	}, 300_000);
});
