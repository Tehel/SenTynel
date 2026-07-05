// Level-code lookup. Codes aren't invertible (they fall out of the same RNG stream as the
// landscape itself, only reachable by replaying the whole generation pipeline), so "decoding"
// a code means regenerating landscapes from 0 and checking each one's code until a match turns
// up. generateLevel(id) is always called with default options (smooths=2, despikes=2)
// regardless of the user's debug generator settings, so a given levelId always produces the
// same code the original game would show.
//
// generateLevel is not cheap — timing utils/all-levels.js (10,000 sequential calls) came in at
// ~14.5s in Node. Two things keep that off the critical path:
// - A shared cache (code -> levelId) is filled incrementally by a background trickle
//   (startBackgroundCodeIndexing/stopBackgroundIndexing) that only runs while the player idles
//   at the main menu — MainMenu.svelte starts it on mount, stops it on unmount, so it never
//   competes with the render/game loop during actual play.
// - findLevelByCode checks that cache first, then continues the scan in small async chunks
//   (yielding via setTimeout) from wherever the background trickle left off, so a cache miss
//   still keeps the UI responsive and cancellable rather than freezing the tab.
import { generateLevel } from '../world/terrain';

// PC/ST is the canonical code system — the Atari ST is what the original game was played on.
const CODE_SYSTEM = 'PC/ST';
const CHUNK_SIZE = 100;
const BACKGROUND_BATCH_SIZE = 20;
const BACKGROUND_INTERVAL_MS = 250;

export const MAX_LEVEL_ID = 9999;

const codeCache = new Map<string, number>();
// Lowest levelId not yet in codeCache. Both the background trickle and a foreground search
// advance this — never both at once, see findLevelByCode's stopBackgroundIndexing() call.
let nextUnindexed = 0;
let backgroundTimer: ReturnType<typeof setInterval> | null = null;

// The displayable code for a single landscape (e.g. for the "Level: N, code: XXXXXXXX" menu
// line) — no cache lookup, just one generateLevel() call.
export function getLevelCode(id: number): string {
	return generateLevel(id).codes[CODE_SYSTEM];
}

function indexOne(id: number): string {
	const code = getLevelCode(id);
	codeCache.set(code, id);
	return code;
}

// Idempotent: a no-op if already running or the cache is already complete. Safe to call on
// every MainMenu mount.
export function startBackgroundCodeIndexing(): void {
	if (backgroundTimer !== null || nextUnindexed > MAX_LEVEL_ID) return;
	backgroundTimer = setInterval(() => {
		const end = Math.min(nextUnindexed + BACKGROUND_BATCH_SIZE, MAX_LEVEL_ID + 1);
		for (let id = nextUnindexed; id < end; id++) indexOne(id);
		nextUnindexed = end;
		if (nextUnindexed > MAX_LEVEL_ID) stopBackgroundIndexing();
	}, BACKGROUND_INTERVAL_MS);
}

export function stopBackgroundIndexing(): void {
	if (backgroundTimer === null) return;
	clearInterval(backgroundTimer);
	backgroundTimer = null;
}

// Returns the matching levelId, or null if no landscape in [0, MAX_LEVEL_ID] produces this code
// (including when aborted early via `signal`).
export async function findLevelByCode(code: string, signal?: AbortSignal): Promise<number | null> {
	const target = code.toLowerCase();
	const cached = codeCache.get(target);
	if (cached !== undefined) return cached;

	// Take over indexing from wherever the background trickle left off — pausing it first so
	// the two never advance `nextUnindexed` at the same time.
	stopBackgroundIndexing();
	for (let id = nextUnindexed; id <= MAX_LEVEL_ID; id++) {
		if (signal?.aborted) return null;
		const generated = indexOne(id);
		nextUnindexed = id + 1;
		if (generated === target) return id;
		if (id % CHUNK_SIZE === CHUNK_SIZE - 1) await new Promise(resolve => setTimeout(resolve, 0));
	}
	return null;
}
