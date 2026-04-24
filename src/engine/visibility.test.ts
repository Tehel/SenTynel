import { describe, it, expect } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from 'three';
import { isCellVisible } from './visibility';

const mapSize = 16;
const flatMap = (height: number) => Array(mapSize * mapSize).fill(height);

describe('isCellVisible', () => {
	it('returns false when camera is below target height', () => {
		const cam = new PerspectiveCamera();
		cam.position.set(5, 2, 5); // y=2, target height=5
		const scene = new Scene();
		expect(isCellVisible(cam, scene, flatMap(5), mapSize, 5, 5)).toBe(false);
	});

	it('returns false when camera is at exactly target height', () => {
		const cam = new PerspectiveCamera();
		cam.position.set(5, 5, 5);
		const scene = new Scene();
		expect(isCellVisible(cam, scene, flatMap(5), mapSize, 5, 5)).toBe(false);
	});

	it('returns false when a blocker mesh obstructs all corners', () => {
		// Target cell: col=8, row=8, height=3
		// World Z of corners: (16-1)-8=7, (16-1)-9=6
		// Camera above target, at Z=0 — all rays travel toward +Z
		const cam = new PerspectiveCamera();
		cam.position.set(8.5, 10, 0);

		const scene = new Scene();

		// Wide tall wall at Z=3.5 — between camera (Z=0) and target corners (Z=6,7)
		const geo = new BoxGeometry(20, 30, 0.2);
		const mat = new MeshBasicMaterial();
		const wall = new Mesh(geo, mat);
		wall.position.set(8.5, 5, 3.5);
		// No userData.col/row — treated as non-target geometry, blocks the rays
		scene.add(wall);

		expect(isCellVisible(cam, scene, flatMap(3), mapSize, 8, 8)).toBe(false);
	});

	// Positive-case test (clear line of sight through scene geometry) is deferred:
	// isCellVisible requires the target tile's mesh to be present in the scene to
	// produce a hit beyond the blocker check. That requires full terrain geometry.
	// TODO: add integration test once scene-builder is extractable.
});
