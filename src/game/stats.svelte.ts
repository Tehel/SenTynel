/*
 Lifetime stats, kept in two independent records.

 `stats` is the player's. `demoStats` is the demo bot's (see game/demo.svelte.ts, which holds the
 matching half — its level cursor and unlocked list). They have the same shape and share every
 recorder below; which one a recorder writes to is decided once per run by setStatsTarget, called
 from game/state.svelte.ts as a level begins. Nothing the bot does can reach the player's record:
 an unattended attract-mode run would otherwise inflate every counter here and, on reaching
 landscape 9999, bump gameCompletions — which permanently speeds up watcher rotation
 (world/objects/watcher.ts).

 Every mutation goes through a recorder rather than being written at the call site, so that gate
 has no holes. Readers that should follow whoever is playing use activeStats().
*/

import { GameObjType } from '../world/terrain';
import { logEvent } from './log';

const PLAYER_KEY = 'stats';
const DEMO_KEY = 'demoStats';

const emptyStats = () => ({
	deaths: 0,
	victories: 0,
	transfers: 0,
	hyperspaceCount: 0,
	absorbed: {
		tree: 0,
		sentry: 0,
		sentinel: 0,
		meanie: 0,
	},
	gameCompletions: 0,
	// Guards "a game completion only counts once per run" — cleared by resetStats(), set the
	// first time landscape 9999 is won in a run. gameCompletions itself is intentionally NOT
	// cleared by resetStats() — see its call site.
	completedGameThisRun: false,
});

export type Stats = ReturnType<typeof emptyStats>;

export const stats = $state(emptyStats());
export const demoStats = $state(emptyStats());

// Which record the recorders write to and activeStats() reports. The player's until told
// otherwise, so anything that forgets to set it can only ever under-count the bot.
let target: Stats = stats;

export function setStatsTarget(which: 'player' | 'demo'): void {
	target = which === 'demo' ? demoStats : stats;
}

// The record belonging to whoever is playing. Used by readers that should reflect the current run
// rather than the player's history specifically — the win screen's summary, and the per-completion
// watcher speedup (so the bot compounds its own completions and the player theirs).
export function activeStats(): Stats {
	return target;
}

function readInto(record: Stats, key: string): void {
	const dataStr = localStorage.getItem(key);
	if (!dataStr) return;
	try {
		const data = JSON.parse(dataStr);
		for (const field of Object.keys(record) as Array<keyof Stats>) {
			if (data[field] !== undefined) (record as any)[field] = data[field];
		}
	} catch (e) {
		console.warn(`Saved stats (${key}) is not valid JSON: `, e);
	}
}

export function loadStats(): void {
	readInto(stats, PLAYER_KEY);
	readInto(demoStats, DEMO_KEY);
}

export function saveStats(): void {
	localStorage.setItem(target === demoStats ? DEMO_KEY : PLAYER_KEY, JSON.stringify(target));
}

// Clears everything except gameCompletions, which a "Reset progress" is meant to preserve — it's
// the record of how many full playthroughs have ever been completed. Acts on whichever record is
// current, so the same function serves the player's reset and the demo's.
export function resetStats(): void {
	target.deaths = 0;
	target.victories = 0;
	target.transfers = 0;
	target.hyperspaceCount = 0;
	target.absorbed.tree = 0;
	target.absorbed.sentry = 0;
	target.absorbed.sentinel = 0;
	target.absorbed.meanie = 0;
	target.completedGameThisRun = false;
	saveStats();
	logEvent('state', 'statsReset', { record: target === demoStats ? 'demo' : 'player' });
}

// Single choke point for absorb counting, mirroring game/rules.ts's ENERGY_COST table.
// Boulder/Synthoid are intentionally absent — absorbing your own utility objects isn't
// tracked, only the "real" game entities.
const ABSORB_STAT_KEY: Partial<Record<GameObjType, keyof Stats['absorbed']>> = {
	[GameObjType.TREE]: 'tree',
	[GameObjType.SENTRY]: 'sentry',
	[GameObjType.SENTINEL]: 'sentinel',
	[GameObjType.MEANIE]: 'meanie',
};

export function recordAbsorb(type: GameObjType): void {
	const key = ABSORB_STAT_KEY[type];
	if (!key) return;
	target.absorbed[key]++;
	saveStats();
}

export function recordTransfer(): void {
	target.transfers++;
	saveStats();
}

// Voluntary hyperspace only. The Meanie-forced jump (engine/meanie.ts) is deliberately not
// counted, and neither is the pedestal jump that wins the landscape.
export function recordHyperspace(): void {
	target.hyperspaceCount++;
	saveStats();
}

// `isFinalLevel` is whether the landscape just won was 9999 — completing it is "the game", but
// replaying it (there's nowhere further to jump to) only counts once per run.
export function recordVictory(isFinalLevel: boolean): void {
	target.victories++;
	if (isFinalLevel && !target.completedGameThisRun) {
		target.gameCompletions++;
		target.completedGameThisRun = true;
	}
	saveStats();
}

export function recordDeath(): void {
	target.deaths++;
	saveStats();
}
