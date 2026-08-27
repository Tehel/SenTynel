/*
 Drive shoot.html in headless Chrome and write PNGs.

 Deliberately dependency-free. Playwright was the obvious choice and was dropped: the browser
 only ever has to load one URL and hold still, Chrome's own --screenshot does that, and the repo
 carries no test-tooling dependency beyond vitest. --virtual-time-budget is what makes it
 reliable — it fast-forwards timers and waits for the page to go quiescent, so the async skybox
 (and later the textures) have resolved and a frame is on the canvas before the capture.

   node utils/shoot.mjs out/a.png "scene=level&level=0&angle=45"
   node utils/shoot.mjs --dir out/sheet near:"mode=eye&col=12&row=14" far:"angle=200"

 Several shots in one invocation share a single dev server, which is most of the wall clock.
 Params are shoot.ts's query string; see its header for the modes.
*/
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const PORT = Number(process.env.SHOOT_PORT ?? 5199);
const W = Number(process.env.SHOOT_W ?? 1280);
const H = Number(process.env.SHOOT_H ?? 720);
const CHROME = process.env.CHROME_BIN ?? 'google-chrome';
const PAD = 120;

const argv = process.argv.slice(2);
let outDir = null;
const shots = [];
for (let i = 0; i < argv.length; i++) {
	if (argv[i] === '--dir') { outDir = argv[++i]; continue; }
	if (outDir === null && shots.length === 0 && argv[i].endsWith('.png')) {
		shots.push({ file: argv[i], params: argv[++i] ?? '' });
		continue;
	}
	const at = argv[i].indexOf(':');
	shots.push({ file: join(outDir ?? '.', argv[i].slice(0, at) + '.png'), params: argv[i].slice(at + 1) });
}
if (shots.length === 0) {
	console.error('usage: shoot.mjs out.png "<params>"   |   shoot.mjs --dir <dir> name:"<params>" ...');
	process.exit(2);
}

const alive = async () => {
	try { await fetch(`http://localhost:${PORT}/shoot.html`); return true; } catch { return false; }
};

let server = null;
if (!(await alive())) {
	server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
		cwd: resolve(import.meta.dirname, '..'),
		stdio: 'ignore',
	});
	const deadline = Date.now() + 30000;
	while (!(await alive())) {
		if (Date.now() > deadline) { server.kill(); throw new Error('vite did not come up'); }
		await new Promise(r => setTimeout(r, 200));
	}
}

// A fresh profile per run: Chrome refuses to reuse one that another instance holds, and a stale
// profile is also a way for one shot's GPU cache to colour the next.
const profile = `/tmp/shoot-profile-${process.pid}`;

try {
	for (const { file, params } of shots) {
		mkdirSync(dirname(resolve(file)), { recursive: true });
		if (existsSync(file)) rmSync(file);
		const url = `http://localhost:${PORT}/shoot.html?w=${W}&h=${H}&${params}`;
		execFileSync(CHROME, [
			'--headless=new',
			'--no-sandbox',
			'--disable-gpu-sandbox',
			// SwiftShader: this box has no GPU in WSL. Slow, but these are stills.
			'--enable-unsafe-swiftshader',
			'--hide-scrollbars',
			'--force-device-scale-factor=1',
			// Chrome's --window-size is the OUTER window; headless keeps ~87px of it for itself, so
			// the page viewport comes back short while --screenshot still captures the full outer
			// size. Ask for extra, then crop back to exactly W×H below. PAD only has to exceed
			// whatever Chrome reserves; the crop makes the surplus invisible.
			`--window-size=${W},${H + PAD}`,
			`--user-data-dir=${profile}`,
			'--virtual-time-budget=8000',
			`--screenshot=${resolve(file)}`,
			url,
		], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 120000 });
		if (!existsSync(file)) throw new Error(`no output for ${file} — ${url}`);
		// Crop off Chrome's reserved strip so every shot is exactly the size that was asked for —
		// two images of different heights cannot be diffed or tiled into a contact sheet.
		execFileSync('convert', [resolve(file), '-crop', `${W}x${H}+0+0`, '+repage', resolve(file)]);
		console.log(`${file}  <-  ${params}`);
	}
} finally {
	rmSync(profile, { recursive: true, force: true });
	if (server) server.kill();
}
