/*
 Which landscape the demo plays next.

 Winning a landscape jumps ahead by exactly the energy left over (game/state.svelte.ts's
 completeWon), so the bot's landing is whatever its purse happens to hold — unless it deliberately
 spends the surplus down first. That is what this module decides: given how far the bot could jump,
 how far it *should*.

 The strategy is to maximise the jump, skipping only landscapes the bot has no fair chance on. It
 is deliberately not utils/path-no-tower.csv's heightGap-0 route: the bot handles a one- and
 two-unit gap perfectly well, so demanding a flat approach to the Sentinel would throw away most
 of the range for nothing. Room is left here for the "fastest / easiest / …" choice a settings
 entry could offer later; for now there is one strategy and no setting.

 Three-free like the rest of game/, and pure apart from the memo below — the landing scan runs on
 the main thread while the bot stands on the pedestal, so it must stay cheap.
*/

import { GameObjType, generateLevel, MAP_SIZE, type Level } from '../world/terrain';
import { EYE_HEIGHT, terrainVisible, tileIndex } from './botGeometry';
import { isDemoBlacklisted } from './demo.svelte';
import { MAX_LEVEL_ID } from './levelCodes';
import { logEvent } from './log';

// The tallest absorb pile the bot is known to manage. heightGap 3 needs seven boulders and has
// never been played through; it is also just two landscapes out of ten thousand (2497 and 9306),
// so skipping them costs nothing.
const MAX_PLAYABLE_HEIGHT_GAP = 2;

// generateLevel is ~3 ms, and a session revisits the same candidates: a landing rejected at one
// landscape is a neighbour of the next one's candidates too.
const playable = new Map<number, boolean>();

/*
 Height gap between the Sentinel's tile and the best tile the pile can go on — a port of
 utils/all-levels.js's heightGap, and the same number all.csv's column reports.

 The Sentinel always sits on the highest *flat* tile (placeSentries only ever considers shape-0
 tiles), and its pedestal raises its base a further unit, so the square needing line of sight is at
 pedestalHeight + 1. The pile therefore goes on the next-highest flat tile, and the drop between
 the two is what sets its height (2 * gap + 1 boulders — see bouldersToSee in game/bot.ts, which
 derives the same figure from the eye geometry).

 Tiles on the far edge row and column have no shape entry at all (addTileShapes stops at dim - 2),
 so the `!== 0` test drops them for free.
*/
export function heightGapOf(level: Level): number | null {
	const pedestal = level.objects.find(o => o.type === GameObjType.PEDESTAL);
	if (!pedestal) return null;

	let second = -1;
	for (let row = 0; row < MAP_SIZE; row++) {
		for (let col = 0; col < MAP_SIZE; col++) {
			if (col === pedestal.x && row === pedestal.z) continue;
			const i = tileIndex(col, row);
			if (level.shapes[i] !== 0) continue;
			if (level.map[i] > second) second = level.map[i];
		}
	}
	if (second < 0) return null;
	return level.map[tileIndex(pedestal.x, pedestal.z)] - second;
}

/*
 Is the starting body enclosed — nothing it could act on at all?

 A tile at or above the eye can't be targeted (engine/visibility.ts refuses it), and every action
 the bot has needs a target: a create needs a tile below the eye to put something on, an absorb
 needs an object standing on one. A body that starts in a hollow ringed by higher ground therefore
 has exactly one legal move, the 3-energy hyperspace escape hatch of the planner's last rung — and
 it may well land somewhere no better. That is a landscape starting at a disadvantage no player
 chose, so the demo skips it.

 372 of the 10000 landscapes are enclosed this way. Line of sight is what does most of the work:
 only 20 have no low-enough flat tile anywhere, the other 352 have one but can't see it past a
 slope.
*/
function startIsEnclosed(level: Level): boolean {
	const start = level.objects.find(o => o.type === GameObjType.SYNTHOID);
	if (!start) return true;
	const startHeight = level.map[tileIndex(start.x, start.z)];
	const eye = startHeight + EYE_HEIGHT;

	for (let row = 0; row < MAP_SIZE - 1; row++) {
		for (let col = 0; col < MAP_SIZE - 1; col++) {
			if (col === start.x && row === start.z) continue;
			if (level.shapes[tileIndex(col, row)] !== 0) continue;
			const height = level.map[tileIndex(col, row)];
			// Integer heights, so "below the eye" is the same as "no higher than our own tile".
			if (height > startHeight) continue;
			if (terrainVisible(level.map, start.x, start.z, eye, col, row, height)) return false;
		}
	}
	return true;
}

// Would the bot get a fair run at this landscape? Costs one generateLevel the first time it is
// asked about an id, nothing thereafter.
export function isPlayableLanding(levelId: number): boolean {
	if (levelId < 0 || levelId > MAX_LEVEL_ID) return false;
	/*
	 The learned half of the answer, and deliberately OUTSIDE the memo below.

	 The two rejections are different kinds of fact. Everything under the memo is a property of the
	 landscape's geometry: it is true before the demo starts, it is the same for every planner, and
	 caching it is free. The blacklist is a property of this run's history — it grows while the demo
	 plays, and a landscape memoised as playable in the morning may have earned three strikes by the
	 afternoon. Caching that would pin the stale answer for the rest of the session.

	 It also means the two can be reasoned about separately: the terrain test is a claim about the
	 GAME, the blacklist is a claim about the BOT. 482 is the case that made the distinction matter —
	 it passes every terrain test (heightGap 2, a visible flat tile at the starting altitude to act
	 on) and is still a dead end, because "somewhere legal to act" is not "somewhere that leads up".
	*/
	if (isDemoBlacklisted(levelId)) return false;

	const cached = playable.get(levelId);
	if (cached !== undefined) return cached;

	const level = generateLevel(levelId);
	const gap = heightGapOf(level);
	const ok = gap !== null && gap <= MAX_PLAYABLE_HEIGHT_GAP && !startIsEnclosed(level);
	playable.set(levelId, ok);
	return ok;
}

/*
 How far to jump: as far as possible, then down one landscape at a time until the landing is one
 worth playing.

 Scanning downward rather than upward is what keeps this cheap. Only 3.7% of landscapes are
 skipped, so the first candidate tried is almost always the answer — about 1.04 generateLevel calls
 per landing in practice, not the `maxJump` calls a full survey of the window would cost.

 Landing exactly on MAX_LEVEL_ID is always allowed whatever its own shape: it is the destination,
 not a waypoint, the same exemption utils/paths.js grants it.

 Returns the jump, not the landing, since that is what the bot has to steer its energy to. Null
 means "don't steer": either there is nowhere left to go (already on the last landscape, where the
 demo starts over and the jump is discarded) or nothing can be afforded anyway.
*/
export function chooseDemoLanding(from: number, maxJump: number): number | null {
	if (maxJump < 1 || from >= MAX_LEVEL_ID) return null;
	// Overshooting the last landscape isn't a jump the game will make (completeWon clamps), so aim
	// at it exactly instead of banking energy that would be thrown away.
	const reach = Math.min(maxJump, MAX_LEVEL_ID - from);
	if (from + reach === MAX_LEVEL_ID) return reach;

	for (let jump = reach; jump >= 1; jump--) {
		if (isPlayableLanding(from + jump)) return jump;
	}
	/*
	 Nothing in range passed. Take the longest jump anyway rather than stall the demo on a landscape
	 it has already finished — a fallback beats a silent zero.

	 But not onto the blacklist if there is any choice, and that preference is not decoration. With
	 the terrain tests alone this branch was near-unreachable (96% of landscapes pass, so it needed a
	 window of consecutive rejects that does not occur). The blacklist changes the odds, because it
	 GROWS towards this branch: every rewind sends the bot back to the same landscape, whose window
	 then loses one more candidate each time round. Landing on a blacklisted landscape would earn it
	 three fresh strikes and another rewind to the same place — a loop that plays, so no watchdog
	 sees it.
	*/
	for (let jump = reach; jump >= 1; jump--) {
		if (!isDemoBlacklisted(from + jump)) {
			logEvent('bot', 'noPlayableLanding', { from, reach, jump });
			return jump;
		}
	}
	// Every landing in reach is blacklisted: this landscape leads nowhere the bot can still go.
	// Logged rather than swallowed — it is the signal that the journey itself is stuck, and there is
	// nothing left here for steering to do about it.
	logEvent('bot', 'allLandingsBlacklisted', { from, reach });
	return reach;
}
