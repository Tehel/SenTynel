/*
 Hyperspace landing choice (PLAN-RULES.md R2, RULES-FIDELITY.md E3).

 The original is firm that a jump never gains you height: "you land at the same height or lower but
 never on your original square". Our implementation started at the right ceiling and then, when
 nothing fitted under it, RAISED the ceiling a level at a time until something did — inverting the
 rule at exactly the moment it matters, on a crowded map where the player most wants a free climb.

 The ceiling itself is the body's ALTITUDE, boulders included, and that is correct rather than a
 second bug: confirmed against Augmentinel, it is what makes "climb the tower, then jump off the top"
 a real (expensive, risky) option. So these tests pin two things that look contradictory and are not
 — the ceiling is generous, and it is absolute.

 pickHyperspaceTile is pure over (map, objects, maxHeight) and reads only col/row/absorbedTime off an
 object, so the occupants here are duck-typed rather than real GameObjects. No three, no scene.
*/

import { describe, it, expect, vi } from 'vitest';

// performHyperspace's success path records a stat, and stats.svelte.ts persists on every
// mutation — stub a minimal in-memory localStorage, the same pattern as state.test.ts.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => store.set(k, v),
	removeItem: (k: string) => store.delete(k),
	clear: () => store.clear(),
});

import { performHyperspace, pickHyperspaceTile, type ActionContext } from './actions';
import { game } from './state.svelte';
import type { GameObject } from '../world/objects/base';
import { MAP_SIZE } from '../world/terrain';
import { seedGameRandom } from './random';

// A map that is entirely `base` high, with an optional raised region. Heights are per-VERTEX, and a
// cell is flat only when its four corners agree — so raising a block of vertices makes the cells
// strictly inside it flat and high, and the cells on its fringe sloped.
function mapWith(base: number, raised?: { from: number; to: number; height: number }): number[] {
	const map = new Array(MAP_SIZE * MAP_SIZE).fill(base);
	if (raised) {
		for (let r = raised.from; r <= raised.to; r++) {
			for (let c = raised.from; c <= raised.to; c++) map[r * MAP_SIZE + c] = raised.height;
		}
	}
	return map;
}

const occupant = (col: number, row: number, absorbed = false) =>
	({ col, row, absorbedTime: absorbed ? 1 : null }) as unknown as GameObject;

// The landing is drawn from game/random.ts, so a seed makes these deterministic.
const pick = (map: number[], objects: GameObject[], maxHeight: number) => {
	seedGameRandom(0, 0);
	return pickHyperspaceTile(map, objects, maxHeight);
};

const heightAt = (map: number[], t: { col: number; row: number }) => map[t.row * MAP_SIZE + t.col];

describe('pickHyperspaceTile', () => {
	it('lands on a tile at or below the ceiling', () => {
		const map = mapWith(2, { from: 8, to: 14, height: 5 });
		const target = pick(map, [], 2);
		expect(target).not.toBeNull();
		expect(heightAt(map, target!)).toBeLessThanOrEqual(2);
	});

	it('never raises the ceiling to find somewhere to land', () => {
		// Every flat tile is at height 5; the body sits at 2. The original would rather strand the
		// jump than hand out a free climb, and this used to return a height-5 tile.
		const map = mapWith(5);
		expect(pick(map, [], 2)).toBeNull();
	});

	it('treats the ceiling as inclusive', () => {
		const map = mapWith(5);
		const target = pick(map, [], 5);
		expect(target).not.toBeNull();
		expect(heightAt(map, target!)).toBe(5);
	});

	it('accepts a fractional ceiling, since the body may be standing on boulders', () => {
		// A body on one boulder at terrain 2 has altitude 2.5 — which must not round down and lock
		// it out of the height-2 ground it is standing over.
		const map = mapWith(2);
		expect(pick(map, [], 2.5)).not.toBeNull();
	});

	it('skips occupied tiles but not ones whose occupant is mid-absorb', () => {
		// One flat tile in the whole map, at the bottom of a plateau.
		const map = mapWith(5, { from: 0, to: MAP_SIZE - 1, height: 5 });
		for (let r = 0; r <= 1; r++) for (let c = 0; c <= 1; c++) map[r * MAP_SIZE + c] = 2;
		expect(pick(map, [occupant(0, 0)], 2)).toBeNull();
		expect(pick(map, [occupant(0, 0, true)], 2)).toEqual({ col: 0, row: 0 });
	});

	it('never lands on a slope', () => {
		// A single-vertex bump makes the four cells touching it sloped; nothing else changes.
		const map = mapWith(2);
		map[10 * MAP_SIZE + 10] = 3;
		for (let i = 0; i < 200; i++) {
			const t = pickHyperspaceTile(map, [], 2);
			expect(t).not.toBeNull();
			const { col, row } = t!;
			const h = map[row * MAP_SIZE + col];
			expect(map[row * MAP_SIZE + col + 1]).toBe(h);
			expect(map[(row + 1) * MAP_SIZE + col]).toBe(h);
			expect(map[(row + 1) * MAP_SIZE + col + 1]).toBe(h);
		}
	});
});

/*
 THE REFUSAL, not the landing (2026-08-24). Reported from watching the demo stall on landscape 482,
 whose map holds exactly two flat tiles at or below the starting altitude: hyperspace was charging
 3 energy for a jump it had already established could not happen.

 It is the only action in the game that could do that. Every other cost buys an object that can be
 absorbed back, so the landscape's energy is conserved; this one took it out permanently, which on a
 map with nowhere to land is an unbounded leak with no cue that anything went wrong. The ceiling is
 deliberately absolute (E3 above) and stays so — what changed is that an impossible jump is refused
 rather than charged for.

 A refusal must also stay retryable: engine/actions.ts only starts the 1 Hz cooldown on a `true`
 return, so `false` here is the same shape as a create the stacking rule turns down.
*/
describe('performHyperspace with nowhere to land', () => {
	// Only the fields performHyperspace actually reads on this path. placeObject/beginTransfer are
	// spied on rather than stubbed silently: "did not charge" and "did not move" are two claims.
	const ctxFor = (map: number[], objects: GameObject[], body: ActionContext['activeBody']) => {
		const placeObject = vi.fn();
		const ctx = {
			allObjects: objects,
			map,
			canPlace: () => true,
			placeObject,
			removeTopObject: () => null,
			canTarget: () => true,
			isVisible: () => true,
			rotFacingCamera: () => 0,
			activeBody: body,
		} as unknown as ActionContext;
		return { ctx, placeObject };
	};

	// Landscape 482 in miniature: a floor-level pocket of two flat tiles, everything else higher.
	// The body stands on one and its own shell still stands on the other, so nothing is free.
	const pocket = () => {
		const map = new Array(MAP_SIZE * MAP_SIZE).fill(9);
		for (let r = 25; r <= 28; r++) for (let c = 29; c <= 31; c++) map[r * MAP_SIZE + c] = 2;
		return map;
	};

	it('refuses the jump and charges nothing when no tile fits under the ceiling', () => {
		const map = pocket();
		// Occupy every flat tile the pocket offers at height 2.
		const occupants: GameObject[] = [];
		for (let r = 25; r <= 27; r++) for (let c = 29; c <= 30; c++) occupants.push(occupant(c, r));
		const { ctx, placeObject } = ctxFor(map, occupants, { col: 29, row: 26, height: 2, onPedestal: false });

		game.energy = 10;
		game.phase = 'PLAYING';
		seedGameRandom(482, 0);
		expect(pickHyperspaceTile(map, occupants, 2)).toBeNull(); // premise of the case

		expect(performHyperspace(ctx, 1000)).toBe(false);
		expect(game.energy).toBe(10);
		expect(placeObject).not.toHaveBeenCalled();
	});

	it('still charges and jumps when a tile is free', () => {
		const map = pocket();
		const occupants = [occupant(29, 26)];
		const { ctx, placeObject } = ctxFor(map, occupants, { col: 29, row: 26, height: 2, onPedestal: false });

		game.energy = 10;
		game.phase = 'PLAYING';
		seedGameRandom(482, 0);

		expect(performHyperspace(ctx, 2000)).toBe(true);
		expect(game.energy).toBe(7);
		expect(placeObject).toHaveBeenCalledOnce();
	});
});
