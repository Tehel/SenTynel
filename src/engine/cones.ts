import {
	AdditiveBlending,
	BufferAttribute,
	BufferGeometry,
	DoubleSide,
	Mesh,
	MeshBasicMaterial,
} from 'three';
import type { Disposer } from './disposer';

// Watcher cone-of-sight visualization. A closed sector volume — top + bottom triangles
// (horizontal sectors) joined by two side walls and a flat front face.
//
// Local frame matches the watcher's: +Z is forward, watcher's `object3D.rotation.y` aims
// the cone.
//
// Vertical bounds:
// - TOP at the watcher's eye line (local y = CONE_TOP_LOCAL ≈ Sentinel/Sentry head height).
// - BOTTOM extended way below ground (local y = CONE_BOTTOM_LOCAL = -20). The transparent
//   material has depthWrite=false but still depth-TESTS, so opaque terrain rendered first
//   clips the cone visually at the ground surface — no need for per-watcher geometry.

// Half-angle in radians — keep in sync with engine/watcher.ts CONE_HALF_ANGLE_RAD.
// (10 / 128) × π ≈ 14° half-angle = 28° full cone.
const CONE_HALF_ANGLE_RAD = (10 / 128) * Math.PI;
// Forward extent. Long enough to read across most of the map (32 cells).
const CONE_RANGE = 20;
// Top edge (eye line) in the watcher's local frame. Compromise between Sentinel (~1.0)
// and Sentry (~0.85) head heights — close enough for a debug aid.
const CONE_TOP_LOCAL = 0.9;
// Bottom edge in local coords. Far below any terrain; the depth-test clips it at ground.
const CONE_BOTTOM_LOCAL = -5;

export interface ConeAssets {
	geometry: BufferGeometry;
	material: MeshBasicMaterial;
}

export function createConeAssets(disposer: Disposer): ConeAssets {
	const geometry = buildConeGeometry();
	const material = new MeshBasicMaterial({
		color: 0xff4040,
		transparent: true,
		opacity: 0.12,
		depthWrite: false,
		side: DoubleSide,
		blending: AdditiveBlending,
	});
	disposer.register(geometry);
	disposer.register(material);
	return { geometry, material };
}

export function attachConeMesh(parent: { add(o: Mesh): void }, assets: ConeAssets): Mesh {
	const mesh = new Mesh(assets.geometry, assets.material);
	mesh.visible = false;
	// Marker read by picker.ts and visibility.ts to skip cone meshes during raycasts —
	// without it, clicking on a cone would target the watcher underneath, and a watcher's
	// cone could block its own LOS rays.
	mesh.userData = { skipRaycast: true };
	parent.add(mesh);
	return mesh;
}

function buildConeGeometry(): BufferGeometry {
	const r = CONE_RANGE;
	const top = CONE_TOP_LOCAL;
	const bot = CONE_BOTTOM_LOCAL;
	const w = r * Math.tan(CONE_HALF_ANGLE_RAD);

	// Six unique vertices forming a vertical-edge apex and a rectangular far end.
	const aT = [0, top, 0];
	const aB = [0, bot, 0];
	const fLT = [-w, top, r];
	const fLB = [-w, bot, r];
	const fRT = [w, top, r];
	const fRB = [w, bot, r];

	// Triangulate the closed wedge. With DoubleSide rendering, winding order doesn't
	// matter visually, so we pick whatever's easiest to read.
	const positions = new Float32Array([
		// top sector triangle
		...aT, ...fLT, ...fRT,
		// bottom sector triangle
		...aB, ...fRB, ...fLB,
		// left wall (apex_top, apex_bot, far_LB / far_LT)
		...aT, ...aB, ...fLB,
		...aT, ...fLB, ...fLT,
		// right wall
		...aT, ...fRT, ...fRB,
		...aT, ...fRB, ...aB,
		// far end (rectangle)
		...fLT, ...fLB, ...fRB,
		...fLT, ...fRB, ...fRT,
	]);

	const geo = new BufferGeometry();
	geo.setAttribute('position', new BufferAttribute(positions, 3));
	geo.computeBoundingSphere();
	return geo;
}
