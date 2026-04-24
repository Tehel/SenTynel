import { Raycaster, Vector3 } from 'three';
import type { PerspectiveCamera, Scene } from 'three';

// Y-up: position.x=col, position.y=height, position.z=(mapSize-1)-row
// userData.col and userData.row identify which grid cell an object belongs to.
export function isCellVisible(
	camera: PerspectiveCamera,
	scene: Scene,
	map: number[],
	mapSize: number,
	col: number,
	row: number,
	yOffset: number = 0
): boolean {
	const eyePos = camera.position;
	const targetHeight = map[row * mapSize + col] + yOffset;

	if (eyePos.y < targetHeight) return false;

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

		let cornerVisible = false;
		for (const int of intersects) {
			let obj = int.object;
			while (obj.parent !== scene) obj = obj.parent!;
			if (obj.userData.col === col && obj.userData.row === row) continue;
			if (int.distance < distance) break;
			if (int.distance >= distance) {
				cornerVisible = true;
				break;
			}
		}
		if (cornerVisible) return true;
	}
	return false;
}
