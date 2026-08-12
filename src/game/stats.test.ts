import { describe, it, expect, beforeEach, vi } from 'vitest';

// stats.svelte.ts persists on every mutation via localStorage — the vitest environment
// here is plain node (see vite.config.ts), which has no such global, so stub a minimal
// in-memory implementation before the module under test is imported.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => store.set(k, v),
	removeItem: (k: string) => store.delete(k),
	clear: () => store.clear(),
});

const { GameObjType } = await import('../world/terrain');
const {
	stats, demoStats, activeStats, setStatsTarget,
	resetStats, recordAbsorb, recordDeath, recordTransfer, recordVictory, loadStats, saveStats,
} = await import('./stats.svelte');

describe('stats', () => {
	beforeEach(() => {
		store.clear();
		setStatsTarget('player');
		for (const record of [stats, demoStats]) {
			record.deaths = 0;
			record.victories = 0;
			record.transfers = 0;
			record.hyperspaceCount = 0;
			record.absorbed.tree = 0;
			record.absorbed.sentry = 0;
			record.absorbed.sentinel = 0;
			record.absorbed.meanie = 0;
			record.gameCompletions = 0;
			record.completedGameThisRun = false;
		}
		stats.deaths = 0;
		stats.victories = 0;
		stats.transfers = 0;
		stats.hyperspaceCount = 0;
		stats.absorbed.tree = 0;
		stats.absorbed.sentry = 0;
		stats.absorbed.sentinel = 0;
		stats.absorbed.meanie = 0;
		stats.gameCompletions = 0;
		stats.completedGameThisRun = false;
	});

	it('recordAbsorb increments the matching type and ignores boulder/synthoid', () => {
		recordAbsorb(GameObjType.TREE);
		recordAbsorb(GameObjType.SENTRY);
		recordAbsorb(GameObjType.SENTINEL);
		recordAbsorb(GameObjType.MEANIE);
		recordAbsorb(GameObjType.BOULDER);
		recordAbsorb(GameObjType.SYNTHOID);

		expect(stats.absorbed).toEqual({ tree: 1, sentry: 1, sentinel: 1, meanie: 1 });
	});

	it('resetStats zeroes everything except gameCompletions', () => {
		stats.deaths = 3;
		stats.victories = 5;
		stats.transfers = 7;
		stats.hyperspaceCount = 2;
		stats.absorbed.sentinel = 1;
		stats.gameCompletions = 4;
		stats.completedGameThisRun = true;

		resetStats();

		expect(stats.deaths).toBe(0);
		expect(stats.victories).toBe(0);
		expect(stats.transfers).toBe(0);
		expect(stats.hyperspaceCount).toBe(0);
		expect(stats.absorbed.sentinel).toBe(0);
		expect(stats.completedGameThisRun).toBe(false);
		expect(stats.gameCompletions).toBe(4);
	});

	it('saveStats/loadStats round-trip through localStorage', () => {
		stats.deaths = 2;
		stats.gameCompletions = 1;
		saveStats();

		stats.deaths = 0;
		stats.gameCompletions = 0;
		loadStats();

		expect(stats.deaths).toBe(2);
		expect(stats.gameCompletions).toBe(1);
	});
});

/*
 The player's record and the demo bot's are the same shape and share every recorder; the target
 decides which one is written. This is the gate that keeps an unattended attract-mode run out of
 the player's history, so it is worth asserting each recorder honours it rather than trusting that
 no direct mutation was left behind somewhere.
*/
describe('the two stats records', () => {
	beforeEach(() => {
		store.clear();
		setStatsTarget('player');
		for (const record of [stats, demoStats]) {
			record.deaths = 0;
			record.victories = 0;
			record.transfers = 0;
			record.absorbed.tree = 0;
			record.gameCompletions = 0;
			record.completedGameThisRun = false;
		}
	});

	it('routes every recorder to the demo record while the demo is the target', () => {
		setStatsTarget('demo');
		recordAbsorb(GameObjType.TREE);
		recordTransfer();
		recordDeath();
		recordVictory(true);

		expect(demoStats).toMatchObject({ deaths: 1, victories: 1, transfers: 1, gameCompletions: 1 });
		expect(demoStats.absorbed.tree).toBe(1);
		expect(stats).toMatchObject({ deaths: 0, victories: 0, transfers: 0, gameCompletions: 0 });
		expect(stats.absorbed.tree).toBe(0);
	});

	it('persists the two records under separate keys', () => {
		setStatsTarget('demo');
		recordDeath();
		setStatsTarget('player');
		recordDeath();
		recordDeath();

		expect(JSON.parse(store.get('demoStats')!).deaths).toBe(1);
		expect(JSON.parse(store.get('stats')!).deaths).toBe(2);

		demoStats.deaths = 0;
		stats.deaths = 0;
		loadStats();
		expect(demoStats.deaths).toBe(1);
		expect(stats.deaths).toBe(2);
	});

	it('resets only the record that is current, and activeStats reports it', () => {
		setStatsTarget('demo');
		recordDeath();
		setStatsTarget('player');
		recordDeath();

		setStatsTarget('demo');
		expect(activeStats()).toBe(demoStats);
		resetStats();
		expect(demoStats.deaths).toBe(0);
		expect(stats.deaths).toBe(1);

		setStatsTarget('player');
		expect(activeStats()).toBe(stats);
	});
});
