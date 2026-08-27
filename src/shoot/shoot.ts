/*
 Offscreen still-frame renderer — the eye-candy branch's way of letting a change be LOOKED at
 before it is claimed.

 CLAUDE.md's working style says the user smoke-tests in a browser and Claude cannot see the
 result, so visual parity must never be claimed without confirmation. That stands. This page
 narrows what has to reach the user: seams, texel density, blown specular, an illegible
 checkerboard and a broken silhouette are all objective and can be caught here first. Taste
 cannot, and still goes to a person.

 It is deliberately NOT the game. It imports buildScene directly rather than driving App.svelte
 through its menu, which buys three things: every frame is reproducible (no rAF timing, no
 pointer lock, no phase machine), the sun is pinned instead of orbiting on wall-clock, and the
 thing under test is exactly the module being changed. Driven by utils/shoot.mjs.

 Served by the dev server only — Vite's build input is index.html alone, so this never ships.
*/
import { PerspectiveCamera, Vector3, Mesh, Group } from 'three';
import { buildScene } from '../engine/scene';
import { Disposer } from '../engine/disposer';
import { RendererManager } from '../engine/renderer';
import { EYE_HEIGHT } from '../engine/camera';
import { MAP_SIZE } from '../world/terrain';
import { getObject } from '../world/objects/models';
import { settings } from '../settings.svelte';
import { applyObjectStyleTo } from '../engine/scene';
import { GameObjType } from '../world/terrain';

// Sun orbit constants, mirrored from engine/loop.ts. Duplicated rather than exported because
// the point here is to PIN the sun at a chosen phase, not to advance it — importing the live
// orbit would invite someone to drive it from wall-clock and lose reproducibility.
const SUN_HEIGHT = 30;
const SUN_RADIUS = 20;
const SUN_PHASE_OFFSET = Math.PI / 3;

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const str = (k: string, d: string) => q.get(k) ?? d;

// Must precede buildScene — engine/scene.ts reads settings.visualStyle while creating materials.
settings.visualStyle = str('style', 'classic') === 'enhanced' ? 'enhanced' : 'classic';
settings.terrainNormals = str('normals', '1') !== '0';
// Models follow the terrain switch unless asked otherwise, so `style=enhanced` shows the whole
// new look rather than new ground under old models.
settings.modelStyle = str('models', str('style', 'classic')) === 'enhanced' ? 'enhanced' : 'classic';

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

/*
 Size from the VIEWPORT, not from the requested w/h. Headless Chrome's --window-size is an outer
 window and it keeps a few dozen pixels for itself, so forcing the renderer to the requested
 height left the canvas short of the bottom of the shot and the body's navy showing through.
 Filling window.innerWidth/Height instead means the canvas always covers exactly what gets
 captured; utils/shoot.mjs asks for the size it wants and takes whatever the viewport gives.
*/
const width = window.innerWidth;
const height = window.innerHeight;
const rm = new RendererManager(canvas);

const camera = new PerspectiveCamera(num('fov', 60), width / height, 0.1, 1000);
const disposer = new Disposer();

const centre = new Vector3(MAP_SIZE / 2, num('look', 4), (MAP_SIZE - 1) / 2);

function placeCamera(mode: string, map: number[]) {
	if (mode === 'eye') {
		/*
		 A player's-eye view. The height comes from the MAP, not the caller: `height` is an offset
		 (boulders under the feet, say), so a shot names a cell and lands standing on it. Passing an
		 absolute height meant every eye shot had to know the terrain in advance, and the first one
		 put the camera underground looking up at the landscape's underside.
		*/
		const col = num('col', MAP_SIZE / 2);
		const row = num('row', MAP_SIZE / 2);
		const ground = map[Math.round(row) * MAP_SIZE + Math.round(col)] ?? 0;
		const h = ground + num('height', 0) + EYE_HEIGHT;
		camera.position.set(col + 0.5, h, MAP_SIZE - 1 - (row + 0.5));
		const yaw = (num('yaw', 0) * Math.PI) / 180;
		const pitch = (num('pitch', 0) * Math.PI) / 180;
		camera.lookAt(
			camera.position.x + Math.sin(yaw) * Math.cos(pitch),
			camera.position.y + Math.sin(pitch),
			camera.position.z + Math.cos(yaw) * Math.cos(pitch)
		);
		return;
	}
	// 'orbit' (default): a fixed point on a circle around the map, looking at its middle.
	const a = (num('angle', 45) * Math.PI) / 180;
	const r = num('dist', MAP_SIZE * 0.9);
	camera.position.set(centre.x + r * Math.cos(a), num('camy', 18), centre.z + r * Math.sin(a));
	camera.lookAt(centre);
}

async function shootLevel() {
	const sd = buildScene(
		num('level', 0),
		{ smooths: num('smooths', 2), despikes: num('despikes', 2), showGrid: q.get('grid') === '1', showSurfaces: true, showAxis: false },
		disposer
	);
	// Pin the sun instead of orbiting it, so two shots differ only by the change under test.
	const phase = SUN_PHASE_OFFSET + num('sun', 0);
	sd.sunLight.position.set(
		MAP_SIZE / 2 + SUN_RADIUS * Math.cos(phase),
		SUN_HEIGHT,
		(MAP_SIZE - 1) / 2 - SUN_RADIUS * Math.sin(phase)
	);
	placeCamera(str('mode', 'orbit'), sd.map);
	// The skybox resolves async off an <img>; give it a moment or the background is bare black.
	await new Promise(r => setTimeout(r, num('settle', 600)));
	rm.render(sd.scene, camera);
}

/*
 Model turntable — every model on its own plinth in a row, rendered at one fixed angle per shot.
 The live, rotating version a person judges shapes with is ui/ModelReview.svelte; this is the
 same arrangement frozen, so a shape can be self-checked from several sides before it is shown.
*/
async function shootModels() {
	const { Scene, AmbientLight, PointLight } = await import('three');
	const scene = new Scene();
	// Same rig as the game, or the comparison says nothing (CLAUDE.md's Three.js notes).
	scene.add(new AmbientLight(0xffffff, 0.7));
	const sun = new PointLight(0xffffff, 0.5, 0, 0);
	sun.position.set(6, 10, 8);
	scene.add(sun);

	const types: [string, GameObjType][] = [
		['tree', GameObjType.TREE],
		['boulder', GameObjType.BOULDER],
		['pedestal', GameObjType.PEDESTAL],
		['synthoid', GameObjType.SYNTHOID],
		['sentry', GameObjType.SENTRY],
		['meanie', GameObjType.MEANIE],
		['sentinel', GameObjType.SENTINEL],
	];
	const SPACING = 1.25;
	const only = str('only', '');
	// Comma list, so a variant can be shown beside the models it has to read differently from —
	// a Sentinel judged on its own tells you nothing about whether it out-scales a synthoid.
	const wanted = only ? only.split(',') : null;
	const shown = wanted ? types.filter(t => wanted.includes(t[0])) : types;
	const spin = (num('spin', 0) * Math.PI) / 180;
	const colors = { color1: 0x808080, color2: 0x00c300 };

	const row = new Group();
	shown.forEach(([, type], i) => {
		const holder = new Group();
		const mesh: Mesh = getObject(type, colors, settings.modelStyle);
		// Dress the model exactly as engine/scene.ts would, so the turntable shows what the game
		// shows. Without this the review sheet is of untextured models and says nothing about the
		// thing most likely to be wrong.
		if (settings.visualStyle === 'enhanced') applyObjectStyleTo(mesh, type);
		holder.add(mesh);
		holder.rotation.y = spin;
		holder.position.set(i * SPACING, 0, 0);
		row.add(holder);
	});
	scene.add(row);

	/*
	 Frame the row tightly. Models are all about one unit tall, so a distance derived from the row's
	 WIDTH alone pushes the camera back until they are specks — the first turntable shot put seven
	 1-unit models across a 1280px frame at roughly 40px each, which is useless for judging a shape.
	 0.62 of the span fills the frame horizontally at the default 60° FOV; a single model (only=...)
	 gets a floor so it does not end up inside the mesh.
	*/
	const span = Math.max(1, shown.length) * SPACING;
	const centreX = (shown.length - 1) * SPACING / 2;
	camera.position.set(centreX, num('camy', 1.15), num('dist', Math.max(2.2, span * 0.62)));
	camera.lookAt(centreX, num('look', 0.75), 0);
	rm.render(scene, camera);
}

(async () => {
	if (str('scene', 'level') === 'models') await shootModels();
	else await shootLevel();
	// utils/shoot.mjs polls for this before capturing — the signal that a frame is on the canvas.
	document.title = 'SHOT-READY';
})().catch(err => {
	console.error(err);
	document.title = 'SHOT-ERROR: ' + (err?.message ?? err);
});
