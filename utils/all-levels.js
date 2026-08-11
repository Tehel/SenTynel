import { GameObjType, generateLevel, MAP_SIZE } from './terrain.js';

// max_trees = 48 - 3 * num_sents

// ---------------------------------------------------------------------------
// Height gap between the Sentinel's tile and the best tile we could stand on
// to absorb it.
//
// The Sentinel always sits on the highest *flat* tile (placeSentries picks from
// highestPositions, which only ever considers shape-0 tiles). Its pedestal
// occupies that tile from h_max to h_max+1, so the Sentinel's own base — the
// square we need line of sight to before we can absorb it — is at h_max+1.
//
// The absorb pile therefore goes on the next-highest flat tile, and the gap
// between the two decides how tall that pile has to be. Tiles on the far edge
// row/column have no shape entry at all (addTileShapes stops at dim-2), so the
// `=== 0` test drops them for free.
// ---------------------------------------------------------------------------
function heightGap(level) {
	const pedestal = level.objects.find(o => o.type === GameObjType.PEDESTAL);
	if (!pedestal) return null;

	let second = -1;
	for (let z = 0; z < MAP_SIZE; z++) {
		for (let x = 0; x < MAP_SIZE; x++) {
			if (x === pedestal.x && z === pedestal.z) continue;
			const i = z * MAP_SIZE + x;
			if (level.shapes[i] !== 0) continue;
			if (level.map[i] > second) second = level.map[i];
		}
	}
	if (second < 0) return null;
	return level.map[pedestal.z * MAP_SIZE + pedestal.x] - second;
}

// ---------------------------------------------------------------------------
// Boulders in the (unrecoverable) absorb pile, from the height gap.
//
// A boulder is 0.5 tall (world/objects/models/boulder.ts) and eye height is
// 0.875 above the feet (engine/camera.ts). Standing on `n` boulders on a tile
// `gap` below the Sentinel's, the eye sits at
//     h_max - gap + 0.5n + 0.875
// and has to reach the Sentinel's base at h_max+1:
//     0.5n >= gap + 0.125   ->   n >= 4*gap + 0.25   ->   n = 2*gap + 1
// so 1 boulder for a level tile, 3 for a 1-unit drop, 5 for 2 units.
// ---------------------------------------------------------------------------
const pileBoulders = gap => 2 * gap + 1;

// ---------------------------------------------------------------------------
// Maximum landscape jump = energy left when hyperspacing off the pedestal.
//
// Income (`totalEnergy` below): the 10 we start with, plus everything absorbable
// on the landscape — 1 per tree, 3 per sentry, 4 for the Sentinel. The starting
// Synthoid isn't counted here because it pays for itself: the body we build on
// the pile costs 3, and the body we leave behind when we transfer into it gives
// that 3 straight back.
//
// Unrecoverable spend, all of it after the Sentinel goes (absorb is locked for
// the rest of the level once it does — game/state.svelte.ts's
// markSentinelAbsorbed):
//   - the pile we're standing on          2 per boulder
//   - the Synthoid placed on the pedestal  3
//   - the final hyperspace                 3
// Leapfrog boulders used to build height along the way are all recoverable, so
// they don't appear here.
// ---------------------------------------------------------------------------
const maxJumpFrom = (totalEnergy, gap) => totalEnergy - 6 - 2 * pileBoulders(gap);

console.log('levelId,nbSentries,nbTrees,totalEnergy,heightGap,maxJump,codeST');
for (let id = 0; id <= 9999; id++) {
	const level = generateLevel(id);
	const nbTrees = level.objects.filter(obj => obj.type == GameObjType.TREE).length;
	const totalEnergy = 10 + nbTrees + level.nbSentries * 3 + 1;
	const gap = heightGap(level);
	const maxJump = gap === null ? '' : maxJumpFrom(totalEnergy, gap);
	console.log(`${id},${level.nbSentries},${nbTrees},${totalEnergy},${gap ?? ''},${maxJump},${level.codes['PC/ST']}`);
}

// nb of levels for each totalEnergy:
// 24,1
// 25,6
// 26,9
// 27,17
// 28,27
// 29,26
// 30,32
// 31,53
// 32,61
// 33,89
// 34,93
// 35,121
// 36,175
// 37,167
// 38,188
// 39,222
// 40,247
// 41,243
// 42,284
// 43,337
// 44,350
// 45,394
// 46,419
// 47,480
// 48,506
// 49,461
// 50,477
// 51,490
// 52,462
// 53,466
// 54,419
// 55,376
// 56,360
// 57,375
// 58,307
// 59,1260

// levels with a 3 height gap (need 7 boulders to absorb sentinel): 2497, 9306

// min: 1136,1,10,24,61469778
