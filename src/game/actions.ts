// Game-rules action layer. Pure with respect to Three.js — every interaction with
// the rendered scene is mediated by an ActionContext provided by engine/actions.ts.
// `import type` only for anything that transitively pulls three: GameObject's type
// flows in but its class file is never loaded at runtime from this module.

import { GameObjType, MAP_SIZE } from '../world/terrain';
import type { GameObject } from '../world/objects/base';
import { game, spendEnergy, gainEnergy, beginTransfer, markSentinelAbsorbed, triggerWon } from './state.svelte';
// gainEnergy is used for absorption rewards; spendEnergy refusals + canPlace gating
// keep creation paths free of the spend/refund dance.
import { energyCostOf } from './rules';
import { logEvent } from './log';

// Mirror of engine/picker.ts's `Pick`. Defined here so game/actions doesn't import
// from engine/* — engine code passes a structurally compatible value.
export type ActionTarget =
	| { kind: 'object'; gameObject: GameObject; col: number; row: number }
	| { kind: 'terrain'; type: 'plane' | 'slope'; col: number; row: number };

// Engine-supplied callbacks. The rules layer never references Three.js directly;
// it operates through this context.
export interface ActionContext {
	allObjects: GameObject[];
	map: number[];

	// Stacking-rule predicate. Used to gate energy spend before placement.
	canPlace(col: number, row: number): boolean;

	// Place an object on (col, row). Caller must have already checked canPlace.
	placeObject(type: GameObjType, col: number, row: number, rot: number, time: number): void;

	// Remove the topmost object at (col, row), respecting LOS rules. Returns the
	// absorbed object's GameObjType, or null if nothing was removed.
	removeTopObject(col: number, row: number, time: number): GameObjType | null;

	isVisible(col: number, row: number, yOffset?: number): boolean;

	// 256-step rotation that makes a model at (col, row) face the player camera.
	rotFacingCamera(col: number, row: number): number;

	// Active body summary, or null if there is none yet (pre-first-action). The engine
	// may fall back to the level's starting synthoid here.
	activeBody: { col: number; row: number; height: number; onPedestal: boolean } | null;
}

export type GameAction = 'create-synthoid' | 'create-boulder' | 'create-tree' | 'absorb' | 'transfer';

function typeOf(o: GameObject): GameObjType | null {
	return (o.constructor as typeof GameObject).type;
}

export function performTargetedAction(
	action: GameAction,
	target: ActionTarget,
	ctx: ActionContext,
	time: number
): void {
	// Slopes are non-interactive — actions need a flat tile or a stacked object.
	if (target.kind === 'terrain' && target.type === 'slope') return;
	const { col, row } = target;

	if (action === 'create-synthoid') {
		if (!ctx.canPlace(col, row)) {
			logEvent('action', 'createSynthoidBlocked', { col, row });
			return;
		}
		if (!spendEnergy(3)) return;
		ctx.placeObject(GameObjType.SYNTHOID, col, row, ctx.rotFacingCamera(col, row), time);
		logEvent('action', 'createSynthoid', { col, row });
		return;
	}
	if (action === 'create-boulder') {
		if (!ctx.canPlace(col, row)) {
			logEvent('action', 'createBoulderBlocked', { col, row });
			return;
		}
		if (!spendEnergy(2)) return;
		// Boulder rotation is fixed at 0 so stacks align cleanly.
		ctx.placeObject(GameObjType.BOULDER, col, row, 0, time);
		logEvent('action', 'createBoulder', { col, row });
		return;
	}
	if (action === 'create-tree') {
		if (!ctx.canPlace(col, row)) {
			logEvent('action', 'createTreeBlocked', { col, row });
			return;
		}
		if (!spendEnergy(1)) return;
		// Random rotation makes natural-looking variety.
		ctx.placeObject(GameObjType.TREE, col, row, Math.floor(Math.random() * 256), time);
		logEvent('action', 'createTree', { col, row });
		return;
	}
	if (action === 'absorb') {
		if (game.sentinelAbsorbed) {
			logEvent('action', 'absorbLocked');
			return;
		}
		const removedType = ctx.removeTopObject(col, row, time);
		if (removedType !== null) {
			const gain = energyCostOf(removedType);
			gainEnergy(gain, `absorb-${GameObjType[removedType].toLowerCase()}`);
			logEvent('action', 'absorb', { col, row, type: GameObjType[removedType], gain });
			if (removedType === GameObjType.SENTINEL) markSentinelAbsorbed();
		}
		return;
	}
	if (action === 'transfer') {
		if (target.kind !== 'object' || typeOf(target.gameObject) !== GameObjType.SYNTHOID) return;
		if (ctx.isVisible(col, row)) {
			beginTransfer(col, row);
		} else {
			logEvent('action', 'transferFailed', { reason: 'notVisible', col, row });
		}
		return;
	}
}

// Pick a random unoccupied flat tile whose terrain height is ≤ maxHeight. Retries with
// the upper bound raised by 1 if nothing fits, until something does or we exceed the
// max terrain height (11). Returns null only if no flat empty tile exists at all.
export function pickHyperspaceTile(
	map: number[],
	allObjects: GameObject[],
	maxHeight: number
): { col: number; row: number } | null {
	let limit = maxHeight;
	while (limit <= 11) {
		const candidates: { col: number; row: number }[] = [];
		for (let r = 0; r < MAP_SIZE - 1; r++) {
			for (let c = 0; c < MAP_SIZE - 1; c++) {
				const h = map[r * MAP_SIZE + c];
				if (h > limit) continue;
				if (
					map[r * MAP_SIZE + c + 1] !== h ||
					map[(r + 1) * MAP_SIZE + c] !== h ||
					map[(r + 1) * MAP_SIZE + c + 1] !== h
				) continue;
				const occupied = allObjects.some(o => o.col === c && o.row === r && o.absorbedTime === null);
				if (occupied) continue;
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
export function performHyperspace(ctx: ActionContext, time: number): void {
	if (!spendEnergy(3)) return;

	const body = ctx.activeBody;
	if (!body) return;

	if (body.onPedestal) {
		logEvent('action', 'hyperspaceFromPedestal');
		triggerWon();
		return;
	}

	const target = pickHyperspaceTile(ctx.map, ctx.allObjects, body.height);
	if (!target) {
		logEvent('action', 'hyperspaceNoTile');
		return;
	}

	// pickHyperspaceTile already filtered to unoccupied flat tiles, so canPlace must pass.
	ctx.placeObject(GameObjType.SYNTHOID, target.col, target.row, ctx.rotFacingCamera(target.col, target.row), time);
	logEvent('action', 'hyperspace', { col: target.col, row: target.row });
	beginTransfer(target.col, target.row);
}
