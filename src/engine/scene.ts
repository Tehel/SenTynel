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
import { morphAnimationScale } from '../world/objects/base';
import { MORPH_HALF_DURATION_MS } from '../game/timing';
import { GameObjType, generateLevel, MAP_SIZE, type LandscapeOptions, type Level } from '../world/terrain';
import { attachConeMesh, createConeAssets, type ConeAssets } from './cones';
import { createExposureOverlay, type ExposureOverlay } from './exposureOverlay';
import { ExposureSensor } from './exposureSensor';
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
import { loadSurface, TEXTURE_TILES } from './textures';
import type { TerrainSurface } from './textures';
import { logEvent } from '../game/log';
import { settings } from '../settings.svelte';

const font = new Font(fontFixedRegularMinimal);

interface Theme {
	planeEven: number;
	planeOdd: number;
	slopeEven: number;
	slopeOdd: number;
	skybox: string;
	/*
	 Which procedural surface dresses the flat tiles and the slopes when settings.visualStyle is
	 'enhanced' (utils/gen-textures.py). Ignored entirely in 'classic'.

	 The pairing is chosen to agree with the palette that was already there rather than to fight
	 it — the textures are greyscale and multiply the theme colour, so a surface only reads well
	 if its structure suits the hue it lands on. Rust-and-grey gets plate, purple-and-mauve gets
	 tissue, green-and-stone stays a meadow.
	*/
	planeSurface: TerrainSurface;
	slopeSurface: TerrainSurface;
	/*
	 Palette used ONLY in 'enhanced'. The classic colours above are the look this project shipped
	 with and the one the player falls back to, so they are never touched — a theme that wants
	 brown timber or grey concrete states it here instead, and switching the setting switches the
	 palette with it. Omit to keep the classic colours in both modes.
	*/
	enhanced?: Palette;
}

interface Palette {
	planeEven: number;
	planeOdd: number;
	slopeEven: number;
	slopeOdd: number;
}

// All skyboxes are from https://polyhaven.com converted from exr
const SATARA_NIGHT_NO_LAMPS = 'satara_night_no_lamps_2k.webp';
const CITRUS_ORCHARD_ROAD = 'citrus_orchard_road_puresky_2k.webp';
const BELFAST_SUNSET = 'belfast_sunset_puresky_2k.webp';
const OVERCAST_SOIL = 'overcast_soil_puresky_2k.webp';
const ARISTEA_WRECK = 'aristea_wreck_puresky_2k.webp';
const KLOPPENHEIN_07 = 'kloppenheim_07_puresky_2k.webp';

const themes: Theme[] = [
	// meadow — green turf over bare stone. Classic palette already suits it.
	{ planeEven: 0x00c300, planeOdd: 0x007979, slopeEven: 0x808080, slopeOdd: 0x6c6c6c,
	  skybox: KLOPPENHEIN_07, planeSurface: 'grass', slopeSurface: 'rock' },
	// shore — pale sand at the waterline, rose sandstone above
	{ planeEven: 0x6cafaf, planeOdd: 0x006b6b, slopeEven: 0xa57b7b, slopeOdd: 0x8f6b6b,
	  skybox: KLOPPENHEIN_07, planeSurface: 'sand', slopeSurface: 'rock',
	  enhanced: { planeEven: 0xd6c49a, planeOdd: 0x4f9a9a, slopeEven: 0xa87f78, slopeOdd: 0x8e6a64 } },
	// dunes — wind-rippled sand, tan slopes; nothing built, nothing green
	{ planeEven: 0xc0c078, planeOdd: 0x780078, slopeEven: 0x5a9292, slopeOdd: 0x4c7b7b,
	  skybox: KLOPPENHEIN_07, planeSurface: 'sand', slopeSurface: 'sand',
	  enhanced: { planeEven: 0xdcc072, planeOdd: 0xb8933f, slopeEven: 0xb08a52, slopeOdd: 0x94713f } },
	// timber — a decked world; brown boards underfoot and dark timber cut into the hills
	{ planeEven: 0xb4b470, planeOdd: 0xa04300, slopeEven: 0x8c8c8c, slopeOdd: 0x767676,
	  skybox: KLOPPENHEIN_07, planeSurface: 'wood', slopeSurface: 'wood',
	  enhanced: { planeEven: 0xb07c46, planeOdd: 0x8a5a2c, slopeEven: 0x6d4726, slopeOdd: 0x573820 } },
	// ruins — moss and lichen reclaiming weathered concrete
	{ planeEven: 0xbababa, planeOdd: 0x4444ba, slopeEven: 0x6caeae, slopeOdd: 0x5b9494,
	  skybox: KLOPPENHEIN_07, planeSurface: 'grass', slopeSurface: 'concrete',
	  enhanced: { planeEven: 0x6f9a4e, planeOdd: 0x9aa88c, slopeEven: 0x8f9186, slopeOdd: 0x767a70 } },
	// brutalist — poured concrete throughout, grey on grey with a cold cast
	{ planeEven: 0xc08f8f, planeOdd: 0xc00000, slopeEven: 0x99995e, slopeOdd: 0x838351,
	  skybox: KLOPPENHEIN_07, planeSurface: 'concrete', slopeSurface: 'concrete',
	  enhanced: { planeEven: 0xbcbcc0, planeOdd: 0x8b8b93, slopeEven: 0x9a9aa4, slopeOdd: 0x7e7e88 } },
	// fungal — the whole landscape is alive, and none of it is friendly
	{ planeEven: 0xc1c1c1, planeOdd: 0x780078, slopeEven: 0x955c95, slopeOdd: 0x825082,
	  skybox: KLOPPENHEIN_07, planeSurface: 'organic', slopeSurface: 'organic',
	  enhanced: { planeEven: 0xab7cb9, planeOdd: 0x6b3f7a, slopeEven: 0x915a91, slopeOdd: 0x74497a } },
	// foundry — hazard stripes on riveted crimson steel. Classic palette is already industrial.
	{ planeEven: 0xc1c100, planeOdd: 0x4747c1, slopeEven: 0xad0000, slopeOdd: 0x920000,
	  skybox: KLOPPENHEIN_07, planeSurface: 'metal', slopeSurface: 'metal' },
];

export interface SceneOptions extends LandscapeOptions {
	showGrid: boolean;
	showSurfaces: boolean;
	showAxis: boolean;
}

// How far a boulder and a pedestal each raise the surface above their own foot. Used both to place
// the next thing on a stack and to ask whether something already standing there is supported.
const BOULDER_RISE = 0.5;
const PEDESTAL_RISE = 1;

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
	/*
	 The exposure map for this landscape (engine/exposureSensor.ts). Everything that needs to KNOW
	 about exposure reads it; the overlay below only draws it. Built lazily on the first question —
	 ~58 ms, free in the frozen window before the player's first action, but no reason to spend on
	 a scene rebuild nobody asks anything of.
	*/
	exposure: ExposureSensor;
	// Debug visualisation of that map — see engine/exposureOverlay.ts. The squares are placed at
	// scene-build time (cheap) but hidden.
	exposureOverlay: ExposureOverlay;
	// Active particle bursts, ticked once a frame in engine/loop.ts.
	particleBursts: ParticleBurst[];
	/*
	 The four terrain materials and the theme they were built from, kept so the visual style can be
	 swapped WITHOUT rebuilding the scene — see applyTerrainStyle below. Rebuilding would repopulate
	 the landscape from generateLevel and throw away everything the player has built, which is
	 exactly what a mid-game toggle must not do.
	*/
	terrainMaterials: { flat: MeshPhongMaterial[]; slope: MeshPhongMaterial[] };
	theme: Theme;
}

export function buildScene(levelId: number, options: SceneOptions, disposer: Disposer): SceneData {
	const dim = MAP_SIZE;
	const level = generateLevel(levelId ?? 0, options);
	// logEvent('scene', 'level', { level });
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
		.then(tex => {
			scene.background = tex;
		})
		.catch(err => console.warn(err));

	/*
	 The colours actually used. In 'classic' this is the theme itself; in 'enhanced' a theme may
	 substitute a palette that suits its surface (brown for timber, grey for concrete) — see the
	 `enhanced` field on Theme. Everything downstream reads `palette`, never `theme`, so the two
	 modes cannot drift apart by someone updating one and forgetting the other.
	*/
	const palette: Palette =
		settings.visualStyle === 'enhanced' && theme.enhanced ? theme.enhanced : theme;

	const customColors: Record<string, number> = {
		color1: palette.slopeEven,
		color2: palette.planeEven,
	};
	const specular = 0x808080;
	const flatShading = true;
	const materialLine = new LineBasicMaterial({ color: 0xffffff });
	const materialFlat = [
		new MeshPhongMaterial({ color: palette.planeEven, flatShading, specular }),
		new MeshPhongMaterial({ color: palette.planeOdd, flatShading, specular }),
	];
	const materialSlope = [
		new MeshPhongMaterial({ color: palette.slopeEven, flatShading, specular, side: DoubleSide }),
		new MeshPhongMaterial({ color: palette.slopeOdd, flatShading, specular, side: DoubleSide }),
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
				positions[p++] = dim - 1 - r;
				positions[p++] = x + 1;
				positions[p++] = map[r * dim + x + 1];
				positions[p++] = dim - 1 - r;
			}
		}
		for (let x = 0; x < dim; x++) {
			for (let r = 0; r < dim - 1; r++) {
				positions[p++] = x;
				positions[p++] = map[r * dim + x];
				positions[p++] = dim - 1 - r;
				positions[p++] = x;
				positions[p++] = map[(r + 1) * dim + x];
				positions[p++] = dim - 1 - (r + 1);
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
					const z0 = dim - 1 - r;
					const z1 = dim - 1 - (r + 1);
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

					const v0 = new Vector3(vs[0].x, vs[0].h, dim - 1 - vs[0].r);
					const v1 = new Vector3(vs[1].x, vs[1].h, dim - 1 - vs[1].r);
					const v2 = new Vector3(vs[2].x, vs[2].h, dim - 1 - vs[2].r);
					const v3 = new Vector3(vs[3].x, vs[3].h, dim - 1 - vs[3].r);

					slopeBatches[parity].push(new BufferGeometry().setFromPoints([v0, v1, v2]));
					slopeBatches[parity].push(new BufferGeometry().setFromPoints([v0, v2, v3]));
				}
			}
		}

		const addMerged = (geos: BufferGeometry[], material: MeshPhongMaterial, type: 'plane' | 'slope') => {
			if (geos.length === 0) return;
			const merged = mergeGeometries(geos);
			geos.forEach(g => g.dispose());
			if (!merged) {
				console.warn('mergeGeometries failed for terrain batch');
				return;
			}
			/*
			 World-space planar UVs, added once on the merged buffer rather than per cell. Every
			 terrain vertex is already in world coordinates (that is what lets picker.ts and
			 visibility.ts recover a cell from a hit point), so u,v is just x,z scaled to the
			 texture's tile count — no per-cell bookkeeping, and no seam between neighbours
			 because adjacent tiles share the same continuous parameterisation.

			 Slopes take the same top-down projection and therefore stretch by up to sqrt(2), since
			 the generator's steepest tile rises one unit over one. That is a drape rather than a
			 distortion at this texel density, and it costs nothing; per-face slope UVs are the
			 fallback if it ever reads badly.
			*/
			const pos = merged.getAttribute('position');
			const uv = new Float32Array(pos.count * 2);
			for (let i = 0; i < pos.count; i++) {
				uv[i * 2] = pos.getX(i) / TEXTURE_TILES;
				uv[i * 2 + 1] = pos.getZ(i) / TEXTURE_TILES;
			}
			merged.setAttribute('uv', new BufferAttribute(uv, 2));

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
	const exposure = new ExposureSensor(map);
	const exposureOverlay = createExposureOverlay(level, map, disposer);
	scene.add(exposureOverlay.mesh);
	const sceneData: SceneData = {
		scene,
		allObjects: [],
		map,
		level,
		sunLight,
		customColors,
		coneAssets,
		particleAssets,
		exposure,
		exposureOverlay,
		particleBursts: [],
		terrainMaterials: { flat: materialFlat, slope: materialSlope },
		theme,
	};
	// Colours and maps are applied through the same path a live toggle uses, so the two cannot
	// disagree about what 'enhanced' means.
	applyTerrainStyle(sceneData);

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
			col: obj.x,
			row: obj.z,
			rot: obj.rot,
			time: 0,
			step: obj.step,
			timer: obj.timer,
		});
	}

	return sceneData;
}

/*
 Put the current visual style onto an existing scene's terrain materials.

 Called once from buildScene and again whenever settings.visualStyle / settings.terrainNormals
 change. Deliberately mutates in place rather than rebuilding: the End-key toggle is meant to be
 usable mid-game, and buildScene would restart the landscape.

 Texture loading is async and fire-and-forget, exactly like the skybox. The .catch is load-bearing
 rather than defensive — src/engine/bot.harness.test.ts builds real scenes in Node, where Image
 does not exist, and this must fail there as quietly as the skybox does or it takes the sweep with
 it. The style is re-read inside the .then because a toggle can land while a load is in flight.
*/
/*
 Which detail texture dresses each kind of object. Chosen so a shape reads as what it is made of:
 stone for the boulder it already looks like, concrete for the pedestal that holds the Sentinel,
 brushed hull for everything that moves, and the fine mottle of `grass` for a pine's needles and bark —
 `wood` is planking, which is exactly wrong on a tree.

 The maps multiply the per-face vertex colours the models already carry, so this adds grain
 without touching the palette.
*/
const OBJECT_SURFACES: Record<GameObjType, TerrainSurface> = {
	[GameObjType.BOULDER]: 'rock',
	[GameObjType.PEDESTAL]: 'concrete',
	[GameObjType.TREE]: 'grass',
	[GameObjType.SYNTHOID]: 'hull',
	[GameObjType.SENTRY]: 'hull',
	[GameObjType.SENTINEL]: 'hull',
	[GameObjType.MEANIE]: 'hull',
};

/*
 Put the current visual style on one object's material. Called when an object is placed and again
 for every live object when the style is toggled, so the End key covers the cast as well as the
 ground.

 Async and tolerant of failure for the same reason as the terrain: the bot harness builds real
 scenes in Node, where Image does not exist.
*/
export function applyObjectStyle(obj: GameObject): void {
	applyObjectStyleTo(obj.object3D as Mesh, (obj.constructor as unknown as { type: GameObjType }).type);
}

// Split from applyObjectStyle so src/shoot/shoot.ts's turntable can dress a bare mesh the same
// way — a review sheet of undressed models would miss exactly the faults worth reviewing.
export function applyObjectStyleTo(mesh: Mesh, type: GameObjType): void {
	const material = mesh.material as MeshPhongMaterial;
	if (Array.isArray(mesh.material)) return;
	const surface = OBJECT_SURFACES[type];
	if (settings.visualStyle !== 'enhanced' || surface === undefined) {
		material.map = null;
		material.needsUpdate = true;
		return;
	}
	loadSurface(surface, import.meta.env.BASE_URL)
		.then(({ albedo }) => {
			if (settings.visualStyle !== 'enhanced') return;
			material.map = albedo;
			material.needsUpdate = true;
		})
		.catch(err => console.warn(err));
}

export function applyTerrainStyle(sceneData: SceneData): void {
	const { theme, terrainMaterials } = sceneData;
	const enhanced = settings.visualStyle === 'enhanced';
	const palette: Palette = enhanced && theme.enhanced ? theme.enhanced : theme;

	terrainMaterials.flat[0].color.setHex(palette.planeEven);
	terrainMaterials.flat[1].color.setHex(palette.planeOdd);
	terrainMaterials.slope[0].color.setHex(palette.slopeEven);
	terrainMaterials.slope[1].color.setHex(palette.slopeOdd);

	const apply = (mats: MeshPhongMaterial[], surface: TerrainSurface) => {
		if (!enhanced) {
			for (const m of mats) {
				m.map = null;
				m.normalMap = null;
				m.needsUpdate = true;
			}
			return;
		}
		loadSurface(surface, import.meta.env.BASE_URL)
			.then(({ albedo, normal }) => {
				if (settings.visualStyle !== 'enhanced') return;
				for (const m of mats) {
					m.map = albedo;
					m.normalMap = settings.terrainNormals ? normal : null;
					m.needsUpdate = true;
				}
			})
			.catch(err => console.warn(err));
	};
	apply(terrainMaterials.flat, theme.planeSurface);
	apply(terrainMaterials.slope, theme.slopeSurface);
	// The cast follows the same switch: geometry from settings.modelStyle, detail map from
	// settings.visualStyle. Objects created later pick both up in placeObject.
	for (const obj of sceneData.allObjects) {
		obj.setModelStyle(settings.modelStyle);
		applyObjectStyle(obj);
	}
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
	const height = stackedHeightAt(sceneData, spec.col, spec.row);
	if (height === null) return false;
	placeObject(sceneData, cls, spec, height);
	return true;
}

/*
 The rung a new object would land on at (col, row), or null if the stacking rule refuses the cell
 outright. Mirrors canPlaceAt, which answers the same question without the arithmetic.

 Objects mid-absorb are not counted (RULES-FIDELITY.md A5): a stack whose top boulder is being
 absorbed places the next one where that boulder no longer is.
*/
function stackedHeightAt(sceneData: SceneData, col: number, row: number): number | null {
	let height = sceneData.map[row * MAP_SIZE + col];
	const objects = objectsAt(sceneData.allObjects, col, row);
	if (objects.length === 0) return height;
	if (objects.length === 1 && objects[0] instanceof Pedestal) return height + PEDESTAL_RISE;
	if (objects[0] instanceof Boulder && objects[objects.length - 1] instanceof Boulder)
		return height + objects.length * BOULDER_RISE;
	return null;
}

/*
 Put an object on the scene at a rung the caller has already settled.

 Split out of addObjectToScene for replaceObjectInScene below, which knows the rung and must not
 re-derive it: a morph's replacement belongs where the drained object stood, and the stack it would
 derive one from no longer holds that object.
*/
function placeObject(sceneData: SceneData, cls: GameObjectCtor, spec: ObjectSpec, height: number): GameObject {
	const { customColors, allObjects, scene } = sceneData;
	const { col, row, rot, time, step = null, timer = null, animationScale } = spec;

	// Boulders alternate orientation up a stack: every other boulder is rotated 45° so
	// the silhouettes interlock instead of stacking identically. Detect the alternation
	// from the final altitude — boulders are 0.5 units tall, terrain heights are integer,
	// so a fractional altitude means the boulder lands atop an odd-count stack.
	// 32 / 256 of a full turn = 45°.
	const finalRot = cls === Boulder && height % 1 !== 0 ? 32 : rot;

	const obj = new cls(time, col, row, height, finalRot, step, timer, customColors);
	if (animationScale !== undefined) obj.animationScale = animationScale;
	allObjects.push(obj);
	applyObjectStyle(obj);
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
				scene,
				sceneData.particleAssets,
				col,
				row,
				height + extent.min,
				height + extent.max,
				sampleMeshColors(mesh),
				'create',
				time
			)
		);
	}

	// Watchers (Sentinel + Sentry) get a cone-of-sight debug mesh parented to their group.
	// The mesh is invisible by default; MainView's effect toggles visibility based on the
	// `Show watcher cones` debug setting.
	if (obj instanceof Watcher) {
		obj.coneMesh = attachConeMesh(obj.object3D, sceneData.coneAssets);
	}

	return obj;
}

/*
 A MORPH IS ONE ATOMIC REPLACEMENT (RULES-FIDELITY.md A5b).

 Every drain effect in the game is a swap in place: a watcher turns a synthoid into a boulder and a
 boulder into a tree (engine/watcher.ts), a tree into a Meanie and the Meanie back into a tree
 (engine/meanie.ts). Both halves happen here, in one frame, with the replacement on the drained
 object's OWN rung — the corpse animates away underneath it (see morphAnimationScale) but the rules
 never see the cell without something standing in it.

 It used to be two events 500 ms apart, and the gap was the bug. Reported from play: *"the top
 boulder becomes a tree and the lower boulder is absorbed by the player, resulting in a tree
 suspended mid-air."* In the gap the cell's active stack was one shorter than the tower on screen, so
 the rung below was promoted to top-of-stack and both the player and the watchers could act on it —
 and the replacement, deriving its altitude from that shrunken stack, dropped to the bottom of the
 cell. `cellReserved` used to paper over the first half of that (a pending spawn reserved its cell);
 with no gap there is nothing to reserve, and nothing to derive.

 The rung is passed rather than re-derived, which is the whole point: `stackedHeightAt` filters out
 absorbing objects, so the drained object's own rung is exactly what it can no longer see. That also
 retires the old morphPlacementFailed path — a replacement standing where its predecessor stood
 cannot be refused by the stacking rule, so the landscape can no longer lose that energy.
*/
export function replaceObjectInScene(
	sceneData: SceneData,
	target: GameObject,
	cls: GameObjectCtor,
	time: number,
	rot = 0
): GameObject {
	const animationScale = morphAnimationScale();
	target.animationScale = animationScale;
	target.remove(time);
	/*
	 Placed now, seen later. The replacement's creationTime is half an interval ahead, so it holds its
	 rung against every rule that reads the stack from this frame on while showing nothing until the
	 outgoing object has finished squashing away — the sequence the game has always had on screen (see
	 game/timing.ts's MORPH_DURATION_MS for why the two are not overlapped).

	 world/objects/base.ts's playSquash/playFade both clamp a not-yet-started animation to its first
	 frame, and engine/particles.ts keeps the creation burst hidden until the same moment, so "ahead of
	 itself" is a supported state rather than a trick.
	*/
	const spec = { col: target.col, row: target.row, rot, time: time + MORPH_HALF_DURATION_MS, animationScale };
	return placeObject(sceneData, cls, spec, target.height);
}

/*
 NOTHING OUTLIVES WHAT IT STANDS ON (RULES-FIDELITY.md A5b).

 An object is gone to the rules the moment it is absorbed (A5) but stays on screen for the whole
 animation, so the two views of the scene disagree for a second or two. Usually that is harmless —
 the corpse sits on the same stack it always did. It stops being harmless when the thing UNDERNEATH
 it leaves too, which A5 makes possible: the rung below a corpse is top-of-stack, so the player can
 absorb it and a watcher can drain it, and what is left is a corpse standing on air. That is the
 second half of the report above, and the half an atomic morph cannot fix, because a tree drained off
 a boulder has no replacement and a player's absorb has none either.

 So: the frame the last mesh under a corpse leaves the scene, the corpse goes with it. Called from
 engine/loop.ts right after the splice pass, and only on a frame that actually spliced something —
 a mesh disappearing is the one event that can lower a surface.

 The corpse is cut, not dropped: a fading tree that suddenly sinks half a unit would be a second
 wrong picture rather than none. Its support's last frame is its own last frame, which reads as the
 two going together.

 The surface this measures against is what is ON SCREEN, corpses included (see screenSurfaceAt) —
 the question here is about the picture, not the rules, and a boulder half-way through fading away
 is still visibly holding up whatever stands on it. Measuring against the rules' surface instead
 would cut a corpse standing on a corpse up to a second early, which is a pop where the picture was
 not yet wrong.
*/
export function finishUnsupportedCorpses(sceneData: SceneData): void {
	const { allObjects, scene } = sceneData;
	const doomed: number[] = [];
	allObjects.forEach((o, i) => {
		if (o.absorbedTime === null) return;
		if (o.height <= screenSurfaceAt(sceneData, o.col, o.row) + 1e-6) return;
		doomed.push(i);
	});
	// Descending, so each splice leaves the lower indices alone. One pass is enough: everything above
	// the surface is cut in this pass, so a cut can never leave a survivor newly unsupported.
	for (let k = doomed.length - 1; k >= 0; k--) {
		const obj = allObjects[doomed[k]];
		scene.remove(obj.object3D);
		obj.dispose();
		allObjects.splice(doomed[k], 1);
	}
}

/*
 How high the surface at (col, row) reaches as drawn: the terrain, plus the pedestal top or the
 boulders standing on it. Trees, synthoids and watchers hold nothing up — each is the top of its own
 stack — but a boulder still animating does, which is why this walks allObjects rather than objectsAt.

 A corpse sitting exactly at the surface is where it always stood, so the comparison in the sweep
 above is strict: only something ABOVE the surface has lost its footing.
*/
function screenSurfaceAt(sceneData: SceneData, col: number, row: number): number {
	let surface = sceneData.map[row * MAP_SIZE + col];
	for (const o of sceneData.allObjects) {
		if (o.col !== col || o.row !== row) continue;
		if (o instanceof Boulder) surface = Math.max(surface, o.height + BOULDER_RISE);
		else if (o instanceof Pedestal) surface = Math.max(surface, o.height + PEDESTAL_RISE);
	}
	return surface;
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

// Stacking-rule predicate: can a fresh object be placed on (col, row)? Mirrors stackedHeightAt
// without the arithmetic, so callers can gate energy spend on placement legality. Objects
// mid-absorb do not count (RULES-FIDELITY.md A5) — a square you have just cleared is free, and a
// square a watcher emptied is held by the replacement standing in it (see replaceObjectInScene),
// not by a reservation.
// A bare (item-less) Pedestal only accepts a Synthoid — once the Sentinel is absorbed,
// absorb is locked for the rest of the level (see game.sentinelAbsorbed), so a Boulder
// or Tree placed there instead would be permanently stuck and unwinnable. `type` is
// optional so non-player callers (level loading, DEBUG free placement) that go through
// addObjectToScene directly instead of this predicate are unaffected.
export function canPlaceAt(sceneData: SceneData, col: number, row: number, type?: GameObjType): boolean {
	const objects = objectsAt(sceneData.allObjects, col, row);
	if (objects.length === 0) return true;
	if (objects.length === 1 && objects[0] instanceof Pedestal)
		return type === undefined || type === GameObjType.SYNTHOID;
	if (objects[0] instanceof Boulder && objects[objects.length - 1] instanceof Boulder) return true;
	return false;
}

/*
 THE SURFACE RULE — can the top object at (col, row) be absorbed, or transferred into?

 The original's rule is about the SURFACE a thing stands on, never about the thing itself: "turn on
 your sights and centre them on the square surface below the object", with one exception — "boulders
 act as an extension of the square surface", so you aim at a boulder's SIDE instead. There are
 therefore exactly two targetable surfaces, and they differ in what it takes to see them:

   - a tile's top face, which is only visible from an eye ABOVE it, and
   - a boulder's side, visible from anywhere with a clear line of sight.

 An object is targetable iff the surface under its feet is visible. That single rule covers every
 case, and two of them are worth spelling out because they look like special cases and are not:

   - A synthoid on a boulder stack is targetable however far above the eye its feet are. This is what
     keeps the game's central climb loop legal — the body you put on top of a seven-boulder tower has
     to stay reachable, or you could never transfer up to it.
   - A synthoid on BARE GROUND is not targetable through a hill. Until 2026-08-16 this code exempted
     synthoids alongside boulders, which no source supports (RULES-FIDELITY.md A1): it made
     reclaiming an abandoned shell free rather than positional, and let the player strip bodies from
     behind a ridge.

 `isVisible` is injected rather than imported so the same rule serves both the absorb path below and
 the transfer path in game/actions.ts, which reaches it through ActionContext.canTarget. One rule,
 one place: the two used to disagree, which is how transfer ended up with no visibility test at all.
*/
export function canTargetTopObject(
	sceneData: SceneData,
	col: number,
	row: number,
	isVisible: (col: number, row: number, yOffset?: number) => boolean
): boolean {
	const objects = objectsAt(sceneData.allObjects, col, row);
	if (objects.length === 0) return false;

	// A pedestal is scenery. Nothing targets it, at any visibility.
	if (objects[objects.length - 1] instanceof Pedestal) return false;
	// A boulder is itself a targetable surface — no line of sight needed beyond seeing it.
	if (objects[objects.length - 1] instanceof Boulder) return true;

	// Otherwise the answer is about what it STANDS on, which is the object directly beneath it
	// (undefined for something sitting straight on the terrain).
	const support = objects[objects.length - 2];
	if (support instanceof Boulder) return true;
	// On the pedestal — the Sentinel, or the synthoid placed there to win — the surface is the
	// pedestal TOP. Seeing its base tile is not enough.
	if (support instanceof Pedestal) return isVisible(col, row, 1);
	return isVisible(col, row, 0);
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

	if (canTargetTopObject(sceneData, col, row, visibilityCheck)) {
		if (settings.particleEffects) {
			const mesh = top.object3D as Mesh;
			const extent = verticalExtent(mesh);
			sceneData.particleBursts.push(
				spawnParticleBurst(
					sceneData.scene,
					sceneData.particleAssets,
					col,
					row,
					top.height + extent.min,
					top.height + extent.max,
					smokeColors(),
					'absorb',
					time
				)
			);
		}
		top.remove(time);
		return true;
	}
	return false;
}
