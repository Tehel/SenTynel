/*
 THE MORPH WINDOW (RULES-FIDELITY.md A5b) — a drain is one atomic replacement, and nothing outlives
 what it stands on.

 Reported from play and from the demo: *"when both the player and a watcher are trying to drain a
 tower at roughly the same time, the top boulder becomes a tree (the watcher's action) and the lower
 boulder is absorbed by the player, resulting in a tree suspended mid-air."*

 Both halves of that came from the same place. A5 made an absorbing object stop counting as an
 occupant, which is right for the square it stood on and wrong for the RUNG BELOW it: the thing
 underneath was promoted to top-of-stack the instant anything above it started to fade, so the two
 actors could take a tower apart at two levels within one second. The drain's replacement then
 re-derived its altitude from a stack that had shrunk under it and landed on the ground, and the
 corpse still on screen was left standing on nothing.

 The fix is in two pieces and this file is one test per piece:

  - `replaceObjectInScene` — the target is removed and its replacement placed at the target's own
    rung IN THE SAME FRAME, so the stack never shrinks and nothing below is ever promoted. There is
    no queue and no reservation any more; the replacement itself is the reservation.
  - `finishUnsupportedCorpses` — the moment an object leaves the scene, any corpse it was holding up
    goes with it. The rules and the screen can no longer disagree about what is standing where.

 A flat map with no terrain meshes, objects added directly rather than through addObjectToScene:
 line of sight is unobstructed, which is what these tests want — they are about stacks, not sight.
*/

import { describe, it, expect, beforeEach } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, MeshPhongMaterial, Scene } from 'three';
import { Boulder, Meanie, Sentry, Synthoid, Tree, type GameObject } from '../world/objects';
import { GameObjType, MAP_SIZE } from '../world/terrain';
import { runDrainPhase } from './watcher';
import { canPlaceAt, finishUnsupportedCorpses, objectsAt, removeObjectFromScene, topObjectAt, type SceneData } from './scene';
import { game } from '../game/state.svelte';
import { settings } from '../settings.svelte';

const GROUND = 1;
// A sentry at (5,5) facing rot 0 looks down +row, so anything at row > 5 in the same column is in
// its cone. Three cells out leaves room for a tower without leaving the beam.
const W_COL = 5;
const W_ROW = 5;
const COL = 5;
const ROW = 8;

type Ctor = new (...args: ConstructorParameters<typeof GameObject>) => GameObject;

function world() {
	const scene = new Scene();
	const map = new Array(MAP_SIZE * MAP_SIZE).fill(GROUND);
	const allObjects: GameObject[] = [];
	const sceneData = { scene, map, allObjects, particleBursts: [] } as unknown as SceneData;

	const add = <T extends GameObject>(T_: Ctor, col: number, row: number, height = GROUND): T => {
		const o = new T_(0, col, row, height, 0, 20, 16, {});
		allObjects.push(o);
		scene.add(o.object3D);
		return o as T;
	};

	return { sceneData, allObjects, add };
}

// One frame of engine/loop.ts, in its order: animate, splice out anything that finished, then sweep
// up the corpses that splice just left standing on air.
function frame(sd: SceneData, time: number): void {
	const toRemove: number[] = [];
	sd.allObjects.forEach((o, i) => {
		o.play(time, { x: 0, y: 0, z: 0 } as never);
		if (o.toRemove) {
			toRemove.push(i);
			sd.scene.remove(o.object3D);
		}
	});
	toRemove.reverse().forEach(i => sd.allObjects.splice(i, 1));
	if (toRemove.length > 0) finishUnsupportedCorpses(sd);
}

const frames = (sd: SceneData, from: number, to: number, step = 16) => {
	for (let t = from; t <= to; t += step) frame(sd, t);
};

// Everything at the cell that still has a mesh in the scene, bottom to top, '*' marking a corpse
// part-way through its absorb. This is the picture the player is looking at, not the rules' view.
const onScreen = (sd: SceneData, col = COL, row = ROW) =>
	sd.allObjects
		.filter(o => o.col === col && o.row === row)
		.sort((a, b) => a.height - b.height)
		.map(o => `${o.constructor.name}@${o.height}${o.absorbedTime === null ? '' : '*'}`)
		.join(' ');

/*
 Has an object's spawn animation begun to show anything? Squash raises scale.y off zero; fade and
 dissolve push the shader's fadeProgress off zero. Both sit at exactly zero while a morph's second
 half is still waiting for its turn, which is the state this file is here to pin down.
*/
function started(o: GameObject): boolean {
	if (settings.animationStyle === 'squash') return o.object3D.scale.y > 0;
	const material = (o.object3D as Mesh).material as MeshPhongMaterial;
	return (material.userData.uniforms as { fadeProgress: { value: number } }).fadeProgress.value > 0;
}

/*
 The invariant, derived independently of the production code: for everything on screen, is the
 surface under its feet the terrain or something that visibly holds it up? Only boulders and the
 pedestal hold anything up — a tree or a synthoid is the top of its stack by definition — and a
 boulder counts while it is still drawn, animating away or not. That is the whole point: this asks
 what the player can see, so an object still fading out is still something to stand on.
*/
function standingOnAir(sd: SceneData): string[] {
	const cells = new Map<string, GameObject[]>();
	for (const o of sd.allObjects) {
		const key = `${o.col}_${o.row}`;
		if (!cells.has(key)) cells.set(key, []);
		cells.get(key)!.push(o);
	}
	const out: string[] = [];
	for (const [key, all] of cells) {
		const [col, row] = key.split('_').map(Number);
		let surface = sd.map[row * MAP_SIZE + col];
		for (const o of all) if (o instanceof Boulder) surface = Math.max(surface, o.height + 0.5);
		for (const o of all) {
			if (o.height > surface + 1e-6) out.push(`${o.constructor.name}@(${col},${row})h${o.height}`);
		}
	}
	return out;
}

beforeEach(() => {
	game.firstActionTaken = true;
	game.phase = 'PLAYING';
	game.energy = 10;
	game.activeSynthoidCol = null;
	game.activeSynthoidRow = null;
	settings.particleEffects = false;
	settings.animationStyle = 'squash';
});

describe('a drain morph is one atomic replacement', () => {
	it('puts the replacement on the drained object\'s own rung, in the same tick', () => {
		const { sceneData, add } = world();
		add(Sentry, W_COL, W_ROW);
		add(Boulder, COL, ROW, GROUND);
		add(Boulder, COL, ROW, GROUND + 0.5);

		// Boulders are taken on the tick they are seen — no stall — so one tick is the whole morph.
		runDrainPhase(sceneData, 0);

		const stack = objectsAt(sceneData.allObjects, COL, ROW);
		expect(stack.map(o => o.constructor.name)).toEqual(['Boulder', 'Tree']);
		// The rung the boulder held, not the ground: the tower keeps its shape. This is what used to
		// go wrong — the replacement re-derived its altitude and dropped to the bottom of the cell.
		expect(stack[1].height).toBe(GROUND + 0.5);
	});

	it('never promotes the rung below, so the tower cannot be taken apart from underneath', () => {
		const { sceneData, add } = world();
		add(Sentry, W_COL, W_ROW);
		const lower = add(Boulder, COL, ROW, GROUND);
		add(Boulder, COL, ROW, GROUND + 0.5);

		runDrainPhase(sceneData, 0);

		// Mid-morph the top of the stack is the new tree, so this is what the player's absorb takes.
		expect(topObjectAt(sceneData.allObjects, COL, ROW)).toBeInstanceOf(Tree);
		expect(removeObjectFromScene(sceneData, COL, ROW, 100, () => true)).toBe(true);
		expect(lower.absorbedTime).toBeNull();
	});

	it('holds the cell against a build for the same reason: something is standing there', () => {
		// The old implementation held it with a reservation (cellReserved) because the cell was
		// genuinely empty for 500 ms. Now the replacement occupies it from the first frame, so the
		// answer is the ordinary stacking rule and there is nothing to reserve.
		const { sceneData, add } = world();
		add(Sentry, W_COL, W_ROW);
		add(Boulder, COL, ROW, GROUND);

		runDrainPhase(sceneData, 0);

		expect(canPlaceAt(sceneData, COL, ROW, GameObjType.BOULDER)).toBe(false);
		expect(canPlaceAt(sceneData, COL + 4, ROW, GameObjType.BOULDER)).toBe(true);
	});

	it('turns a drained synthoid into a boulder on the rung it stood on', () => {
		const { sceneData, add } = world();
		add(Sentry, W_COL, W_ROW);
		add(Boulder, COL, ROW, GROUND);
		add(Synthoid, COL, ROW, GROUND + 0.5);

		// Synthoids stall for WATCHER_GRACE_MS, so the morph starts on the second tick past it.
		runDrainPhase(sceneData, 0);
		runDrainPhase(sceneData, 4000);

		const stack = objectsAt(sceneData.allObjects, COL, ROW);
		expect(stack.map(o => o.constructor.name)).toEqual(['Boulder', 'Boulder']);
		expect(stack[1].height).toBe(GROUND + 0.5);
	});

	it('plays its two halves in sequence, the pair taking one drain interval', () => {
		// The replacement is in the rules from tick zero (the tests above) and on screen only for the
		// second half — the old object squashes away, then the new one inflates. Overlapping the two
		// was tried and looks wrong; see game/timing.ts's MORPH_DURATION_MS.
		for (const style of ['squash', 'fade'] as const) {
			settings.animationStyle = style;
			const { sceneData, add } = world();
			add(Sentry, W_COL, W_ROW);
			const boulder = add(Boulder, COL, ROW, GROUND);

			runDrainPhase(sceneData, 0);
			const tree = objectsAt(sceneData.allObjects, COL, ROW)[0];

			// First half: the boulder is still leaving and the tree is holding its rung invisibly.
			frames(sceneData, 16, 400);
			expect(boulder.toRemove, style).toBe(false);
			expect(tree.ready, style).toBe(false);
			expect(started(tree), style).toBe(false);

			// Half-way: the boulder is gone and the tree starts to appear.
			frames(sceneData, 416, 600);
			expect(onScreen(sceneData), style).toBe('Tree@1');
			expect(started(tree), style).toBe(true);
			expect(tree.ready, style).toBe(false);

			// One interval from the drain, the whole morph is finished — under both styles, which a
			// flat animationScale of 2 could not manage (fade took half again as long).
			frames(sceneData, 616, 1050);
			expect(tree.ready, style).toBe(true);
		}
	});

	it('converts a tree on a boulder into a Meanie without moving it', () => {
		// The Meanie conversion and its reversion are the same morph, so they get the same treatment:
		// a tree on a boulder becomes a Meanie on that boulder, not a Meanie on the ground.
		const { sceneData, add } = world();
		// The half-scan fixture from engine/watcher.test.ts: a watcher on a hill and a wall that
		// blocks every corner of the player's square but not their head, which is the one state that
		// converts a tree instead of draining (RULES-FIDELITY.md C9).
		add(Sentry, W_COL, W_ROW, 8);
		add(Synthoid, W_COL, W_ROW + 5, GROUND);
		game.activeSynthoidCol = W_COL;
		game.activeSynthoidRow = W_ROW + 5;
		// The nearest tree to the body is the one that converts — and it is standing on a boulder.
		add(Boulder, W_COL + 1, W_ROW + 5, GROUND);
		add(Tree, W_COL + 1, W_ROW + 5, GROUND + 0.5);
		const wall = new Mesh(new BoxGeometry(40, 6.2, 0.2), new MeshBasicMaterial());
		wall.position.set(W_COL + 0.5, 3.1, MAP_SIZE - 1 - 7.5);
		sceneData.scene.add(wall);

		runDrainPhase(sceneData, 0);
		runDrainPhase(sceneData, 4000);

		const meanie = sceneData.allObjects.find(o => o instanceof Meanie);
		expect(meanie).toBeDefined();
		// On the boulder. The two-halves version derived this from the stack 500 ms later, so a
		// boulder taken in the meantime dropped the Meanie to the ground.
		expect(meanie!.height).toBe(GROUND + 0.5);
	});
});

describe('nothing outlives what it stands on', () => {
	it('cuts the corpse the frame its support leaves the scene', () => {
		// The report, as nearly as a unit test can hold it: a tree on a boulder, the player absorbs
		// the tree (a full second), the watcher takes the boulder underneath (half of one). The tree's
		// corpse used to hang in the air over the tree the watcher put back.
		const { sceneData, add } = world();
		add(Sentry, W_COL, W_ROW);
		add(Boulder, COL, ROW, GROUND);
		const tree = add(Tree, COL, ROW, GROUND + 0.5);

		expect(removeObjectFromScene(sceneData, COL, ROW, 0, () => true)).toBe(true);
		runDrainPhase(sceneData, 100);

		// Not one frame of the whole exchange shows anything standing on air.
		for (let t = 16; t <= 2000; t += 16) {
			frame(sceneData, t);
			expect(standingOnAir(sceneData), `t=${t}`).toEqual([]);
		}
		expect(tree.absorbedTime).not.toBeNull();
		expect(onScreen(sceneData)).toBe('Tree@1');
	});

	it('cuts it for a tree drained off a boulder too, where the morph has no replacement', () => {
		// A tree on a boulder is drained away and nothing is put back (engine/watcher.ts's third
		// branch), so being atomic has nothing to be atomic about here: the rung empties either way
		// and only the corpse rule can keep the picture honest.
		const { sceneData, add } = world();
		add(Sentry, W_COL, W_ROW);
		add(Boulder, COL, ROW, GROUND);
		add(Tree, COL, ROW, GROUND + 0.5);

		runDrainPhase(sceneData, 0);
		expect(removeObjectFromScene(sceneData, COL, ROW, 100, () => true)).toBe(true);

		for (let t = 116; t <= 2000; t += 16) {
			frame(sceneData, t);
			expect(standingOnAir(sceneData), `t=${t}`).toEqual([]);
		}
		expect(onScreen(sceneData)).toBe('');
	});

	it('leaves an ordinary absorb alone — a corpse on its own rung is not standing on air', () => {
		// The sweep must not cut anything it is not aimed at: absorbing the top of a tower leaves a
		// corpse exactly where the stack still supports it, for the whole animation.
		const { sceneData, add } = world();
		add(Boulder, COL, ROW, GROUND);
		const top = add(Boulder, COL, ROW, GROUND + 0.5);

		expect(removeObjectFromScene(sceneData, COL, ROW, 0, () => true)).toBe(true);
		frames(sceneData, 16, 900);
		expect(top.toRemove).toBe(false);
		expect(onScreen(sceneData)).toBe('Boulder@1 Boulder@1.5*');
		frames(sceneData, 916, 1100);
		expect(onScreen(sceneData)).toBe('Boulder@1');
	});
});
