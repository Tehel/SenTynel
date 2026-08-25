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
	startGame, startDemo, advanceDemo, exitDemo, failDemo, currentLevelId, resetDemoRun,
	resumeDemo, resetDemoAndRestart, stepLevelId,
} = await import('./state.svelte');
const { stats, demoStats, resetStats, setStatsTarget } = await import('./stats.svelte');
const {
	demoProgress, STRIKES_BEFORE_BLACKLIST, IMPOSSIBLE_LEVELS, isDemoBlacklisted, isProvenImpossible,
	blacklistDemoLevel,
} = await import('./demo.svelte');

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

describe('stepping an unlocked-landscape list', () => {
	it('walks in both directions', () => {
		expect(stepLevelId([0, 7, 19], 7, 1)).toBe(19);
		expect(stepLevelId([0, 7, 19], 7, -1)).toBe(0);
	});

	it('stops at each end instead of wrapping', () => {
		expect(stepLevelId([0, 7, 19], 19, 1)).toBeNull();
		expect(stepLevelId([0, 7, 19], 0, -1)).toBeNull();
	});

	it('refuses to step from a landscape that is not in the list', () => {
		expect(stepLevelId([0, 7, 19], 12, 1)).toBeNull();
	});

	it('handles a single-entry list, which is where every journey starts', () => {
		expect(stepLevelId([0], 0, 1)).toBeNull();
		expect(stepLevelId([0], 0, -1)).toBeNull();
	});
});

describe('pausing and resuming a demo (touch control)', () => {
	beforeEach(() => {
		store.clear();
		settings.levelId = 100;
		settings.levelIds = [0, 100];
		demoProgress.levelId = 7;
		demoProgress.levelIds = [0, 7, 19];
		demoProgress.cameFrom = 0;
		demoProgress.blacklist = [];
		game.phase = 'MENU';
		resetStats();
		startDemo();
	});

	it('resumes the paused run untouched when the stepper never moved', () => {
		game.energy = 4; // mid-run
		pauseGame();
		resumeDemo(null);
		expect(game.phase).toBe('PLAYING');
		expect(demoProgress.levelId).toBe(7);
		// A resume is not a restart: the run's energy survives it.
		expect(game.energy).toBe(4);
	});

	it('treats a stepper left on the running landscape as a plain resume', () => {
		game.energy = 4;
		pauseGame();
		resumeDemo(7);
		expect(game.phase).toBe('PLAYING');
		expect(game.energy).toBe(4);
	});

	it('begins the chosen landscape fresh when the stepper moved', () => {
		game.energy = 4;
		pauseGame();
		resumeDemo(19);
		expect(game.phase).toBe('PLAYING');
		expect(demoProgress.levelId).toBe(19);
		expect(currentLevelId()).toBe(19);
		// A full beginLevel(), not a resume — the landscape is new, so the purse is too.
		expect(game.energy).toBe(10);
	});

	it('leaves no rewind target or strike behind a hand-picked landscape', () => {
		// Nothing paid for this landing, so failDemo() must hand back to the menu rather than
		// rewind onto a jump that never happened. See setDemoLevel.
		pauseGame();
		resumeDemo(19);
		expect(demoProgress.cameFrom).toBeNull();
		expect(demoProgress.strikes).toBe(0);
	});

	it('does nothing outside a paused demo', () => {
		game.phase = 'PLAYING';
		resumeDemo(19);
		expect(demoProgress.levelId).toBe(7);

		startGame(); // not a demo any more
		game.phase = 'PAUSED';
		resumeDemo(19);
		expect(demoProgress.levelId).toBe(7);
		expect(game.phase).toBe('PAUSED');
	});

	it('leaves the player\'s progress alone across a pause and a re-pick', () => {
		pauseGame();
		resumeDemo(19);
		expect(settings.levelId).toBe(100);
		expect(settings.levelIds).toEqual([0, 100]);
	});

	it('resets and restarts on landscape 0, keeping the demo driving', () => {
		demoProgress.blacklist = [482];
		pauseGame();
		resetDemoAndRestart();
		expect(demoProgress.levelId).toBe(0);
		expect(demoProgress.levelIds).toEqual([0]);
		expect(demoProgress.blacklist).toEqual([]);
		expect(game.phase).toBe('PLAYING');
		expect(game.demo).toBe(true);
		expect(game.energy).toBe(10);
		// The bot's own record was cleared; the player's is untouched.
		expect(settings.levelId).toBe(100);
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

/*
 THE THREE-STRIKE BLACKLIST. Reported from watching the demo stall on landscape 482 — a map whose
 only two flat tiles at the starting altitude are the pair the body starts on, so nothing can be
 climbed and hyperspace merely swaps between them.

 A dead landscape has to be left behind WITHOUT handing the demo a landing it never earned, which is
 what makes the rewind the load-bearing part rather than the list: the cursor goes back to a
 landscape the bot actually won, and the same win then buys a different jump because
 chooseDemoLanding consults the list. Every test here is really about that invariant.

 The strike count lives on the cursor, not on a per-landscape map, so "in a row" is what these
 assert — a win in between has to reset it.
*/
describe('demo failure handling: strikes, blacklist and rewind', () => {
	// Failing once, as the supervisor in App.svelte does: LOST, then failDemo(). `haltWhenStranded`
	// is what touch passes, having no usable menu to be handed back to.
	const loseOnce = (haltWhenStranded = false) => {
		game.phase = 'PLAYING';
		triggerLost();
		return failDemo({ haltWhenStranded });
	};

	beforeEach(() => {
		store.clear();
		settings.levelId = 40;
		settings.levelIds = [0, 40];
		demoProgress.levelId = 500;
		demoProgress.levelIds = [0, 400, 500];
		// The demo reached 500 by winning 400 — the state a real run is in, and what gives the
		// rewind somewhere to go.
		demoProgress.cameFrom = 400;
		demoProgress.strikes = 0;
		demoProgress.strikeLevelId = null;
		demoProgress.blacklist = [];
		game.phase = 'MENU';
		game.demo = false;
		game.levelEpoch = 0;
		setStatsTarget('player');
		resetStats();
		setStatsTarget('demo');
		resetStats();
		setStatsTarget('player');
	});

	it('retries the same landscape on the first two failures, with a fresh seed each time', () => {
		startDemo();
		expect(loseOnce()).toBe(true);

		expect(demoProgress.levelId).toBe(500);
		expect(demoProgress.strikes).toBe(1);
		expect(demoProgress.blacklist).toEqual([]);
		// Straight back into play rather than out to the menu — the whole point of an unattended run.
		expect(game.phase).toBe('PLAYING');
		expect(game.demo).toBe(true);
		// A retry that replayed the same seed would be one sample counted three times. levelEpoch is
		// also what MainView's Effect 2 rebuilds the scene on, so the bot can't restart on wreckage.
		expect(game.levelEpoch).toBe(1);

		expect(loseOnce()).toBe(true);
		expect(demoProgress.strikes).toBe(2);
		expect(demoProgress.levelId).toBe(500);
		expect(game.levelEpoch).toBe(2);
	});

	it('blacklists on the third failure and rewinds to the landscape that paid for it', () => {
		startDemo();
		for (let i = 0; i < STRIKES_BEFORE_BLACKLIST - 1; i++) expect(loseOnce()).toBe(true);
		expect(loseOnce()).toBe(true);

		expect(demoProgress.blacklist).toEqual([500]);
		expect(demoProgress.levelId).toBe(400);
		// Cleared, so one rewind cannot be spent twice: the target has to be won again before the
		// chain continues, which is what bounds the whole mechanism.
		expect(demoProgress.cameFrom).toBeNull();
		expect(demoProgress.strikes).toBe(0);
		// Still playing, and now on a landscape it has beaten before.
		expect(game.phase).toBe('PLAYING');
		expect(game.demo).toBe(true);
	});

	// The blacklist must never reach the player. It is a verdict on the bot, not on the game.
	it('leaves the player\'s progress untouched throughout', () => {
		startDemo();
		for (let i = 0; i < STRIKES_BEFORE_BLACKLIST; i++) loseOnce();

		expect(settings.levelId).toBe(40);
		expect(settings.levelIds).toEqual([0, 40]);
	});

	/*
	 "Three times in a row", not three times ever. A landscape the bot loses twice and then beats has
	 proved the losses were samples, and its count has to go back to zero — otherwise a long journey
	 accumulates a strike here and a strike there and blacklists landscapes the bot can win.
	*/
	it('forgets earlier failures once the landscape is won', () => {
		startDemo();
		loseOnce();
		loseOnce();
		expect(demoProgress.strikes).toBe(2);

		game.phase = 'PLAYING';
		game.energy = 9;
		triggerWon();
		advanceDemo();

		expect(demoProgress.levelId).toBe(509);
		expect(demoProgress.strikes).toBe(0);
		expect(demoProgress.blacklist).toEqual([]);
		// And the landscape just won is what the next failure will rewind to.
		expect(demoProgress.cameFrom).toBe(500);
	});

	/*
	 The demo's first landscape has no win behind it, so there is nothing to re-steer and no way to
	 leave without either looping on it forever or being handed a landing for free. Handing back to
	 the menu is the old pre-blacklist behaviour, kept for exactly this case.
	*/
	it('hands back to the menu when there is nothing behind it to re-steer', () => {
		demoProgress.levelId = 0;
		demoProgress.cameFrom = null;
		startDemo();

		expect(loseOnce()).toBe(false);
		expect(game.phase).toBe('MENU');
		expect(game.demo).toBe(false);
		expect(demoProgress.levelId).toBe(0);
		// No strike counted either: a landscape that cannot be rewound away from cannot be
		// blacklisted, so counting towards a verdict that can never be reached would be misleading.
		expect(demoProgress.strikes).toBe(0);
		expect(demoProgress.blacklist).toEqual([]);
	});

	// The wrap after 9999 starts the journey over, and that is not a jump anyone could re-steer.
	it('leaves no rewind target after wrapping past landscape 9999', () => {
		demoProgress.levelId = 9999;
		startDemo();
		game.energy = 5;
		triggerWon();
		advanceDemo();

		expect(demoProgress.levelId).toBe(0);
		expect(demoProgress.cameFrom).toBeNull();
	});

	// A rewind onto a landscape already given up on would be starting a run we know ends badly.
	it('hands back to the menu rather than rewinding onto a blacklisted landscape', () => {
		demoProgress.blacklist = [400];
		startDemo();
		for (let i = 0; i < STRIKES_BEFORE_BLACKLIST; i++) loseOnce();

		expect(demoProgress.blacklist).toEqual([400, 500]);
		expect(game.phase).toBe('MENU');
		expect(game.demo).toBe(false);
	});

	/*
	 The hard-coded impossible list (game/demo.svelte.ts's IMPOSSIBLE_LEVELS). Reaching that verdict
	 by play costs up to three DEMO_LEVEL_LIMIT_MS losses, on every fresh device — so the ones a
	 human has proven are seeded, and are kept apart from the ones the bot earned.
	*/
	it('writes off a proven-impossible landscape on the first loss, without sampling it', () => {
		const impossible = IMPOSSIBLE_LEVELS[0];
		demoProgress.levelId = impossible;
		demoProgress.levelIds = [0, 400, impossible];
		demoProgress.cameFrom = 400;
		startDemo();

		expect(loseOnce()).toBe(true);
		// Straight to the rewind — no three strikes, since the shape is already recorded.
		expect(demoProgress.levelId).toBe(400);
		expect(demoProgress.strikes).toBe(0);
		// And not claimed as this run's discovery: the earned list is what the menu counts and what
		// a reset clears, and a seeded landscape has no business in either.
		expect(demoProgress.blacklist).toEqual([]);
	});

	it('still samples an ordinary landscape three times before writing it off', () => {
		// The other half: the immediate write-off must be scoped to the seeded list, or one unlucky
		// loss would permanently exclude a landscape the bot can usually win.
		startDemo();
		expect(loseOnce()).toBe(true);
		expect(demoProgress.strikes).toBe(1);
		expect(demoProgress.blacklist).toEqual([]);
	});

	it('steers landings away from a proven-impossible landscape with nothing recorded', () => {
		expect(demoProgress.blacklist).toEqual([]);
		expect(isDemoBlacklisted(IMPOSSIBLE_LEVELS[0])).toBe(true);
		expect(isProvenImpossible(IMPOSSIBLE_LEVELS[0])).toBe(true);
	});

	it('keeps a proven-impossible landscape out of the earned list', () => {
		blacklistDemoLevel(IMPOSSIBLE_LEVELS[0]);
		expect(demoProgress.blacklist).toEqual([]);
	});

	/*
	 STRANDED, HELD RATHER THAN DROPPED (2026-08-25). Handing back to the menu is right on a desktop
	 and useless on a phone, whose menu is an arrow-key tree it cannot drive — so touch asks to be held
	 in PAUSED, where the demo's touch controls already offer the two ways out.
	*/
	it('strands the demo in PAUSED when there is nothing behind it to re-steer', () => {
		demoProgress.cameFrom = null;
		startDemo();
		expect(loseOnce(true)).toBe(false);

		expect(game.phase).toBe('PAUSED');
		expect(game.demo).toBe(true);
		expect(game.demoHalted).toBe(true);
		// The cursor stays put: there was nowhere honest to move it, which is why we are here.
		expect(demoProgress.levelId).toBe(500);
	});

	it('strands rather than rewinding onto a landscape already given up on', () => {
		demoProgress.blacklist = [400];
		startDemo();
		for (let i = 0; i < STRIKES_BEFORE_BLACKLIST; i++) loseOnce(true);

		expect(demoProgress.blacklist).toEqual([400, 500]);
		expect(game.phase).toBe('PAUSED');
		expect(game.demoHalted).toBe(true);
	});

	it('still hands back to the menu when the caller has a menu to hand back to', () => {
		demoProgress.cameFrom = null;
		startDemo();
		loseOnce();
		expect(game.phase).toBe('MENU');
		expect(game.demoHalted).toBe(false);
	});

	it('replays the landscape with a fresh seed when a stranded demo is resumed untouched', () => {
		demoProgress.cameFrom = null;
		startDemo();
		loseOnce(true);
		const epoch = game.levelEpoch;

		resumeDemo(null);
		expect(game.phase).toBe('PLAYING');
		expect(game.demoHalted).toBe(false);
		expect(demoProgress.levelId).toBe(500);
		// Never a resume in place: that would drop the bot into the scene it just lost on, with the
		// energy it lost with. A rebuild and a fresh seed, which is what levelEpoch drives.
		expect(game.levelEpoch).toBe(epoch + 1);
		expect(game.energy).toBe(10);
	});

	it('plays the landscape a stranded demo was steered onto', () => {
		demoProgress.cameFrom = null;
		demoProgress.levelIds = [0, 400, 500];
		startDemo();
		loseOnce(true);

		resumeDemo(400);
		expect(game.phase).toBe('PLAYING');
		expect(game.demoHalted).toBe(false);
		expect(demoProgress.levelId).toBe(400);
		expect(currentLevelId()).toBe(400);
		expect(game.energy).toBe(10);
	});

	it('can be reset straight out of a stranded pause', () => {
		demoProgress.cameFrom = null;
		startDemo();
		loseOnce(true);

		resetDemoAndRestart();
		expect(demoProgress.levelId).toBe(0);
		expect(game.phase).toBe('PLAYING');
		expect(game.demoHalted).toBe(false);
		expect(settings.levelId).toBe(40); // the player's record, untouched
	});

	it('clears the blacklist and the rewind trail on a demo reset', () => {
		demoProgress.blacklist = [482, 500];
		demoProgress.strikes = 2;
		demoProgress.strikeLevelId = 500;
		resetDemoRun();

		expect(demoProgress.blacklist).toEqual([]);
		expect(demoProgress.levelId).toBe(0);
		expect(demoProgress.cameFrom).toBeNull();
		expect(demoProgress.strikes).toBe(0);
		expect(demoProgress.strikeLevelId).toBeNull();
	});

	it('keeps the proven-impossible landscapes across a reset', () => {
		// A claim about the game, not about this bot — so a fresh journey has nothing to re-litigate
		// and must not spend a quarter of an hour rediscovering it.
		resetDemoRun();
		expect(isDemoBlacklisted(IMPOSSIBLE_LEVELS[0])).toBe(true);
	});
});
