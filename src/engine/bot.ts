import type { PerspectiveCamera, Mesh } from 'three';
import type { CameraController } from './camera';
import { easeInOutCubic } from './camera';
import type { SceneData } from './scene';
import type { GameAction } from '../game/actions';
import { GameObject, Tree } from '../world/objects';
import { MAP_SIZE } from '../world/terrain';
import { performEngineAction } from './actions';
import { isCellVisible } from './visibility';
import { verticalExtent } from './particles';
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

// One thing the bot intends to do: an action, and the cell (and height) to aim at first.
interface BotStep {
	action: GameAction;
	col: number;
	row: number;
	targetY?: number;
	label: string;
}

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

// Aim at the middle of an object's own silhouette rather than its base — the raycast then has
// the whole model to hit instead of skimming its foot. Uses the mesh's real bounding box, so it
// works unchanged for a synthoid on a 7-boulder stack.
function aimHeightOf(obj: GameObject): number {
	const extent = verticalExtent(obj.object3D as Mesh);
	return obj.height + (extent.min + extent.max) / 2;
}

// Shortest signed angular distance from a to b, in (-π, π].
function shortestAngleDelta(a: number, b: number): number {
	return ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

// Drives the game as a virtual player: it aims the real camera at a rate limit and then fires
// the same engine action path a human's click does, so every energy, placement, line-of-sight
// and cooldown rule applies to it unchanged. Its *planning* is omniscient (it reads the level
// data directly, there is no fog of war), but its *execution* has to earn every action.
//
// Phase D1 behaviour: absorb the trees it can see, nearest first. The step machinery below is
// the shape the D2/D3 planner plugs into.
export class BotDriver {
	// Cells whose step failed on execution. A step is only ever rejected for reasons that don't
	// change while the bot stands still (no line of sight, blocked placement), so retrying the
	// same target from the same spot would spin forever. Cleared whenever the body moves.
	private failed = new Set<string>();
	private step: BotStep | null = null;
	private turn: BotTurn | null = null;
	private settledFrames = 0;
	private lastBodyKey = '';

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
			this.step = this.chooseStep();
			this.settledFrames = 0;
			if (!this.step) return;
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
		if (!performEngineAction(step.action, this.camera, this.sceneData, time)) {
			this.failed.add(cellKey(step.col, step.row));
			logEvent('bot', 'stepFailed', { ...step });
		}
	}

	// Plan the head turn toward a step's target. Duration comes from the larger of the two axis
	// deltas, and both axes then run on that one clock — so the head sweeps a straight arc and
	// arrives on both axes together, rather than finishing yaw and then tilting.
	private beginTurn(step: BotStep): BotTurn | null {
		const aim = this.camCtrl.aimAnglesFor(step.col, step.row, step.targetY);
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

	// D1: the nearest tree that's actually absorbable from where we stand. The line-of-sight
	// test is the same one the absorb rule applies (engine/scene.ts's removeObjectFromScene
	// takes it as visibilityCheck), so a step that passes here should also pass on execution —
	// pre-filtering just saves burning a 1 Hz slot to discover otherwise.
	private chooseStep(): BotStep | null {
		const { allObjects, map, scene } = this.sceneData;
		const candidates = allObjects
			.filter(o => o instanceof Tree && o.absorbedTime === null && !this.failed.has(cellKey(o.col, o.row)))
			.map(o => ({
				obj: o,
				distance: Math.hypot(o.col + 0.5 - this.camCtrl.posCol, o.row + 0.5 - this.camCtrl.posRow),
			}))
			.sort((a, b) => a.distance - b.distance);

		for (const { obj } of candidates) {
			if (!isCellVisible(this.camera, scene, map, MAP_SIZE, obj.col, obj.row)) continue;
			return {
				action: 'absorb',
				col: obj.col,
				row: obj.row,
				targetY: aimHeightOf(obj),
				label: 'absorb tree',
			};
		}
		return null;
	}
}
