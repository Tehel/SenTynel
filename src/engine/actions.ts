import { Raycaster, Vector2 } from 'three';
import type { PerspectiveCamera } from 'three';
import { Boulder, Sentinel, Meanie, Sentry, Synthoid, Tree } from '../world/objects';
import { rng256 } from '../world/terrain';
import { isCellVisible } from './visibility';
import { addObjectToScene, removeObjectFromScene, type SceneData } from './scene';
import type { InputManager } from './input';

export function handleClick(
	event: MouseEvent,
	input: InputManager,
	camera: PerspectiveCamera,
	sceneData: SceneData,
	mapSize: number,
	lastTime: number,
	onRequestLock: () => void
): void {
	if (!input.isLocked) {
		onRequestLock();
		return;
	}

	const raycaster = new Raycaster();
	raycaster.setFromCamera(new Vector2(0, 0), camera);
	const intersects = raycaster.intersectObjects(sceneData.scene.children);

	for (const hit of intersects) {
		let obj = hit.object;
		while (obj.parent !== sceneData.scene) obj = obj.parent!;
		if (!obj.userData) return;

		const { col, row, type } = obj.userData as { col: number; row: number; type: string };
		const { map, customColors, allObjects, scene } = sceneData;
		const vis = (c: number, r: number, yo?: number) =>
			isCellVisible(camera, scene, map, mapSize, c, r, yo);

		if (event.button === 0) {
			if (!['plane', 'slope'].includes(type)) removeObjectFromScene(col, row, lastTime, vis, allObjects);
		} else if (event.button === 1) {
			if (type !== 'slope') {
				const cls = event.shiftKey ? Meanie : event.ctrlKey ? Sentinel : Synthoid;
				addObjectToScene(cls, lastTime, col, row, rng256(), null, null, map, mapSize, customColors, allObjects, scene);
			}
		} else if (event.button === 2) {
			if (type !== 'slope') {
				const cls = event.shiftKey ? Tree : event.ctrlKey ? Sentry : Boulder;
				addObjectToScene(cls, lastTime, col, row, rng256(), null, null, map, mapSize, customColors, allObjects, scene);
			}
		}
		break;
	}
}
