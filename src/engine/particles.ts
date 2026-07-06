import { BoxGeometry, Color, DynamicDrawUsage, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, Scene } from 'three';
import type { Disposer } from './disposer';
import { MAP_SIZE } from '../world/terrain';

// Cube edge length — small relative to a 1×1 cell. Kept tiny so a burst of many of them
// reads as fine motes, not a handful of visible chunks.
const PARTICLE_SIZE = 0.06;
const PARTICLE_COUNT = 30;
// Slow and unhurried — an "evaporating/coalescing" mote drift rather than a snappy burst.
// Revised 2026-07-06: the original 450ms/16-particle/2-cell version read as an
// explosion/implosion, at odds with the Sentinel universe's more majestic, fearsome tone.
const BURST_DURATION_MS = 900;
// Max outward/inward travel, in cells — the furthest-flung particles are fully shrunk away
// by the time they'd have covered this distance. Halved from the original 2 cells so the
// effect stays close to the object instead of spraying outward.
const BURST_RADIUS = 1;
// Direction vectors are biased upward (both modes) so the burst reads as motes drifting
// rather than spraying flat along the ground.
const UP_BIAS_MIN = 0.3;
const UP_BIAS_MAX = 0.9;
// 'create' anchors particles only across the lower third of the object's height, not the
// full segment. The 'squash' spawn animation grows the model from nothing at the base up to
// full height over roughly the same duration as the burst, so anchoring across the full
// (eventual) height made particles visibly converge into still-empty air above the
// currently-short, still-growing silhouette — anchoring low keeps the convergence point
// close to where the object actually has geometry for most of the animation.
const CREATE_ANCHOR_SPAN = 1 / 3;

// Ease-out cubic — fast to start, slowing to a gentle stop. Used for 'create's distance
// factor (see spawnParticleBurst's update()): particles rush in from their scattered
// starting point and decelerate into place, rather than accelerating throughout ('absorb's
// flat/linear drift) or ramping up then back down (an earlier ease-in-out revision).
function easeOutCubic(t: number): number {
	return 1 - Math.pow(1 - t, 3);
}

export interface ParticleAssets {
	geometry: BoxGeometry;
	material: MeshBasicMaterial;
}

// Shared cube geometry + material for every burst in this level — built once per
// buildScene() call and registered with that build's Disposer, the same pattern as
// engine/cones.ts's coneAssets. Per-particle color rides on each burst's own
// InstancedMesh.instanceColor attribute, so sharing one material across every burst is
// safe — nothing burst-specific lives on it.
export function createParticleAssets(disposer: Disposer): ParticleAssets {
	const geometry = new BoxGeometry(PARTICLE_SIZE, PARTICLE_SIZE, PARTICLE_SIZE);
	const material = new MeshBasicMaterial();
	disposer.register(geometry);
	disposer.register(material);
	return { geometry, material };
}

// A color sample per particle, read straight off a GameObject's own merged-mesh vertex
// colors (see world/objects/models/index.ts) — used for creation bursts so the effect
// matches whatever is materializing (tree greens/browns, synthoid yellow/black, ...)
// without inventing a made-up palette.
export function sampleMeshColors(mesh: Mesh, count = PARTICLE_COUNT): Color[] {
	const attr = mesh.geometry.getAttribute('color');
	const colors: Color[] = [];
	for (let i = 0; i < count; i++) {
		if (!attr) {
			colors.push(new Color(0xffffff));
			continue;
		}
		const vi = Math.floor(Math.random() * attr.count);
		colors.push(new Color(attr.getX(vi), attr.getY(vi), attr.getZ(vi)));
	}
	return colors;
}

// Absorb bursts are deliberately not the object's own colors — a uniform whitish "smoke",
// varied slightly per particle so it doesn't read as one flat color.
export function smokeColors(count = PARTICLE_COUNT): Color[] {
	const colors: Color[] = [];
	for (let i = 0; i < count; i++) {
		const v = 0.75 + Math.random() * 0.25;
		colors.push(new Color(v, v, v));
	}
	return colors;
}

// The vertical span (local Y) a GameObject's model occupies — lets a burst scatter its
// particles along the object's actual height instead of a guessed constant. Cached on the
// geometry by Three.js itself after the first call.
export function verticalExtent(mesh: Mesh): { min: number; max: number } {
	if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
	const box = mesh.geometry.boundingBox!;
	return { min: box.min.y, max: box.max.y };
}

export interface ParticleBurst {
	// Advances the burst toward `time`; returns true once it's finished (caller drops it).
	update(time: number): boolean;
	dispose(): void;
}

interface Particle {
	anchorX: number;
	anchorY: number;
	anchorZ: number;
	dirX: number;
	dirY: number;
	dirZ: number;
	distance: number;
}

// Reused across every burst's update() to build instance matrices — bursts never overlap
// within a single frame's synchronous update loop, so one scratch object is safe to share.
const dummy = new Object3D();

// One-shot burst of small cubes along the vertical segment [baseY, topY] at grid cell
// (col, row). 'absorb': cubes start on the segment and fly outward while shrinking to
// nothing (a dissipating puff). 'create' is the reverse: cubes start scattered outward and
// converge onto the segment while shrinking, as if motes were gathering into the object as
// it materializes. `colors` supplies one color per particle (see sampleMeshColors/
// smokeColors) — its length sets the particle count.
export function spawnParticleBurst(
	scene: Scene,
	assets: ParticleAssets,
	col: number,
	row: number,
	baseY: number,
	topY: number,
	colors: Color[],
	mode: 'create' | 'absorb',
	startTime: number
): ParticleBurst {
	const count = colors.length;
	const mesh = new InstancedMesh(assets.geometry, assets.material, count);
	mesh.instanceMatrix.setUsage(DynamicDrawUsage);
	// Three.js computes InstancedMesh.boundingSphere lazily on first render and never
	// invalidates it on later setMatrixAt calls. Every instance starts at the identity
	// matrix (stacked at world origin) until the first update() call — if that first render
	// happens before the first update() (e.g. a burst spawned via a keypress, which loop.ts
	// processes in the same tick as, but after, the particle-burst update loop), the cached
	// sphere is wrong forever and the burst is silently frustum-culled for its whole life.
	// These bursts are tiny/short-lived/few at once, so just skip culling instead of trying
	// to keep a manual bounding volume in sync every frame.
	mesh.frustumCulled = false;

	// Y-up world position — matches GameObject's own mesh.position formula (world/objects/base.ts).
	const worldX = col + 0.5;
	const worldZ = (MAP_SIZE - 1) - (row + 0.5);

	const particles: Particle[] = colors.map((color, i) => {
		mesh.setColorAt(i, color);
		const alongFraction = count === 1 ? 0.5 : i / (count - 1);
		const along = mode === 'create' ? alongFraction * CREATE_ANCHOR_SPAN : alongFraction;
		const angle = Math.random() * Math.PI * 2;
		const upBias = UP_BIAS_MIN + Math.random() * (UP_BIAS_MAX - UP_BIAS_MIN);
		const dirLength = Math.hypot(Math.cos(angle), upBias, Math.sin(angle));
		return {
			anchorX: worldX,
			anchorY: baseY + along * (topY - baseY),
			anchorZ: worldZ,
			dirX: Math.cos(angle) / dirLength,
			dirY: upBias / dirLength,
			dirZ: Math.sin(angle) / dirLength,
			distance: BURST_RADIUS * (0.5 + Math.random() * 0.5),
		};
	});

	scene.add(mesh);

	function update(time: number): boolean {
		const t = Math.min(1, (time - startTime) / BURST_DURATION_MS);
		// 'absorb' travels out at a flat, constant pace (no easing) — a fast launch there has
		// nothing at the far end to mask it, so it reads as a burst rather than a drift.
		// 'create' rushes in from its scattered starting point and decelerates into place
		// (ease-out on the shrinking distance-to-anchor), landing gently rather than snapping.
		const distFactor = mode === 'absorb' ? t : 1 - easeOutCubic(t);
		const scale = 1 - t;
		for (let i = 0; i < count; i++) {
			const p = particles[i];
			const d = p.distance * distFactor;
			dummy.position.set(p.anchorX + p.dirX * d, p.anchorY + p.dirY * d, p.anchorZ + p.dirZ * d);
			dummy.scale.setScalar(scale);
			dummy.updateMatrix();
			mesh.setMatrixAt(i, dummy.matrix);
		}
		mesh.instanceMatrix.needsUpdate = true;
		return t >= 1;
	}

	// assets.geometry/material are shared across every burst and owned by the Disposer
	// (see createParticleAssets) — only the per-burst InstancedMesh itself is torn down here.
	function dispose(): void {
		scene.remove(mesh);
	}

	return { update, dispose };
}
