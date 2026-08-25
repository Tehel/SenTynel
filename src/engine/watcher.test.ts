/*
 The lock-on rule (PLAN-RULES.md R3, RULES-FIDELITY.md C6/C7/C8) — the drain phase's behaviour, as
 measured against Augmentinel.

 Four rules, each of which the previous implementation got wrong in a different direction:

  1. A watcher's attention is ONE exclusive slot, and its priority is type-then-distance: synthoids
     first, then boulders, then trees-on-boulders, nearest first within each class. The decisive
     case is a near boulder behind a far synthoid — the synthoid goes first, so proximity is only
     the tiebreak.
  2. Only SYNTHOIDS stall. A watcher waits WATCHER_GRACE_MS before taking the first point off one;
     boulders it takes on the tick it sees them. This is what stops the grace period being a general
     reaction time and makes it a detection delay for the intruder.
  3. Rotation runs DURING the stall and freezes only once energy is actually moving, so a watcher
     whose beam carries it away mid-count simply loses the target.
  4. Player drains CUMULATE. Three watchers holding your square cost three energy a second, not one.

 A flat map with no terrain meshes: line of sight is unobstructed, so these test the rule rather than
 the raycaster (engine/visibility.test.ts owns that). Objects are added straight to the scene rather
 than through addObjectToScene, which wants particle and cone assets none of this needs.
*/

import { describe, it, expect, beforeEach } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, Scene } from 'three';
import { Boulder, Meanie, Sentry, Synthoid, Tree, Watcher, type GameObject } from '../world/objects';
import { MAP_SIZE } from '../world/terrain';
import { runDrainPhase } from './watcher';
import { WATCHER_GRACE_MS } from '../game/timing';
import { canPlaceAt, type SceneData } from './scene';
import { GameObjType } from '../world/terrain';
import { game } from '../game/state.svelte';
import { settings } from '../settings.svelte';

const GROUND = 1;

type Ctor = new (...args: ConstructorParameters<typeof GameObject>) => GameObject;

/*
 A watcher at (5,5) facing rot 0 looks down +row: angle256ToRad(0) = PI, so the facing vector is
 (0,0,-1), and world z runs opposite to row. Everything below therefore sits at row > 5, inside a
 cone of +/-14 degrees — about 1.25 cells of lateral room at 5 cells out.
*/
const W_COL = 5;
const W_ROW = 5;

function world() {
	const scene = new Scene();
	const map = new Array(MAP_SIZE * MAP_SIZE).fill(GROUND);
	const allObjects: GameObject[] = [];
	const sceneData = { scene, map, allObjects, deferredSpawns: [] } as unknown as SceneData;

	const add = <T extends GameObject>(T_: Ctor, col: number, row: number, height = GROUND): T => {
		const o = new T_(0, col, row, height, 0, 20, 16, {});
		allObjects.push(o);
		scene.add(o.object3D);
		return o as T;
	};

	return { sceneData, allObjects, add };
}

// One 1 Hz drain tick. runDrainPhase is the whole phase; the caller owns the clock.
const tickAt = (sceneData: SceneData, time: number) => runDrainPhase(sceneData, time);

beforeEach(() => {
	// Watchers are dormant until the player acts, and the conservation-tree spawn would otherwise
	// want particle assets we have not built.
	game.firstActionTaken = true;
	game.phase = 'PLAYING';
	game.energy = 10;
	game.activeSynthoidCol = null;
	game.activeSynthoidRow = null;
	settings.particleEffects = false;
});

describe('target priority', () => {
	it('takes a far synthoid before a near boulder', () => {
		// The rule that distance alone cannot explain. The boulder is three cells closer.
		const { sceneData, add } = world();
		add(Sentry, W_COL, W_ROW);
		const boulder = add(Boulder, W_COL, W_ROW + 2);
		const synthoid = add(Synthoid, W_COL + 1, W_ROW + 5);

		// Past the stall, so the synthoid is actually taken rather than merely locked.
		tickAt(sceneData, 0);
		tickAt(sceneData, WATCHER_GRACE_MS);

		expect(synthoid.absorbedTime).not.toBeNull();
		expect(boulder.absorbedTime).toBeNull();
	});

	it('takes the nearer of two boulders', () => {
		const { sceneData, add } = world();
		add(Sentry, W_COL, W_ROW);
		const near = add(Boulder, W_COL, W_ROW + 2);
		const far = add(Boulder, W_COL, W_ROW + 5);

		tickAt(sceneData, 0);

		expect(near.absorbedTime).not.toBeNull();
		expect(far.absorbedTime).toBeNull();
	});

	it('takes a boulder before a tree standing on one', () => {
		const { sceneData, add } = world();
		add(Sentry, W_COL, W_ROW);
		add(Boulder, W_COL + 1, W_ROW + 5);
		const treeOnBoulder = add(Tree, W_COL + 1, W_ROW + 5, GROUND + 0.5);
		const bareBoulder = add(Boulder, W_COL, W_ROW + 2);

		tickAt(sceneData, 0);

		expect(bareBoulder.absorbedTime).not.toBeNull();
		expect(treeOnBoulder.absorbedTime).toBeNull();
	});

	it('leaves a lone tree alone — one unit of energy is not worth a square', () => {
		const { sceneData, add } = world();
		add(Sentry, W_COL, W_ROW);
		const tree = add(Tree, W_COL, W_ROW + 3);

		for (let t = 0; t <= WATCHER_GRACE_MS * 2; t += 1000) tickAt(sceneData, t);

		expect(tree.absorbedTime).toBeNull();
	});
});

describe('the stall applies to synthoids only', () => {
	it('takes a boulder on the tick it is seen', () => {
		const { sceneData, add } = world();
		add(Sentry, W_COL, W_ROW);
		const boulder = add(Boulder, W_COL, W_ROW + 3);

		tickAt(sceneData, 0);

		expect(boulder.absorbedTime).not.toBeNull();
	});

	it('waits out the grace before touching a synthoid', () => {
		const { sceneData, add } = world();
		add(Sentry, W_COL, W_ROW);
		const synthoid = add(Synthoid, W_COL, W_ROW + 3);

		tickAt(sceneData, 0);
		expect(synthoid.absorbedTime).toBeNull();
		tickAt(sceneData, WATCHER_GRACE_MS - 1);
		expect(synthoid.absorbedTime).toBeNull();

		tickAt(sceneData, WATCHER_GRACE_MS);
		expect(synthoid.absorbedTime).not.toBeNull();
	});

	it('starts the count again for a synthoid it has lost and re-acquired', () => {
		const { sceneData, allObjects, add } = world();
		const sentry = add(Sentry, W_COL, W_ROW) as Watcher;
		const synthoid = add(Synthoid, W_COL, W_ROW + 3);

		tickAt(sceneData, 0);
		// Break the sighting by turning the watcher away, then restore it.
		sentry.rot = 128;
		tickAt(sceneData, 1000);
		sentry.rot = 0;
		tickAt(sceneData, 2000);

		// Without a reset this would be past the grace already at t=3000.
		expect(allObjects).toContain(synthoid);
		expect(synthoid.absorbedTime).toBeNull();
		tickAt(sceneData, 2000 + WATCHER_GRACE_MS);
		expect(synthoid.absorbedTime).not.toBeNull();
	});
});

describe('rotation freezes on draining, not on locking', () => {
	it('keeps rotating while it counts down on a synthoid', () => {
		const { sceneData, add } = world();
		const sentry = add(Sentry, W_COL, W_ROW) as Watcher;
		add(Synthoid, W_COL, W_ROW + 3);

		tickAt(sceneData, 0);

		expect(sentry.drainLocked).toBe(false);
	});

	it('freezes once it is actually taking energy', () => {
		const { sceneData, add } = world();
		const sentry = add(Sentry, W_COL, W_ROW) as Watcher;
		add(Boulder, W_COL, W_ROW + 3);

		tickAt(sceneData, 0);

		expect(sentry.drainLocked).toBe(true);
	});
});

describe('drains on the player cumulate', () => {
	const playerAt = (add: ReturnType<typeof world>['add'], col: number, row: number) => {
		const body = add(Synthoid, col, row);
		game.activeSynthoidCol = col;
		game.activeSynthoidRow = row;
		return body;
	};

	it('costs one point per second per watcher holding the square', () => {
		const { sceneData, add } = world();
		// Two watchers on opposite sides, both looking at the same square.
		add(Sentry, W_COL, W_ROW);
		const other = add(Sentry, W_COL, W_ROW + 6) as Watcher;
		other.rot = 128; // facing back down -row, toward the body between them
		other.object3D.rotation.y = Math.PI - (128 * 2 * Math.PI) / 256;
		playerAt(add, W_COL, W_ROW + 3);

		game.energy = 10;
		tickAt(sceneData, 0);
		expect(game.energy).toBe(10); // both still counting down

		tickAt(sceneData, WATCHER_GRACE_MS);
		expect(game.energy).toBe(8); // two watchers, two points in one tick
	});

	it('costs one point per second with a single watcher', () => {
		const { sceneData, add } = world();
		add(Sentry, W_COL, W_ROW);
		playerAt(add, W_COL, W_ROW + 3);

		game.energy = 10;
		tickAt(sceneData, 0);
		tickAt(sceneData, WATCHER_GRACE_MS);

		expect(game.energy).toBe(9);
	});
});

/*
 Reported from play, 2026-08-17: standing in a BARE synthoid behind a slope on level 10, with the
 Sentinel high enough to see the body but not the cell under it, and trees around — no amber vignette
 and no Meanie. The Sentinel just rotated away.

 The cause was in target selection, not in the Meanie code. The candidate filter tested line of sight
 to each object's FOOT, and a synthoid on bare ground has its foot AT its square — so a hidden square
 meant the watcher never selected the player at all. No target, no 'partial' scan, no conversion. The
 whole half-scan mechanic was unreachable unless the player happened to be standing on boulders,
 which is the one case where foot and square differ.

 The geometry below is the report in miniature: a high watcher, a bare body, and a wall that hides the
 square but not the head. The window between those two is about 0.34 of a unit — see the derivation in
 the fixture — so if this test ever needs re-tuning, work it out rather than nudging numbers.
*/
describe('a watcher sees the body, not just the square', () => {
	// Head of a synthoid, from its own model: verticalExtent(...).max on the merged mesh.
	const SYNTHOID_HEAD = 0.9375;

	const halfScanWorld = () => {
		const w = world();
		// Watcher on a hill at height 8, so its eye at 8.9 clears both the square (1.0) and the head
		// (1.9375) — isCellVisibleFrom refuses any target at or above the eye, so a ground-level
		// watcher could see neither.
		const sentry = w.add(Sentry, W_COL, W_ROW, 8);
		const body = w.add(Synthoid, W_COL, W_ROW + 5, GROUND);
		game.activeSynthoidCol = W_COL;
		game.activeSynthoidRow = W_ROW + 5;
		// A tree for the conversion to consume, well off the sightline.
		w.add(Tree, 20, 20);
		/*
		 Wall top at 6.2. Rays from the eye to the FAR corners of the target cell are the shallowest,
		 so they set both bounds: to the square they reach 6.03 at the wall (blocked), to the head
		 6.37 (clear). Blocking every square corner needs W > 6.03; leaving one head corner needs
		 W < 6.37.
		*/
		const wall = new Mesh(new BoxGeometry(40, 6.2, 0.2), new MeshBasicMaterial());
		wall.position.set(W_COL + 0.5, 3.1, MAP_SIZE - 1 - 7.5);
		w.sceneData.scene.add(wall);
		return { ...w, sentry, body };
	};

	it('reports a partial scan when only the body is visible', () => {
		const { sceneData } = halfScanWorld();

		tickAt(sceneData, 0);

		// Amber, not red: it can see you but cannot touch you.
		expect(game.scanState).toBe('partial');
		expect(game.energy).toBe(10);
	});

	it('converts a tree into a Meanie rather than draining', () => {
		const { sceneData, allObjects } = halfScanWorld();

		tickAt(sceneData, 0);
		tickAt(sceneData, WATCHER_GRACE_MS);
		// The conversion animates like a drain: absorb now, spawn 500 ms later.
		for (let i = allObjects.length - 1; i >= 0; i--) {
			if (allObjects[i].absorbedTime !== null) allObjects.splice(i, 1);
		}
		sceneData.deferredSpawns.splice(0).forEach(d => d.spawn());

		expect(allObjects.some(o => o instanceof Meanie)).toBe(true);
		expect(game.energy).toBe(10);
	});

	it('still drains normally when the square is visible', () => {
		// Same high watcher, no wall: the square is in view, so this is a full scan and costs energy.
		const { sceneData, add } = world();
		add(Sentry, W_COL, W_ROW, 8);
		add(Synthoid, W_COL, W_ROW + 5, GROUND);
		game.activeSynthoidCol = W_COL;
		game.activeSynthoidRow = W_ROW + 5;

		tickAt(sceneData, 0);
		expect(game.scanState).toBe('full');
		tickAt(sceneData, WATCHER_GRACE_MS);
		expect(game.energy).toBe(9);
	});
});

describe('a transfer is not a shield', () => {
	it('keeps counting while the player glides in, and drains on arrival', () => {
		const { sceneData, add } = world();
		add(Sentry, W_COL, W_ROW);
		const destination = add(Synthoid, W_COL, W_ROW + 3);
		game.activeSynthoidCol = W_COL;
		game.activeSynthoidRow = W_ROW + 3;

		// The whole stall elapses mid-glide. The old rule skipped the destination cell outright, so
		// the watcher never even locked on and the player landed safe.
		game.phase = 'TRANSFER';
		tickAt(sceneData, 0);
		tickAt(sceneData, WATCHER_GRACE_MS);

		// Nothing has happened to the body yet — deferring the effect is what stops the shell
		// morphing to a boulder around the camera mid-glide.
		expect(destination.absorbedTime).toBeNull();
		expect(game.energy).toBe(10);

		game.phase = 'PLAYING';
		tickAt(sceneData, WATCHER_GRACE_MS + 1000);
		expect(game.energy).toBe(9);
	});
});

/*
 THE MORPH WINDOW (2026-08-25). Reported the moment RULES-FIDELITY.md A5 shipped: *"what happens when
 an item is being absorbed by a watcher? Can the player now start to build in the same place 0.1
 second into the animation, thus breaking rules AND preventing rebuilding what the watcher intended to
 put there?"*

 A drain is a morph in two halves: the target is removed at once and its replacement (synthoid ->
 boulder, boulder -> tree) lands 500 ms later through sceneData.deferredSpawns. A5 made an absorbing
 object stop counting as an occupant — correct for a square you cleared YOURSELF, where nothing is
 queued — which left this window holding nothing at all. Building into it would have taken a square
 the rules had already promised to the watcher, and scheduleDrainSpawn's own failure path spells out
 the consequence: the morph is refused and the landscape silently loses the energy that boulder was.

 A pending spawn now reserves its cell. The two assertions are one claim each: the window is closed,
 and it opens again once the morph has actually landed.
*/
describe('a cell mid-morph is reserved for the watcher', () => {
	it('refuses a build while a drained object\'s replacement is still pending', () => {
		const { sceneData, add } = world();
		add(Sentry, W_COL, W_ROW);
		const boulder = add(Boulder, W_COL, W_ROW + 3);

		// Boulders are taken on the tick they are seen — no stall — so one tick starts the morph.
		tickAt(sceneData, 0);
		expect(boulder.absorbedTime).not.toBeNull();
		expect(sceneData.deferredSpawns).toHaveLength(1);

		// 0.1 s in: the boulder is gone from every other rule's point of view, but the tree that
		// replaces it has not arrived. The square belongs to neither of us.
		expect(canPlaceAt(sceneData, W_COL, W_ROW + 3, GameObjType.BOULDER)).toBe(false);
		// A cell the watcher has NOT claimed is unaffected — this is a reservation, not a freeze.
		expect(canPlaceAt(sceneData, W_COL + 4, W_ROW + 3, GameObjType.BOULDER)).toBe(true);
	});

	it('frees the cell again once the morph has landed', () => {
		const { sceneData, add } = world();
		add(Sentry, W_COL, W_ROW);
		add(Boulder, W_COL, W_ROW + 3);
		tickAt(sceneData, 0);

		// Drain the queue the way engine/loop.ts does, without running a real frame.
		sceneData.deferredSpawns = sceneData.deferredSpawns.filter(d => {
			if (d.executeAt <= 10_000) return false;
			return true;
		});
		expect(canPlaceAt(sceneData, W_COL, W_ROW + 3, GameObjType.BOULDER)).toBe(true);
	});
});
