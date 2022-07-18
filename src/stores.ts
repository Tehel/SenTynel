import { type Writable, writable, get } from 'svelte/store';

export const energy: Writable<number> = writable(37);
export const levelId: Writable<number> = writable(0);
export const levelIds: Writable<number[]> = writable([0]);
export const soundVolume: Writable<number> = writable(5);
export const rotationInterval: Writable<number> = writable(10);
export const mouseSpeed: Writable<number> = writable(3);
export const showGrid: Writable<boolean> = writable(false);
export const showSurfaces: Writable<boolean> = writable(true);
export const showAxis: Writable<boolean> = writable(false);
export const showPosition: Writable<boolean> = writable(false);
export const showFPS: Writable<boolean> = writable(false);
export const mapSize: Writable<number> = writable(0x20);
export const smooths: Writable<number> = writable(2);
export const despikes: Writable<number> = writable(2);

export let debug = false;

export function load() {
	const dataStr = localStorage.getItem('state');
	if (!dataStr) return;
	let data;
	try {
		data = JSON.parse(dataStr);
	} catch (e) {
		console.warn('Saved state is not valid JSON: ', e);
		return;
	}
	if (data.levelId !== undefined) levelId.set(data.levelId);
	if (data.levelIds !== undefined) levelIds.set(data.levelIds);
	if (data.soundVolume !== undefined) soundVolume.set(data.soundVolume);
	if (data.rotationInterval !== undefined) rotationInterval.set(data.rotationInterval);
	if (data.mouseSpeed !== undefined) mouseSpeed.set(data.mouseSpeed);
	if (data.showGrid !== undefined) showGrid.set(data.showGrid);
	if (data.showSurfaces !== undefined) showSurfaces.set(data.showSurfaces);
	if (data.showAxis !== undefined) showAxis.set(data.showAxis);
	if (data.showPosition !== undefined) showPosition.set(data.showPosition);
	if (data.showFPS !== undefined) showFPS.set(data.showFPS);
	if (data.mapSize !== undefined) mapSize.set(data.mapSize);
	if (data.smooths !== undefined) smooths.set(data.smooths);
	if (data.despikes !== undefined) despikes.set(data.despikes);
}

export function save() {
	const data: Record<string, any> = {};
	data.levelId = get(levelId);
	data.levelIds = get(levelIds);
	data.soundVolume = get(soundVolume);
	data.rotationInterval = get(rotationInterval);
	data.mouseSpeed = get(mouseSpeed);
	data.showGrid = get(showGrid);
	data.showSurfaces = get(showSurfaces);
	data.showAxis = get(showAxis);
	data.showPosition = get(showPosition);
	data.showFPS = get(showFPS);
	data.mapSize = get(mapSize);
	data.smooths = get(smooths);
	data.despikes = get(despikes);

	localStorage.setItem('state', JSON.stringify(data));
}

debug = localStorage.getItem('debug') !== null;
