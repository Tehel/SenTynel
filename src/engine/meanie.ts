import { Vector3 } from 'three';
import { GameObject, Meanie, Synthoid, Tree } from '../world/objects';
import { angle256ToRad, angleFacing, radToAngle256 } from '../world/objects/base';
import { GameObjType, MAP_SIZE } from '../world/terrain';
import { addObjectToScene, objectsAt, type SceneData } from './scene';
import { isCellVisibleFrom } from './visibility';
import { game, drainEnergy, beginTransfer } from '../game/state.svelte';
import { logEvent } from '../game/log';
import { pickHyperspaceTile } from '../game/actions';

// Match the watcher drain pacing — tree absorb (500 ms) followed 500 ms later by
// the meanie spawn, both at animationScale = 2.
const DRAIN_HALF_DURATION_MS = 500;
const DRAIN_ANIMATION_SCALE = 2;

// 256-step circle; meanies rotate up to 16 units (~22.5°) per 4 Hz tick = 90°/s.
// Faster than Sentinels but slow enough that the player has time to break LOS.
const MEANIE_ROT_STEP_PER_TICK = 16;

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

	let activeCol = game.activeSynthoidCol;
	let activeRow = game.activeSynthoidRow;
	if (activeCol === null || activeRow === null) {
		const start = sceneData.level.objects.find(o => o.type === GameObjType.SYNTHOID);
		if (!start) return;
		activeCol = start.x;
		activeRow = start.z;
	}
	const body = objectsAt(sceneData.allObjects, activeCol, activeRow).find(
		(o): o is Synthoid => o instanceof Synthoid
	);
	if (!body) return;

	for (const meanie of meanies) {
		updateMeanie(meanie, body, sceneData, time);
	}
}

function updateMeanie(meanie: Meanie, body: Synthoid, sceneData: SceneData, time: number): void {
	const targetTheta = angleFacing(
		meanie.col + 0.5,
		meanie.row + 0.5,
		body.col + 0.5,
		body.row + 0.5
	);
	const targetRot = radToAngle256(targetTheta);
	const diff = signedRot256Diff(meanie.rot, targetRot);

	if (Math.abs(diff) > MEANIE_ROT_STEP_PER_TICK) {
		// Still rotating into position.
		const step = Math.sign(diff) * MEANIE_ROT_STEP_PER_TICK;
		meanie.rot = (((meanie.rot + step) % 256) + 256) % 256;
		meanie.object3D.rotation.y = angle256ToRad(meanie.rot);
		return;
	}

	// Aimed at the player — snap to exact bearing and run the LOS check.
	meanie.rot = targetRot;
	meanie.object3D.rotation.y = targetTheta;

	const eyePos = new Vector3(
		meanie.col + 0.5,
		meanie.height + EYE_HEIGHT_LOCAL,
		MAP_SIZE - 1 - (meanie.row + 0.5)
	);
	const yOffset = body.height - sceneData.map[body.row * MAP_SIZE + body.col];
	const visible = isCellVisibleFrom(
		eyePos,
		sceneData.scene,
		sceneData.map,
		MAP_SIZE,
		body.col,
		body.row,
		yOffset,
		meanie.col,
		meanie.row
	);
	if (visible) forceHyperspace(sceneData, body, time);
}

// Shortest signed delta from `from` to `to` on the 256-step circle. Result in (-128, 128].
function signedRot256Diff(from: number, to: number): number {
	let d = (to - from + 256) % 256;
	if (d > 128) d -= 256;
	return d;
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
