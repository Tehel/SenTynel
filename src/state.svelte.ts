export const settings = $state({
	levelId: 0,
	levelIds: [0] as number[],
	soundVolume: 5,
	rotationInterval: 10,
	mouseSpeed: 3,
	showGrid: false,
	showSurfaces: true,
	showAxis: false,
	showPosition: false,
	showFPS: false,
	mapSize: 0x20,
	smooths: 2,
	despikes: 2,
});

export const debug = () => localStorage.getItem('debug') !== null;

export function load() {
	const dataStr = localStorage.getItem('state');
	if (!dataStr) return;
	try {
		const data = JSON.parse(dataStr);
		for (const key of Object.keys(settings) as Array<keyof typeof settings>) {
			if (data[key] !== undefined) (settings as any)[key] = data[key];
		}
	} catch (e) {
		console.warn('Saved state is not valid JSON: ', e);
	}
}

export function save() {
	localStorage.setItem('state', JSON.stringify(settings));
}
