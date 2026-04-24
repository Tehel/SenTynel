import { describe, it, expect } from 'vitest';
import { generateLevel, GameObjType } from './terrain';

describe('generateLevel', () => {
	describe('level 0', () => {
		const level = generateLevel(0);

		it('map has correct size', () => {
			expect(level.map.length).toBe(32 * 32);
		});

		it('map values in range [1, 11]', () => {
			expect(level.map.every(v => v >= 1 && v <= 11)).toBe(true);
		});

		it('shapes array has correct size', () => {
			expect(level.shapes.length).toBe(32 * 32);
		});

		it('has exactly 1 sentry (Sentinel only on landscape 0)', () => {
			expect(level.nbSentries).toBe(1);
		});

		it('codes covers all 5 platforms', () => {
			expect(Object.keys(level.codes).sort()).toEqual(['Amiga', 'BBC/C64', 'CPC', 'PC/ST', 'Spectrum']);
		});

		it('codes are 8-character hex strings', () => {
			for (const code of Object.values(level.codes)) {
				expect(code).toMatch(/^[0-9a-f]{8}$/);
			}
		});

		it('player synthoid is at fixed position (x=0x08, z=0x11)', () => {
			const player = level.objects.find(o => o.type === GameObjType.SYNTHOID);
			expect(player).toBeDefined();
			expect(player!.x).toBe(0x08);
			expect(player!.z).toBe(0x11);
		});

		it('object types are all valid GameObjType values', () => {
			const valid = new Set(Object.values(GameObjType).filter(v => typeof v === 'number'));
			expect(level.objects.every(o => valid.has(o.type))).toBe(true);
		});

		it('map snapshot (first 64 values)', () => {
			expect(level.map.slice(0, 64)).toMatchSnapshot();
		});

		it('object placements snapshot', () => {
			expect(
				level.objects.map(o => ({ type: GameObjType[o.type], x: o.x, y: o.y, z: o.z }))
			).toMatchSnapshot();
		});

		it('codes snapshot', () => {
			expect(level.codes).toMatchSnapshot();
		});
	});

	describe('level 1', () => {
		const level = generateLevel(1);

		it('map has correct size', () => {
			expect(level.map.length).toBe(32 * 32);
		});

		it('map values in range [1, 11]', () => {
			expect(level.map.every(v => v >= 1 && v <= 11)).toBe(true);
		});

		it('has at least 1 sentry', () => {
			expect(level.nbSentries).toBeGreaterThanOrEqual(1);
		});

		it('map snapshot (first 64 values)', () => {
			expect(level.map.slice(0, 64)).toMatchSnapshot();
		});

		it('codes snapshot', () => {
			expect(level.codes).toMatchSnapshot();
		});
	});

	it('generateLevel is deterministic', () => {
		const a = generateLevel(42);
		const b = generateLevel(42);
		expect(a.map).toEqual(b.map);
		expect(a.objects).toEqual(b.objects);
		expect(a.codes).toEqual(b.codes);
	});
});
