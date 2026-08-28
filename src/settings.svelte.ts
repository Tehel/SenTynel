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
	 The eye-candy master switch: procedural terrain textures AND the redrawn object models, as one
	 decision. It was three flags once — terrain, models, and a separate toggle for surface relief —
	 which was three ways to ask the same question and a Display menu nobody could read. Nobody
	 wanted terrain textures under old models, the End key had always moved the pair together, and
	 relief was only ever split out to be judged once and then left on.
	*/
	visualStyle: 'classic' as 'classic' | 'enhanced',
	// Which watchers the redrawn set uses — see world/objects/models/index.ts's ModelFamily. Only
	// affects the Sentinel and the Sentry, and only while visualStyle is 'enhanced'.
	modelFamily: 'birds' as 'birds' | 'robots',
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
