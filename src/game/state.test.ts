import { describe, it, expect, beforeEach, vi } from 'vitest';

// state.svelte.ts (via settings.svelte.ts and stats.svelte.ts) persists to localStorage
// on every mutation — stub a minimal in-memory implementation, see stats.test.ts.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => store.set(k, v),
	removeItem: (k: string) => store.delete(k),
	clear: () => store.clear(),
});

const { settings } = await import('../settings.svelte');
const { game, triggerWon, completeWon, triggerLost, enterBirdsEye, completeBirdsEyeExit, pauseGame, resumeGame } =
	await import('./state.svelte');
const { stats, resetStats } = await import('./stats.svelte');

describe('final-landscape win handling', () => {
	beforeEach(() => {
		store.clear();
		settings.levelId = 0;
		settings.levelIds = [0];
		game.energy = 10;
		game.phase = 'PLAYING';
		resetStats();
		// resetStats() intentionally preserves gameCompletions across resets (by design) —
		// zero it here too, purely for test isolation between cases in this file.
		stats.gameCompletions = 0;
	});

	it('caps the jump at 9999 and unlocks it when the jump would overshoot', () => {
		settings.levelId = 9990;
		settings.levelIds = [0, 9990];
		game.energy = 20; // would land on 10010 uncapped
		triggerWon();
		completeWon();
		expect(settings.levelId).toBe(9999);
		expect(settings.levelIds).toContain(9999);
	});

	it('does not advance or unlock a new level when landscape 9999 itself is won', () => {
		settings.levelId = 9999;
		settings.levelIds = [0, 9999];
		game.energy = 20;
		triggerWon();
		completeWon();
		expect(settings.levelId).toBe(9999);
		expect(settings.levelIds).toEqual([0, 9999]);
	});

	it('counts a game completion only once per run, again after a reset', () => {
		settings.levelId = 9999;
		settings.levelIds = [0, 9999];

		triggerWon();
		completeWon();
		expect(stats.gameCompletions).toBe(1);

		// Replaying landscape 9999 in the same run must not add another completion.
		game.phase = 'PLAYING';
		triggerWon();
		completeWon();
		expect(stats.gameCompletions).toBe(1);

		// Reset clears the "already completed this run" guard (but not the count itself),
		// so the next win on 9999 counts again.
		resetStats();
		game.phase = 'PLAYING';
		settings.levelId = 9999;
		triggerWon();
		completeWon();
		expect(stats.gameCompletions).toBe(2);
	});

	it('triggerLost increments the death count once per LOST transition', () => {
		triggerLost();
		triggerLost(); // already LOST — must not double-count
		expect(stats.deaths).toBe(1);
	});
});

describe('bird\'s-eye view transitions', () => {
	beforeEach(() => {
		game.phase = 'PLAYING';
	});

	it('only enters BIRDSEYE from PLAYING', () => {
		enterBirdsEye();
		expect(game.phase).toBe('BIRDSEYE');

		game.phase = 'PAUSED';
		enterBirdsEye(); // no-op — not in PLAYING
		expect(game.phase).toBe('PAUSED');
	});

	it('only completes the BIRDSEYE exit from BIRDSEYE', () => {
		completeBirdsEyeExit(); // no-op — not in BIRDSEYE
		expect(game.phase).toBe('PLAYING');

		enterBirdsEye();
		completeBirdsEyeExit();
		expect(game.phase).toBe('PLAYING');
	});

	it('pauseGame/resumeGame round-trip from BIRDSEYE lands back in PLAYING', () => {
		enterBirdsEye();
		pauseGame();
		expect(game.phase).toBe('PAUSED');
		resumeGame();
		expect(game.phase).toBe('PLAYING');
	});
});
