import { Vector3, type PerspectiveCamera, type Mesh } from 'three';
import type { CameraController } from './camera';
import { EYE_HEIGHT, easeInOutCubic } from './camera';
import { canPlaceAt, objectsAt, type SceneData } from './scene';
import { EYE_HEIGHT_LOCAL } from './watcher';
import { GameObject, Watcher } from '../world/objects';
import { GameObjType, MAP_SIZE } from '../world/terrain';
import { performEngineActionOn } from './actions';
import { pickTarget } from './picker';
import { isCellVisibleFrom } from './visibility';
import { verticalExtent } from './particles';
import { computeHopField, findAssaultTile, planNextStep, type AssaultPlan, type BotObject, type BotStep, type BotWorld } from '../game/bot';
import { game, canPerformAction } from '../game/state.svelte';
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

// Shortest signed angular distance from a to b, in (-π, π].
function shortestAngleDelta(a: number, b: number): number {
	return ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

// World-space eye position for a body standing on (col, row) with its feet at standHeight.
// Matches CameraController's grid↔world mapping exactly; getting this wrong would have the bot
// planning against a world it isn't actually standing in.
const eyeAt = (col: number, row: number, standHeight: number) =>
	new Vector3(col + 0.5, standHeight + EYE_HEIGHT, MAP_SIZE - 1 - (row + 0.5));

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
			if (!this.step) {
				this.nextPlanAt = time + IDLE_REPLAN_MS;
				return;
			}
			logEvent('bot', 'step', { ...this.step });
			this.turn = this.beginTurn(this.step);
			// No bearing to the target (it's underfoot) — nothing to aim at, so drop it.
			if (!this.turn) {
				this.failed.add(cellKey(this.step.col, this.step.row));
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
		const pick = pickTarget(this.camera, this.sceneData);
		if (!pick || pick.col !== step.col || pick.row !== step.row) {
			this.failed.add(cellKey(step.col, step.row));
			logEvent('bot', 'aimMissed', {
				...step,
				hit: pick ? `${pick.kind}@${pick.col}_${pick.row}` : 'nothing',
			});
			return;
		}
		if (!performEngineActionOn(step.action, pick, this.camera, this.sceneData, time)) {
			this.failed.add(cellKey(step.col, step.row));
			logEvent('bot', 'stepFailed', { ...step });
		}
	}

	private chooseStep(): BotStep | null {
		const world = this.buildWorld();
		if (!this.surveyed) {
			this.surveyed = true;
			this.assault = findAssaultTile(world);
			if (this.assault) this.hopField = computeHopField(world, this.assault);
			logEvent('bot', 'survey', { ...this.assault, reachableTiles: this.hopField.size });
		}
		return planNextStep(world, this.assault, this.hopField);
	}

	// Snapshot the live scene into the planner's view of it. Cheap by design: the two expensive
	// operations (line of sight, watcher exposure) are callbacks, so they only cost anything for
	// the tiles the planner actually asks about.
	private buildWorld(): BotWorld {
		const { allObjects, map, level, scene } = this.sceneData;
		this.watchedCache.clear();

		const active = allObjects.filter(o => o.absorbedTime === null);
		const objects = active.map(toBotObject);
		const watchers = active.filter((o): o is Watcher => o instanceof Watcher);

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
				const watched = watchers.some(w =>
					isCellVisibleFrom(
						new Vector3(w.col + 0.5, w.height + EYE_HEIGHT_LOCAL, MAP_SIZE - 1 - (w.row + 0.5)),
						scene,
						map,
						MAP_SIZE,
						col,
						row,
						0,
						w.col,
						w.row
					)
				);
				this.watchedCache.set(key, watched);
				return watched;
			},
			isBlocked: (col, row) => this.failed.has(cellKey(col, row)),
			energy: game.energy,
			body,
			previousBody:
				game.previousSynthoidCol !== null && game.previousSynthoidRow !== null
					? { col: game.previousSynthoidCol, row: game.previousSynthoidRow }
					: null,
			sentinelAbsorbed: game.sentinelAbsorbed,
		};
	}

	// Plan the head turn toward a step's target. Duration comes from the larger of the two axis
	// deltas, and both axes then run on that one clock — so the head sweeps a straight arc and
	// arrives on both axes together, rather than finishing yaw and then tilting.
	private beginTurn(step: BotStep): BotTurn | null {
		const aim = this.camCtrl.aimAnglesFor(step.col, step.row, step.aimHeight);
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
