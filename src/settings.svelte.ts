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
	showWatcherCones: false,
	// Debug visualisation of the exposure map (engine/exposureOverlay.ts). An oracle, so it stays
	// debug-gated in the menu — a player who can see it is not really playing the game.
	showExposureMap: false,
	animationStyle: 'squash' as 'fade' | 'squash' | 'dissolve',
	particleEffects: true,
	/*
	 The eye-candy branch's master switch. 'classic' is the Augmentinel-faithful look this project
	 shipped with — flat colours, no maps; 'enhanced' adds the procedural terrain textures and the
	 reworked models. Kept as a setting rather than a replacement for two reasons: the house rule
	 that every cosmetic addition can be turned off (see particleEffects above), and because an A/B
	 is the only honest way to judge whether the new look is actually better.
	*/
	visualStyle: 'classic' as 'classic' | 'enhanced',
	// Surface relief on terrain. Split from visualStyle because it is a separate verdict: albedo
	// alone and albedo+normals look materially different under the orbiting sun.
	terrainNormals: true,
	// Which demo-bot strategy plays the attract mode (game/botPlanners.ts). Debug-gated in the
	// menu — it is a comparison tool, not a preference.
	botPlanner: 'v2' as 'v1' | 'v2',
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
