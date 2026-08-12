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

export const demoProgress = $state({
	// The landscape the bot plays next.
	levelId: 0,
	// Every landscape it has reached, in the same shape as settings.levelIds — it is what the
	// "Landscapes unlocked" line of the final win screen counts.
	levelIds: [0] as number[],
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

// Sends the demo back to landscape 0. Its own escape hatch: a landscape the bot can't win is
// re-attempted every time the demo starts (game/state.svelte.ts's failure path leaves the cursor
// where it is on purpose), which is useful signal but needs a way out.
export function resetDemoProgress(): void {
	demoProgress.levelId = 0;
	demoProgress.levelIds = [0];
	saveDemoProgress();
}
