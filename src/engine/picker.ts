import { Raycaster, Vector2 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { GameObject } from '../world/objects';
import type { SceneData } from './scene';
import { MAP_SIZE } from '../world/terrain';

export type Pick =
	| { kind: 'object'; gameObject: GameObject; col: number; row: number }
	| { kind: 'terrain'; type: 'plane' | 'slope'; col: number; row: number };

// World-space hit point → grid cell. World mapping: x = col, z = (MAP_SIZE-1) - row,
// so a hit at (x, z) lands on cell (floor(x), MAP_SIZE-2-floor(z)). Clamp defensively
// to terrain bounds (0..MAP_SIZE-2) — out-of-range shouldn't happen for valid hits.
function cellAt(x: number, z: number): { col: number; row: number } {
	const col = Math.max(0, Math.min(MAP_SIZE - 2, Math.floor(x)));
	const row = Math.max(0, Math.min(MAP_SIZE - 2, MAP_SIZE - 2 - Math.floor(z)));
	return { col, row };
}

// Raycast from the camera centre, return the first picked target. Skips invisible
// objects (notably the active synthoid body the player is sitting inside). The
// returned col/row identifies the grid cell — for an object pick that is the cell
// the GameObject occupies, for terrain it is derived from the world-space hit point
// (terrain meshes are merged per material and have no per-cell userData).
export function pickTarget(camera: PerspectiveCamera, sceneData: SceneData): Pick | null {
	const raycaster = new Raycaster();
	raycaster.setFromCamera(new Vector2(0, 0), camera);
	// recursive=true so face meshes inside game-object Groups are hit.
	const intersects = raycaster.intersectObjects(sceneData.scene.children, true);

	for (const hit of intersects) {
		// Skip cone-of-sight overlays and any other meshes flagged non-pickable. Without
		// this, clicking on a cone would target the watcher underneath.
		if (hit.object.userData?.skipRaycast) continue;
		let obj = hit.object;
		while (obj.parent !== sceneData.scene) obj = obj.parent!;
		if (!obj.visible) continue;
		const ud = obj.userData as { gameObject?: GameObject; kind?: string; type?: 'plane' | 'slope' };
		if (ud.gameObject) {
			const go = ud.gameObject;
			return { kind: 'object', gameObject: go, col: go.col, row: go.row };
		}
		if (ud.kind === 'terrain' && (ud.type === 'plane' || ud.type === 'slope')) {
			const { col, row } = cellAt(hit.point.x, hit.point.z);
			return { kind: 'terrain', type: ud.type, col, row };
		}
	}
	return null;
}
