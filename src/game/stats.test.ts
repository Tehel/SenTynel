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
const { stats, resetStats, recordAbsorb, loadStats, saveStats } = await import('./stats.svelte');

describe('stats', () => {
	beforeEach(() => {
		store.clear();
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
