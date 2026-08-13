import { Vector3, type PerspectiveCamera, type Mesh } from 'three';
import type { CameraController } from './camera';
import { EYE_HEIGHT, easeInOutCubic } from './camera';
import { canPlaceAt, objectsAt, topObjectAt, type SceneData } from './scene';
import { EYE_HEIGHT_LOCAL, inWatcherCone } from './watcher';
import { GameObject, Synthoid, Watcher } from '../world/objects';
import { GameObjType, MAP_SIZE } from '../world/terrain';
import { performEngineActionOn, performEngineHyperspace } from './actions';
import { pickAlong, pickTarget } from './picker';
import { isCellVisibleFrom } from './visibility';
import { verticalExtent } from './particles';
import {
	computeHopField,
	findAssaultTile,
	HYPERSPACE_COST,
	planNextStep,
	type AssaultPlan,
	type BotObject,
	type BotPlan,
	type BotStep,
	type BotWorld,
} from '../game/bot';
import { bearingUnits, ticksUntilBearingCovered, type ConeState } from '../game/cone';
import { chooseDemoLanding } from '../game/route';
import { game, canPerformAction, currentLevelId, triggerLost } from '../game/state.svelte';
import { DEMO_LEVEL_LIMIT_MS, DEMO_NO_PROGRESS_MS } from '../game/timing';
import { logEvent } from '../game/log';

// A 180° U-turn in half a second. The demo's most visible tunable: faster and the bot reads as
// a turret snapping between targets, slower and it starts missing its 1 Hz action slots.
// This sets the turn's *average* rate, not a ceiling — the turn is a scripted ease over a
// duration derived from this, so the instantaneous rate peaks at 1.5× here around the midpoint
// (easeInOutCubic) and falls to zero at both ends. Constant-velocity turning was accurate to
// the limit and looked like a gun turret; the ease is what makes it read as a head.
const TURN_RATE_RAD_PER_SEC = Math.PI / 0.5;
// Floor on turn duration, so nudges between two nearby targets still ease visibly instead of
// snapping within a single frame. Well under the 1 Hz action cadence, so it never costs a slot.
const MIN_TURN_MS = 120;
// Consecutive frames on target required before acting. Two, not one, and that is load-bearing:
// pickTarget raycasts through camera.matrixWorld, which Three only refreshes inside
// renderer.render(). The bot runs before the camera block each frame, so the aim it sets on
// frame N isn't in matrixWorld until that frame renders — acting on frame N would pick along
// the previous frame's orientation. Waiting one more frame costs 16 ms and removes the whole
// class of "aimed right, hit the wrong thing" bugs.
const SETTLED_FRAMES_REQUIRED = 2;
// How long to wait before re-planning after finding nothing to do. Long enough that idling is
// cheap, short enough that the bot reacts promptly when the world changes around it (a watcher
// morphs something into a tree, a meanie wanders off).
const IDLE_REPLAN_MS = 500;
/*
 Decisions a single plan may survive before it is abandoned regardless.

 The planner's own give-up tests (game/bot.ts's isPlanViable) catch everything it can observe:
 achieved, fouled, overbuilt, out of reach. This is for what it can't. A watcher eating our pile
 as fast as we lay it looks, tick by tick, exactly like ordinary progress — the plan stays viable,
 the next boulder is the right move, and nothing ever reports a failure. Only elapsed time gives
 it away. Generous enough for the longest honest plan (seven boulders, a body and a transfer, and
 failed attempts don't consume the action cooldown) with room to spare.

 Measured inert: 24 and 10 give byte-identical outcomes across the 102-landscape sweep, because
 isPlanViable catches everything observable first. Kept anyway — it guards the one case that is
 invisible by construction, and the cost of it never firing is nothing.
*/
const MAX_PLAN_DECISIONS = 24;
/*
 Where on a target's silhouette to aim, as a fraction of its height, tried in order.

 The middle is the best first guess — most model to hit. But the crosshair is a single ray, and
 a tree or a fold of ground between us and a Synthoid can cover its midriff while leaving the
 head and feet in plain view; the bot could see its target perfectly well and still fail to
 transfer, over and over, aiming at the obstacle. A human would just look a little higher. High
 comes before low because most things that occlude are on the ground.
*/
const AIM_FRACTIONS = [0.5, 0.85, 0.2];
/*
 How far ahead cone prediction bothers to look, in 4 Hz ticks — 32 seconds.

 Not a performance guard so much as a statement about what the answer is worth. Every cell a watcher
 has line of sight to is covered eventually (the ±20 step walks the facing onto a 4-unit lattice, so
 nothing with LOS is permanently safe), which would make an unbounded ticksUntilSeen a ranking of
 far-off exposures that no plan lives long enough to care about. The longest honest plan is a
 seven-boulder pile, a body and a transfer — nine actions at the 1 Hz cadence, 36 ticks — so
 anything still clear well past that is simply "safe", and ties at Infinity.
*/
const SIGHT_HORIZON_TICKS = 128;

// A scripted head turn toward a step's target: captured once when the step is picked, then
// played out over `duration`. Angles are stored as a start plus a signed delta (the delta
// already resolved to the shortest way round) so the ease applies to a plain number and can't
// wrap mid-turn.
interface BotTurn {
	fromDirection: number;
	fromVertical: number;
	deltaDirection: number;
	deltaVertical: number;
	duration: number;
	elapsed: number;
}

const cellKey = (col: number, row: number) => `${col}_${row}`;
// Failures are remembered per action, not per cell — see BotWorld.isBlocked.
const failureKey = (action: string, col: number, row: number) => `${action}|${col}_${row}`;

// Shortest signed angular distance from a to b, in (-π, π].
function shortestAngleDelta(a: number, b: number): number {
	return ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

// World-space eye position for a body standing on (col, row) with its feet at standHeight.
// Matches CameraController's grid↔world mapping exactly; getting this wrong would have the bot
// planning against a world it isn't actually standing in.
const eyeAt = (col: number, row: number, standHeight: number) =>
	new Vector3(col + 0.5, standHeight + EYE_HEIGHT, MAP_SIZE - 1 - (row + 0.5));

// A watcher's own eye, at the height engine/watcher.ts drains from.
const watcherEye = (w: Watcher) => eyeAt(w.col, w.row, w.height + EYE_HEIGHT_LOCAL - EYE_HEIGHT);

// The rotation state game/cone.ts predicts from. `rot` and `step` come from the generator and are
// public on GameObject; the clock is exposed read-only by Watcher for exactly this.
const coneStateOf = (w: Watcher): ConeState => ({
	col: w.col,
	row: w.row,
	rot: w.rot,
	step: w.step,
	ticksUntilTurn: w.ticksToTurn,
	turnPeriodTicks: w.turnPeriod,
});

/*
 Drives the game as a virtual player: it aims the real camera at a rate limit and then fires the
 same engine action path a human's click does, so every energy, placement, line-of-sight and
 cooldown rule applies to it unchanged. Its *planning* is omniscient (game/bot.ts reads the
 whole landscape, there is no fog of war), but its *execution* has to earn every action.

 This class is the engine half: it snapshots the scene into the planner's BotWorld, caches the
 expensive per-level survey, and plays out the head turn each step needs.
*/
export class BotDriver {
	// Cells whose step failed on execution — see BotWorld.isBlocked. Cleared whenever the body
	// moves, since every reason a step can fail is a function of where we're standing.
	private failed = new Set<string>();
	private step: BotStep | null = null;
	private turn: BotTurn | null = null;
	private settledFrames = 0;
	private lastBodyKey = '';
	private nextPlanAt = 0;
	private aimAttempt = 0;
	// What the bot is in the middle of doing, and for how long. See BotPlan — this is the memory
	// the planner deliberately does without, so that it can stay pure and testable.
	private plan: BotPlan | null = null;
	private planDecisions = 0;
	// The survey. Terrain and pedestal don't move, so this is computed once per landscape —
	// it's the single most expensive thing the bot does (up to 40 line-of-sight sweeps).
	private assault: AssaultPlan | null = null;
	private surveyed = false;
	// Hops-to-goal for every flat tile, from the terrain alone (game/bot.ts's computeHopField).
	// Built once with the survey — the terrain never moves — and it is what stops the walk from
	// strolling into a dead end that happens to be near the goal.
	private hopField = new Map<number, number>();
	// Watcher-exposure answers, rebuilt per decision. Each miss costs one sweep per live
	// watcher, and the planner asks about the same handful of tiles repeatedly while scoring.
	private watchedCache = new Map<string, boolean>();
	private inSightCache = new Map<string, boolean>();
	// Ticks-until-seen per cell, and the per-(watcher, cell) line-of-sight answers that all three
	// exposure questions now share. Same lifetime as the two above: one decision.
	private seenCache = new Map<string, number>();
	private losCache = new Map<string, boolean>();
	// Watchdog clocks, in the loop's timebase. Seeded on the first tick rather than at
	// construction, since the driver is built during the scene rebuild and may sit unticked for a
	// frame or two before the phase reaches PLAYING. Re-seeded whenever game.startCount moves,
	// because a demo restarted on the landscape it was already showing doesn't rebuild the scene —
	// and so keeps this same driver, whose clocks would otherwise still be running from last time
	// and expire immediately.
	private levelStartedAt: number | null = null;
	private lastProgressAt = 0;
	private startedOn = -1;
	// Last value seen for game.lastActionAt, which is how progress is detected without the action
	// path having to report anything back: markActionPerformed moves it only when an action
	// actually took effect (a refused or mis-aimed one deliberately doesn't consume the slot).
	private lastSeenAction = 0;

	constructor(
		private camera: PerspectiveCamera,
		private camCtrl: CameraController,
		private sceneData: SceneData
	) {}

	tick(time: number, dt: number): void {
		// Only PLAYING: during TRANSFER the camera is mid-glide and every action is blocked, and
		// the other phases aren't the bot's to drive. Dropping the step here also means the bot
		// re-plans with fresh eyes on the far side of a transfer.
		if (game.phase !== 'PLAYING') {
			this.step = null;
			this.turn = null;
			this.settledFrames = 0;
			return;
		}

		if (this.checkWatchdog(time)) return;

		// A transfer invalidates every line-of-sight judgement the failure set recorded.
		const bodyKey = cellKey(game.activeSynthoidCol ?? -1, game.activeSynthoidRow ?? -1);
		if (bodyKey !== this.lastBodyKey) {
			this.lastBodyKey = bodyKey;
			this.failed.clear();
		}

		if (!this.step) {
			// Planning is not free — a decision costs a line-of-sight sweep per candidate tile.
			// With something to do that's fine, since a step then occupies the bot for a second
			// or more. With nothing to do it would re-derive "nothing" every frame at 60 Hz and
			// visibly cost framerate, so idling backs off instead.
			if (time < this.nextPlanAt) return;
			this.step = this.chooseStep();
			this.settledFrames = 0;
			this.aimAttempt = 0;
			if (!this.step) {
				this.nextPlanAt = time + IDLE_REPLAN_MS;
				return;
			}
			logEvent('bot', 'step', { ...this.step });
			// Hyperspace has no target, so there is nothing to aim at or verify — it just goes.
			if (this.step.action === 'hyperspace') {
				const step = this.step;
				this.step = null;
				if (!performEngineHyperspace(this.camera, this.sceneData, time)) {
					this.nextPlanAt = time + IDLE_REPLAN_MS;
					logEvent('bot', 'stepFailed', { ...step });
				}
				return;
			}
			this.turn = this.beginTurn(this.step);
			// No bearing to the target (it's underfoot) — nothing to aim at, so drop it.
			if (!this.turn) {
				this.failed.add(failureKey(this.step.action, this.step.col, this.step.row));
				this.step = null;
				return;
			}
		}
		if (!this.turn) return;

		if (!this.updateTurn(this.turn, dt)) return;
		// Aim has landed and is stale-free; wait out the shared 1 Hz cadence before acting.
		if (!canPerformAction(time)) return;

		const step = this.step;
		this.step = null;
		this.turn = null;
		this.settledFrames = 0;

		// Check the crosshair actually found what we aimed at before committing. Acting on a
		// blind pick is how the bot ends up building on whatever hillside happened to be in the
		// way — the action succeeds, the rules are satisfied, and the plan quietly derails.
		/*
		 The right cell isn't enough for a transfer. game/actions.ts requires the pick to *be* the
		 Synthoid, and a body we just built stands on the pile we built under it — so the same cell
		 also holds boulders, and a ray landing on one of those resolves to a perfectly good object
		 at exactly the right coordinates. The rules then refuse the transfer, and the bot has paid
		 five energy for a body it can't get into. Twice over that is the whole starting purse.

		 Checking the picked object's identity turns that into a miss, which the retry ladder
		 answers by aiming higher up the target — off the boulder and onto the body.
		*/
		const pick = pickTarget(this.camera, this.sceneData);
		const wrongKind =
			step.action === 'transfer' && !(pick?.kind === 'object' && pick.gameObject instanceof Synthoid);
		if (!pick || wrongKind || pick.col !== step.col || pick.row !== step.row) {
			const hitWhat = pick?.kind === 'object' ? pick.gameObject.constructor.name : pick?.kind;
			const hit = pick ? `${hitWhat}@${pick.col}_${pick.row}` : 'nothing';
			// Something is in the way of that particular ray. Try another part of the target
			// before writing it off — the blacklist is permanent until the body next moves, and
			// giving up on a Synthoid we can plainly see costs the 3 energy already spent on it.
			if (this.aimAttempt + 1 < AIM_FRACTIONS.length && topObjectAt(this.sceneData.allObjects, step.col, step.row)) {
				this.aimAttempt++;
				this.step = step;
				this.turn = this.beginTurn(step);
				logEvent('bot', 'aimRetry', { ...step, hit, attempt: this.aimAttempt });
				return;
			}
			this.failed.add(failureKey(step.action, step.col, step.row));
			logEvent('bot', 'aimMissed', { ...step, hit });
			return;
		}
		if (step.action === 'hyperspace') return; // handled above, never reaches the aim path
		if (!performEngineActionOn(step.action, pick, this.camera, this.sceneData, time)) {
			this.failed.add(failureKey(step.action, step.col, step.row));
			logEvent('bot', 'stepFailed', { ...step });
		}
	}

	/*
	 Close out a landscape that isn't going anywhere. Returns true once it has, so the caller stops
	 driving — the phase is LOST by then and the demo supervisor in App.svelte takes it from there.

	 Progress is "an action the rules accepted", read off game.lastActionAt. A bot circling a tile
	 it can't build on fails its aim over and over without ever consuming an action slot, which is
	 exactly the state this is here to catch; the overall limit catches the slower version, where
	 something does keep working but the landscape is never finished.

	 The reason is carried into LOST so the screen doesn't caption a stall "Energy Depleted" — the
	 bot commonly has energy in hand and simply nothing legal to spend it on.
	*/
	private checkWatchdog(time: number): boolean {
		if (this.levelStartedAt === null || this.startedOn !== game.startCount) {
			this.startedOn = game.startCount;
			this.levelStartedAt = time;
			this.lastProgressAt = time;
			this.lastSeenAction = game.lastActionAt;
		}
		if (game.lastActionAt !== this.lastSeenAction) {
			this.lastSeenAction = game.lastActionAt;
			this.lastProgressAt = time;
		}

		const idle = time - this.lastProgressAt;
		const elapsed = time - this.levelStartedAt;
		if (idle < DEMO_NO_PROGRESS_MS && elapsed < DEMO_LEVEL_LIMIT_MS) return false;

		logEvent('bot', 'watchdog', {
			levelId: currentLevelId(),
			idleMs: Math.round(idle),
			elapsedMs: Math.round(elapsed),
			energy: game.energy,
		});
		this.step = null;
		this.turn = null;
		triggerLost('stalled');
		return true;
	}

	private chooseStep(): BotStep | null {
		if (this.plan && this.planDecisions >= MAX_PLAN_DECISIONS) {
			logEvent('bot', 'planAbandoned', { ...this.plan, reason: 'stale' });
			this.plan = null;
			this.planDecisions = 0;
		}
		const world = this.buildWorld();
		if (!this.surveyed) {
			this.surveyed = true;
			this.assault = findAssaultTile(world);
			if (this.assault) this.hopField = computeHopField(world, this.assault);
			logEvent('bot', 'survey', { ...this.assault, reachableTiles: this.hopField.size });
		}

		const decision = planNextStep(world, this.assault, this.hopField);
		const kept =
			decision.plan !== null &&
			this.plan !== null &&
			decision.plan.col === this.plan.col &&
			decision.plan.row === this.plan.row;
		if (kept) {
			this.planDecisions++;
		} else {
			if (this.plan && !decision.plan) logEvent('bot', 'planDropped', { ...this.plan });
			if (decision.plan) logEvent('bot', 'plan', { ...decision.plan });
			this.planDecisions = 0;
		}
		this.plan = decision.plan;
		return decision.step;
	}

	// Snapshot the live scene into the planner's view of it. Cheap by design: the two expensive
	// operations (line of sight, watcher exposure) are callbacks, so they only cost anything for
	// the tiles the planner actually asks about.
	private buildWorld(): BotWorld {
		const { allObjects, map, level, scene } = this.sceneData;
		this.watchedCache.clear();
		this.inSightCache.clear();
		this.seenCache.clear();
		this.losCache.clear();

		const active = allObjects.filter(o => o.absorbedTime === null);
		const objects = active.map(toBotObject);
		const watchers = active.filter((o): o is Watcher => o instanceof Watcher);

		/*
		 Line of sight from one watcher to one cell — the expensive half of every exposure question,
		 and now shared by all three of them. Keyed by watcher rather than folded into the per-cell
		 caches, because isInSight rejects most cells on the cone test before ever asking, and
		 ticksUntilSeen does the same with the schedule; both orderings only work if the sweep stays
		 a separate, individually-cached step.
		*/
		const watcherLOS = (index: number, w: Watcher, col: number, row: number): boolean => {
			const key = `${index}|${col}_${row}`;
			const cached = this.losCache.get(key);
			if (cached !== undefined) return cached;
			const visible = isCellVisibleFrom(watcherEye(w), scene, map, MAP_SIZE, col, row, 0, w.col, w.row);
			this.losCache.set(key, visible);
			return visible;
		};

		/*
		 Ticks until any watcher's cone reaches this cell. Cheap test first, exactly as isInSight
		 does it: the schedule (game/cone.ts) is pure arithmetic, so it runs for every watcher, and
		 the line-of-sight sweep is only spent on one that could actually improve on the best answer
		 so far. Narrowing the horizon to `best` as it improves means a cell already under a cone
		 costs nothing beyond the first watcher that proves it.

		 The approximation, stated once here and once in game/cone.ts: a drain-locked watcher's
		 rotation clock is frozen, and whether it *stays* locked depends on the whole board, so this
		 assumes every clock runs. When that is wrong, exposure is predicted earlier than it arrives
		 — the safe direction for deciding where to stand.
		*/
		const ticksUntilSeen = (col: number, row: number): number => {
			const key = cellKey(col, row);
			const cached = this.seenCache.get(key);
			if (cached !== undefined) return cached;
			let best = Infinity;
			for (let i = 0; i < watchers.length; i++) {
				const w = watchers[i];
				const bearing = bearingUnits(w.col, w.row, col, row);
				if (bearing === null) continue;
				const horizon = Math.min(best, SIGHT_HORIZON_TICKS);
				const ticks = ticksUntilBearingCovered(coneStateOf(w), bearing, horizon);
				if (ticks >= best) continue;
				if (!watcherLOS(i, w, col, row)) continue;
				best = ticks;
				if (best === 0) break;
			}
			this.seenCache.set(key, best);
			return best;
		};

		const bodyCol = game.activeSynthoidCol;
		const bodyRow = game.activeSynthoidRow;
		let body: BotWorld['body'] = null;
		if (bodyCol !== null && bodyRow !== null) {
			const stack = objectsAt(allObjects, bodyCol, bodyRow);
			const self = stack.find(o => (o.constructor as typeof GameObject).type === GameObjType.SYNTHOID);
			if (self) {
				body = {
					col: bodyCol,
					row: bodyRow,
					height: self.height,
					onPedestal: stack.some(o => (o.constructor as typeof GameObject).type === GameObjType.PEDESTAL),
				};
			}
		}

		return {
			map,
			// level.shapes is the generator's own flatness verdict, already computed — no need to
			// re-derive it from the four corner heights. Edge tiles have no shape entry at all,
			// which drops them here for free (they're outside the playable 0..MAP_SIZE-2 range).
			isFlat: (col, row) => level.shapes[row * MAP_SIZE + col] === 0,
			objects,
			objectsAt: (col, row) => objects.filter(o => o.col === col && o.row === row),
			canPlace: (col, row, type) => canPlaceAt(this.sceneData, col, row, type),
			canSeeFrom: (fromCol, fromRow, standHeight, col, row, yOffset) =>
				isCellVisibleFrom(
					eyeAt(fromCol, fromRow, standHeight),
					scene,
					map,
					MAP_SIZE,
					col,
					row,
					yOffset,
					fromCol,
					fromRow
				),
			isWatched: (col, row) => {
				const key = cellKey(col, row);
				const cached = this.watchedCache.get(key);
				if (cached !== undefined) return cached;
				const watched = watchers.some((w, i) => watcherLOS(i, w, col, row));
				this.watchedCache.set(key, watched);
				return watched;
			},
			// Cone first — it's a couple of trig operations and rejects most cells outright, so the
			// line-of-sight sweep behind it only runs for the few a watcher is actually facing.
			isInSight: (col, row) => {
				const key = cellKey(col, row);
				const cached = this.inSightCache.get(key);
				if (cached !== undefined) return cached;
				const seen = watchers.some((w, i) => inWatcherCone(w, col, row) && watcherLOS(i, w, col, row));
				this.inSightCache.set(key, seen);
				return seen;
			},
			ticksUntilSeen,
			willBeSeenWithin: (col, row, ticks) => ticksUntilSeen(col, row) <= ticks,
			// One ray from where the eye already is. The camera isn't pointed there yet — it doesn't
			// need to be; a Raycaster takes any origin and direction.
			canHit: (col, row, aimHeight) => {
				const point = new Vector3(col + 0.5, aimHeight, MAP_SIZE - 1 - (row + 0.5));
				const pick = pickAlong(this.camera.position, point, this.sceneData);
				return pick !== null && pick.col === col && pick.row === row;
			},
			isBlocked: (col, row, action) => this.failed.has(failureKey(action, col, row)),
			energy: game.energy,
			body,
			plan: this.plan,
			previousBody:
				game.previousSynthoidCol !== null && game.previousSynthoidRow !== null
					? { col: game.previousSynthoidCol, row: game.previousSynthoidRow }
					: null,
			sentinelAbsorbed: game.sentinelAbsorbed,
			// Route steering, demo only — a player's leftover energy is theirs. Gated on the Sentinel
			// being down for two reasons: choosing a landing generates a landscape or two, and until
			// the endgame starts the final purse isn't knowable anyway. The winning jump is what
			// survives paying for the hyperspace itself, hence the subtraction.
			targetJump:
				game.demo && game.sentinelAbsorbed
					? chooseDemoLanding(currentLevelId(), game.energy - HYPERSPACE_COST)
					: null,
		};
	}

	// Plan the head turn toward a step's target. Duration comes from the larger of the two axis
	// deltas, and both axes then run on that one clock — so the head sweeps a straight arc and
	// arrives on both axes together, rather than finishing yaw and then tilting.
	private beginTurn(step: BotStep): BotTurn | null {
		const aim = this.camCtrl.aimAnglesFor(step.col, step.row, this.aimHeightFor(step));
		// Directly underfoot — no bearing to turn to, and nothing the crosshair could hit.
		if (!aim) return null;

		const deltaDirection = shortestAngleDelta(this.camCtrl.direction, aim.direction);
		const deltaVertical = aim.vertical - this.camCtrl.vertical;
		const distance = Math.max(Math.abs(deltaDirection), Math.abs(deltaVertical));
		return {
			fromDirection: this.camCtrl.direction,
			fromVertical: this.camCtrl.vertical,
			deltaDirection,
			deltaVertical,
			duration: Math.max(MIN_TURN_MS, (distance / TURN_RATE_RAD_PER_SEC) * 1000),
			elapsed: 0,
		};
	}

	// Where to point for this attempt. The planner's own aimHeight leads; later attempts walk up
	// and down the target's silhouette looking for a line the obstacle doesn't cover.
	private aimHeightFor(step: BotStep): number {
		if (this.aimAttempt === 0) return step.aimHeight;
		const target = topObjectAt(this.sceneData.allObjects, step.col, step.row);
		if (!target) return step.aimHeight;
		const extent = verticalExtent(target.object3D as Mesh);
		return target.height + extent.min + (extent.max - extent.min) * AIM_FRACTIONS[this.aimAttempt];
	}

	// Play one frame of the scripted turn. Returns true once the aim has landed and been settled
	// long enough to act on. Driving off accumulated dt (like TurnDriver and the transfer glide)
	// rather than an absolute start time means it simply freezes if the bot stops being ticked.
	private updateTurn(turn: BotTurn, dt: number): boolean {
		turn.elapsed += dt;
		const t = Math.min(1, turn.elapsed / turn.duration);
		const eased = easeInOutCubic(t);
		this.camCtrl.direction = turn.fromDirection + turn.deltaDirection * eased;
		this.camCtrl.vertical = turn.fromVertical + turn.deltaVertical * eased;

		if (t < 1) {
			this.settledFrames = 0;
			return false;
		}
		this.settledFrames++;
		return this.settledFrames >= SETTLED_FRAMES_REQUIRED;
	}
}

// Aim at the middle of an object's own silhouette rather than its base — the raycast then has
// the whole model to hit instead of skimming its foot. verticalExtent reads the geometry's
// bounding box, which Three caches after the first call, so this stays cheap per decision.
function toBotObject(o: GameObject): BotObject {
	const extent = verticalExtent(o.object3D as Mesh);
	return {
		type: (o.constructor as typeof GameObject).type ?? GameObjType.TREE,
		col: o.col,
		row: o.row,
		height: o.height,
		aimHeight: o.height + (extent.min + extent.max) / 2,
	};
}
