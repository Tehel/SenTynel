import { Vector3 } from 'three';
import type { Mesh } from 'three';
import { Boulder, Synthoid, Tree, Watcher, GameObject } from '../world/objects';
import { angle256ToRad } from '../world/objects/base';
import { GameObjType, MAP_SIZE } from '../world/terrain';
import { addObjectToScene, objectsAt, type SceneData } from './scene';
import { isCellVisibleFrom } from './visibility';
// The object's own model height, so "can it see the body" means the body and not a guessed constant.
import { verticalExtent } from './particles';
import { triggerMeanieConversion } from './meanie';
import { game, drainEnergy, setScanState } from '../game/state.svelte';
import { WATCHER_GRACE_MS } from '../game/timing';
import { logEvent } from '../game/log';
import { randomAngle256, randomInt } from '../game/random';

// 4 Hz turn driver × DRAIN_TICK_PERIOD = drain Hz. With period 4, drain fires at 1 Hz.
export const DRAIN_TICK_PERIOD = 4;

// Cone half-angle in radians — keep in sync with engine/cones.ts CONE_HALF_ANGLE_RAD.
const CONE_HALF_ANGLE_RAD = (10 / 128) * Math.PI;
// Watcher eye height above its base, matched to the cone overlay's top edge. Exported so the
// demo bot (engine/bot.ts) can ask "would a watcher see me standing there?" from the same eye
// this drain phase uses — a bot hiding from a slightly wrong eye height isn't hiding.
export const EYE_HEIGHT_LOCAL = 0.9;
// Drain pacing: target absorb takes the first half of the drain interval, the new spawn
// the second half. Both animations run at animationScale = 2 so the player's chosen
// absorb/spawn animation completes inside its half-second window.
const DRAIN_HALF_DURATION_MS = 500;
const DRAIN_ANIMATION_SCALE = 2;

/*
 Is (col, row) inside this watcher's cone as it is pointed right now?

 Extracted so the demo bot can ask the same question the drain phase asks — a bot modelling the
 threat with its own copy of this arithmetic would drift from the rule the moment either changed.
 Cone only: line of sight is a separate test (isCellVisibleFrom), and both must hold.
*/
export function inWatcherCone(watcher: { col: number; row: number; rot: number }, col: number, row: number): boolean {
	const theta = angle256ToRad(watcher.rot);
	const facing = new Vector3(Math.sin(theta), 0, Math.cos(theta));
	// Cell centres cancel out of the difference, and world z runs opposite to row.
	const toTarget = new Vector3(col - watcher.col, 0, -(row - watcher.row));
	if (toTarget.length() < 0.001) return false;
	return facing.angleTo(toTarget) <= CONE_HALF_ANGLE_RAD;
}

// Scratch state for one drain phase. ≤ 1 action per watcher, ≤ 1 drain per item.
interface DrainTickState {
	watchersActed: Set<GameObject>;
	itemsDrained: Set<GameObject>;
	// Scan-warning tally: watchers whose exclusive attention is the player, split by whether they can
	// see the square (drainable) or only the body (Meanie instead). Published as game.scanState.
	playerFull: number;
	playerPartial: number;
	// Longest-running stall among those 'full' watchers, so the UI ramps against the soonest drain.
	longestLockMs: number;
}

/*
 Target priority: synthoids, then boulders, then trees-on-boulders — nearest first WITHIN each class.

 Type beats distance, which is the half that staring at a single watcher never reveals. Three
 synthoids lined up on the Sentinel are taken in distance order, and the boulder the nearest one
 leaves behind is not touched until all three are gone, even though it is nearer than the second
 synthoid (RULES-FIDELITY.md C7).

 Ordering by descending energy value (3/2/1) yields the same sequence in every arrangement the game
 can build, so there is nothing to choose between the two models.
*/
function drainPriority(target: GameObject): number {
	if (target instanceof Synthoid) return 0;
	if (target instanceof Boulder) return 1;
	return 2;
}

// Is this the body the player currently occupies? Drains on it hit the energy pool rather than
// transforming it, and — unlike everything else — they stack across watchers.
function isPlayerBody(obj: GameObject): boolean {
	return obj instanceof Synthoid && obj.col === game.activeSynthoidCol && obj.row === game.activeSynthoidRow;
}

// Per cell, find the topmost item that's a valid drain target.
// - Synthoid (top of stack): always drainable (player body or shell).
// - Boulder (top of stack): always drainable.
// - Tree (top of stack): drainable ONLY when sitting directly on a boulder. Lone trees
//   on terrain are inert. This lets watchers chew through a `[Boulder, Tree]` stack:
//   first the tree, then (next tick) the boulder, conserving energy via the
//   spawn-elsewhere tree each time.
// Anything stacked UNDER a drain target is shielded — the topmost item is the only one
// the watcher acts on this tick.
function findDrainTarget(stack: GameObject[]): GameObject | null {
	if (stack.length === 0) return null;
	const top = stack[stack.length - 1];
	if (top instanceof Synthoid || top instanceof Boulder) return top;
	if (top instanceof Tree && stack.length >= 2 && stack[stack.length - 2] instanceof Boulder) return top;
	return null;
}

// Called by GameLoop at 1 Hz, only after the player's first action.
export function runDrainPhase(sceneData: SceneData, time: number): void {
	if (!game.firstActionTaken) return;

	const watchers = sceneData.allObjects.filter(
		(o): o is Watcher => o instanceof Watcher && o.absorbedTime === null
	);
	if (watchers.length === 0) {
		setScanState(0, 0, 0);
		return;
	}

	// Build candidates as one drain target per occupied cell — see findDrainTarget.
	// Iterating allObjects + a visited Set lets us skip rebuilding the stack array per
	// cell while still respecting topmost-only semantics.
	const candidates: GameObject[] = [];
	const visited = new Set<string>();
	for (const obj of sceneData.allObjects) {
		if (obj.absorbedTime !== null) continue;
		const key = `${obj.col}_${obj.row}`;
		if (visited.has(key)) continue;
		visited.add(key);
		const target = findDrainTarget(objectsAt(sceneData.allObjects, obj.col, obj.row));
		if (target) candidates.push(target);
	}

	const tick: DrainTickState = {
		watchersActed: new Set(),
		itemsDrained: new Set(),
		playerFull: 0,
		playerPartial: 0,
		longestLockMs: 0,
	};
	for (const watcher of watchers) {
		// "As long as a watcher has something to drain, it doesn't rotate." Note this tracks actually
		// DRAINING: a watcher still counting down its lock-on stall keeps turning on schedule, and
		// loses the target if its beam carries it away (RULES-FIDELITY.md C6).
		const drained = tryWatcherDrain(watcher, candidates, sceneData, tick, time);
		watcher.drainLocked = drained;
	}

	// Publish the scan warning unconditionally — passing zeroes is how the cue clears itself.
	setScanState(tick.playerFull, tick.playerPartial, tick.longestLockMs);
}

function tryWatcherDrain(
	watcher: Watcher,
	candidates: GameObject[],
	sceneData: SceneData,
	tick: DrainTickState,
	time: number
): boolean {
	if (tick.watchersActed.has(watcher)) return false;

	const eyePos = new Vector3(
		watcher.col + 0.5,
		watcher.height + EYE_HEIGHT_LOCAL,
		(MAP_SIZE - 1) - (watcher.row + 0.5)
	);
	const visibleTargets: { obj: GameObject; distance: number }[] = [];
	for (const cand of candidates) {
		// The one-drain-per-item cap stops two watchers morphing the same boulder twice in a tick.
		// It deliberately does NOT apply to the player's body: drains on the player CUMULATE, so
		// three watchers holding your square cost three energy a second (RULES-FIDELITY.md C6).
		if (!isPlayerBody(cand) && tick.itemsDrained.has(cand)) continue;
		if (cand.col === watcher.col && cand.row === watcher.row) continue;

		const toTarget = cand.object3D.position.clone().sub(watcher.object3D.position);
		toTarget.y = 0;
		const distance = toTarget.length();
		if (distance < 0.001) continue;
		if (!inWatcherCone(watcher, cand.col, cand.row)) continue;

		// LOS to the target's actual foot height (handles synthoids on boulder stacks).
		const yOffset = cand.height - sceneData.map[cand.row * MAP_SIZE + cand.col];
		const seeFrom = (offset: number) =>
			isCellVisibleFrom(
				eyePos,
				sceneData.scene,
				sceneData.map,
				MAP_SIZE,
				cand.col,
				cand.row,
				offset,
				watcher.col,
				watcher.row
			);

		let seen = seeFrom(yOffset);
		/*
		 THE PLAYER IS DETECTED BY THEIR HEAD, not only by their feet — which is what makes the
		 half-scan state (and therefore the whole Meanie mechanic) reachable at all.

		 Reported from play, 2026-08-17: a bare synthoid behind a slope with the Sentinel high enough
		 to see the body but not the cell under it produced no warning and no Meanie. The foot of a
		 synthoid on bare ground IS its square, so the test above answers the same question as the
		 square test below, and a hidden square meant the player was never selected as a target. The
		 sources describe exactly this state — "its head is visible but not the square it stands on" —
		 so it has to be reachable, and it only ever was when the player happened to be on boulders.

		 Deliberately limited to the player's body. For every other object, foot-height detection is
		 already the right question: it coincides with the surface rule the player absorbs under
		 (engine/scene.ts's canTargetTopObject), so a shell whose square is hidden is out of a
		 watcher's reach for the same reason it would be out of yours. Nothing in the sources suggests
		 a watcher can strip an object it can see but whose ground it cannot.
		*/
		if (!seen && isPlayerBody(cand)) seen = seeFrom(yOffset + verticalExtent(cand.object3D as Mesh).max);
		if (!seen) continue;

		visibleTargets.push({ obj: cand, distance });
	}

	if (visibleTargets.length === 0) {
		watcher.lockTarget = null;
		return false;
	}
	visibleTargets.sort((a, b) => drainPriority(a.obj) - drainPriority(b.obj) || a.distance - b.distance);
	const target = visibleTargets[0].obj;

	/*
	 The lock-on stall. Only synthoids get one — a boulder is taken on the tick it is seen.

	 Re-fixing on the same object continues its count; anything else restarts it, so losing and
	 re-acquiring costs the full grace again. The watcher is EXCLUSIVELY occupied for the duration —
	 it never looks past visibleTargets[0] — which is why a boulder standing behind a synthoid the
	 watcher is staring at survives untouched. That is the shield the rule exists to enable.
	*/
	if (target instanceof Synthoid) {
		if (watcher.lockTarget !== target) {
			watcher.lockTarget = target;
			watcher.lockStartedAt = time;
		}
	} else {
		watcher.lockTarget = null;
	}

	/*
	 Scan warning, recorded BEFORE the stall's early return below — a watcher counting down on you is
	 exactly the state worth warning about, and it is the state in which nothing has happened yet.
	 Ordering is load-bearing and I got it wrong once: report after the return and the cue only ever
	 appears at the moment it is already too late to act on.

	 The square test is the same one applyDrain needs to choose between draining the pool and spawning
	 a Meanie, so it is resolved once here and passed down.
	*/
	let playerTileVisible = false;
	if (isPlayerBody(target)) {
		playerTileVisible = isCellVisibleFrom(
			eyePos,
			sceneData.scene,
			sceneData.map,
			MAP_SIZE,
			target.col,
			target.row,
			0,
			watcher.col,
			watcher.row
		);
		if (playerTileVisible) {
			tick.playerFull++;
			tick.longestLockMs = Math.max(tick.longestLockMs, time - watcher.lockStartedAt);
		} else {
			tick.playerPartial++;
		}
	}

	// Still counting: no energy moves, and we report no drain, so the watcher keeps rotating and its
	// beam can carry it off the target and throw the count away.
	if (target instanceof Synthoid && time - watcher.lockStartedAt < WATCHER_GRACE_MS) return false;

	/*
	 A transfer is not a shield (RULES-FIDELITY.md C8). The lock above has been running on the body
	 the player is gliding into, so the stall elapses in transit and the drain lands on arrival, which
	 is what the original does. Only the EFFECT is deferred, and only for the destination: without
	 that the shell could finish morphing into a boulder around the camera mid-glide.
	*/
	if (game.phase === 'TRANSFER' && target.col === game.activeSynthoidCol && target.row === game.activeSynthoidRow)
		return false;

	applyDrain(watcher, target, sceneData, tick, time, playerTileVisible);
	return true;
}

/*
 `playerTileVisible` is resolved by the caller — it needs the same answer for the scan warning, before
 the stall can return early — rather than recomputed here. One raycast, one answer, and no way for
 the cue and the effect to disagree about what the watcher can see.
*/
function applyDrain(
	watcher: Watcher,
	target: GameObject,
	sceneData: SceneData,
	tick: DrainTickState,
	time: number,
	playerTileVisible: boolean
): void {
	tick.watchersActed.add(watcher);
	tick.itemsDrained.add(target);

	// The player's active body is treated specially: pool drain (if tile visible) or
	// Meanie conversion trigger (if only the body is visible). The body itself is never
	// transformed in either branch. game.activeSynthoidCol/Row is seeded by MainView's
	// Effect 3a (setStartingSynthoid) before PLAYING is reachable, then kept current by
	// beginTransfer() — no fallback needed here.
	if (isPlayerBody(target)) {
		if (playerTileVisible) {
			drainEnergy(1, 'watcher-pool');
			game.drainPulseAt = performance.now();
			logEvent('ai', 'playerPoolDrained', { col: target.col, row: target.row });
			spawnConservationTree(sceneData, time);
		} else {
			// Body visible, tile occluded — convert the closest tree to a Meanie.
			// Energy is conserved by the conversion itself (tree → meanie, both 1),
			// so no separate conservation tree is spawned.
			triggerMeanieConversion(sceneData, target, time);
		}
		return;
	}

	// Non-player items: drain transforms by tier, animated at 2× speed (500 ms each
	// for absorb + spawn = the 1 s drain interval).
	// Synthoid (3) → Boulder (2): absorb the synthoid, spawn a boulder 500 ms later.
	// Boulder (2) → Tree (1): same pattern; spawn may still fail on awkward stacks.
	// Tree (only drainable when sitting on a boulder) → absorb only; no spawn at this
	// cell. The boulder underneath becomes drainable next tick.
	if (target instanceof Synthoid) {
		startDrainAbsorb(target, time);
		scheduleDrainSpawn(sceneData, target.col, target.row, GameObjType.BOULDER, time);
		logEvent('ai', 'drained', { col: target.col, row: target.row, from: 'SYNTHOID', to: 'BOULDER' });
	} else if (target instanceof Boulder) {
		startDrainAbsorb(target, time);
		scheduleDrainSpawn(sceneData, target.col, target.row, GameObjType.TREE, time);
		logEvent('ai', 'drained', { col: target.col, row: target.row, from: 'BOULDER', to: 'TREE' });
	} else {
		// Tree on a boulder.
		startDrainAbsorb(target, time);
		logEvent('ai', 'drained', { col: target.col, row: target.row, from: 'TREE', to: null });
	}
	spawnConservationTree(sceneData, time);
}

// Kick off the absorb animation on `target` at 2× speed so it completes in 500 ms.
function startDrainAbsorb(target: GameObject, time: number): void {
	target.animationScale = DRAIN_ANIMATION_SCALE;
	target.remove(time);
}

// Queue a spawn for 500 ms from now — by then the target's animated absorb has
// finished and the GameLoop's play() loop has spliced it out, leaving the cell empty
// for the new object's stacking check to pass.
function scheduleDrainSpawn(
	sceneData: SceneData,
	col: number,
	row: number,
	newType: GameObjType,
	time: number
): void {
	const cls = newType === GameObjType.BOULDER ? Boulder : Tree;
	const rot = newType === GameObjType.BOULDER ? 0 : randomAngle256();
	const spawnAt = time + DRAIN_HALF_DURATION_MS;
	sceneData.deferredSpawns.push({
		executeAt: spawnAt,
		spawn: () => {
			const placed = addObjectToScene(sceneData, cls, {
				col,
				row,
				rot,
				time: spawnAt,
				animationScale: DRAIN_ANIMATION_SCALE,
			});
			if (!placed) {
				// Stacking rejected the spawn — e.g. another object landed at this cell
				// during the absorb's half-second window. Energy isn't conserved here;
				// logged for diagnostics.
				logEvent('ai', 'morphPlacementFailed', { col, row, newType: GameObjType[newType] });
			}
		},
	});
}

// Conservation tree: every successful drain spawns a fresh Tree on a random empty flat
// tile. Animated at 2× speed to match the drain pacing. Skipped (with a log entry) if
// no eligible tile exists.
function spawnConservationTree(sceneData: SceneData, time: number): void {
	const tile = pickEmptyFlatTile(sceneData.map, sceneData.allObjects);
	if (!tile) {
		logEvent('ai', 'conservationTreeSkipped', { reason: 'no eligible tile' });
		return;
	}
	addObjectToScene(sceneData, Tree, {
		col: tile.col,
		row: tile.row,
		rot: randomAngle256(),
		time,
		animationScale: DRAIN_ANIMATION_SCALE,
	});
}

function pickEmptyFlatTile(map: number[], allObjects: GameObject[]): { col: number; row: number } | null {
	const candidates: { col: number; row: number }[] = [];
	for (let r = 0; r < MAP_SIZE - 1; r++) {
		for (let c = 0; c < MAP_SIZE - 1; c++) {
			const h = map[r * MAP_SIZE + c];
			if (
				map[r * MAP_SIZE + c + 1] !== h ||
				map[(r + 1) * MAP_SIZE + c] !== h ||
				map[(r + 1) * MAP_SIZE + c + 1] !== h
			)
				continue;
			if (allObjects.some(o => o.col === c && o.row === r && o.absorbedTime === null)) continue;
			candidates.push({ col: c, row: r });
		}
	}
	return candidates.length > 0 ? candidates[randomInt(candidates.length)] : null;
}
