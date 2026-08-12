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
const {
	game, triggerWon, completeWon, triggerLost, enterBirdsEye, completeBirdsEyeExit,
	pauseGame, resumeGame, beginTransfer, completeTransfer,
	startGame, startDemo, advanceDemo, exitDemo, currentLevelId, resetDemoRun,
} = await import('./state.svelte');
const { stats, demoStats, resetStats, setStatsTarget } = await import('./stats.svelte');
const { demoProgress } = await import('./demo.svelte');

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

/*
 The demo sandbox. Attract mode plays landscape after landscape unattended, so nothing it does may
 reach the player's record — otherwise an overnight run unlocks hundreds of landscapes nobody
 played and inflates every lifetime counter.
*/
describe('demo mode keeps its own progress', () => {
	beforeEach(() => {
		store.clear();
		settings.levelId = 40;
		settings.levelIds = [0, 40];
		demoProgress.levelId = 100;
		demoProgress.levelIds = [0, 100];
		game.phase = 'MENU';
		game.demo = false;
		setStatsTarget('player');
		resetStats();
		stats.gameCompletions = 0;
		setStatsTarget('demo');
		resetStats();
		demoStats.gameCompletions = 0;
		setStatsTarget('player');
	});

	it('plays its own landscape, not the one selected in the menu', () => {
		expect(currentLevelId()).toBe(40);
		startDemo();
		expect(currentLevelId()).toBe(100);
		// ...and hands the cursor straight back on the way out.
		exitDemo();
		expect(currentLevelId()).toBe(40);
	});

	it('advances its own cursor on a win and leaves the player\'s progress alone', () => {
		startDemo();
		game.energy = 7;
		triggerWon();
		advanceDemo();

		expect(demoProgress.levelId).toBe(107);
		expect(demoProgress.levelIds).toContain(107);
		expect(settings.levelId).toBe(40);
		expect(settings.levelIds).toEqual([0, 40]);
		// Straight into the next landscape — no trip through MENU, which is what makes it attract
		// mode rather than a sequence of demos.
		expect(game.phase).toBe('PLAYING');
		expect(game.demo).toBe(true);
		expect(game.energy).toBe(10);
	});

	it('counts its wins and deaths against its own record', () => {
		startDemo();
		triggerWon();
		expect(demoStats.victories).toBe(1);
		expect(stats.victories).toBe(0);

		game.phase = 'PLAYING';
		triggerLost();
		expect(demoStats.deaths).toBe(1);
		expect(stats.deaths).toBe(0);
	});

	// The bot compounding the player's watcher speedup (world/objects/watcher.ts reads
	// gameCompletions) would be the worst of the leaks — it isn't undone by a reset.
	it('cannot bump the player\'s completion count by finishing landscape 9999', () => {
		demoProgress.levelId = 9999;
		startDemo();
		triggerWon();
		expect(demoStats.gameCompletions).toBe(1);
		expect(stats.gameCompletions).toBe(0);
	});

	// Nowhere further to jump, so the run starts over rather than sitting on the last landscape.
	it('wraps back to landscape 0 after winning 9999', () => {
		demoProgress.levelId = 9999;
		startDemo();
		game.energy = 5;
		triggerWon();
		advanceDemo();
		expect(demoProgress.levelId).toBe(0);
	});

	// A failure deliberately leaves the cursor where it is, so the bot re-attempts its weakest
	// landscape. resetDemoRun is the way out of that.
	it('holds its cursor on a loss, and Reset demo progress clears it', () => {
		startDemo();
		triggerLost('stalled');
		expect(game.lostReason).toBe('stalled');
		exitDemo();
		expect(game.phase).toBe('MENU');
		expect(demoProgress.levelId).toBe(100);

		resetDemoRun();
		expect(demoProgress.levelId).toBe(0);
		expect(demoStats.deaths).toBe(0);
		// The player's record is untouched either way, and the target is back on them.
		expect(settings.levelId).toBe(40);
		startGame();
		expect(currentLevelId()).toBe(40);
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

describe('body-transfer pause handling', () => {
	beforeEach(() => {
		game.phase = 'PLAYING';
	});

	it('pauseGame/resumeGame round-trip from TRANSFER lands back in TRANSFER', () => {
		beginTransfer(1, 1);
		expect(game.phase).toBe('TRANSFER');
		pauseGame();
		expect(game.phase).toBe('PAUSED');
		resumeGame();
		expect(game.phase).toBe('TRANSFER');
	});

	it('pauseGame/resumeGame round-trip from PLAYING still lands back in PLAYING', () => {
		pauseGame();
		expect(game.phase).toBe('PAUSED');
		resumeGame();
		expect(game.phase).toBe('PLAYING');
	});

	it('completeTransfer is a no-op while PAUSED — the camera glide only completes it from TRANSFER', () => {
		beginTransfer(1, 1);
		pauseGame();
		completeTransfer();
		expect(game.phase).toBe('PAUSED');
		resumeGame();
		expect(game.phase).toBe('TRANSFER');
	});
});
