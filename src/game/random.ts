/*
 Deterministic randomness for gameplay.

 Deliberately NOT world/terrain.ts's rng256. That one is the landscape generator's own LFSR: its
 sequence is consumed in a fixed order to reproduce the original game bit-for-bit (guarded by
 terrain.test.ts's fingerprints) and its state *after* generation is what produces the level
 codes. It is also re-seeded by every generateLevel() call, and those happen at arbitrary moments
 outside gameplay — getLevelCode() while the menu is open, the level-code index build. Drawing
 gameplay values from it would make a run depend on whether someone happened to open a menu.

 So gameplay gets its own generator, seeded from the landscape. Everything that changes what
 actually happens — which tile a hyperspace lands on, where a conservation tree appears — comes
 from here, which makes a run reproducible: the same landscape plays out the same way, a bug
 seen once can be seen again, and engine/bot.harness.test.ts becomes a stable yardstick instead
 of something that shifts between invocations.

 Purely cosmetic randomness (engine/particles.ts) deliberately stays on Math.random: it is driven
 by wall-clock frame timing and could never be reproducible anyway.
*/

// mulberry32: one 32-bit word of state, good distribution, and short enough to read.
let state = 1;

/*
 Reseed for a landscape. levelEpoch is folded in so that replaying a landscape after a loss is a
 fresh run rather than a rerun of the identical one — the terrain and object layout repeat (those
 come from the generator), but the drain-by-drain unfolding does not, so a lost landscape isn't a
 fixed puzzle with one answer.
*/
export function seedGameRandom(levelId: number, levelEpoch = 0): void {
	// Knuth's multiplicative constant spreads adjacent landscape numbers to distant seeds; the
	// +1 keeps landscape 0 from seeding to zero, which mulberry32 handles poorly.
	state = (Math.imul(levelId + 1, 2654435761) + levelEpoch) >>> 0 || 1;
}

// Next value in [0, 1).
export function gameRandom(): number {
	state = (state + 0x6d2b79f5) | 0;
	let t = state;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Integer in [0, n). Returns 0 for an empty range so callers can't index out of bounds.
export const randomInt = (n: number): number => (n > 0 ? Math.floor(gameRandom() * n) : 0);

// A rotation in the original game's 256-step circle (see angle256ToRad in world/objects/base.ts).
export const randomAngle256 = (): number => randomInt(256);
