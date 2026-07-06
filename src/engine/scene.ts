import {
	AmbientLight,
	AxesHelper,
	BufferAttribute,
	BufferGeometry,
	DoubleSide,
	LineBasicMaterial,
	LineSegments,
	Mesh,
	MeshPhongMaterial,
	PointLight,
	Scene,
	SphereGeometry,
	Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Font } from './fonts/Font';
import { TextGeometry } from './fonts/TextGeometry';
import { fontFixedRegularMinimal } from './fonts/fixed_v01_Regular_minimal';
import { GameObject, Boulder, Synthoid, Tree, Sentinel, Meanie, Sentry, Pedestal, Watcher } from '../world/objects';
import { GameObjType, generateLevel, MAP_SIZE, type LandscapeOptions, type Level } from '../world/terrain';
import { attachConeMesh, createConeAssets, type ConeAssets } from './cones';
import {
	createParticleAssets,
	sampleMeshColors,
	smokeColors,
	spawnParticleBurst,
	verticalExtent,
	type ParticleAssets,
	type ParticleBurst,
} from './particles';
import type { Disposer } from './disposer';
import { loadSkybox } from './skybox';
import { logEvent } from '../game/log';
import { settings } from '../settings.svelte';

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
	{ planeEven: 0x00c300, planeOdd: 0x007979, slopeEven: 0x808080, slopeOdd: 0x6c6c6c, skybox: KLOPPENHEIN_07 },
	{ planeEven: 0xc0c078, planeOdd: 0x780078, slopeEven: 0x5a9292, slopeOdd: 0x4c7b7b, skybox: KLOPPENHEIN_07 },
	{ planeEven: 0x6cafaf, planeOdd: 0x006b6b, slopeEven: 0xa57b7b, slopeOdd: 0x8f6b6b, skybox: KLOPPENHEIN_07 },
	{ planeEven: 0xb4b470, planeOdd: 0xa04300, slopeEven: 0x8c8c8c, slopeOdd: 0x767676, skybox: KLOPPENHEIN_07 },
	{ planeEven: 0xbababa, planeOdd: 0x4444ba, slopeEven: 0x6caeae, slopeOdd: 0x5b9494, skybox: KLOPPENHEIN_07 },
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
	// Shared geometry+material for create/absorb particle bursts — see engine/particles.ts.
	particleAssets: ParticleAssets;
	deferredSpawns: DeferredSpawn[];
	// Active particle bursts, ticked once a frame in engine/loop.ts alongside deferredSpawns.
	particleBursts: ParticleBurst[];
}

export function buildScene(levelId: number, options: SceneOptions, disposer: Disposer): SceneData {
	const dim = MAP_SIZE;
	const level = generateLevel(levelId ?? 0, options);
	logEvent('scene', 'level', { level });
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

	// Grid lines — Y-up: Vector3(col, height, (dim-1)-row). One merged LineSegments holds
	// all 1984 segments (2×31×32 east-west + north-south); each consecutive vertex pair
	// is one independent segment. Drops ~2000 draw calls to 1.
	if (options.showGrid) {
		const eastWest = (dim - 1) * dim;
		const northSouth = (dim - 1) * dim;
		const positions = new Float32Array((eastWest + northSouth) * 2 * 3);
		let p = 0;
		for (let r = 0; r < dim; r++) {
			for (let x = 0; x < dim - 1; x++) {
				positions[p++] = x;
				positions[p++] = map[r * dim + x];
				positions[p++] = (dim - 1) - r;
				positions[p++] = x + 1;
				positions[p++] = map[r * dim + x + 1];
				positions[p++] = (dim - 1) - r;
			}
		}
		for (let x = 0; x < dim; x++) {
			for (let r = 0; r < dim - 1; r++) {
				positions[p++] = x;
				positions[p++] = map[r * dim + x];
				positions[p++] = (dim - 1) - r;
				positions[p++] = x;
				positions[p++] = map[(r + 1) * dim + x];
				positions[p++] = (dim - 1) - (r + 1);
			}
		}
		const gridGeo = new BufferGeometry();
		gridGeo.setAttribute('position', new BufferAttribute(positions, 3));
		scene.add(new LineSegments(gridGeo, materialLine));
		disposer.register(gridGeo);
	}

	// Terrain surfaces — built per cell into 4 batches by material (planeEven/Odd,
	// slopeEven/Odd) and merged into 4 meshes total. Picker + visibility derive col/row
	// from the world-space hit point instead of per-mesh userData; see picker.ts and
	// visibility.ts. Each cell builds its triangles in world coordinates so the merged
	// buffer is ready to render with no per-mesh transform.
	if (options.showSurfaces) {
		const planeBatches: BufferGeometry[][] = [[], []];
		const slopeBatches: BufferGeometry[][] = [[], []];

		for (let r = 0; r < dim - 1; r++) {
			for (let x = 0; x < dim - 1; x++) {
				const vs = [
					{ x, r, h: map[r * dim + x], i: 0 },
					{ x: x + 1, r, h: map[r * dim + x + 1], i: 1 },
					{ x: x + 1, r: r + 1, h: map[(r + 1) * dim + x + 1], i: 2 },
					{ x, r: r + 1, h: map[(r + 1) * dim + x], i: 3 },
				];

				const parity = (r + x) % 2;

				if (vs[0].h === vs[1].h && vs[0].h === vs[2].h && vs[0].h === vs[3].h) {
					// Flat tile — two triangles in world coords.
					const h = vs[0].h;
					const z0 = (dim - 1) - r;
					const z1 = (dim - 1) - (r + 1);
					const a = new Vector3(x, h, z0);
					const b = new Vector3(x + 1, h, z0);
					const c = new Vector3(x + 1, h, z1);
					const d = new Vector3(x, h, z1);
					planeBatches[parity].push(new BufferGeometry().setFromPoints([a, b, c, a, c, d]));
				} else {
					// Slope tile — pick lone vertex like before, build two triangles.
					const vss = vs.slice().sort((a, b) => a.h - b.h);
					const lone = vss[0].h === vss[1].h ? vss[3].i : vss[0].i;
					vs.push(...vs.splice(0, lone));

					const v0 = new Vector3(vs[0].x, vs[0].h, (dim - 1) - vs[0].r);
					const v1 = new Vector3(vs[1].x, vs[1].h, (dim - 1) - vs[1].r);
					const v2 = new Vector3(vs[2].x, vs[2].h, (dim - 1) - vs[2].r);
					const v3 = new Vector3(vs[3].x, vs[3].h, (dim - 1) - vs[3].r);

					slopeBatches[parity].push(new BufferGeometry().setFromPoints([v0, v1, v2]));
					slopeBatches[parity].push(new BufferGeometry().setFromPoints([v0, v2, v3]));
				}
			}
		}

		const addMerged = (
			geos: BufferGeometry[],
			material: MeshPhongMaterial,
			type: 'plane' | 'slope'
		) => {
			if (geos.length === 0) return;
			const merged = mergeGeometries(geos);
			geos.forEach(g => g.dispose());
			if (!merged) {
				console.warn('mergeGeometries failed for terrain batch');
				return;
			}
			const mesh = new Mesh(merged, material);
			mesh.userData = { kind: 'terrain', type };
			scene.add(mesh);
			disposer.register(merged);
		};
		addMerged(planeBatches[0], materialFlat[0], 'plane');
		addMerged(planeBatches[1], materialFlat[1], 'plane');
		addMerged(slopeBatches[0], materialSlope[0], 'slope');
		addMerged(slopeBatches[1], materialSlope[1], 'slope');
	}

	// Build the SceneData up-front and mutate it as objects are placed; addObjectToScene
	// reads scene/map/customColors and pushes into allObjects.
	const coneAssets = createConeAssets(disposer);
	const particleAssets = createParticleAssets(disposer);
	const sceneData: SceneData = {
		scene,
		allObjects: [],
		map,
		level,
		sunLight,
		customColors,
		coneAssets,
		particleAssets,
		deferredSpawns: [],
		particleBursts: [],
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

	// Particle burst on runtime creation only — time=0 is initial level population (instant,
	// no animation), matching GameObject's own date>0 gate for the spawn fade/squash.
	// settings.particleEffects (Settings > Game, default on) lets players who want the
	// original game's unadorned look turn this off entirely.
	if (time > 0 && settings.particleEffects) {
		const mesh = obj.object3D as Mesh;
		const extent = verticalExtent(mesh);
		sceneData.particleBursts.push(
			spawnParticleBurst(
				scene, sceneData.particleAssets, col, row,
				height + extent.min, height + extent.max,
				sampleMeshColors(mesh), 'create', time
			)
		);
	}

	// Watchers (Sentinel + Sentry) get a cone-of-sight debug mesh parented to their group.
	// The mesh is invisible by default; MainView's effect toggles visibility based on the
	// `Show watcher cones` debug setting.
	if (obj instanceof Watcher) {
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
// A bare (item-less) Pedestal only accepts a Synthoid — once the Sentinel is absorbed,
// absorb is locked for the rest of the level (see game.sentinelAbsorbed), so a Boulder
// or Tree placed there instead would be permanently stuck and unwinnable. `type` is
// optional so non-player callers (level loading, DEBUG free placement) that go through
// addObjectToScene directly instead of this predicate are unaffected.
export function canPlaceAt(sceneData: SceneData, col: number, row: number, type?: GameObjType): boolean {
	const objects = sceneData.allObjects.filter(o => o.col === col && o.row === row);
	if (objects.length === 0) return true;
	if (objects.length === 1 && objects[0] instanceof Pedestal) return type === undefined || type === GameObjType.SYNTHOID;
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
		if (settings.particleEffects) {
			const mesh = top.object3D as Mesh;
			const extent = verticalExtent(mesh);
			sceneData.particleBursts.push(
				spawnParticleBurst(
					sceneData.scene, sceneData.particleAssets, col, row,
					top.height + extent.min, top.height + extent.max,
					smokeColors(), 'absorb', time
				)
			);
		}
		top.remove(time);
		return true;
	}
	return false;
}
