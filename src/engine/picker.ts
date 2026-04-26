import { Raycaster, Vector2 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { GameObject } from '../world/objects';
import type { SceneData } from './scene';

export type Pick =
	| { kind: 'object'; gameObject: GameObject; col: number; row: number }
	| { kind: 'terrain'; type: 'plane' | 'slope'; col: number; row: number };

// Raycast from the camera centre, return the first picked target. Skips invisible
// objects (notably the active synthoid body the player is sitting inside) and meshes
// without col/row metadata. The returned col/row identifies the grid cell — for an
// object pick that is the cell the GameObject occupies, for terrain it is the cell
// the plane/slope mesh covers.
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
		const ud = obj.userData as { gameObject?: GameObject; type?: 'plane' | 'slope'; col?: number; row?: number };
		if (ud.gameObject) {
			const go = ud.gameObject;
			return { kind: 'object', gameObject: go, col: go.col, row: go.row };
		}
		if (ud.type === 'plane' || ud.type === 'slope') {
			if (ud.col === undefined || ud.row === undefined) continue;
			return { kind: 'terrain', type: ud.type, col: ud.col, row: ud.row };
		}
	}
	return null;
}
