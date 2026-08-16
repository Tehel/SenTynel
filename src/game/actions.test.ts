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

import { describe, it, expect } from 'vitest';
import { pickHyperspaceTile } from './actions';
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
