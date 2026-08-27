/*
 Drive the REAL app in headless Chrome over the DevTools protocol, and evaluate expressions
 inside it. Where utils/shoot.mjs renders a still from engine modules, this runs the whole game —
 menu, phases, input — which is what you need to reproduce anything that only happens while
 playing.

 No dependency: Node 24 ships a global WebSocket, and CDP is just JSON over one socket.

   node utils/drive.mjs script.mjs

 The script default-exports async (api) => {...} with:
   api.eval(js)      -> value of the expression, evaluated in the page
   api.key(k)        -> press and release a key (keydown/keyup with the right code+key)
   api.click()       -> a left click at the canvas centre
   api.wait(ms)
   api.shot(path)
*/
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.DRIVE_PORT ?? 5203);
const CDP = 9333;
const CHROME = process.env.CHROME_BIN ?? 'google-chrome';
const profile = `/tmp/drive-profile-${process.pid}`;

const alive = async url => { try { await fetch(url); return true; } catch { return false; } };

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
	cwd: resolve(import.meta.dirname, '..'), stdio: 'ignore',
});
const chrome = spawn(CHROME, [
	'--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--hide-scrollbars',
	'--force-device-scale-factor=1', '--window-size=1280,840',
	`--user-data-dir=${profile}`, `--remote-debugging-port=${CDP}`, 'about:blank',
], { stdio: 'ignore' });

const deadline = Date.now() + 40000;
while (!(await alive(`http://localhost:${PORT}/`)) || !(await alive(`http://localhost:${CDP}/json/version`))) {
	if (Date.now() > deadline) throw new Error('vite or chrome did not come up');
	await new Promise(r => setTimeout(r, 250));
}

const targets = await (await fetch(`http://localhost:${CDP}/json`)).json();
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));

let id = 0;
const pending = new Map();
ws.onmessage = e => {
	const msg = JSON.parse(e.data);
	if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params = {}) =>
	new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

const wait = ms => new Promise(r => setTimeout(r, ms));

// Keys the game cares about, with the codes Chrome expects. windowsVirtualKeyCode matters:
// without it Chrome delivers no `code` for the navigation keys and the game never sees them.
const KEYS = {
	Enter: { code: 'Enter', key: 'Enter', vk: 13 },
	Escape: { code: 'Escape', key: 'Escape', vk: 27 },
	End: { code: 'End', key: 'End', vk: 35 },
	Home: { code: 'Home', key: 'Home', vk: 36 },
	ArrowUp: { code: 'ArrowUp', key: 'ArrowUp', vk: 38 },
	ArrowDown: { code: 'ArrowDown', key: 'ArrowDown', vk: 40 },
};

const api = {
	async eval(js) {
		const r = await send('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true });
		if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
		return r.result?.result?.value;
	},
	async key(k) {
		const spec = KEYS[k] ?? { code: `Key${k.toUpperCase()}`, key: k, vk: k.toUpperCase().charCodeAt(0) };
		for (const type of ['keyDown', 'keyUp']) {
			await send('Input.dispatchKeyEvent', {
				type, code: spec.code, key: spec.key,
				windowsVirtualKeyCode: spec.vk, nativeVirtualKeyCode: spec.vk,
			});
		}
		await wait(60);
	},
	async click(x = 640, y = 400) {
		for (const type of ['mousePressed', 'mouseReleased']) {
			await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
		}
		await wait(60);
	},
	wait,
	async goto(path = '/') { await send('Page.navigate', { url: `http://localhost:${PORT}${path}` }); await wait(1500); },
	async shot(path) {
		const r = await send('Page.captureScreenshot', { format: 'png' });
		writeFileSync(resolve(path), Buffer.from(r.result.data, 'base64'));
	},
};

try {
	const mod = await import(resolve(process.argv[2]));
	await mod.default(api);
} finally {
	ws.close(); chrome.kill(); vite.kill(); rmSync(profile, { recursive: true, force: true });
}
