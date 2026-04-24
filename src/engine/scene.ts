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
import { GameObjType, generateLevel, type LandscapeOptions, type Level } from '../world/terrain';
import type { Disposer } from './disposer';

const font = new Font(fontFixedRegularMinimal);

interface ColorTheme {
	planeEven: number;
	planeOdd: number;
	slopeEven: number;
	slopeOdd: number;
}

const themes: ColorTheme[] = [
	{ planeEven: 0x00c300, planeOdd: 0x007979, slopeEven: 0x808080, slopeOdd: 0x6c6c6c },
	{ planeEven: 0xc0c078, planeOdd: 0x780078, slopeEven: 0x5a9292, slopeOdd: 0x4c7b7b },
	{ planeEven: 0x6cafaf, planeOdd: 0x006b6b, slopeEven: 0xa57b7b, slopeOdd: 0x8f6b6b },
	{ planeEven: 0xb4b470, planeOdd: 0xa04300, slopeEven: 0x8c8c8c, slopeOdd: 0x767676 },
	{ planeEven: 0xbababa, planeOdd: 0x4444ba, slopeEven: 0x6caeae, slopeOdd: 0x5b9494 },
	{ planeEven: 0xc08f8f, planeOdd: 0xc00000, slopeEven: 0x99995e, slopeOdd: 0x838351 },
	{ planeEven: 0xc1c1c1, planeOdd: 0x780078, slopeEven: 0x955c95, slopeOdd: 0x825082 },
	{ planeEven: 0xc1c100, planeOdd: 0x4747c1, slopeEven: 0xad0000, slopeOdd: 0x920000 },
];

export interface SceneOptions extends LandscapeOptions {
	showGrid: boolean;
	showSurfaces: boolean;
	showAxis: boolean;
}

export interface SceneData {
	scene: Scene;
	allObjects: GameObject[];
	map: number[];
	level: Level;
	sunLight: PointLight;
	customColors: Record<string, number>;
}

export function buildScene(levelId: number, options: SceneOptions, disposer: Disposer): SceneData {
	const dim = options.dim;
	const level = generateLevel(levelId ?? 0, options);
	const map = level.map;

	const scene = new Scene();
	scene.add(new AmbientLight(0xffffff, 0.7));

	// decay=0: disables inverse-square falloff (see CLAUDE.md Three.js notes)
	const sunLight = new PointLight(0xffffff, 0.4, 0, 0);
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
	const geometryTitle = new TextGeometry('THE SENTINEL', { font, size: 0.2, height: 0.2, curveSegments: 12 });
	const materialTitle = new MeshPhongMaterial({ color: 0x6caeae, flatShading: true, specular: 0xcfcfcf });
	const title = new Mesh(geometryTitle, materialTitle);
	title.position.set(15.5, 10, dim + 3);
	title.setRotationFromEuler(new Euler(0, Math.PI, 0, 'XYZ'));
	scene.add(title);
	disposer.register(geometryTitle);
	disposer.register(materialTitle);

	const themeIdx = level.nbSentries - 1;
	const theme = themes[themeIdx];
	const customColors: Record<string, number> = {
		color1: theme.slopeEven,
		color2: theme.planeEven,
	};

	const materialLine = new LineBasicMaterial({ color: 0xffffff });
	const materialFlat = [
		new MeshPhongMaterial({ color: theme.planeEven, flatShading: true, specular: 0xcfcfcf }),
		new MeshPhongMaterial({ color: theme.planeOdd, flatShading: true, specular: 0x808080 }),
	];
	const materialSlope = [
		new MeshPhongMaterial({ color: theme.slopeEven, flatShading: true, specular: 0x808080, side: DoubleSide }),
		new MeshPhongMaterial({ color: theme.slopeOdd, flatShading: true, specular: 0x808080, side: DoubleSide }),
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

	// Place level objects
	const allObjects: GameObject[] = [];
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
		addObjectToScene(objectCtors[obj.type], 0, obj.x, obj.z, obj.rot, obj.step, obj.timer,
			map, dim, customColors, allObjects, scene);
	}

	return { scene, allObjects, map, level, sunLight, customColors };
}

export function addObjectToScene(
	cls: new (...args: any[]) => GameObject,
	time: number,
	col: number,
	row: number,
	rot: number,
	step: number | null,
	timer: number | null,
	map: number[],
	dim: number,
	customColors: Record<string, number>,
	allObjects: GameObject[],
	scene: Scene
): boolean {
	let height = map[row * dim + col];
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

	const obj = new cls(time, col, row, height, rot, step, timer, dim, customColors);
	allObjects.push(obj);
	scene.add(obj.object3D);
	return true;
}

export function removeObjectFromScene(
	col: number,
	row: number,
	time: number,
	visibilityCheck: (col: number, row: number, yOffset?: number) => boolean,
	allObjects: GameObject[]
): boolean {
	const objects = allObjects.filter(o => o.col === col && o.row === row && !o.absorbedTime);
	if (objects.length === 0) return false;

	const top = objects[objects.length - 1];
	if (top instanceof Pedestal) return false;

	const allowed =
		(objects.length > 1 && objects[0] instanceof Boulder) ||
		(objects.length > 1 && objects[0] instanceof Pedestal && visibilityCheck(col, row, 1)) ||
		(objects.length === 1 && visibilityCheck(col, row));

	if (allowed) {
		top.remove(time);
		return true;
	}
	return false;
}
