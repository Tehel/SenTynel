// Game-rules action layer. Pure with respect to Three.js — every interaction with
// the rendered scene is mediated by an ActionContext provided by engine/actions.ts.
// `import type` only for anything that transitively pulls three: GameObject's type
// flows in but its class file is never loaded at runtime from this module.

import { GameObjType, MAP_SIZE } from '../world/terrain';
import type { GameObject } from '../world/objects/base';
import {
	game,
	spendEnergy,
	gainEnergy,
	beginTransfer,
	markFirstAction,
	markSentinelAbsorbed,
	triggerWon,
	floorEnergyForPedestalHyperspace,
} from './state.svelte';
// gainEnergy is used for absorption rewards; spendEnergy refusals + canPlace gating
// keep creation paths free of the spend/refund dance.
import { energyCostOf } from './rules';
import { logEvent } from './log';
import { randomAngle256, randomInt } from './random';
import { recordAbsorb, recordHyperspace, recordTransfer } from './stats.svelte';

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
	canPlace(col: number, row: number, type: GameObjType): boolean;

	// Place an object on (col, row). Caller must have already checked canPlace.
	placeObject(type: GameObjType, col: number, row: number, rot: number, time: number): void;

	// Remove the topmost object at (col, row), respecting LOS rules. Returns the
	// absorbed object's GameObjType, or null if nothing was removed.
	removeTopObject(col: number, row: number, time: number): GameObjType | null;

	// The surface rule (engine/scene.ts's canTargetTopObject): is the topmost object at
	// (col, row) something we're allowed to act on from here? Absorb reaches it through
	// removeTopObject; transfer has to ask directly, so that the two cannot drift apart.
	canTarget(col: number, row: number): boolean;

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

// Returns whether the action actually took effect — the engine layer only starts the
// action-cooldown timer (and its HUD readout) on true, so a failed attempt (no target,
// blocked placement, insufficient energy) doesn't cost the player a retry.
export function performTargetedAction(
	action: GameAction,
	target: ActionTarget,
	ctx: ActionContext,
	time: number
): boolean {
	// Slopes are non-interactive — actions need a flat tile or a stacked object.
	if (target.kind === 'terrain' && target.type === 'slope') return false;
	const { col, row } = target;

	if (action === 'create-synthoid') {
		if (!ctx.canPlace(col, row, GameObjType.SYNTHOID)) {
			logEvent('action', 'createSynthoidBlocked', { col, row });
			return false;
		}
		if (!spendEnergy(3)) return false;
		ctx.placeObject(GameObjType.SYNTHOID, col, row, ctx.rotFacingCamera(col, row), time);
		logEvent('action', 'createSynthoid', { col, row });
		markFirstAction();
		return true;
	}
	if (action === 'create-boulder') {
		if (!ctx.canPlace(col, row, GameObjType.BOULDER)) {
			logEvent('action', 'createBoulderBlocked', { col, row });
			return false;
		}
		if (!spendEnergy(2)) return false;
		// Boulder rotation is fixed at 0 so stacks align cleanly.
		ctx.placeObject(GameObjType.BOULDER, col, row, 0, time);
		logEvent('action', 'createBoulder', { col, row });
		markFirstAction();
		return true;
	}
	if (action === 'create-tree') {
		if (!ctx.canPlace(col, row, GameObjType.TREE)) {
			logEvent('action', 'createTreeBlocked', { col, row });
			return false;
		}
		if (!spendEnergy(1)) return false;
		// Random rotation makes natural-looking variety.
		ctx.placeObject(GameObjType.TREE, col, row, randomAngle256(), time);
		logEvent('action', 'createTree', { col, row });
		markFirstAction();
		return true;
	}
	if (action === 'absorb') {
		if (game.sentinelAbsorbed) {
			logEvent('action', 'absorbLocked');
			return false;
		}
		const removedType = ctx.removeTopObject(col, row, time);
		if (removedType === null) return false;
		const gain = energyCostOf(removedType);
		gainEnergy(gain, `absorb-${GameObjType[removedType].toLowerCase()}`);
		logEvent('action', 'absorb', { col, row, type: GameObjType[removedType], gain });
		recordAbsorb(removedType);
		if (removedType === GameObjType.SENTINEL) markSentinelAbsorbed();
		markFirstAction();
		return true;
	}
	if (action === 'transfer') {
		if (target.kind !== 'object' || typeOf(target.gameObject) !== GameObjType.SYNTHOID) return false;
		// Transfer takes the SAME surface test as absorbing a synthoid — you aim at the shell's
		// feet, and feet on bare ground need their tile in view (engine/scene.ts's
		// canTargetTopObject). Resolving the model with the crosshair is not enough on its own:
		// that used to be this module's rule, credited to the original, and it was wrong. Feet on
		// a boulder still pass freely, which is what keeps transferring up a tower legal.
		if (!ctx.canTarget(col, row)) {
			logEvent('action', 'transferBlocked', { col, row });
			return false;
		}
		// ...but not into a synthoid a watcher has already begun draining (absorbedTime set):
		// its morph to a boulder→tree would otherwise complete during the transfer glide,
		// stranding the camera "inside" a non-synthoid body. A dying synthoid is not a valid
		// target — the attempt fails silently and can be retried (until it's fully a boulder).
		if (target.gameObject.absorbedTime !== null) return false;
		beginTransfer(col, row);
		recordTransfer();
		markFirstAction();
		return true;
	}
	return false;
}

/*
 Pick a random unoccupied flat tile for a hyperspace landing: "the same height or lower but never on
 your original square".

 `maxHeight` is the body's ALTITUDE, boulders included, not the terrain under it — confirmed against
 Augmentinel, and deliberate: it is what makes climbing a tower and then jumping off the top a real
 option, expensive and risky but available. Hence the fractional ceiling, and hence the comparison
 being inclusive.

 The ceiling is ABSOLUTE. This used to raise it a level at a time whenever nothing fitted underneath,
 which quietly handed the player a free climb precisely when the map was crowded enough for it to
 matter — the rule inverted at the only moment it had any teeth. If nothing fits, nothing fits: the
 caller has already spent the energy and the jump is simply wasted.

 Returns null when no unoccupied flat tile sits at or below the ceiling.
*/
export function pickHyperspaceTile(
	map: number[],
	allObjects: GameObject[],
	maxHeight: number
): { col: number; row: number } | null {
	const candidates: { col: number; row: number }[] = [];
	for (let r = 0; r < MAP_SIZE - 1; r++) {
		for (let c = 0; c < MAP_SIZE - 1; c++) {
			const h = map[r * MAP_SIZE + c];
			if (h > maxHeight) continue;
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
	return candidates.length > 0 ? candidates[randomInt(candidates.length)] : null;
}

// Voluntary hyperspace: spend 3 energy, then either trigger the WON flow (if the active
// body is on a pedestal) or place a fresh synthoid on a random eligible tile and transfer.
// The pedestal/WON path is let through even on a refused spend — see
// floorEnergyForPedestalHyperspace's doc comment for why.
// Returns whether energy was actually spent — see performTargetedAction's return doc.
export function performHyperspace(ctx: ActionContext, time: number): boolean {
	const body = ctx.activeBody;

	if (body?.onPedestal) {
		// Also floors the exact-3 case (spend succeeds, 0 left): without this, arriving with
		// exactly 3 energy would jump 0 landscapes while arriving with less than 3 (floored to
		// 1) jumps 1 — a worse starting position ending better than a less-worse one.
		if (!spendEnergy(3) || game.energy < 1) floorEnergyForPedestalHyperspace();
		logEvent('action', 'hyperspaceFromPedestal');
		triggerWon();
		markFirstAction();
		return true;
	}

	if (!spendEnergy(3)) return false;
	if (!body) return true; // energy already spent; nothing else to do without a body

	// Voluntary hyperspace, excluding the pedestal/WON path above — matches the
	// "hyperspace other than the final win ones" stat. Forced (Meanie-triggered)
	// hyperspace in engine/meanie.ts is deliberately not counted here.
	recordHyperspace();

	const target = pickHyperspaceTile(ctx.map, ctx.allObjects, body.height);
	if (!target) {
		logEvent('action', 'hyperspaceNoTile');
		return true; // energy already spent
	}

	// pickHyperspaceTile already filtered to unoccupied flat tiles, so canPlace must pass.
	ctx.placeObject(GameObjType.SYNTHOID, target.col, target.row, ctx.rotFacingCamera(target.col, target.row), time);
	logEvent('action', 'hyperspace', { col: target.col, row: target.row });
	beginTransfer(target.col, target.row);
	markFirstAction();
	return true;
}
