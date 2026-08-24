/*
 The demo bot's own saved progress, kept entirely apart from the player's.

 Attract mode plays landscape after landscape unattended, and every win would otherwise land in
 settings.levelIds and be unlocked for a player who never touched them — to say nothing of a run
 that reaches 9999 and bumps stats.gameCompletions, which permanently speeds up watcher rotation
 (world/objects/watcher.ts). So the bot keeps its own cursor and its own unlocked list here, and
 its own lifetime stats in stats.svelte.ts's `demoStats`. Nothing it does can reach the player's
 record.

 The side benefit is that the demo resumes: it picks up on the landscape it reached last time
 rather than restarting from wherever the menu happens to be pointing.

 Data and persistence only — deliberately no import of state.svelte.ts, which imports this (the
 currentLevelId() selector lives there, where both this and settings are in scope).
*/

const STORAGE_KEY = 'demoState';

/*
 Three consecutive failures on one landscape is what earns a place on the blacklist. Consecutive
 rather than cumulative, and three rather than one, because the bot is not deterministic across
 runs in a browser: the 1 Hz cadence lands differently against the 4 Hz drain depending on frame
 timing, so one loss is a sample and not a verdict (engine/bot.harness.test.ts makes the same point
 with BOT_FRAME_MS). Three in a row on the same landscape is a shape, not a coin toss.
*/
export const STRIKES_BEFORE_BLACKLIST = 3;

export const demoProgress = $state({
	// The landscape the bot plays next.
	levelId: 0,
	// Every landscape it has reached, in the same shape as settings.levelIds — it is what the
	// "Landscapes unlocked" line of the final win screen counts.
	levelIds: [0] as number[],
	/*
	 Where `levelId` was reached FROM — the landscape whose win jumped us here, or null when there
	 is no such landscape (the demo's origin, a fresh reset, or the wrap after 9999).

	 It exists so that a dead end has somewhere to rewind TO. A landscape the bot cannot finish has
	 to be left behind somehow, and nudging the cursor past it would hand the demo a landscape it
	 never earned. Rewinding to the one it demonstrably won and re-steering that jump keeps every
	 landing paid for.
	*/
	cameFrom: null as number | null,
	/*
	 Consecutive failures on `strikeLevelId`. Two scalars rather than a map keyed by landscape,
	 because "three times in a row" is only ever asked about the landscape under the cursor: the
	 moment the cursor moves the count is meaningless and resets itself, which a map would instead
	 accumulate silently across an entire journey.
	*/
	strikes: 0,
	strikeLevelId: null as number | null,
	/*
	 Landscapes the bot has failed STRIKES_BEFORE_BLACKLIST times in a row, so `chooseDemoLanding`
	 steers its landings around them (game/route.ts).

	 EVIDENCE, NOT CURATION — the distinction PLAN-BOT2.md's "On maintaining a blacklist of
	 unwinnable landscapes" turns on. Everything here was actually played and actually lost, which
	 is why the list self-heals: it is cleared wholesale by "Reset demo progress", so an improved
	 bot gets to disagree with every entry rather than inheriting yesterday's weaknesses. Nothing
	 prunes it automatically, because the list IS the bug report — a landscape on it is either
	 genuinely dead (482, whose map holds two flat tiles at the starting altitude and no way up) or
	 the next thing to fix.
	*/
	blacklist: [] as number[],
});

export function loadDemoProgress(): void {
	const dataStr = localStorage.getItem(STORAGE_KEY);
	if (!dataStr) return;
	try {
		const data = JSON.parse(dataStr);
		for (const key of Object.keys(demoProgress) as Array<keyof typeof demoProgress>) {
			if (data[key] !== undefined) (demoProgress as any)[key] = data[key];
		}
	} catch (e) {
		console.warn('Saved demo progress is not valid JSON: ', e);
	}
}

export function saveDemoProgress(): void {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(demoProgress));
}

// Sends the demo back to landscape 0 and forgets everything it learned on the way. Its own escape
// hatch, and now also the only thing that clears the blacklist: the journey is what produced the
// list, so starting the journey over is exactly the moment to stop trusting it.
export function resetDemoProgress(): void {
	demoProgress.levelId = 0;
	demoProgress.levelIds = [0];
	demoProgress.cameFrom = null;
	demoProgress.strikes = 0;
	demoProgress.strikeLevelId = null;
	// Cleared with everything else, and deliberately: the list records what THIS bot could not do,
	// so it must not outlive a decision to start the journey over. See the field's own note.
	demoProgress.blacklist = [];
	saveDemoProgress();
}

// Does the demo steer around this landscape? Consulted by game/route.ts's isPlayableLanding, and
// deliberately demo-only — nothing here can reach the player's own progression.
export function isDemoBlacklisted(levelId: number): boolean {
	return demoProgress.blacklist.includes(levelId);
}

/*
 Count one failure on the landscape under the cursor and return the new consecutive total.

 Re-seats the counter whenever the cursor has moved since the last strike, which is what makes the
 count "in a row" without anything having to remember to clear it on the way past.
*/
export function recordDemoStrike(): number {
	if (demoProgress.strikeLevelId !== demoProgress.levelId) {
		demoProgress.strikeLevelId = demoProgress.levelId;
		demoProgress.strikes = 0;
	}
	demoProgress.strikes++;
	saveDemoProgress();
	return demoProgress.strikes;
}

export function clearDemoStrikes(): void {
	demoProgress.strikes = 0;
	demoProgress.strikeLevelId = null;
	saveDemoProgress();
}

export function blacklistDemoLevel(levelId: number): void {
	if (demoProgress.blacklist.includes(levelId)) return;
	demoProgress.blacklist.push(levelId);
	demoProgress.blacklist.sort((a, b) => a - b);
	saveDemoProgress();
}
