import { describe, it, expect } from 'vitest';
import { gameRandom, randomAngle256, randomInt, seedGameRandom } from './random';

const draw = (n: number) => Array.from({ length: n }, () => gameRandom());

describe('seeded gameplay randomness', () => {
	it('repeats exactly for the same landscape', () => {
		seedGameRandom(1234);
		const first = draw(50);
		seedGameRandom(1234);
		expect(draw(50)).toEqual(first);
	});

	it('differs between landscapes, including adjacent ones', () => {
		seedGameRandom(1);
		const one = draw(20);
		seedGameRandom(2);
		expect(draw(20)).not.toEqual(one);
	});

	// levelEpoch is bumped when a lost landscape is rebuilt, so a retry is a fresh run rather
	// than a rerun of the identical one — the layout repeats, the unfolding doesn't.
	it('differs between attempts at the same landscape', () => {
		seedGameRandom(7, 0);
		const first = draw(20);
		seedGameRandom(7, 1);
		expect(draw(20)).not.toEqual(first);
	});

	// Landscape 0 seeds through the +1, which is there to keep it off mulberry32's weak zero.
	it('produces a healthy sequence for landscape 0', () => {
		seedGameRandom(0);
		const values = draw(200);
		expect(new Set(values).size).toBe(200);
		expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
		expect(Math.max(...values)).toBeLessThan(1);
	});

	it('spreads roughly evenly across the unit interval', () => {
		seedGameRandom(42);
		const buckets = new Array(10).fill(0);
		for (const v of draw(10_000)) buckets[Math.floor(v * 10)]++;
		// Uniform would be 1000 a bucket; allow a generous band rather than assert a distribution.
		expect(Math.min(...buckets)).toBeGreaterThan(800);
		expect(Math.max(...buckets)).toBeLessThan(1200);
	});

	it('keeps randomInt inside the range, and never indexes an empty list', () => {
		seedGameRandom(9);
		for (let i = 0; i < 500; i++) {
			const v = randomInt(7);
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(7);
			expect(Number.isInteger(v)).toBe(true);
		}
		expect(randomInt(0)).toBe(0);
	});

	it('keeps rotations inside the 256-step circle', () => {
		seedGameRandom(3);
		for (let i = 0; i < 500; i++) {
			const rot = randomAngle256();
			expect(rot).toBeGreaterThanOrEqual(0);
			expect(rot).toBeLessThan(256);
		}
	});
});
