/*
 "Does a settings entry rebuild the engine?" — a referee for the one bug this codebase keeps
 making, run through utils/drive.mjs against the REAL app in headless Chrome.

   node utils/drive.mjs utils/audio-menu-check.mjs

 THE BUG IT GUARDS. A Svelte 5 effect's dependency list is not what it appears to read, it is what
 everything it calls reads, however many frames deep. MainView's Effect 1 is the engine lifecycle
 and its header says it never reads settings — but initAudio() ends by applying the volume
 settings, so calling it bare enrolled settings.soundVolume/music/soundEffects as dependencies of
 the renderer. Touching any audio menu entry then tore down the WebGL renderer, the input manager
 and the scene, and rebuilt them. Measured here: 8 rebuilds from one pass over the Sound submenu.

 It is the second time: buildScene reading settings.visualStyle did the same thing to Effect 2 and
 is documented in CLAUDE.md. Both were fixed with untrack. Neither announced itself as anything to
 do with the setting that caused it — the first showed up as the camera resetting to (0,0), the
 second as a WebGL warning about 3D textures.

 WHY getContext AND NOT THE GL CONTEXT'S IDENTITY. The first version of this probe stamped an id
 on the WebGL context and compared it before and after. That reports PASS against the known-bad
 build: a browser hands back the SAME context object for repeated getContext() on one canvas, so a
 rebuilt WebGLRenderer is indistinguishable that way. Counting getContext CALLS after mount is a
 direct count of renderer constructions, and was verified to read 8 on the bad build and 0 on the
 fixed one. A referee that cannot fail is not a referee.
*/
export default async api => {
	await api.goto('/');
	await api.wait(2000);

	// Install the counter AFTER mount, so the initial legitimate construction is not counted.
	await api.eval(`
		window.__ctx = 0;
		const orig = HTMLCanvasElement.prototype.getContext;
		HTMLCanvasElement.prototype.getContext = function (...a) {
			if (String(a[0]).startsWith('webgl')) window.__ctx++;
			return orig.apply(this, a);
		};
		'ok'`);

	const focus = () => api.eval(`(document.querySelector('.focus')||{}).innerText || '?'`);
	const rebuilds = () => api.eval(`window.__ctx`);

	console.log('rebuilds after mount :', await rebuilds(), '(baseline, must be 0)');

	for (let i = 0; i < 6 && !/Settings/.test(await focus()); i++) await api.key('ArrowDown');
	await api.key('Enter'); await api.wait(250);
	for (let i = 0; i < 10 && !/^Sound$/m.test(await focus()); i++) await api.key('ArrowDown');
	await api.key('Enter'); await api.wait(250);

	console.log('rebuilds after menu nav:', await rebuilds(), '(navigation alone must not rebuild)');

	const seen = [];
	for (let i = 0; i < 5; i++) {
		await api.key('ArrowDown');
		seen.push(await focus());
		await api.key('ArrowLeft'); await api.wait(150);
		await api.key('ArrowRight'); await api.wait(150);
	}
	await api.wait(800);
	const n = await rebuilds();
	console.log('entries toggled      :', JSON.stringify(seen));
	console.log('engine rebuilds      :', n);
	console.log('VERDICT              :', n === 0
		? 'PASS — audio settings do not touch the engine lifecycle'
		: `FAIL — ${n} engine rebuild(s) caused by audio settings`);
};
