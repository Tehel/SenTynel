/*
 Coverage for the two things in the exposure overlay that fail SILENTLY.

 The held hatching is a shader patch, and a string replace against a chunk name that no longer
 exists does not throw — it just quietly does nothing, and held cells render solid, looking exactly
 like watched ones. A Three.js upgrade renaming or dropping a chunk is a real possibility (the
 project tracks latest), so the chunk names are asserted against Three's own ShaderLib rather than
 against a fixture.

 The rest is a headless end-to-end pass over createExposureOverlay + refreshExposureOverlay: no
 renderer, no DOM, no WebGL — the overlay's own arithmetic all happens on the CPU.
*/

import { describe, it, expect } from 'vitest';
import { Color, Matrix4, ShaderLib, Vector3 } from 'three';
import { Disposer } from './disposer';
import {
	assumedHeight,
	BOULDER_HEIGHT,
	COLOR_HIDDEN,
	createExposureOverlay,
	handleExposureKeys,
	HOVER_HEIGHT,
	MAX_PILE_BOULDERS,
	refreshExposureOverlay,
	setExposurePile,
} from './exposureOverlay';
import { ExposureSensor, type LiveWatcher } from './exposureSensor';
import { MAP_SIZE, type Level } from '../world/terrain';

// The overlay only draws; the map and the clocks come from a sensor (engine/exposureSensor.ts).
const viewOf = (map: number[], live: LiveWatcher[]) => new ExposureSensor(map).view(live);

const PERIOD = 48;

// A flat landscape: every cell shape 0 (flat), every vertex at height 1.
const flatLevel = () => {
	const map = new Array(MAP_SIZE * MAP_SIZE).fill(1);
	const shapes = new Array(MAP_SIZE * MAP_SIZE).fill(0);
	return { level: { map, shapes } as unknown as Level, map };
};

const watcher = (over: Partial<LiveWatcher> = {}): LiveWatcher => ({
	col: 5,
	row: 5,
	height: 1,
	rot: 0,
	step: 20,
	ticksToTurn: PERIOD,
	turnPeriod: PERIOD,
	drainLocked: false,
	turning: false,
	absorbed: false,
	...over,
});

describe('the held-hatching shader patch', () => {
	it('targets chunk names that still exist in this Three.js', () => {
		expect(ShaderLib.basic.vertexShader).toContain('#include <begin_vertex>');
		expect(ShaderLib.basic.fragmentShader).toContain('#include <dithering_fragment>');
	});

	it('actually rewrites the shader rather than silently matching nothing', () => {
		const disposer = new Disposer();
		const { level, map } = flatLevel();
		const overlay = createExposureOverlay(level, map, disposer);
		const material = overlay.mesh.material as { onBeforeCompile?: (s: unknown) => void };

		const shader = {
			vertexShader: ShaderLib.basic.vertexShader,
			fragmentShader: ShaderLib.basic.fragmentShader,
			uniforms: {},
		};
		material.onBeforeCompile!(shader);

		// The attribute has to be declared, carried across, and then actually acted on. Asserted on
		// the mechanism rather than on the exact GLSL, so retuning the hatching does not break the
		// test that exists to prove the patch landed at all.
		expect(shader.vertexShader).toContain('attribute float held;');
		expect(shader.vertexShader).toContain('vHeld = held;');
		expect(shader.vertexShader).toContain('vStripe =');
		expect(shader.fragmentShader).toContain('varying float vHeld;');
		// Declared once and used at least once more — a patch that declares a varying and never
		// reads it compiles cleanly and does nothing, which is the failure being guarded against.
		expect(shader.fragmentShader.split('vHeld').length - 1).toBeGreaterThanOrEqual(2);
		expect(shader.fragmentShader).not.toBe(ShaderLib.basic.fragmentShader);
		disposer.disposeAll();
	});
});

describe('the overlay end to end, headless', () => {
	it('covers the flat cells and leaves the slopes alone', () => {
		const disposer = new Disposer();
		const { level, map } = flatLevel();
		// Punch one slope into the middle; it must not get a square.
		level.shapes[10 * MAP_SIZE + 10] = 5;
		const overlay = createExposureOverlay(level, map, disposer);

		const playable = (MAP_SIZE - 1) * (MAP_SIZE - 1);
		expect(overlay.cells.length).toBe(playable - 1);
		expect(overlay.mesh.count).toBe(overlay.cells.length);
		expect(overlay.cells.some(c => c.col === 10 && c.row === 10)).toBe(false);
		// Never intercept the crosshair or a watcher's line of sight.
		expect(overlay.mesh.userData.skipRaycast).toBe(true);
		// Culling is off on purpose — Three caches an InstancedMesh's bounding sphere and never
		// invalidates it, and this one object spans the whole map so the test can never pay off.
		expect(overlay.mesh.frustumCulled).toBe(false);
		disposer.disposeAll();
	});

	/*
	 The bug this whole `held` mechanism exists for, at the level the player sees it: a drain-locked
	 watcher's pending sectors must be hatched rather than repainted, so their ramp colour still
	 says WHEN they arrive once the lock breaks.
	*/
	it('flags the cells waiting on a held turn, and only those', () => {
		const disposer = new Disposer();
		const { level, map } = flatLevel();
		const overlay = createExposureOverlay(level, map, disposer);

		refreshExposureOverlay(overlay, viewOf(map, [watcher()]));
		const running = Array.from({ length: overlay.cells.length }, (_, i) => overlay.held.getX(i));
		expect(running.every(v => v === 0)).toBe(true);

		// Same watcher, now holding its turn with the clock run past zero.
		refreshExposureOverlay(overlay, viewOf(map, [watcher({ drainLocked: true, ticksToTurn: -12 })]));
		const stalled = Array.from({ length: overlay.cells.length }, (_, i) => overlay.held.getX(i));
		expect(stalled.some(v => v === 1)).toBe(true);

		// The cells it is looking at RIGHT NOW are being watched, not held — rot 0 faces
		// row-increasing, so a cell straight along +row from the watcher is in the cone.
		const inCone = overlay.cells.findIndex(c => c.col === 5 && c.row === 12);
		expect(inCone).toBeGreaterThanOrEqual(0);
		expect(stalled[inCone]).toBe(0);

		disposer.disposeAll();
	});
});

/*
 The height stepper, which is the whole reason the map stores a height WINDOW rather than a
 boolean. Everything here is about the one claim a ground-level picture cannot make: a cell can be
 hidden with nothing on it and wide open once a pile is built there.
*/
describe('the height stepper', () => {
	/*
	 Terrain 1 everywhere; the watcher stands on a plateau of 4 (eye 4.9) and a bank of 3 crosses
	 between it and the far side. Ground level behind the bank is hidden; a body raised a couple of
	 boulders clears it. Same geometry as game/exposure.test.ts's ridge, so the two agree on what
	 they are describing.
	*/
	const ridgeWorld = () => {
		const map = new Array(MAP_SIZE * MAP_SIZE).fill(1);
		for (let col = 0; col < MAP_SIZE; col++) {
			for (const row of [7, 8]) map[row * MAP_SIZE + col] = 3;
			for (const row of [1, 2, 3]) map[row * MAP_SIZE + col] = 4;
		}
		const shapes = new Array(MAP_SIZE * MAP_SIZE).fill(0);
		return { level: { map, shapes } as unknown as Level, map };
	};
	const ridgeWatcher = () => watcher({ col: 5, row: 2, height: 4, rot: 0 });

	const colorOf = (overlay: ReturnType<typeof createExposureOverlay>, col: number, row: number) => {
		const i = overlay.cells.findIndex(c => c.col === col && c.row === row);
		expect(i).toBeGreaterThanOrEqual(0);
		return overlay.mesh.getColorAt(i, new Color()).getHex();
	};

	it('turns a terrain-hidden cell exposed once boulders go under it', () => {
		const disposer = new Disposer();
		const { level, map } = ridgeWorld();
		const overlay = createExposureOverlay(level, map, disposer);
		// rot 0 faces row-increasing, so the far side of the bank is in this watcher's cone.
		const target = { col: 5, row: 12 };

		refreshExposureOverlay(overlay, viewOf(map, [ridgeWatcher()]));
		expect(colorOf(overlay, target.col, target.row)).toBe(new Color(COLOR_HIDDEN).getHex());

		// Raise the assumed body by two boulders: the bank no longer hides it.
		expect(setExposurePile(overlay, 2)).toBe(true);
		refreshExposureOverlay(overlay, viewOf(map, [ridgeWatcher()]));
		expect(colorOf(overlay, target.col, target.row)).not.toBe(new Color(COLOR_HIDDEN).getHex());
		disposer.disposeAll();
	});

	it('lifts the squares onto the plane being asked about', () => {
		const disposer = new Disposer();
		const { level, map } = ridgeWorld();
		const overlay = createExposureOverlay(level, map, disposer);
		const i = overlay.cells.findIndex(c => c.col === 5 && c.row === 12);
		const scratch = new Matrix4();
		const squareY = () => {
			overlay.mesh.getMatrixAt(i, scratch);
			return new Vector3().setFromMatrixPosition(scratch).y;
		};

		expect(squareY()).toBeCloseTo(overlay.cells[i].height + HOVER_HEIGHT, 5);

		// The squares have to move with the question, or the picture shows one plane while the
		// colours answer about another.
		setExposurePile(overlay, 3);
		expect(squareY()).toBeCloseTo(overlay.cells[i].height + 3 * BOULDER_HEIGHT + HOVER_HEIGHT, 5);
		expect(assumedHeight(overlay, overlay.cells[i].height)).toBeCloseTo(
			overlay.cells[i].height + 3 * BOULDER_HEIGHT,
			5
		);
		disposer.disposeAll();
	});

	it('clamps to bare ground and to MAX_PILE_BOULDERS, and reports whether anything moved', () => {
		const disposer = new Disposer();
		const { level, map } = ridgeWorld();
		const overlay = createExposureOverlay(level, map, disposer);

		expect(setExposurePile(overlay, -5)).toBe(false);
		expect(overlay.pileBoulders).toBe(0);
		expect(setExposurePile(overlay, 999)).toBe(true);
		expect(overlay.pileBoulders).toBe(MAX_PILE_BOULDERS);
		// No change means no repaint, which is what lets the caller skip work on every other frame.
		expect(setExposurePile(overlay, MAX_PILE_BOULDERS)).toBe(false);
		disposer.disposeAll();
	});

	it('steps on PageUp/PageDown and resets on Home, reporting whether it moved', () => {
		const disposer = new Disposer();
		const { level } = ridgeWorld();
		const overlay = createExposureOverlay(level, ridgeWorld().map, disposer);

		const keys = (...pressed: string[]) => ({
			consumeJustPressed: (k: string) => pressed.includes(k),
		});

		expect(handleExposureKeys(keys('PageUp'), overlay)).toBe(true);
		expect(overlay.pileBoulders).toBe(1);
		handleExposureKeys(keys('PageUp'), overlay);
		expect(overlay.pileBoulders).toBe(2);
		handleExposureKeys(keys('PageDown'), overlay);
		expect(overlay.pileBoulders).toBe(1);
		handleExposureKeys(keys('Home'), overlay);
		expect(overlay.pileBoulders).toBe(0);
		// Nothing pressed, nothing moves — and the caller is told so, which is what lets it skip
		// the repaint on every frame that is not a keypress.
		expect(handleExposureKeys(keys(), overlay)).toBe(false);
		expect(overlay.pileBoulders).toBe(0);
		disposer.disposeAll();
	});
});
