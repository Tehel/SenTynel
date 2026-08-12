/*
 Coverage for the demo's landing choice.

 The reference values come from utils/all.csv (regenerate with `node utils/all-levels.js`), which
 the analysis scripts and utils/paths.js are also built on — so heightGapOf agreeing with it here
 is what keeps the runtime rule and the route CSVs talking about the same landscapes.
*/

import { describe, it, expect } from 'vitest';
import { generateLevel } from '../world/terrain';
import { chooseDemoLanding, heightGapOf, isPlayableLanding } from './route';

describe('heightGapOf', () => {
	// heightGap column of utils/all.csv.
	it('matches the all.csv figures', () => {
		expect(heightGapOf(generateLevel(0))).toBe(0);
		expect(heightGapOf(generateLevel(1))).toBe(0);
		expect(heightGapOf(generateLevel(2))).toBe(1);
		expect(heightGapOf(generateLevel(9999))).toBe(1);
	});

	// The only two landscapes in the whole range needing a seven-boulder pile.
	it('finds the two gap-3 landscapes', () => {
		expect(heightGapOf(generateLevel(2497))).toBe(3);
		expect(heightGapOf(generateLevel(9306))).toBe(3);
	});

	/*
	 The formula the pile height comes from, cross-checked against the planner's own derivation:
	 utils/all-levels.js says 2 * gap + 1 boulders, and game/bot.ts's bouldersToSee derives the same
	 number from the eye geometry. game/bot.test.ts already asserts they agree; this asserts the gap
	 feeding them is the same gap.
	*/
	it('reads the gap off the Sentinel and the next-highest flat tile', () => {
		const level = generateLevel(2);
		const gap = heightGapOf(level)!;
		expect(gap).toBeGreaterThanOrEqual(0);
		expect(2 * gap + 1).toBe(3);
	});
});

describe('isPlayableLanding', () => {
	// The landscapes bot.harness.test.ts asserts wins on — if the demo refused to land on any of
	// them, the yardstick and the attract mode would be measuring different games.
	it('accepts the landscapes the bot is known to win', () => {
		for (const id of [0, 1, 2, 272, 9999]) expect(isPlayableLanding(id)).toBe(true);
	});

	/*
	 Enclosed starts: the body begins in a hollow with nothing it can target at all, so its only
	 legal opening move is the 3-energy hyperspace escape hatch. 372 of the 10000 landscapes are
	 like this; 190 and 200 have no flat tile at or below the start height anywhere, while 15 and 23
	 have one but no line of sight to it past a slope.
	*/
	it('rejects landscapes whose starting position is enclosed', () => {
		for (const id of [15, 23, 190, 200]) expect(isPlayableLanding(id)).toBe(false);
	});

	// Seven boulders of pile, never played through — and only two landscapes, so skipping them
	// costs the route nothing.
	it('rejects the gap-3 landscapes', () => {
		expect(isPlayableLanding(2497)).toBe(false);
		expect(isPlayableLanding(9306)).toBe(false);
	});

	it('rejects ids outside the landscape range', () => {
		expect(isPlayableLanding(-1)).toBe(false);
		expect(isPlayableLanding(10000)).toBe(false);
	});
});

describe('chooseDemoLanding', () => {
	it('maximises the jump when the furthest landing is playable', () => {
		// 0 + 4 = 4, which all.csv puts at heightGap 0 — and it is where utils/path-no-tower.csv's
		// first hop goes, for the same reason.
		expect(isPlayableLanding(4)).toBe(true);
		expect(chooseDemoLanding(0, 4)).toBe(4);
	});

	/*
	 Stepping down past an unplayable landing is the whole point of the scan: 200 is enclosed, so a
	 bot at 190 able to jump 10 takes 9 instead and lands on 199.
	*/
	it('steps down past an unplayable landing', () => {
		expect(isPlayableLanding(200)).toBe(false);
		const jump = chooseDemoLanding(190, 10)!;
		expect(jump).toBeLessThan(10);
		expect(isPlayableLanding(190 + jump)).toBe(true);
	});

	// The destination is exempt from the filter — it's arrived at, not played through as a
	// waypoint, the same exemption utils/paths.js grants it. 9999's own gap is 1 anyway.
	it('lands exactly on the final landscape rather than overshooting it', () => {
		expect(chooseDemoLanding(9990, 40)).toBe(9);
		expect(chooseDemoLanding(9990, 9)).toBe(9);
	});

	it('has nothing to steer to from the final landscape, or with nothing affordable', () => {
		expect(chooseDemoLanding(9999, 20)).toBeNull();
		expect(chooseDemoLanding(100, 0)).toBeNull();
		expect(chooseDemoLanding(100, -3)).toBeNull();
	});

	// Whatever it returns has to be a jump the purse can actually pay for, or the bot would burn
	// energy down to a target it then can't reach.
	it('never returns more than the affordable jump', () => {
		for (const maxJump of [1, 2, 5, 12, 30]) {
			const jump = chooseDemoLanding(500, maxJump)!;
			expect(jump).toBeGreaterThanOrEqual(1);
			expect(jump).toBeLessThanOrEqual(maxJump);
		}
	});
});
