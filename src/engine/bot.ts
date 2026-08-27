import { Vector3, type PerspectiveCamera, type Mesh } from 'three';
import type { CameraController } from './camera';
import { EYE_HEIGHT, easeInOutCubic } from './camera';
import { canPlaceAt, canTargetTopObject, objectsAt, topObjectAt, type SceneData } from './scene';
import { EYE_HEIGHT_LOCAL, inWatcherCone } from './watcher';
import { GameObject, Synthoid, Watcher } from '../world/objects';
import { GameObjType, MAP_SIZE } from '../world/terrain';
import { performEngineActionOn, performEngineHyperspace } from './actions';
import { pickAlong, pickTarget } from './picker';
import { isCellVisibleFrom } from './visibility';
import { verticalExtent } from './particles';
import { LadderPlanner } from '../game/bot';
import { HYPERSPACE_COST } from '../game/botGeometry';
import type { BotObject, BotPlanner, BotStep, BotWorld } from '../game/botWorld';
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
 Where on a *tile* to aim, as offsets from its centre in cell units, tried in this order.

 The same problem one level down. A cell is a square, the crosshair is a single ray, and a fold of
 ground between us and a tile routinely hides its centre while leaving most of its surface in plain
 view — the ray then resolves on the hillside in front and the step is written off as impossible.
 Landscape 35 is the case that made this expensive: two tiles the bot could plainly have built on,
 both refused on their centre ray, both blacklisted, after which it declared itself boxed in and
 hyperspaced away from a landscape it was still winning.

 Corners first, because that is what the reachability model believes: engine/visibility.ts asks
 whether *any of the four corners* of a cell can be reached, and everything upstream of the aim —
 canSeeFrom, isPlanViable, the hop field — is built on it. A tile the planner thought reachable is
 reachable at a corner, so a corner is where to look first; the edge midpoints then cover a ridge
 that cuts the square in half without clearing either end of a diagonal.

 Pulled INSIDE the cell rather than sitting on its border. engine/picker.ts resolves a terrain hit
 to a cell by flooring the world-space hit point, so a ray aimed at the corner itself lands on
 whichever of the four cells meeting there rounds first — the neighbour as often as the target.
 0.4 keeps a tenth of a cell of margin against that while staying as far out as the corner allows.
*/
const AIM_INSET = 0.4;
const AIM_OFFSETS: readonly (readonly [number, number])[] = [
	[-AIM_INSET, -AIM_INSET],
	[AIM_INSET, -AIM_INSET],
	[-AIM_INSET, AIM_INSET],
	[AIM_INSET, AIM_INSET],
	[0, -AIM_INSET],
	[0, AIM_INSET],
	[-AIM_INSET, 0],
	[AIM_INSET, 0],
];
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
// A place to point the crosshair: a fractional grid coordinate (cell centre is col + 0.5,
// row + 0.5) and a world Y. See aimCandidates.
interface AimPoint {
	gridCol: number;
	gridRow: number;
	y: number;
}

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
	/*
	 Steps that failed on execution — see BotWorld.isBlocked. Cleared whenever the body moves, since
	 every reason a step can fail is a function of where we're standing.

	 The value is WHAT WAS STANDING THERE when the failure was recorded, and the entry only counts
	 while that is still standing there (see isBlocked below).
	*/
	private failed = new Map<string, GameObject | null>();
	private step: BotStep | null = null;
	private turn: BotTurn | null = null;
	private settledFrames = 0;
	private lastBodyKey = '';
	private nextPlanAt = 0;
	private aimAttempt = 0;
	// Whether the planner has had its once-per-landscape survey. Terrain and pedestal don't move,
	// and it is the single most expensive thing the bot does (up to 64 line-of-sight sweeps).
	private surveyed = false;
	// The planner's current intention, as it last reported it, and how many decisions it has been
	// pursuing it. What the intention *means* is the planner's business; all the driver needs is
	// whether it has changed. See the staleness note on MAX_PLAN_DECISIONS.
	private intention: string | null = null;
	private intentionDecisions = 0;
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
		private sceneData: SceneData,
		// Which strategy is driving. Injected so a challenger can be run against the same engine,
		// scene and rules as the incumbent — see PLAN-BOT2.md.
		private planner: BotPlanner = new LadderPlanner()
	) {}

	tick(time: number, dt: number): void {
		// Only PLAYING: during TRANSFER the camera is mid-glide and every action is blocked, and
		// the other phases aren't the bot's to drive. Dropping the step here also means the bot
		// re-plans with fresh eyes on the far side of a transfer.
		if (game.phase !== 'PLAYING') {
			/*
			 A PAUSED demo is a demo somebody stopped to look at (PLAN-MOBILE.md's touch pause), and
			 the watchdog below measures against rAF time, which never stops — the render loop keeps
			 running in every phase. Left alone, any pause longer than DEMO_NO_PROGRESS_MS would have
			 the FIRST resumed frame declare the landscape stalled, which then books a strike against
			 a run that was doing fine and blacklists it after three. Advancing both stamps by the
			 frame delta keeps the watchdog's clock running only while the bot is actually playing.

			 PAUSED only, deliberately. TRANSFER counts against the watchdog today, and excusing it
			 here would move every sweep number banked in PLAN-BOT2.md — a fix for a phase the harness
			 never enters has no business changing what the harness measures.
			*/
			if (game.phase === 'PAUSED' && this.levelStartedAt !== null) {
				this.levelStartedAt += dt;
				this.lastProgressAt += dt;
			}
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
				this.blacklist(this.step.action, this.step.col, this.step.row);
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
			/*
			 A shot at something that is not all there yet says nothing about whether it can be hit.

			 The mirror image of the corpse rule in world/objects/base.ts's remove(): an absorbed object
			 is gone to the rules, so it is made gone to the raycasts too. A *materialising* one is the
			 other way round — present to objectsAt and canPlaceAt from the frame it is created, while its
			 mesh spends up to a second growing out of the ground under the spawn animation. A ray at its
			 finished midpoint passes over the model it will become and lands on the terrain behind.

			 So this is neither a miss to retry nor a cell to write off: it is a shot taken early. Drop the
			 step and let the next decision propose it again against a model that is actually standing
			 there. Bounded by the animation, which finishes in about a second whatever the style.

			 Landscape 7755, and the whole of the loss. A watcher turned the tree at 7_12 into the Meanie
			 hunting the body, the bot's shot at the tree went over the Meanie's head, and both retries
			 landed inside the conversion's own spawn animation. Three misses in a third of a second wrote
			 `absorb` off at that cell — and by the time the model had grown in, rung 0b's
			 `!world.isBlocked` was false for a Meanie two squares away, in plain sight, with a clear
			 crosshair. It held the body five seconds later and cost the landscape.
			*/
			const materialising = topObjectAt(this.sceneData.allObjects, step.col, step.row);
			if (materialising && !materialising.ready) {
				logEvent('bot', 'aimEarly', { ...step, hit, what: materialising.constructor.name });
				return;
			}
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
			this.blacklist(step.action, step.col, step.row);
			logEvent('bot', 'aimMissed', { ...step, hit });
			return;
		}
		if (step.action === 'hyperspace') return; // handled above, never reaches the aim path
		if (!performEngineActionOn(step.action, pick, this.camera, this.sceneData, time)) {
			// Same reasoning as the early shot above: a rules refusal against something still growing
			// into place is a fact about this instant, not about the cell.
			const top = topObjectAt(this.sceneData.allObjects, step.col, step.row);
			if (top && !top.ready) {
				logEvent('bot', 'stepEarly', { ...step, what: top.constructor.name });
				return;
			}
			this.blacklist(step.action, step.col, step.row);
			logEvent('bot', 'stepFailed', { ...step });
			return;
		}
		this.clearFailuresAt(step.col, step.row);
	}

	/*
	 Forget what was refused at a cell we have just changed.

	 The failure set is otherwise cleared only when the body moves, on the stated reasoning that "every
	 reason a step can fail is a function of where we're standing". That holds for an aim miss, which is
	 a line of sight from here. It is FALSE for a rules refusal: canPlace is a function of the cell's
	 CONTENTS, and the bot rearranges those itself all day.

	 Landscape 233 is the case. Two boulders into a three-boulder assault pile, a watcher's conservation
	 tree landed on it; the next create was refused because a tree on a stack takes the one slot on top,
	 and that refusal blacklisted `create-boulder` at the tile. The bot absorbed that very tree one
	 decision later — and went on treating its own assault tile as impossible, walking away from a pile
	 it had already paid four energy for.

	 Keyed to the cell rather than to the action, because the thing that changed is the cell. Bounded by
	 construction: it only forgets after an action the rules ACCEPTED, so it cannot become a free retry
	 of something genuinely impossible, which is what the blacklist is there to stop.
	*/
	private clearFailuresAt(col: number, row: number): void {
		const suffix = `|${cellKey(col, row)}`;
		for (const key of this.failed.keys()) if (key.endsWith(suffix)) this.failed.delete(key);
	}

	/*
	 Write a step off, together with what was standing on its cell at the time.

	 Every reason a step can fail is a judgement about a *particular thing on a particular cell*: this
	 ray is covered, that stack has no slot, the rules refuse this object here. So the record is only
	 worth anything while that thing is still there — and the world rearranges cells the bot has not
	 touched, all the time. A drain morphs a synthoid to a boulder to a tree, a conservation tree lands,
	 and the nearest tree becomes a MEANIE.

	 That last one is the case this was written for, from watching landscape 7755 (reported 2026-08-26,
	 the second half of the trace in PLAN-BOT2.md postscript 19). The bot aimed at a tree at 7_12, and
	 while the head was turning a watcher converted that very tree into the Meanie hunting it — so the
	 ray went through the model's hollow, missed, and blacklisted `absorb` at the cell. From that moment
	 rung 0b's `!world.isBlocked` was false for a Meanie two squares away with line of sight and a clear
	 crosshair, for five straight seconds, until it found the body and forced the hyperspace that cost
	 the landscape. The Meanie is *always* the cell the bot has most recently been shooting at, because
	 both pick the nearest tree — so the miss and the target it disqualifies are not independent events.

	 Identity, not type: a morph and a replacement both produce a new GameObject (replaceObjectInScene),
	 and objectsAt already drops anything mid-absorb, so "the top of this cell is no longer the object I
	 failed against" is exactly one reference comparison.

	 Bounded the same way clearFailuresAt is: an entry is only forgotten when the cell has genuinely
	 changed under it, so terrain in the way of the only ray stays written off for as long as we stand
	 here, which is what the blacklist exists to do.
	*/
	private blacklist(action: string, col: number, row: number): void {
		this.failed.set(failureKey(action, col, row), topObjectAt(this.sceneData.allObjects, col, row));
	}

	// Does that record still describe the cell? A stale one is dropped rather than merely ignored, so
	// the set stays the size of the judgements that are still live.
	private isBlocked(action: string, col: number, row: number): boolean {
		const key = failureKey(action, col, row);
		if (!this.failed.has(key)) return false;
		if (this.failed.get(key) === topObjectAt(this.sceneData.allObjects, col, row)) return true;
		this.failed.delete(key);
		return false;
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
		// Staleness first, so the decision below is taken without the intention we've given up on.
		if (this.intention !== null && this.intentionDecisions >= MAX_PLAN_DECISIONS) {
			logEvent('bot', 'planAbandoned', { intention: this.intention, reason: 'stale' });
			this.planner.abandon();
			this.intention = null;
			this.intentionDecisions = 0;
		}
		const world = this.buildWorld();
		if (!this.surveyed) {
			this.surveyed = true;
			this.planner.survey(world);
		}

		const step = this.planner.decide(world);
		const now = this.planner.intention();
		if (now !== null && now === this.intention) {
			this.intentionDecisions++;
		} else {
			this.intention = now;
			this.intentionDecisions = 0;
		}
		return step;
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
			// Rays from where the eye already is — the camera isn't pointed there yet, and doesn't
			// need to be; a Raycaster takes any origin and direction. Plural, and through the same
			// candidate list the aim itself walks, so the planner's idea of what can be hit is
			// exactly what the driver can deliver. See aimCandidates.
			canHit: (col, row, aimHeight) =>
				this.aimCandidates(col, row, aimHeight).some(point => this.reaches(point, col, row)),
			/*
			 The surface rule, asked of the real rule rather than approximated (PLAN-RULES.md R1).

			 A planner cannot answer this from canSeeFrom alone: what an object stands on decides
			 which surface has to be visible, and boulders need none at all. Deriving that in the
			 planner would be a second copy of engine/scene.ts's canTargetTopObject, and the two
			 would drift the first time either moved — the same argument that put inWatcherCone
			 behind a shared export. So it arrives as a callback, like everything else here.

			 Without it the planner proposes absorbs and transfers the rules refuse, and re-proposes
			 them every decision: measured as +28 watchdog-stalled on the 6000-6999 block, which was
			 the whole of R1's regression.
			*/
			canTarget: (col, row) =>
				body !== null &&
				canTargetTopObject(this.sceneData, col, row, (c, r, yOffset) =>
					isCellVisibleFrom(
						eyeAt(body!.col, body!.row, body!.height),
						scene,
						map,
						MAP_SIZE,
						c,
						r,
						yOffset,
						body!.col,
						body!.row
					)
				),
			isBlocked: (col, row, action) => this.isBlocked(action, col, row),
			energy: game.energy,
			body,
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
		const point = this.aimPointFor(step);
		const aim = this.camCtrl.aimAnglesForPoint(point.gridCol, point.gridRow, point.y);
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

	/*
	 Where to point for this attempt. The middle of whatever is standing there leads; later attempts
	 walk up and down its silhouette looking for a line the obstacle doesn't cover.

	 Re-derived from the live scene rather than taken from the step, and that is the point: the two are
	 the same number by construction — the planner's aimHeight is this same midpoint, read through
	 toBotObject — right up until the cell changes while the head is turning, which takes about a second
	 at TURN_RATE_RAD_PER_SEC. Then they are the silhouettes of two different models, and the ray is
	 aimed at the one that has gone.

	 Landscape 7755: the bot set off to absorb a tree at 7_12, and a watcher converted that very tree
	 into a Meanie mid-turn (the nearest tree is what both the harvest and the conversion pick, so this
	 is not a coincidence). A tree's midpoint is most of a unit above a Meanie's, so the shot went clean
	 over its head into the hillside beyond, twice more up and down a silhouette anchored to the tree's
	 extent, and the cell was written off — with the Meanie hunting the body still standing on it. See
	 the blacklist comment below for the other half of that.
	*/
	private aimHeightFor(step: BotStep): number {
		const target = topObjectAt(this.sceneData.allObjects, step.col, step.row);
		if (!target) return step.aimHeight;
		// The occluder is what engine/picker.ts resolves, so the aim ladder must walk that
		// silhouette — aiming at the drawn model's extent would miss wherever the two differ.
		const extent = verticalExtent(target.occluder);
		// AIM_FRACTIONS[0] is the midpoint, so attempt 0 needs no special case: it is the planner's own
		// aimHeight whenever the planner's target is still the thing standing here.
		return target.height + extent.min + (extent.max - extent.min) * AIM_FRACTIONS[this.aimAttempt];
	}

	/*
	 Every point on a cell the crosshair could sensibly be aimed at, best first.

	 A cell is not a point and a model is not a column, but the crosshair is a single ray — so
	 "can this be acted on" has as many answers as there are places to aim, and asking about one
	 of them is how the bot talks itself out of work it could plainly do. Two shapes, because the
	 two targets fail differently:

	 - Something standing there: walk its own silhouette (AIM_FRACTIONS). A tree or a fold of ground
	   can cover a body's waist while its head and feet are clear — and some models have no waist at
	   all. The Meanie is a head floating over a tripod foot with a hollow between them, so a ray at
	   its bounding-box midpoint passes clean through and lands on whatever is behind it. That single
	   mid-height ray was the whole of canHit, which is why the rung that exists to absorb Meanies on
	   sight (game/bot2.ts's 0b) had never once fired in a thousand landscapes.
	 - Bare ground: walk the tile's own surface (AIM_OFFSETS).

	 Shared by the aim and by BotWorld.canHit deliberately. The planner's "can I hit that" must be
	 the same question the driver can actually answer, or one of them is wrong every time they
	 disagree: too strict and it declines work that was there for the taking, too loose and it
	 spends a second of the 1 Hz cadence aiming into a hillside.
	*/
	private aimCandidates(col: number, row: number, startY: number): AimPoint[] {
		const gridCol = col + 0.5;
		const gridRow = row + 0.5;
		const points: AimPoint[] = [{ gridCol, gridRow, y: startY }];
		const top = topObjectAt(this.sceneData.allObjects, col, row);
		if (top) {
			const extent = verticalExtent(top.occluder);
			for (const fraction of AIM_FRACTIONS) {
				const y = top.height + extent.min + (extent.max - extent.min) * fraction;
				if (Math.abs(y - startY) > 1e-6) points.push({ gridCol, gridRow, y });
			}
		} else {
			for (const [dCol, dRow] of AIM_OFFSETS) points.push({ gridCol: gridCol + dCol, gridRow: gridRow + dRow, y: startY });
		}
		return points;
	}

	/*
	 The point to aim at for this step, in fractional grid coordinates.

	 A *pre*-flight walk of the candidates above: pickAlong casts the ray the crosshair would cast
	 without turning the head first, so finding the opening costs microseconds instead of the second
	 of the 1 Hz cadence that turning, firing and missing costs. The post-turn verification in tick()
	 stays as the backstop — this only changes which shot is taken, never whether the result is
	 checked — and so does the retry ladder behind it, since the world can move between the two.
	*/
	private aimPointFor(step: BotStep): AimPoint {
		const candidates = this.aimCandidates(step.col, step.row, this.aimHeightFor(step));
		for (const point of candidates) {
			if (!this.reaches(point, step.col, step.row, step.action === 'transfer')) continue;
			if (point !== candidates[0]) logEvent('bot', 'aimAdjusted', { ...step, y: point.y, gridCol: point.gridCol });
			return point;
		}
		// Nothing on this cell is reachable. Aim at the first candidate anyway and let the
		// verification in tick() record the miss — the answer is the same, and it keeps one path
		// for "we missed".
		return candidates[0];
	}

	/*
	 Would the crosshair, pointed at this grid point, resolve on this cell?

	 Same ray, same filters, same resolution as the pick that will decide the action
	 (engine/picker.ts), so the two cannot disagree about what is reachable.
	*/
	private reaches(point: AimPoint, col: number, row: number, wantSynthoid = false): boolean {
		const world = new Vector3(point.gridCol, point.y, MAP_SIZE - 1 - point.gridRow);
		const pick = pickAlong(this.camera.position, world, this.sceneData);
		if (pick === null || pick.col !== col || pick.row !== row) return false;
		// A slope is refused outright by the rules (game/actions.ts), so reaching one is not reaching
		// the cell — that is precisely what the centre ray hits when a fold of ground is in the way.
		if (pick.kind === 'terrain' && pick.type === 'slope') return false;
		// A transfer needs the pick to BE the Synthoid, not merely to land on its cell: the pile it
		// stands on is at the same coordinates, and so is the ground under it.
		return !wantSynthoid || (pick.kind === 'object' && pick.gameObject instanceof Synthoid);
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
	const extent = verticalExtent(o.occluder);
	return {
		type: (o.constructor as typeof GameObject).type ?? GameObjType.TREE,
		col: o.col,
		row: o.row,
		height: o.height,
		aimHeight: o.height + (extent.min + extent.max) / 2,
	};
}
