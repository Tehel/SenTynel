import { Vector3 } from 'three';
import { GameObject, Meanie, Synthoid, Tree } from '../world/objects';
import { angle256ToRad } from '../world/objects/base';
import { MAP_SIZE } from '../world/terrain';
import { addObjectToScene, objectsAt, type SceneData } from './scene';
import { isCellVisibleFrom } from './visibility';
// The same cone predicate the watchers use, rather than a second copy of the arithmetic here.
import { inWatcherCone } from './watcher';
import { game, drainEnergy, beginTransfer } from '../game/state.svelte';
import { logEvent } from '../game/log';
import { randomAngle256 } from '../game/random';
import { pickHyperspaceTile } from '../game/actions';

// Match the watcher drain pacing — tree absorb (500 ms) followed 500 ms later by
// the meanie spawn, both at animationScale = 2.
const DRAIN_HALF_DURATION_MS = 500;
const DRAIN_ANIMATION_SCALE = 2;

// 256-step circle; meanies rotate 16 units (~22.5°) per 4 Hz tick = 90°/s.
// Faster than Sentinels but slow enough that the player has time to break LOS.
const MEANIE_ROT_STEP_PER_TICK = 16;
// One full turn — the Meanie's entire lifetime if it never sights the player's square. At the step
// above that is 16 ticks, four seconds.
const FULL_SWEEP_UNITS = 256;

// Eye height matches the cone overlay / watcher conventions.
const EYE_HEIGHT_LOCAL = 0.9;

// Called from watcher.ts when a Sentinel/Sentry sees the player's body but its base
// tile is occluded (player on a boulder stack tall enough to hide the foot). Picks
// the live tree closest to the player and animates tree → Meanie at the same pacing
// the drain morphs use. No conservation tree spawns — the consumed tree's energy is
// what the Meanie carries (both are energy 1, net zero).
export function triggerMeanieConversion(
	sceneData: SceneData,
	playerBody: GameObject,
	time: number
): void {
	/*
	 ONE Meanie at a time. The condition that calls this holds on every 1 Hz drain tick for as long
	 as the player keeps their square hidden, and without this guard each of those ticks converted
	 another tree — with the conservation-tree mechanic obligingly manufacturing replacements. Ten
	 seconds of hiding was ten Meanies where the original makes one.

	 There is a theoretical window between the trigger and the deferred spawn 500 ms later in which no
	 Meanie is in allObjects yet. It is unreachable in practice: the caller runs at 1 Hz, so the next
	 opportunity is 500 ms after the Meanie has already appeared.
	*/
	if (sceneData.allObjects.some(o => o instanceof Meanie && o.absorbedTime === null)) {
		logEvent('ai', 'meanieConversionSkipped', { reason: 'one already active' });
		return;
	}

	const trees = sceneData.allObjects.filter(
		(o): o is Tree => o instanceof Tree && o.absorbedTime === null
	);
	if (trees.length === 0) {
		logEvent('ai', 'meanieConversionNoTree');
		return;
	}

	let closest: Tree | null = null;
	let closestDistSq = Infinity;
	for (const t of trees) {
		const dCol = t.col - playerBody.col;
		const dRow = t.row - playerBody.row;
		const d = dCol * dCol + dRow * dRow;
		if (d < closestDistSq) {
			closestDistSq = d;
			closest = t;
		}
	}
	if (!closest) return;

	const { col, row } = closest;
	logEvent('ai', 'meanieConversion', { col, row });
	closest.animationScale = DRAIN_ANIMATION_SCALE;
	closest.remove(time);

	const spawnAt = time + DRAIN_HALF_DURATION_MS;
	sceneData.deferredSpawns.push({
		executeAt: spawnAt,
		col,
		row,
		spawn: () => {
			const placed = addObjectToScene(sceneData, Meanie, {
				col,
				row,
				rot: 0,
				time: spawnAt,
				animationScale: DRAIN_ANIMATION_SCALE,
			});
			if (!placed) logEvent('ai', 'meanieSpawnFailed', { col, row });
		},
	});
}

// Called every game tick (4 Hz) from GameLoop. Each ready Meanie rotates by up to
// MEANIE_ROT_STEP_PER_TICK toward the player; once it's aimed, an LOS check forces
// a hyperspace if the player's tile is visible.
export function runMeaniePhase(sceneData: SceneData, time: number): void {
	if (!game.firstActionTaken) return;
	if (game.phase !== 'PLAYING') return;

	const meanies = sceneData.allObjects.filter(
		(o): o is Meanie => o instanceof Meanie && o.absorbedTime === null && o.ready
	);
	if (meanies.length === 0) return;

	// Seeded by MainView's Effect 3a (setStartingSynthoid) before PLAYING is reachable, then
	// kept current by beginTransfer() — no fallback needed here.
	const activeCol = game.activeSynthoidCol;
	const activeRow = game.activeSynthoidRow;
	if (activeCol === null || activeRow === null) return;
	const body = objectsAt(sceneData.allObjects, activeCol, activeRow).find(
		(o): o is Synthoid => o instanceof Synthoid
	);
	if (!body) return;

	for (const meanie of meanies) {
		updateMeanie(meanie, body, sceneData, time);
	}
}

/*
 One tick of a Meanie: sweep, then look.

 It SWEEPS at a fixed rate in a fixed direction rather than turning to face the player. That is the
 difference between a threat and a certainty — a turret tracking you acquires any bearing in about
 two seconds and re-acquires as you move, where a sweeping one can be dodged by breaking its
 sightline, which is the counter-play the original intends. (Its direction is fixed rather than
 randomised; nothing in the sources says it varies, and one fewer variable is one fewer thing to
 reproduce when a report comes in from watching the demo.)

 What it looks FOR is the player's SQUARE, not their body. That matters precisely because its parent
 spawned it for failing that same test: a Meanie is trying to get an angle the watcher could not, and
 one that fires on the body would go off instantly on the very situation it exists to solve.
*/
function updateMeanie(meanie: Meanie, body: Synthoid, sceneData: SceneData, time: number): void {
	meanie.rot = (meanie.rot + MEANIE_ROT_STEP_PER_TICK) % 256;
	meanie.object3D.rotation.y = angle256ToRad(meanie.rot);
	meanie.sweptUnits += MEANIE_ROT_STEP_PER_TICK;

	// Cone first, same predicate the watchers use, then line of sight to the square (yOffset 0).
	if (inWatcherCone(meanie, body.col, body.row)) {
		const eyePos = new Vector3(
			meanie.col + 0.5,
			meanie.height + EYE_HEIGHT_LOCAL,
			MAP_SIZE - 1 - (meanie.row + 0.5)
		);
		const squareVisible = isCellVisibleFrom(
			eyePos,
			sceneData.scene,
			sceneData.map,
			MAP_SIZE,
			body.col,
			body.row,
			0,
			meanie.col,
			meanie.row
		);
		if (squareVisible) {
			forceHyperspace(sceneData, body, time);
			return;
		}
	}

	// One full turn and no sighting: give up and become a tree again, handing the landscape back to
	// its parent watcher. Energy is conserved by the reversion itself (meanie 1 → tree 1).
	if (meanie.sweptUnits >= FULL_SWEEP_UNITS) revertToTree(meanie, sceneData, time);
}

// A Meanie that has swept a full circle without finding the player's square turns back into a tree,
// at the same pacing the conversion used. See updateMeanie.
function revertToTree(meanie: Meanie, sceneData: SceneData, time: number): void {
	const { col, row } = meanie;
	logEvent('ai', 'meanieReverted', { col, row });
	meanie.animationScale = DRAIN_ANIMATION_SCALE;
	meanie.remove(time);

	const spawnAt = time + DRAIN_HALF_DURATION_MS;
	sceneData.deferredSpawns.push({
		executeAt: spawnAt,
		col,
		row,
		spawn: () => {
			const placed = addObjectToScene(sceneData, Tree, {
				col,
				row,
				rot: randomAngle256(),
				time: spawnAt,
				animationScale: DRAIN_ANIMATION_SCALE,
			});
			if (!placed) logEvent('ai', 'meanieRevertSpawnFailed', { col, row });
		},
	});
}

// Forced hyperspace from a Meanie sighting. Drains the standard 3-energy cost (passive,
// can push the player to LOST), then teleports to a random eligible tile.
function forceHyperspace(sceneData: SceneData, body: Synthoid, time: number): void {
	logEvent('ai', 'meanieForcedHyperspace', { col: body.col, row: body.row });
	drainEnergy(3, 'meanie-forced-hyperspace');
	if (game.phase === 'LOST') return;

	const target = pickHyperspaceTile(sceneData.map, sceneData.allObjects, body.height);
	if (!target) {
		logEvent('ai', 'forcedHyperspaceNoTile');
		return;
	}
	const placed = addObjectToScene(sceneData, Synthoid, {
		col: target.col,
		row: target.row,
		rot: 0,
		time,
	});
	if (!placed) {
		logEvent('ai', 'forcedHyperspaceSpawnFailed', { col: target.col, row: target.row });
		return;
	}
	beginTransfer(target.col, target.row);
}
