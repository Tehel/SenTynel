import {
	AmbientLight,
	AxesHelper,
	BufferGeometry,
	DoubleSide,
	Euler,
	Line,
	LineBasicMaterial,
	Mesh,
	MeshPhongMaterial,
	PlaneGeometry,
	PointLight,
	Scene,
	SphereGeometry,
	Vector3,
} from 'three';
import { Font } from './fonts/Font';
import { TextGeometry } from './fonts/TextGeometry';
import { fontFixedRegularMinimal } from './fonts/fixed_v01_Regular_minimal';
import { GameObject, Boulder, Synthoid, Tree, Sentinel, Meanie, Sentry, Pedestal } from '../world/objects';
import { GameObjType, generateLevel, MAP_SIZE, type LandscapeOptions, type Level } from '../world/terrain';
import { attachConeMesh, createConeAssets, type ConeAssets } from './cones';
import type { Disposer } from './disposer';
import { loadSkybox } from './skybox';

const font = new Font(fontFixedRegularMinimal);

interface Theme {
	planeEven: number;
	planeOdd: number;
	slopeEven: number;
	slopeOdd: number;
	skybox: string;
}

// All skyboxes are from https://polyhaven.com converted from exr
const SATARA_NIGHT_NO_LAMPS = 'satara_night_no_lamps_2k.webp';
const CITRUS_ORCHARD_ROAD = 'citrus_orchard_road_puresky_2k.webp';
const BELFAST_SUNSET = 'belfast_sunset_puresky_2k.webp';
const OVERCAST_SOIL = 'overcast_soil_puresky_2k.webp';
const ARISTEA_WRECK = 'aristea_wreck_puresky_2k.webp';
const KLOPPENHEIN_07 = 'kloppenheim_07_puresky_2k.webp';

const themes: Theme[] = [
	{ planeEven: 0x00c300, planeOdd: 0x007979, slopeEven: 0x808080, slopeOdd: 0x6c6c6c, skybox: SATARA_NIGHT_NO_LAMPS },
	{ planeEven: 0xc0c078, planeOdd: 0x780078, slopeEven: 0x5a9292, slopeOdd: 0x4c7b7b, skybox: CITRUS_ORCHARD_ROAD },
	{ planeEven: 0x6cafaf, planeOdd: 0x006b6b, slopeEven: 0xa57b7b, slopeOdd: 0x8f6b6b, skybox: BELFAST_SUNSET },
	{ planeEven: 0xb4b470, planeOdd: 0xa04300, slopeEven: 0x8c8c8c, slopeOdd: 0x767676, skybox: OVERCAST_SOIL },
	{ planeEven: 0xbababa, planeOdd: 0x4444ba, slopeEven: 0x6caeae, slopeOdd: 0x5b9494, skybox: ARISTEA_WRECK },
	{ planeEven: 0xc08f8f, planeOdd: 0xc00000, slopeEven: 0x99995e, slopeOdd: 0x838351, skybox: KLOPPENHEIN_07 },
	{ planeEven: 0xc1c1c1, planeOdd: 0x780078, slopeEven: 0x955c95, slopeOdd: 0x825082, skybox: KLOPPENHEIN_07 },
	{ planeEven: 0xc1c100, planeOdd: 0x4747c1, slopeEven: 0xad0000, slopeOdd: 0x920000, skybox: KLOPPENHEIN_07 },
];

export interface SceneOptions extends LandscapeOptions {
	showGrid: boolean;
	showSurfaces: boolean;
	showAxis: boolean;
}

// A spawn deferred to a future frame. The watcher drain uses this to schedule the
// post-absorb spawn 500 ms after kicking off the absorb animation. GameLoop processes
// any due entries each frame, after the play() loop has already spliced out objects
// whose absorb just completed — so the cell is empty when the deferred spawn fires.
export interface DeferredSpawn {
	executeAt: number;
	spawn: () => void;
}

export interface SceneData {
	scene: Scene;
	allObjects: GameObject[];
	map: number[];
	level: Level;
	sunLight: PointLight;
	customColors: Record<string, number>;
	// Shared geometry+material for the watcher view-cone debug overlay. attachConeToWatcher
	// uses these to lazily add a child mesh when the debug toggle turns on.
	coneAssets: ConeAssets;
	deferredSpawns: DeferredSpawn[];
}

export function buildScene(levelId: number, options: SceneOptions, disposer: Disposer): SceneData {
	const dim = MAP_SIZE;
	const level = generateLevel(levelId ?? 0, options);
	console.log(level);
	const map = level.map;

	const scene = new Scene();
	scene.add(new AmbientLight(0xffffff, 0.7));

	// decay=0: disables inverse-square falloff (see CLAUDE.md Three.js notes)
	const sunLight = new PointLight(0xffffff, 0.5, 0, 0);
	const sunGeo = new SphereGeometry(1, 12, 12);
	const sunMesh = new Mesh(sunGeo);
	sunLight.add(sunMesh);
	scene.add(sunLight);
	disposer.register(sunGeo);
	if (!Array.isArray(sunMesh.material)) disposer.register(sunMesh.material);

	if (options.showAxis) {
		const axesHelper = new AxesHelper(10);
		disposer.register(axesHelper.geometry);
		if (!Array.isArray(axesHelper.material)) disposer.register(axesHelper.material);
		scene.add(axesHelper);
	}

	// Title mesh — Y-up: position.y=height, position.z=(dim-1)-row
	// const geometryTitle = new TextGeometry('THE SENTINEL', { font, size: 0.2, height: 0.2, curveSegments: 12 });
	// const materialTitle = new MeshPhongMaterial({ color: 0x6caeae, flatShading: true, specular: 0xcfcfcf });
	// const title = new Mesh(geometryTitle, materialTitle);
	// title.position.set(15.5, 10, dim + 3);
	// title.setRotationFromEuler(new Euler(0, Math.PI, 0, 'XYZ'));
	// scene.add(title);
	// disposer.register(geometryTitle);
	// disposer.register(materialTitle);

	const themeIdx = level.nbSentries - 1;
	const theme = themes[themeIdx];

	// Skybox: load once per file and cache the texture in the skybox module. First scene
	// build resolves async (background stays default-black for a frame or two); subsequent
	// builds hit the cache and the .then fires on the next microtask. Assigning to a
	// discarded scene if the user rebuilds before the first load resolves is harmless —
	// the old scene just gets GC'd with the texture reference still pointing at the cache.
	loadSkybox(theme.skybox, import.meta.env.BASE_URL)
		.then(tex => { scene.background = tex; })
		.catch(err => console.warn(err));

	const customColors: Record<string, number> = {
		color1: theme.slopeEven,
		color2: theme.planeEven,
	};
	const specular = 0x808080;
	const flatShading = true;
	const materialLine = new LineBasicMaterial({ color: 0xffffff });
	const materialFlat = [
		new MeshPhongMaterial({ color: theme.planeEven, flatShading, specular }),
		new MeshPhongMaterial({ color: theme.planeOdd, flatShading, specular }),
	];
	const materialSlope = [
		new MeshPhongMaterial({ color: theme.slopeEven, flatShading, specular, side: DoubleSide }),
		new MeshPhongMaterial({ color: theme.slopeOdd, flatShading, specular, side: DoubleSide }),
	];
	disposer.register(materialLine);
	materialFlat.forEach(m => disposer.register(m));
	materialSlope.forEach(m => disposer.register(m));

	// Shared flat plane geometry — rotated to lie in XZ plane (Y-up horizontal)
	const geometryPlane = new PlaneGeometry(1, 1);
	disposer.register(geometryPlane);

	// Grid lines — Y-up: Vector3(col, height, (dim-1)-row)
	if (options.showGrid) {
		for (let x = 0; x < dim - 1; x++) {
			for (let r = 0; r < dim; r++) {
				const geo = new BufferGeometry().setFromPoints([
					new Vector3(x, map[r * dim + x], (dim - 1) - r),
					new Vector3(x + 1, map[r * dim + x + 1], (dim - 1) - r),
				]);
				scene.add(new Line(geo, materialLine));
				disposer.register(geo);
			}
		}
		for (let r = 0; r < dim - 1; r++) {
			for (let x = 0; x < dim; x++) {
				const geo = new BufferGeometry().setFromPoints([
					new Vector3(x, map[r * dim + x], (dim - 1) - r),
					new Vector3(x, map[(r + 1) * dim + x], (dim - 1) - (r + 1)),
				]);
				scene.add(new Line(geo, materialLine));
				disposer.register(geo);
			}
		}
	}

	// Terrain surfaces — Y-up: position(col, height, (dim-1)-row)
	if (options.showSurfaces) {
		for (let r = 0; r < dim - 1; r++) {
			for (let x = 0; x < dim - 1; x++) {
				const vs = [
					{ x, r, h: map[r * dim + x], i: 0 },
					{ x: x + 1, r, h: map[r * dim + x + 1], i: 1 },
					{ x: x + 1, r: r + 1, h: map[(r + 1) * dim + x + 1], i: 2 },
					{ x, r: r + 1, h: map[(r + 1) * dim + x], i: 3 },
				];

				if (vs[0].h === vs[1].h && vs[0].h === vs[2].h && vs[0].h === vs[3].h) {
					const plane = new Mesh(geometryPlane, materialFlat[(r + x) % 2]);
					plane.position.set(x + 0.5, vs[0].h, (dim - 1) - (r + 0.5));
					plane.rotation.x = -Math.PI / 2; // lie flat in XZ plane (Y-up)
					plane.userData = { type: 'plane', col: x, row: r };
					scene.add(plane);
				} else {
					const vss = vs.slice().sort((a, b) => a.h - b.h);
					const lone = vss[0].h === vss[1].h ? vss[3].i : vss[0].i;
					vs.push(...vs.splice(0, lone));

					const v0 = new Vector3(vs[0].x, vs[0].h, (dim - 1) - vs[0].r);
					const v1 = new Vector3(vs[1].x, vs[1].h, (dim - 1) - vs[1].r);
					const v2 = new Vector3(vs[2].x, vs[2].h, (dim - 1) - vs[2].r);
					const v3 = new Vector3(vs[3].x, vs[3].h, (dim - 1) - vs[3].r);

					const material = materialSlope[(r + x) % 2];

					const geo1 = new BufferGeometry().setFromPoints([v0, v1, v2]);
					const tri1 = new Mesh(geo1, material);
					tri1.userData = { type: 'slope', col: x, row: r };
					scene.add(tri1);

					const geo2 = new BufferGeometry().setFromPoints([v0, v2, v3]);
					const tri2 = new Mesh(geo2, material);
					tri2.userData = { type: 'slope', col: x, row: r };
					scene.add(tri2);

					disposer.register(geo1);
					disposer.register(geo2);
				}
			}
		}
	}

	// Build the SceneData up-front and mutate it as objects are placed; addObjectToScene
	// reads scene/map/customColors and pushes into allObjects.
	const coneAssets = createConeAssets(disposer);
	const sceneData: SceneData = {
		scene,
		allObjects: [],
		map,
		level,
		sunLight,
		customColors,
		coneAssets,
		deferredSpawns: [],
	};

	const objectCtors = {
		[GameObjType.SENTINEL]: Sentinel,
		[GameObjType.SENTRY]: Sentry,
		[GameObjType.MEANIE]: Meanie,
		[GameObjType.PEDESTAL]: Pedestal,
		[GameObjType.TREE]: Tree,
		[GameObjType.SYNTHOID]: Synthoid,
		[GameObjType.BOULDER]: Boulder,
	} as const;

	for (const obj of level.objects) {
		// sentland: obj.x=col, obj.z=row, obj.y=height (ignored; we derive from map)
		addObjectToScene(sceneData, objectCtors[obj.type], {
			col: obj.x, row: obj.z, rot: obj.rot, time: 0, step: obj.step, timer: obj.timer,
		});
	}

	return sceneData;
}

export type GameObjectCtor = new (...args: ConstructorParameters<typeof GameObject>) => GameObject;

export interface ObjectSpec {
	col: number;
	row: number;
	rot: number;
	time: number;
	step?: number | null;
	timer?: number | null;
	// Optional speed multiplier for the spawn animation (1 = normal player-action speed,
	// 2 = the watcher-drain pacing that fits absorb + spawn into the 1 s drain interval).
	animationScale?: number;
}

export function addObjectToScene(sceneData: SceneData, cls: GameObjectCtor, spec: ObjectSpec): boolean {
	const { map, customColors, allObjects, scene } = sceneData;
	const { col, row, rot, time, step = null, timer = null, animationScale } = spec;
	let height = map[row * MAP_SIZE + col];
	// Includes absorbed-but-fading objects so we don't double-place during the fade-out.
	const objects = allObjects.filter(o => o.col === col && o.row === row);

	if (objects.length > 0) {
		if (objects.length === 1 && objects[0] instanceof Pedestal) {
			height += 1;
		} else if (objects[0] instanceof Boulder && objects[objects.length - 1] instanceof Boulder) {
			height += objects.length / 2;
		} else {
			return false;
		}
	}

	// Boulders alternate orientation up a stack: every other boulder is rotated 45° so
	// the silhouettes interlock instead of stacking identically. Detect the alternation
	// from the final altitude — boulders are 0.5 units tall, terrain heights are integer,
	// so a fractional altitude means the boulder lands atop an odd-count stack.
	// 32 / 256 of a full turn = 45°.
	const finalRot = cls === Boulder && height % 1 !== 0 ? 32 : rot;

	const obj = new cls(time, col, row, height, finalRot, step, timer, customColors);
	if (animationScale !== undefined) obj.animationScale = animationScale;
	allObjects.push(obj);
	scene.add(obj.object3D);

	// Watchers (Sentinel + Sentry, since Sentry extends Sentinel) get a cone-of-sight
	// debug mesh parented to their group. The mesh is invisible by default; MainView's
	// effect toggles visibility based on the `Show watcher cones` debug setting.
	if (obj instanceof Sentinel) {
		obj.coneMesh = attachConeMesh(obj.object3D, sceneData.coneAssets);
	}

	return true;
}

// Active (non-absorbed) objects stacked at the given cell, bottom to top. The last
// element is the topmost (the one a player would absorb).
export function objectsAt(allObjects: GameObject[], col: number, row: number): GameObject[] {
	return allObjects.filter(o => o.col === col && o.row === row && o.absorbedTime === null);
}

export function topObjectAt(allObjects: GameObject[], col: number, row: number): GameObject | null {
	const stack = objectsAt(allObjects, col, row);
	return stack.length > 0 ? stack[stack.length - 1] : null;
}

// Stacking-rule predicate: can a fresh object be placed on (col, row)? Mirrors the
// stacking branch in addObjectToScene without performing the placement, so callers can
// gate energy spend on placement legality. Includes absorbed-but-fading occupants so a
// just-cleared cell isn't reused mid-fade.
export function canPlaceAt(sceneData: SceneData, col: number, row: number): boolean {
	const objects = sceneData.allObjects.filter(o => o.col === col && o.row === row);
	if (objects.length === 0) return true;
	if (objects.length === 1 && objects[0] instanceof Pedestal) return true;
	if (objects[0] instanceof Boulder && objects[objects.length - 1] instanceof Boulder) return true;
	return false;
}

export function removeObjectFromScene(
	sceneData: SceneData,
	col: number,
	row: number,
	time: number,
	visibilityCheck: (col: number, row: number, yOffset?: number) => boolean
): boolean {
	const objects = objectsAt(sceneData.allObjects, col, row);
	if (objects.length === 0) return false;

	const top = objects[objects.length - 1];
	if (top instanceof Pedestal) return false;

	// Boulders and synthoids are always absorbable regardless of LOS (original game rule:
	// if you can target it through the picker, you can absorb it). This applies to a
	// synthoid on a pedestal too — the first branch matches before we reach the pedestal
	// check below. Items on a Pedestal that AREN'T synthoids (the Sentinel itself, or a
	// tree the player put up there) require LOS to the pedestal TOP (yOffset=1) — seeing
	// the pedestal's base tile is not enough. Everything else requires plain LOS.
	let allowed: boolean;
	if (top instanceof Boulder || top instanceof Synthoid) {
		allowed = true;
	} else if (objects[0] instanceof Pedestal) {
		allowed = visibilityCheck(col, row, 1);
	} else {
		allowed = visibilityCheck(col, row);
	}

	if (allowed) {
		top.remove(time);
		return true;
	}
	return false;
}
