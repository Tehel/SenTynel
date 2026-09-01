import { describe, it, expect } from 'vitest';
import { volumeToGain } from './audio';

/*
 The volume curve's two anchors are not preferences, they are constraints (PLAN-SOUND.md):

   0  must be TRUE silence. A very small gain is not the same thing — a muted game that still
      feeds a nonzero gain is a bug report waiting to happen.
   10 must be exactly unity. The assets peak between -2.3 and -16.8 dBFS, so any master gain
      above 1.0 clips the hot ones (turn, at -2.3 dBFS, first). "Much too loud" is meant to come
      from the material at full scale, never from distortion.

 Everything else about the curve is tuning and deliberately not asserted here — DB_PER_STEP is
 expected to move once someone has listened on real hardware. What is asserted is the SHAPE:
 monotonic, and uniform in decibels rather than in gain, which is the whole reason it exists.
*/
describe('volumeToGain', () => {
	it('mutes at 0 — exactly zero, not merely small', () => {
		expect(volumeToGain(0)).toBe(0);
	});

	it('reaches unity at 10, so the master can never clip', () => {
		expect(volumeToGain(10)).toBeCloseTo(1, 10);
	});

	it('never exceeds unity, including above the menu range', () => {
		for (const v of [10, 11, 50, 1000]) expect(volumeToGain(v)).toBeLessThanOrEqual(1);
	});

	it('is monotonic across the menu range', () => {
		for (let v = 1; v <= 10; v++) expect(volumeToGain(v)).toBeGreaterThan(volumeToGain(v - 1));
	});

	it('steps by a constant number of decibels, not a constant gain', () => {
		const db = (v: number) => 20 * Math.log10(volumeToGain(v));
		const steps = [];
		for (let v = 2; v <= 10; v++) steps.push(db(v) - db(v - 1));
		for (const s of steps) expect(s).toBeCloseTo(steps[0], 10);
		// And confirm it really is NOT linear gain, which is the thing being ruled out.
		expect(volumeToGain(5)).toBeLessThan(0.5 * volumeToGain(10));
	});

	it('treats negative volumes as muted rather than inverting the signal', () => {
		expect(volumeToGain(-1)).toBe(0);
	});
});
