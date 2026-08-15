/*
 Exposure-map validation harness.

 game/exposure.ts computes line of sight ANALYTICALLY — a march over the height field — where the
 engine casts a real ray through the real scene. That is a 200x saving and the only reason a
 whole-map sweep fits in the window before the player's first action, but it is worth nothing
 unless the two agree. PLAN-EXPOSURE.md records why the question is live: the older single-centre-
 ray `terrainVisible` reported ~20% FEWER visible cells than the engine — i.e. it called cells safe
 that a watcher could see, which is the direction that gets a bot killed.

   npx vitest run src/engine/exposure.harness              # the pinned landscapes
   EXPOSURE_LEVELS=0-99 npx vitest run src/engine/exposure.harness   # a block
   EXPOSURE_VERBOSE=1 ...                                  # per-landscape detail
   EXPOSURE_MARGIN=0.25 ...                                # re-run the trade-off below

 The two directions of disagreement are NOT equivalent and are counted separately:

   UNSAFE  map says "cannot be seen", engine says it can.  Bounded, and the bound is tight.
   safe    map says "can be seen", engine says it cannot.  Tolerated, and expected: the analytic
           sweep is terrain-only, so every tree, boulder and watcher body standing in a sightline
           is occlusion the map does not model. It over-reports exposure, which costs the bot
           caution rather than its life.

 The unsafe bound is not zero, and the reason is worth knowing before anyone tries to "fix" it.
 Traced on landscape 390 (watcher at 14,15 h8 -> cell 23,3): the sightline enters a hill almost
 tangentially, and the engine's raycaster misses that grazing entry — after which the ray travels
 three whole levels INSIDE the hill without ever registering a hit, because the faces it would
 exit through are back-facing and the flat-plane material is FrontSide. Cast the identical ray
 BACKWARDS and it hits the blocker cleanly at the expected distance. So the engine, not the
 march, is the permissive one in these cases: it sees through terrain that geometrically blocks.
 No analytic model reproduces that, because it is a face-culling artifact rather than geometry.

 SIGHTLINE_MARGIN (game/exposure.ts) removes the rest — the true grazes, where the two disagree
 by a few hundredths of a level. Its value was chosen from the trade-off below, measured over
 landscapes 0-49 with EXPOSURE_MARGIN, and 0.1 is the knee: past it almost nothing is bought.

   margin   unsafe            safe-side
   0        40 (0.018%)       2009 (0.92%)
   0.05     21                2902 (1.33%)
   0.1      14 (0.0064%)      4373 (2.01%)     <- chosen
   0.25      8                7941 (3.65%)
   0.5       7               13092 (6.01%)

 Sampling every (watcher, cell) at several target heights is what makes this a test of the height
 WINDOW rather than of a boolean — the drain phase tests line of sight to the target's foot height
 (engine/watcher.ts), so a cell hidden at ground level and exposed once a pile is built on it is
 the case the map exists to get right.
*/

import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { Disposer } from './disposer';
import { buildScene } from './scene';
import { EYE_HEIGHT_LOCAL } from './watcher';
import { isCellVisibleFrom } from './visibility';
import { Watcher } from '../world/objects';
import { MAP_SIZE } from '../world/terrain';
import { buildExposureMap, canEverSee, WATCHER_EYE_HEIGHT, type ExposureWatcher } from '../game/exposure';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const VERBOSE = !!env?.EXPOSURE_VERBOSE;
const MARGIN = env?.EXPOSURE_MARGIN === undefined ? undefined : Number(env.EXPOSURE_MARGIN);

/*
 Pinned landscapes. The six PLAN-EXPOSURE.md measured its cost estimate on, minus the two slowest,
 so the default run stays inside a few seconds: 0 and 390 are the diagnosis regulars, 3000 is the
 diagnosis-set opener, and 9999 is the one where the old analytic sweep disagreed worst.
*/
const DEFAULT_LEVELS = [0, 390, 3000, 9999];

// Foot heights to probe, as offsets above the cell's own terrain: bare ground, then the piles a
// bot actually builds (half a level per boulder).
const HEIGHT_OFFSETS = [0, 0.5, 1, 1.5, 2.5];

// See the header: the floor is the engine's own see-through-terrain artifact, ~0.006% observed.
const MAX_UNSAFE_RATE = 0.0005;
// The map may be conservative; it may not be useless. Observed ~2%.
const MAX_SAFE_SIDE_RATE = 0.05;

function parseLevels(spec: string | undefined): number[] {
	if (!spec) return DEFAULT_LEVELS;
	const out: number[] = [];
	for (const part of spec.split(',')) {
		const range = part.match(/^(\d+)-(\d+)$/);
		if (range) for (let i = Number(range[1]); i <= Number(range[2]); i++) out.push(i);
		else out.push(Number(part));
	}
	return out;
}

interface Tally {
	pairs: number;
	unsafe: number;
	safe: number;
	buildMs: number;
	// Where the unsafe ones were, so a failure is diagnosable rather than just a count.
	examples: string[];
}

function validate(levelId: number): Tally {
	const disposer = new Disposer();
	const sceneData = buildScene(
		levelId,
		{ smooths: 2, despikes: 2, showGrid: false, showSurfaces: true, showAxis: false },
		disposer
	);
	const { scene, map, level } = sceneData;
	scene.updateMatrixWorld(true);

	const live = sceneData.allObjects.filter((o): o is Watcher => o instanceof Watcher && o.absorbedTime === null);
	const watchers: ExposureWatcher[] = live.map(w => ({
		col: w.col,
		row: w.row,
		height: w.height,
		rot: w.rot,
		step: w.step,
	}));

	const started = performance.now();
	const exposure = buildExposureMap(map, watchers, MARGIN === undefined ? {} : { margin: MARGIN });
	const buildMs = performance.now() - started;

	const tally: Tally = { pairs: 0, unsafe: 0, safe: 0, buildMs, examples: [] };

	for (let w = 0; w < live.length; w++) {
		const watcher = live[w];
		// The eye the drain phase itself uses — cell centre, EYE_HEIGHT_LOCAL above the tile.
		const eye = new Vector3(
			watcher.col + 0.5,
			watcher.height + EYE_HEIGHT_LOCAL,
			MAP_SIZE - 1 - (watcher.row + 0.5)
		);
		for (let row = 0; row < MAP_SIZE - 1; row++) {
			for (let col = 0; col < MAP_SIZE - 1; col++) {
				// Flat cells only: they are the ones anything can stand on, and the only ones the
				// map is ever asked about.
				if (level.shapes[row * MAP_SIZE + col] !== 0) continue;
				if (col === watcher.col && row === watcher.row) continue;
				const terrain = map[row * MAP_SIZE + col];
				for (const offset of HEIGHT_OFFSETS) {
					// The cone is not part of this comparison — isCellVisibleFrom knows nothing
					// about facing. This validates the LOS/height half in isolation, which is the
					// half that is approximated; the cone half is exact and covered by
					// game/cone.test.ts against the engine's own inWatcherCone.
					const predicted =
						terrain + offset >= exposure.minVisibleHeight[w][row * MAP_SIZE + col] &&
						terrain + offset < exposure.eyeHeights[w];
					const actual = isCellVisibleFrom(
						eye,
						scene,
						map,
						MAP_SIZE,
						col,
						row,
						offset,
						watcher.col,
						watcher.row
					);
					tally.pairs++;
					if (predicted === actual) continue;
					if (actual) {
						tally.unsafe++;
						if (tally.examples.length < 8)
							tally.examples.push(
								`w${w}@${watcher.col},${watcher.row}h${watcher.height} -> ${col},${row} ` +
									`terrain ${terrain} +${offset}, threshold ` +
									exposure.minVisibleHeight[w][row * MAP_SIZE + col].toFixed(3)
							);
					} else {
						tally.safe++;
					}
				}
			}
		}
	}

	// canEverSee is the accessor everything else goes through; make sure it agrees with the raw
	// arrays this loop read, so the test cannot pass against a field the callers never see.
	if (live.length > 0) {
		const w = 0;
		for (let row = 0; row < MAP_SIZE - 1; row += 7) {
			for (let col = 0; col < MAP_SIZE - 1; col += 7) {
				const terrain = map[row * MAP_SIZE + col];
				const direct =
					terrain >= exposure.minVisibleHeight[w][row * MAP_SIZE + col] && terrain < exposure.eyeHeights[w];
				const masks = exposure.coneMask[w];
				const cell = row * MAP_SIZE + col;
				const facedEver = masks[cell * 2] !== 0 || masks[cell * 2 + 1] !== 0;
				expect(canEverSee(exposure, w, col, row, terrain)).toBe(direct && facedEver);
			}
		}
	}

	sceneData.allObjects.forEach(o => o.dispose());
	disposer.disposeAll();
	return tally;
}

describe('the analytic sweep against the engine raycaster', () => {
	const levels = parseLevels(env?.EXPOSURE_LEVELS);

	it('never calls a cell safe that a watcher can actually see', () => {
		// The eye heights must be the same number or nothing below means anything.
		expect(WATCHER_EYE_HEIGHT).toBe(EYE_HEIGHT_LOCAL);

		const totals: Tally = { pairs: 0, unsafe: 0, safe: 0, buildMs: 0, examples: [] };
		for (const levelId of levels) {
			const tally = validate(levelId);
			totals.pairs += tally.pairs;
			totals.unsafe += tally.unsafe;
			totals.safe += tally.safe;
			totals.buildMs += tally.buildMs;
			if (tally.examples.length && totals.examples.length < 8)
				totals.examples.push(...tally.examples.slice(0, 8 - totals.examples.length));
			if (VERBOSE || tally.unsafe > 0)
				console.log(
					`  level ${String(levelId).padStart(4)}: ${tally.pairs} samples, ` +
						`unsafe ${tally.unsafe}, safe-side ${tally.safe}, build ${tally.buildMs.toFixed(1)} ms`
				);
		}

		console.log(
			`exposure sweep over ${levels.length} landscape(s): ${totals.pairs} samples, ` +
				`UNSAFE ${totals.unsafe}, safe-side ${totals.safe} ` +
				`(${((100 * totals.safe) / Math.max(1, totals.pairs)).toFixed(2)}%), ` +
				`mean build ${(totals.buildMs / levels.length).toFixed(1)} ms`
		);
		for (const example of totals.examples) console.log(`  unsafe: ${example}`);

		// Not zero, and the comment at the top of this file says why: the residue is the
		// engine seeing through terrain, not the map mismodelling it. Measured 3 of 42335 on
		// the pinned landscapes and 14 of 217765 over 0-49, so the bound is ~8x the observed
		// rate — loose enough not to be flaky, tight enough that a real regression trips it.
		expect(totals.unsafe / totals.pairs).toBeLessThan(MAX_UNSAFE_RATE);
		// The other direction is cheap but not free, and an unbounded rise would mean the map
		// had become uselessly pessimistic — which no unsafe count would catch.
		expect(totals.safe / totals.pairs).toBeLessThan(MAX_SAFE_SIDE_RATE);
	}, 600_000);
});
