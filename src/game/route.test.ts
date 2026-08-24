/*
 Coverage for the demo's landing choice.

 The reference values come from utils/all.csv (regenerate with `node utils/all-levels.js`), which
 the analysis scripts and utils/paths.js are also built on — so heightGapOf agreeing with it here
 is what keeps the runtime rule and the route CSVs talking about the same landscapes.
*/

import { describe, it, expect, beforeEach, vi } from 'vitest';

// demo.svelte.ts persists on every mutation; the blacklist tests below mutate it directly, so a
// minimal in-memory localStorage stands in — the same pattern as state.test.ts.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => store.set(k, v),
	removeItem: (k: string) => store.delete(k),
	clear: () => store.clear(),
});

import { generateLevel } from '../world/terrain';
import { chooseDemoLanding, heightGapOf, isPlayableLanding } from './route';
import { demoProgress } from './demo.svelte';

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

/*
 THE STEERING HALF of the three-strike blacklist (game/state.svelte.ts's failDemo). The list is only
 worth keeping if the demo actually routes around it, and that routing is not new code: the downward
 scan in chooseDemoLanding already existed for the terrain tests, so blacklisting a landscape reuses
 the machinery that skips an enclosed start.

 The landscapes here are picked to be terrain-playable, so a rejection can only have come from the
 blacklist — otherwise these would pass whether the wiring existed or not.
*/
describe('steering around the blacklist', () => {
	beforeEach(() => {
		store.clear();
		demoProgress.blacklist = [];
	});

	it('rejects a blacklisted landscape that the terrain tests accept', () => {
		// Premise: playable on its own merits, so the assertion below is about the list alone.
		expect(isPlayableLanding(272)).toBe(true);
		demoProgress.blacklist = [272];
		expect(isPlayableLanding(272)).toBe(false);
	});

	/*
	 The reason isPlayableLanding checks the list OUTSIDE its memo. The terrain verdict is cached for
	 the session; the blacklist grows while the demo plays, so a landscape asked about before it
	 earned its third strike must not stay cached as playable afterwards.
	*/
	it('sees a landscape blacklisted after it was already asked about', () => {
		expect(isPlayableLanding(600)).toBe(true); // populates the memo
		demoProgress.blacklist = [600];
		expect(isPlayableLanding(600)).toBe(false);
		// ...and back again, once a reset clears the list: the terrain verdict was never lost.
		demoProgress.blacklist = [];
		expect(isPlayableLanding(600)).toBe(true);
	});

	// What the rewind is for: the same win has to buy a different landing.
	it('steps the jump down past a blacklisted landing', () => {
		const from = 400;
		const jump = chooseDemoLanding(from, 20)!;
		demoProgress.blacklist = [from + jump];

		const steered = chooseDemoLanding(from, 20)!;
		expect(steered).toBeLessThan(jump);
		expect(demoProgress.blacklist).not.toContain(from + steered);
	});

	/*
	 The fallback, and the pathology it exists to close. Every rewind sends the bot back to the same
	 landscape, so its jump window loses one more candidate each time round — this branch GROWS
	 towards being reached. Landing on a blacklisted landscape from here would earn it three fresh
	 strikes and another rewind to the same place: a loop that plays, so no watchdog would see it.
	*/
	it('avoids the blacklist even when nothing in range is playable', () => {
		/*
		 Reaching the fallback needs EVERY candidate to fail isPlayableLanding while at least one is
		 not blacklisted — so the window is built out of both kinds of rejection. 15 and 23 are
		 enclosed starts (rejected on terrain, above) and everything between them is blacklisted here,
		 which leaves the fallback the only branch that can answer and 23 the only landing it may
		 pick. A window blacklisted bar one playable landscape would instead be answered by the
		 primary loop, testing nothing.
		*/
		const from = 14;
		// 15 is an enclosed start, so it is refused on terrain and never blacklisted.
		expect(isPlayableLanding(15)).toBe(false);
		demoProgress.blacklist = Array.from({ length: 8 }, (_, i) => 16 + i); // 16..23

		// The furthest landing is blacklisted, so the answer has to differ from the plain `reach`
		// the fallback used to return unconditionally — which is what makes this discriminating.
		const jump = chooseDemoLanding(from, 9)!;
		expect(jump).toBe(1); // landscape 15 — unplayable, but not given up on
		expect(demoProgress.blacklist).not.toContain(from + jump);
	});

	// With genuinely nowhere left it still returns a jump rather than stalling the demo — the
	// journey being stuck is logged, not silently turned into a zero.
	it('still returns a jump when every landing in range is blacklisted', () => {
		const from = 400;
		demoProgress.blacklist = Array.from({ length: 20 }, (_, i) => from + i + 1);
		expect(chooseDemoLanding(from, 20)).toBe(20);
	});
});
