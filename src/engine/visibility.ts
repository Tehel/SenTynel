import { Raycaster, Vector3 } from 'three';
import type { PerspectiveCamera, Scene } from 'three';

// Y-up: position.x=col, position.y=height, position.z=(mapSize-1)-row
// userData.col and userData.row identify which grid cell an object belongs to.

// LOS check from an arbitrary world-space eye position. Watchers use this from their own
// position; the player wrapper below feeds in `camera.position`. fromCol/fromRow let a
// watcher exclude its own cell's geometry (which would otherwise self-block).
export function isCellVisibleFrom(
	eyePos: Vector3,
	scene: Scene,
	map: number[],
	mapSize: number,
	col: number,
	row: number,
	yOffset: number = 0,
	fromCol?: number,
	fromRow?: number
): boolean {
	// Ensure world matrices are current — the renderer normally does this every frame,
	// but it hasn't run yet on the first tick (or in unit tests with no renderer). Cheap
	// when nothing is dirty; without it, raycasts can silently miss freshly-added objects.
	scene.updateMatrixWorld();

	const targetHeight = map[row * mapSize + col] + yOffset;

	// Eye must be strictly above target floor: standing level with a tile shouldn't see it.
	if (eyePos.y <= targetHeight) return false;

	const raycaster = new Raycaster();

	for (const [vc, vr] of [
		[col, row],
		[col + 1, row],
		[col, row + 1],
		[col + 1, row + 1],
	] as [number, number][]) {
		const target = new Vector3(vc, targetHeight, (mapSize - 1) - vr);
		const path = target.clone().sub(eyePos);
		const distance = path.length();
		raycaster.set(eyePos, path.normalize());
		const intersects = raycaster.intersectObjects(scene.children);

		// Optimistic: the corner is treated as reached unless a non-skipped hit is
		// strictly closer than the target by more than EPS. EPS absorbs floating-point
		// noise on rays that graze a neighbouring cell's mesh exactly at the shared
		// corner (where adjacent-cell hits land at ~target distance ± 1e-6).
		const EPS = 0.001;
		let cornerVisible = true;
		for (const int of intersects) {
			// Skip cone-of-sight overlays (and any other mesh marked non-pickable) so a
			// watcher's own cone can't block its LOS, and player rays pass through cones.
			if (int.object.userData?.skipRaycast) continue;
			let obj = int.object;
			while (obj.parent !== scene) obj = obj.parent!;
			// Skip invisible objects — notably the player's hidden active synthoid body,
			// which surrounds the camera and would otherwise register near-zero-distance
			// hits (model meshes use DoubleSide, so back-faces from inside are picked up).
			if (!obj.visible) continue;

			// Resolve the cell this hit sits on: terrain (merged mesh) → from world-space
			// hit point; game-object Group → from userData.col/row. Anything else (e.g.
			// the test wall in visibility.test.ts) is treated as a pure blocker, never
			// matching the source/target skip clauses.
			let hitCol: number | undefined;
			let hitRow: number | undefined;
			const ud = obj.userData as { col?: number; row?: number; kind?: string };
			if (ud.kind === 'terrain') {
				hitCol = Math.max(0, Math.min(mapSize - 2, Math.floor(int.point.x)));
				hitRow = Math.max(0, Math.min(mapSize - 2, mapSize - 2 - Math.floor(int.point.z)));
			} else if (typeof ud.col === 'number' && typeof ud.row === 'number') {
				hitCol = ud.col;
				hitRow = ud.row;
			}

			// Skip the target cell's own geometry.
			if (hitCol === col && hitRow === row) continue;
			// Skip the source cell's own geometry (watcher's body or pedestal).
			if (fromCol !== undefined && hitCol === fromCol && hitRow === fromRow) continue;
			if (int.distance < distance - EPS) {
				cornerVisible = false;
				break;
			}
			// First non-skipped hit at or past the target — unobstructed; stop iterating.
			break;
		}
		if (cornerVisible) return true;
	}
	return false;
}

// Player-side LOS — thin wrapper for the camera's eye.
export function isCellVisible(
	camera: PerspectiveCamera,
	scene: Scene,
	map: number[],
	mapSize: number,
	col: number,
	row: number,
	yOffset: number = 0
): boolean {
	return isCellVisibleFrom(camera.position, scene, map, mapSize, col, row, yOffset);
}
