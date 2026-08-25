/*
 Meanie behaviour (PLAN-RULES.md R5, RULES-FIDELITY.md D1-D3).

 A Meanie is the watchers' answer to you hiding your square: it cannot be drained, so it is flushed
 out instead. Four rules, all of which we previously got wrong:

  1. ONE at a time. The conversion used to fire on every 1 Hz drain tick the half-visible condition
     held, with no check for an existing Meanie — ten seconds hidden was ten Meanies, and the
     conservation-tree mechanic keeps manufacturing the raw material.
  2. It SWEEPS at a constant rate in a fixed direction. It used to rotate straight at the player,
     which acquires any bearing in ~2 seconds and re-acquires as you move: unavoidable by
     construction, where a sweeping one can be dodged by breaking its sightline.
  3. It gets ONE full rotation. Miss, and it reverts to a tree — so breaking the sighting means you
     can wait it out, which is the counter-play the rule exists to give you.
  4. It tests the player's SQUARE, not their body. This matters precisely because its parent spawned
     it for failing that same test: a faithful Meanie is trying to get an angle its parent could not.

 The wall fixture below is what makes rule 4 observable at all — a body high on a pile with its
 square hidden is exactly the situation that creates a Meanie in the first place, so a Meanie that
 tests the body would fire instantly on the very case it exists to solve.
*/

import { describe, it, expect, beforeEach } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, Scene } from 'three';
import { Boulder, Meanie, Synthoid, Tree, type GameObject } from '../world/objects';
import { MAP_SIZE } from '../world/terrain';
import { runMeaniePhase, triggerMeanieConversion } from './meanie';
import type { SceneData } from './scene';
import { game } from '../game/state.svelte';
import { settings } from '../settings.svelte';
import { seedGameRandom } from '../game/random';

const GROUND = 1;
const M_COL = 5;
const M_ROW = 5;
// A Meanie steps 16 of 256 units per 4 Hz tick, so a full sweep is 16 ticks.
const TICKS_PER_SWEEP = 16;

type Ctor = new (...args: ConstructorParameters<typeof GameObject>) => GameObject;

function world() {
	const scene = new Scene();
	const map = new Array(MAP_SIZE * MAP_SIZE).fill(GROUND);
	const allObjects: GameObject[] = [];
	const sceneData = { scene, map, allObjects, particleBursts: [] } as unknown as SceneData;

	const add = <T extends GameObject>(T_: Ctor, col: number, row: number, height = GROUND): T => {
		const o = new T_(0, col, row, height, 0, null, null, {});
		allObjects.push(o);
		scene.add(o.object3D);
		return o as T;
	};

	/*
	 A low wall between the Meanie and the far half of the map, tuned so the Meanie can see the BODY
	 but not the SQUARE it stands on — the exact state that causes a Meanie to be made in the first
	 place, and the only state in which rule 4 is observable.

	 The margins are tight and worth writing down, because the first attempt at this fixture hid both
	 and the test passed vacuously. The Meanie's eye is at 1.9 (ground 1 + EYE_HEIGHT_LOCAL 0.9). A
	 body on ONE boulder has its feet at 1.5, so the ray to it RISES less than it falls to the square
	 at 1.0; at the wall those rays are at ~1.72 and ~1.5 respectively, so a wall topping out at 1.6
	 separates them.

	 Note the body must stay BELOW the Meanie's eye: isCellVisibleFrom refuses any target at or above
	 the eye outright, so a taller pile hides the body as well and proves nothing.
	*/
	const addWall = () => {
		const wall = new Mesh(new BoxGeometry(40, 1.6, 0.2), new MeshBasicMaterial());
		wall.position.set(M_COL + 0.5, 0.8, MAP_SIZE - 1 - 7.5);
		scene.add(wall);
	};

	// A body on flat ground, registered as the one the player occupies — runMeaniePhase looks the
	// active body up through game.activeSynthoidCol/Row and does nothing at all without it.
	const addBody = (col: number, row: number) => {
		const body = add(Synthoid, col, row, GROUND);
		game.activeSynthoidCol = col;
		game.activeSynthoidRow = row;
		return body;
	};

	// A body on a single boulder: feet at 1.5, square at ground level. See addWall.
	const addRaisedBody = (col: number, row: number) => {
		add(Boulder, col, row, GROUND);
		const body = add(Synthoid, col, row, GROUND + 0.5);
		game.activeSynthoidCol = col;
		game.activeSynthoidRow = row;
		return body;
	};

	return { sceneData, allObjects, add, addBody, addWall, addRaisedBody };
}

const liveMeanies = (objects: GameObject[]) => objects.filter(o => o instanceof Meanie && o.absorbedTime === null);

/*
 Settle a morph that has just started.

 A conversion or a reversion is one atomic replacement (engine/scene.ts's replaceObjectInScene), so
 the new object is in allObjects the moment the trigger fires and nothing has to be flushed. What is
 still worth doing by hand is the splice GameLoop performs once an absorb animation finishes, since
 these tests never run a frame: without it every cell keeps its corpses and `allObjects` reads as
 twice as full as the scene.
*/
const settleMorphs = (sceneData: SceneData) => {
	for (let i = sceneData.allObjects.length - 1; i >= 0; i--) {
		if (sceneData.allObjects[i].absorbedTime !== null) sceneData.allObjects.splice(i, 1);
	}
};

beforeEach(() => {
	game.firstActionTaken = true;
	game.phase = 'PLAYING';
	game.energy = 10;
	game.activeSynthoidCol = null;
	game.activeSynthoidRow = null;
	settings.particleEffects = false;
	seedGameRandom(0, 0);
});

describe('only one Meanie exists at a time', () => {
	it('refuses a second conversion while one is alive', () => {
		const { sceneData, allObjects, add } = world();
		const body = add(Synthoid, M_COL, M_ROW + 5);
		add(Tree, 2, 2);
		add(Tree, 3, 3);

		triggerMeanieConversion(sceneData, body, 1000);
		settleMorphs(sceneData);
		expect(liveMeanies(allObjects)).toHaveLength(1);

		// The half-visible condition holds every tick; the old code made a Meanie every one of them.
		triggerMeanieConversion(sceneData, body, 2000);
		settleMorphs(sceneData);
		expect(liveMeanies(allObjects)).toHaveLength(1);
		// ...and the second tree is still standing.
		expect(allObjects.filter(o => o instanceof Tree && o.absorbedTime === null)).toHaveLength(1);
	});

	it('allows a new one once the previous has gone', () => {
		const { sceneData, allObjects, add } = world();
		const body = add(Synthoid, M_COL, M_ROW + 5);
		add(Tree, 2, 2);
		add(Tree, 3, 3);

		triggerMeanieConversion(sceneData, body, 1000);
		settleMorphs(sceneData);
		liveMeanies(allObjects)[0].remove(1500);

		triggerMeanieConversion(sceneData, body, 2000);
		settleMorphs(sceneData);
		expect(liveMeanies(allObjects)).toHaveLength(1);
	});
});

describe('it sweeps rather than homing', () => {
	it('turns a fixed step per tick regardless of where the player is', () => {
		const { sceneData, add, addBody } = world();
		addBody(M_COL, M_ROW + 5);
		// Facing directly away from the player. A homing Meanie snaps around in ~8 ticks; a sweeping
		// one advances by exactly one step whatever the bearing to the target.
		const meanie = add(Meanie, M_COL, M_ROW) as Meanie;
		meanie.rot = 128;

		runMeaniePhase(sceneData, 1000);
		expect(meanie.rot).toBe(144);
		runMeaniePhase(sceneData, 1250);
		expect(meanie.rot).toBe(160);
	});
});

describe('it tests the square, not the body', () => {
	it('does not fire on a body whose square it cannot see', () => {
		const { sceneData, add, addWall, addRaisedBody } = world();
		addWall();
		addRaisedBody(M_COL, M_ROW + 5);
		add(Meanie, M_COL, M_ROW);

		for (let t = 0; t < TICKS_PER_SWEEP; t++) runMeaniePhase(sceneData, 1000 + t * 250);

		expect(game.phase).toBe('PLAYING');
		expect(game.energy).toBe(10);
	});

	it('fires once its sweep brings a visible square into the cone', () => {
		const { sceneData, add, addBody } = world();
		addBody(M_COL, M_ROW + 5);
		const meanie = add(Meanie, M_COL, M_ROW) as Meanie;
		meanie.rot = 128;

		for (let t = 0; t < TICKS_PER_SWEEP && game.phase === 'PLAYING'; t++) runMeaniePhase(sceneData, 1000 + t * 250);

		// Forced hyperspace: 3 energy gone, and a transfer under way.
		expect(game.energy).toBe(7);
		expect(game.phase).toBe('TRANSFER');
	});
});

describe('it reverts to a tree after one full sweep', () => {
	it('gives up and becomes a tree again when it never sees the square', () => {
		const { sceneData, allObjects, add, addWall, addRaisedBody } = world();
		addWall();
		addRaisedBody(M_COL, M_ROW + 5);
		const meanie = add(Meanie, M_COL, M_ROW) as Meanie;

		for (let t = 0; t <= TICKS_PER_SWEEP; t++) runMeaniePhase(sceneData, 1000 + t * 250);

		expect(meanie.absorbedTime).not.toBeNull();
		// Energy is conserved: the Meanie (1) is queued to come back as a Tree (1) where it stood.
		settleMorphs(sceneData);
		expect(allObjects.some(o => o instanceof Tree && o.col === M_COL && o.row === M_ROW)).toBe(true);
	});

	it('does not give up early', () => {
		const { sceneData, add, addWall, addRaisedBody } = world();
		addWall();
		addRaisedBody(M_COL, M_ROW + 5);
		const meanie = add(Meanie, M_COL, M_ROW) as Meanie;

		for (let t = 0; t < TICKS_PER_SWEEP - 1; t++) runMeaniePhase(sceneData, 1000 + t * 250);

		expect(meanie.absorbedTime).toBeNull();
	});
});
