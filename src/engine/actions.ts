import type { PerspectiveCamera } from 'three';
import { Boulder, GameObject, Meanie, Pedestal, Sentinel, Sentry, Synthoid, Tree } from '../world/objects';
import { GameObjType, MAP_SIZE, rng256 } from '../world/terrain';
import { angleFacing, radToAngle256 } from '../world/objects/base';
import { isCellVisible } from './visibility';
import { addObjectToScene, canPlaceAt, removeObjectFromScene, objectsAt, type GameObjectCtor, type SceneData } from './scene';
import { pickTarget } from './picker';
import type { InputManager } from './input';
import { game, canPerformAction, markActionPerformed } from '../game/state.svelte';
import {
	performHyperspace,
	performTargetedAction,
	type ActionContext,
	type GameAction,
} from '../game/actions';

// Bird's-eye trigger: a left-click that hits nothing (true empty sky) while looking up
// steeper than this. Kept separate from the mouse-button dispatch table below since it's a
// view/state transition, not a targeted game action — no energy cost, no cooldown.
const BIRDSEYE_TRIGGER_ANGLE_RAD = (30 * Math.PI) / 180;

export function isBirdsEyeTrigger(camera: PerspectiveCamera, sceneData: SceneData, cameraVertical: number): boolean {
	return cameraVertical > BIRDSEYE_TRIGGER_ANGLE_RAD && pickTarget(camera, sceneData) === null;
}

const CTOR_BY_TYPE: Record<GameObjType, GameObjectCtor> = {
	[GameObjType.SENTINEL]: Sentinel,
	[GameObjType.SENTRY]: Sentry,
	[GameObjType.MEANIE]: Meanie,
	[GameObjType.PEDESTAL]: Pedestal,
	[GameObjType.TREE]: Tree,
	[GameObjType.SYNTHOID]: Synthoid,
	[GameObjType.BOULDER]: Boulder,
};

// Build the engine adaptor that backs the game-rules ActionContext for one frame.
function buildActionContext(camera: PerspectiveCamera, sceneData: SceneData): ActionContext {
	const { allObjects, map, scene, level } = sceneData;
	const isVisible = (c: number, r: number, yo?: number) =>
		isCellVisible(camera, scene, map, MAP_SIZE, c, r, yo);

	const rotFacingCamera = (col: number, row: number): number => {
		const camCol = camera.position.x;
		const camRow = MAP_SIZE - 1 - camera.position.z;
		return radToAngle256(angleFacing(col + 0.5, row + 0.5, camCol, camRow));
	};

	const canPlace = (col: number, row: number, type: GameObjType) => canPlaceAt(sceneData, col, row, type);

	const placeObject = (type: GameObjType, col: number, row: number, rot: number, time: number): void => {
		addObjectToScene(sceneData, CTOR_BY_TYPE[type], { col, row, rot, time });
	};

	const removeTopObject = (col: number, row: number, time: number): GameObjType | null => {
		const stack = objectsAt(allObjects, col, row);
		if (stack.length === 0) return null;
		const top = stack[stack.length - 1];
		const topType = (top.constructor as typeof GameObject).type;
		const removed = removeObjectFromScene(sceneData, col, row, time, isVisible);
		return removed ? topType : null;
	};

	// Active body: prefer the player's transferred-to body, fall back to the level's
	// starting synthoid before any transfer has happened.
	let activeCol = game.activeSynthoidCol;
	let activeRow = game.activeSynthoidRow;
	if (activeCol === null || activeRow === null) {
		const start = level.objects.find(o => o.type === GameObjType.SYNTHOID);
		if (start) { activeCol = start.x; activeRow = start.z; }
	}
	let activeBody: ActionContext['activeBody'] = null;
	if (activeCol !== null && activeRow !== null) {
		const stack = objectsAt(allObjects, activeCol, activeRow);
		const body = stack.find(o => o instanceof Synthoid);
		if (body) {
			activeBody = {
				col: activeCol,
				row: activeRow,
				height: body.height,
				onPedestal: stack.some(o => o instanceof Pedestal),
			};
		}
	}

	return { allObjects, map, canPlace, placeObject, removeTopObject, isVisible, rotFacingCamera, activeBody };
}

export function handleKeyActions(
	input: InputManager,
	camera: PerspectiveCamera,
	sceneData: SceneData,
	time: number
): void {
	let ctx: ActionContext | null = null;
	const ensureCtx = () => ctx ?? (ctx = buildActionContext(camera, sceneData));
	const targetedAction = (action: GameAction) => {
		const pick = pickTarget(camera, sceneData);
		if (!pick || !canPerformAction(time)) return;
		if (performTargetedAction(action, pick, ensureCtx(), time)) markActionPerformed(time);
	};

	if (input.consumeJustPressed('h') && canPerformAction(time)) {
		if (performHyperspace(ensureCtx(), time)) markActionPerformed(time);
	}
	if (input.consumeJustPressed('r')) targetedAction('create-synthoid');
	if (input.consumeJustPressed('b')) targetedAction('create-boulder');
	if (input.consumeJustPressed('t')) targetedAction('create-tree');
	if (input.consumeJustPressed('u')) targetedAction('absorb');
	if (input.consumeJustPressed(' ') || input.consumeJustPressed('Enter')) targetedAction('transfer');
}

// Mouse bindings in PLAYING mode: left = absorb, middle = synthoid, right = boulder.
// No mouse shortcut for tree, transfer, or hyperspace by design.
export function handleMouseAction(
	button: number,
	camera: PerspectiveCamera,
	sceneData: SceneData,
	time: number
): void {
	const action: GameAction | null =
		button === 0 ? 'absorb' :
		button === 1 ? 'create-synthoid' :
		button === 2 ? 'create-boulder' : null;
	if (!action) return;
	const pick = pickTarget(camera, sceneData);
	if (!pick || !canPerformAction(time)) return;
	if (performTargetedAction(action, pick, buildActionContext(camera, sceneData), time)) {
		markActionPerformed(time);
	}
}

// DEBUG-mode click handler: free placement / removal, no energy cost. Stays in the
// engine layer because it's a debug affordance, not a rule.
export function handleClick(
	event: MouseEvent,
	camera: PerspectiveCamera,
	sceneData: SceneData,
	lastTime: number
): void {
	const pick = pickTarget(camera, sceneData);
	if (!pick) return;

	const { col, row } = pick;
	const isSlope = pick.kind === 'terrain' && pick.type === 'slope';
	const isObject = pick.kind === 'object';
	const { map, scene } = sceneData;
	const vis = (c: number, r: number, yo?: number) =>
		isCellVisible(camera, scene, map, MAP_SIZE, c, r, yo);

	if (event.button === 0) {
		// Left-click removes the top object on this cell — only meaningful when an object was hit.
		if (isObject) removeObjectFromScene(sceneData, col, row, lastTime, vis);
	} else if (event.button === 1) {
		if (isSlope) return;
		const cls = event.shiftKey ? Meanie : event.ctrlKey ? Sentinel : Synthoid;
		addObjectToScene(sceneData, cls, { col, row, rot: rng256(), time: lastTime });
	} else if (event.button === 2) {
		if (isSlope) return;
		const cls = event.shiftKey ? Tree : event.ctrlKey ? Sentry : Boulder;
		// Boulders look better aligned (rot=0); randomise for the rest.
		const rot = cls === Boulder ? 0 : rng256();
		addObjectToScene(sceneData, cls, { col, row, rot, time: lastTime });
	}
}
