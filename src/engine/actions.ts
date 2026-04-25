import { Raycaster, Vector2 } from 'three';
import type { PerspectiveCamera } from 'three';
import { Boulder, Pedestal, Sentinel, Meanie, Sentry, Synthoid, Tree } from '../world/objects';
import { GameObjType, rng256 } from '../world/terrain';
import { isCellVisible } from './visibility';
import { addObjectToScene, removeObjectFromScene, type SceneData } from './scene';
import type { InputManager } from './input';
import { game, spendEnergy, gainEnergy, beginTransfer, markSentinelAbsorbed, triggerWon } from '../game/state.svelte';
import { energyCostOf } from '../game/rules';
import { logEvent } from '../game/log';
import { GameObject, angleFacing, radToAngle256 } from '../world/objects/base';

// 256-step rot value so a synthoid at (col, row) faces the player camera. Used at
// player-driven spawn time (R / middle-click / hyperspace).
function rotFacingCamera(col: number, row: number, mapSize: number, camera: PerspectiveCamera): number {
	const camCol = camera.position.x;
	const camRow = mapSize - 1 - camera.position.z;
	return radToAngle256(angleFacing(col + 0.5, row + 0.5, camCol, camRow));
}

export type GameAction = 'create-synthoid' | 'create-boulder' | 'create-tree' | 'absorb' | 'transfer';

// Raycast from camera centre; returns the root scene object and its userData, skipping
// invisible objects (e.g. the active synthoid body) and items with no userData.col.
function pickTarget(
	camera: PerspectiveCamera,
	sceneData: SceneData
): { col: number; row: number; type: string } | null {
	const raycaster = new Raycaster();
	raycaster.setFromCamera(new Vector2(0, 0), camera);
	// recursive=true so face meshes inside game-object Groups are hit.
	const intersects = raycaster.intersectObjects(sceneData.scene.children, true);

	for (const hit of intersects) {
		let obj = hit.object;
		while (obj.parent !== sceneData.scene) obj = obj.parent!;
		// Skip invisible objects (the hidden active synthoid body).
		if (!obj.visible) continue;
		const ud = obj.userData as { col?: number; row?: number; type?: string };
		if (ud.col === undefined) continue;
		return { col: ud.col, row: ud.row!, type: ud.type! };
	}
	return null;
}

// Resolve a target via raycast and apply the requested action. Shared by both keyboard
// (handleKeyActions) and mouse (handleMouseAction) entry points.
function performTargetedAction(
	action: GameAction,
	camera: PerspectiveCamera,
	sceneData: SceneData,
	mapSize: number,
	time: number
): void {
	const target = pickTarget(camera, sceneData);
	if (!target || target.type === 'slope') return;

	const { col: targetCol, row: targetRow, type: targetType } = target;
	const { map, customColors, allObjects, scene } = sceneData;
	const vis = (c: number, r: number, yo?: number) => isCellVisible(camera, scene, map, mapSize, c, r, yo);

	if (action === 'create-synthoid') {
		if (!spendEnergy(3)) return;
		const rot = rotFacingCamera(targetCol, targetRow, mapSize, camera);
		const placed = addObjectToScene(Synthoid, time, targetCol, targetRow, rot, null, null, map, mapSize, customColors, allObjects, scene);
		if (!placed) gainEnergy(3, 'synthoid-blocked');
		else logEvent('action', 'createSynthoid', { col: targetCol, row: targetRow });
		return;
	}
	if (action === 'create-boulder') {
		if (!spendEnergy(2)) return;
		const placed = addObjectToScene(Boulder, time, targetCol, targetRow, rng256(), null, null, map, mapSize, customColors, allObjects, scene);
		if (!placed) gainEnergy(2, 'boulder-blocked');
		else logEvent('action', 'createBoulder', { col: targetCol, row: targetRow });
		return;
	}
	if (action === 'create-tree') {
		if (!spendEnergy(1)) return;
		const placed = addObjectToScene(Tree, time, targetCol, targetRow, rng256(), null, null, map, mapSize, customColors, allObjects, scene);
		if (!placed) gainEnergy(1, 'tree-blocked');
		else logEvent('action', 'createTree', { col: targetCol, row: targetRow });
		return;
	}
	if (action === 'absorb') {
		if (game.sentinelAbsorbed) {
			logEvent('action', 'absorbLocked');
			return;
		}
		const stack = allObjects.filter(o => o.col === targetCol && o.row === targetRow && !o.absorbedTime);
		if (stack.length === 0) return;
		const top = stack[stack.length - 1];
		const topType = (top.constructor as typeof GameObject).type;
		const removed = removeObjectFromScene(targetCol, targetRow, time, vis, allObjects);
		if (removed && topType !== null) {
			const gain = energyCostOf(topType);
			gainEnergy(gain, `absorb-${GameObjType[topType].toLowerCase()}`);
			logEvent('action', 'absorb', { col: targetCol, row: targetRow, type: GameObjType[topType], gain });
			if (topType === GameObjType.SENTINEL) markSentinelAbsorbed();
		}
		return;
	}
	if (action === 'transfer') {
		if (targetType !== 'SYNTHOID') return;
		if (vis(targetCol, targetRow)) {
			beginTransfer(targetCol, targetRow);
		} else {
			logEvent('action', 'transferFailed', { reason: 'notVisible', col: targetCol, row: targetRow });
		}
		return;
	}
}

// Pick a random unoccupied flat tile whose terrain height is ≤ maxHeight. Retries with
// the upper bound raised by 1 if nothing fits, until something does or we exceed the
// max terrain height (11). Returns null only if no flat empty tile exists at all.
function pickHyperspaceTile(
	map: number[],
	dim: number,
	allObjects: GameObject[],
	maxHeight: number
): { col: number; row: number } | null {
	let limit = maxHeight;
	while (limit <= 11) {
		const candidates: { col: number; row: number }[] = [];
		for (let r = 0; r < dim - 1; r++) {
			for (let c = 0; c < dim - 1; c++) {
				const h = map[r * dim + c];
				if (h > limit) continue;
				if (
					map[r * dim + c + 1] !== h ||
					map[(r + 1) * dim + c] !== h ||
					map[(r + 1) * dim + c + 1] !== h
				) continue;
				if (allObjects.some(o => o.col === c && o.row === r && !o.absorbedTime)) continue;
				candidates.push({ col: c, row: r });
			}
		}
		if (candidates.length > 0) return candidates[Math.floor(Math.random() * candidates.length)];
		limit++;
	}
	return null;
}

// Voluntary hyperspace: spend 3 energy, then either trigger the WON flow (if the active
// body is on a pedestal) or place a fresh synthoid on a random eligible tile and transfer.
function performHyperspace(camera: PerspectiveCamera, sceneData: SceneData, mapSize: number, time: number): void {
	if (!spendEnergy(3)) return;

	const { allObjects, map, customColors, scene, level } = sceneData;

	let activeCol = game.activeSynthoidCol;
	let activeRow = game.activeSynthoidRow;
	if (activeCol === null || activeRow === null) {
		const start = level.objects.find(o => o.type === GameObjType.SYNTHOID);
		if (!start) return;
		activeCol = start.x;
		activeRow = start.z;
	}

	const activeBody = allObjects.find(
		o => o instanceof Synthoid && o.col === activeCol && o.row === activeRow && !o.absorbedTime
	);
	if (!activeBody) return;

	if (allObjects.some(o => o instanceof Pedestal && o.col === activeCol && o.row === activeRow)) {
		logEvent('action', 'hyperspaceFromPedestal');
		triggerWon();
		return;
	}

	const target = pickHyperspaceTile(map, mapSize, allObjects, activeBody.height);
	if (!target) {
		logEvent('action', 'hyperspaceNoTile');
		return;
	}

	const rot = rotFacingCamera(target.col, target.row, mapSize, camera);
	const placed = addObjectToScene(
		Synthoid, time, target.col, target.row, rot, null, null,
		map, mapSize, customColors, allObjects, scene
	);
	if (!placed) {
		logEvent('action', 'hyperspaceFailed', { col: target.col, row: target.row });
		return;
	}

	logEvent('action', 'hyperspace', { col: target.col, row: target.row });
	beginTransfer(target.col, target.row);
}

export function handleKeyActions(
	input: InputManager,
	camera: PerspectiveCamera,
	sceneData: SceneData,
	mapSize: number,
	time: number
): void {
	if (input.consumeJustPressed('h')) performHyperspace(camera, sceneData, mapSize, time);

	if (input.consumeJustPressed('r')) performTargetedAction('create-synthoid', camera, sceneData, mapSize, time);
	if (input.consumeJustPressed('b')) performTargetedAction('create-boulder', camera, sceneData, mapSize, time);
	if (input.consumeJustPressed('t')) performTargetedAction('create-tree', camera, sceneData, mapSize, time);
	if (input.consumeJustPressed('u')) performTargetedAction('absorb', camera, sceneData, mapSize, time);
	if (input.consumeJustPressed(' ') || input.consumeJustPressed('Enter'))
		performTargetedAction('transfer', camera, sceneData, mapSize, time);
}

// Mouse bindings in PLAYING mode: left = absorb, middle = synthoid, right = boulder.
// No mouse shortcut for tree, transfer, or hyperspace by design.
export function handleMouseAction(
	button: number,
	camera: PerspectiveCamera,
	sceneData: SceneData,
	mapSize: number,
	time: number
): void {
	if (button === 0) performTargetedAction('absorb', camera, sceneData, mapSize, time);
	else if (button === 1) performTargetedAction('create-synthoid', camera, sceneData, mapSize, time);
	else if (button === 2) performTargetedAction('create-boulder', camera, sceneData, mapSize, time);
}

export function handleClick(
	event: MouseEvent,
	input: InputManager,
	camera: PerspectiveCamera,
	sceneData: SceneData,
	mapSize: number,
	lastTime: number
): void {
	const raycaster = new Raycaster();
	raycaster.setFromCamera(new Vector2(0, 0), camera);
	const intersects = raycaster.intersectObjects(sceneData.scene.children, true);

	for (const hit of intersects) {
		let obj = hit.object;
		while (obj.parent !== sceneData.scene) obj = obj.parent!;
		if (!obj.userData) return;

		const { col, row, type } = obj.userData as { col: number; row: number; type: string };
		const { map, customColors, allObjects, scene } = sceneData;
		const vis = (c: number, r: number, yo?: number) =>
			isCellVisible(camera, scene, map, mapSize, c, r, yo);

		if (event.button === 0) {
			if (!['plane', 'slope'].includes(type)) removeObjectFromScene(col, row, lastTime, vis, allObjects);
		} else if (event.button === 1) {
			if (type !== 'slope') {
				const cls = event.shiftKey ? Meanie : event.ctrlKey ? Sentinel : Synthoid;
				addObjectToScene(cls, lastTime, col, row, rng256(), null, null, map, mapSize, customColors, allObjects, scene);
			}
		} else if (event.button === 2) {
			if (type !== 'slope') {
				const cls = event.shiftKey ? Tree : event.ctrlKey ? Sentry : Boulder;
				addObjectToScene(cls, lastTime, col, row, rng256(), null, null, map, mapSize, customColors, allObjects, scene);
			}
		}
		break;
	}
}
