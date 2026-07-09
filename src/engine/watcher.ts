import { Vector3 } from 'three';
import { Boulder, Synthoid, Tree, Watcher, GameObject } from '../world/objects';
import { angle256ToRad } from '../world/objects/base';
import { GameObjType, MAP_SIZE } from '../world/terrain';
import { addObjectToScene, objectsAt, type SceneData } from './scene';
import { isCellVisibleFrom } from './visibility';
import { triggerMeanieConversion } from './meanie';
import { game, drainEnergy } from '../game/state.svelte';
import { logEvent } from '../game/log';

// 4 Hz turn driver × DRAIN_TICK_PERIOD = drain Hz. With period 4, drain fires at 1 Hz.
export const DRAIN_TICK_PERIOD = 4;

// Cone half-angle in radians — keep in sync with engine/cones.ts CONE_HALF_ANGLE_RAD.
const CONE_HALF_ANGLE_RAD = (10 / 128) * Math.PI;
// Watcher eye height above its base, matched to the cone overlay's top edge.
const EYE_HEIGHT_LOCAL = 0.9;
// Drain pacing: target absorb takes the first half of the drain interval, the new spawn
// the second half. Both animations run at animationScale = 2 so the player's chosen
// absorb/spawn animation completes inside its half-second window.
const DRAIN_HALF_DURATION_MS = 500;
const DRAIN_ANIMATION_SCALE = 2;

// Scratch state for one drain phase. ≤ 1 action per watcher, ≤ 1 drain per item.
interface DrainTickState {
	watchersActed: Set<GameObject>;
	itemsDrained: Set<GameObject>;
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
	if (watchers.length === 0) return;

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

	const tick: DrainTickState = { watchersActed: new Set(), itemsDrained: new Set() };
	for (const watcher of watchers) {
		// "As long as a watcher has something to drain, it doesn't rotate." A watcher
		// that consumed an action this tick (drain or meanie trigger) freezes its
		// rotation timer until the first tick it has no target.
		const acted = tryWatcherDrain(watcher, candidates, sceneData, tick, time);
		watcher.drainLocked = acted;
	}
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
	const theta = angle256ToRad(watcher.rot);
	const facing = new Vector3(Math.sin(theta), 0, Math.cos(theta));

	const visibleTargets: { obj: GameObject; distance: number }[] = [];
	for (const cand of candidates) {
		if (tick.itemsDrained.has(cand)) continue;
		if (cand.col === watcher.col && cand.row === watcher.row) continue;

		const toTarget = cand.object3D.position.clone().sub(watcher.object3D.position);
		toTarget.y = 0;
		const distance = toTarget.length();
		if (distance < 0.001) continue;
		if (facing.angleTo(toTarget) > CONE_HALF_ANGLE_RAD) continue;

		// LOS to the target's actual foot height (handles synthoids on boulder stacks).
		const yOffset = cand.height - sceneData.map[cand.row * MAP_SIZE + cand.col];
		if (
			!isCellVisibleFrom(
				eyePos,
				sceneData.scene,
				sceneData.map,
				MAP_SIZE,
				cand.col,
				cand.row,
				yOffset,
				watcher.col,
				watcher.row
			)
		)
			continue;

		visibleTargets.push({ obj: cand, distance });
	}

	if (visibleTargets.length === 0) return false;
	// Closest-first selection. TODO: compare against the original game's order when a
	// reference is available.
	visibleTargets.sort((a, b) => a.distance - b.distance);
	const target = visibleTargets[0].obj;

	applyDrain(watcher, target, eyePos, sceneData, tick, time);
	return true;
}

function applyDrain(
	watcher: Watcher,
	target: GameObject,
	eyePos: Vector3,
	sceneData: SceneData,
	tick: DrainTickState,
	time: number
): void {
	tick.watchersActed.add(watcher);
	tick.itemsDrained.add(target);

	// The player's active body is treated specially: pool drain (if tile visible) or
	// Meanie conversion trigger (if only the body is visible). The body itself is never
	// transformed in either branch. game.activeSynthoidCol/Row is seeded by MainView's
	// Effect 3a (setStartingSynthoid) before PLAYING is reachable, then kept current by
	// beginTransfer() — no fallback needed here.
	const isPlayerBody =
		target instanceof Synthoid &&
		target.col === game.activeSynthoidCol &&
		target.row === game.activeSynthoidRow;

	if (isPlayerBody) {
		const tileVisible = isCellVisibleFrom(
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
		if (tileVisible) {
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
	const rot = newType === GameObjType.BOULDER ? 0 : Math.floor(Math.random() * 256);
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
		rot: Math.floor(Math.random() * 256),
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
	return candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : null;
}
