import { GameObjType } from '../world/terrain';
import { logEvent } from './log';

export const stats = $state({
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
	// Guards "a game completion only counts once per run" — cleared by resetStats(),
	// set the first time landscape 9999 is won in a run. gameCompletions itself is
	// intentionally NOT cleared by resetStats() — see its call site.
	completedGameThisRun: false,
});

export function loadStats(): void {
	const dataStr = localStorage.getItem('stats');
	if (!dataStr) return;
	try {
		const data = JSON.parse(dataStr);
		for (const key of Object.keys(stats) as Array<keyof typeof stats>) {
			if (data[key] !== undefined) (stats as any)[key] = data[key];
		}
	} catch (e) {
		console.warn('Saved stats is not valid JSON: ', e);
	}
}

export function saveStats(): void {
	localStorage.setItem('stats', JSON.stringify(stats));
}

// Clears everything except gameCompletions, which a "Reset progress" is meant to
// preserve — it's the record of how many full playthroughs have ever been completed.
export function resetStats(): void {
	stats.deaths = 0;
	stats.victories = 0;
	stats.transfers = 0;
	stats.hyperspaceCount = 0;
	stats.absorbed.tree = 0;
	stats.absorbed.sentry = 0;
	stats.absorbed.sentinel = 0;
	stats.absorbed.meanie = 0;
	stats.completedGameThisRun = false;
	saveStats();
	logEvent('state', 'statsReset');
}

// Single choke point for absorb counting, mirroring game/rules.ts's ENERGY_COST table.
// Boulder/Synthoid are intentionally absent — absorbing your own utility objects isn't
// tracked, only the "real" game entities.
const ABSORB_STAT_KEY: Partial<Record<GameObjType, keyof typeof stats.absorbed>> = {
	[GameObjType.TREE]: 'tree',
	[GameObjType.SENTRY]: 'sentry',
	[GameObjType.SENTINEL]: 'sentinel',
	[GameObjType.MEANIE]: 'meanie',
};

export function recordAbsorb(type: GameObjType): void {
	const key = ABSORB_STAT_KEY[type];
	if (!key) return;
	stats.absorbed[key]++;
	saveStats();
}
