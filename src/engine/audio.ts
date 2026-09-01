/*
 The audio layer. See PLAN-SOUND.md for what plays when, and why the asset set looks as it does.

 NOTHING IN THIS MODULE TOUCHES A BROWSER API AT IMPORT TIME. engine/scene.ts calls into it, and
 scene.ts is loaded by the Node bot harness (engine/bot.harness.test.ts) where there is no
 AudioContext and no fetch of an .m4a. Every entry point below therefore no-ops until initAudio()
 has run, exactly as engine/textures.ts stays inert outside a browser. Breaking that does not fail
 loudly — it fails as a thousand-landscape sweep that will not start.

 THE LISTENER RIDES THE CAMERA, which is the whole reason positional audio needs no adaptation
 here: the camera IS the player's eye. It does not matter that the camera is not part of the scene
 graph — WebGLRenderer.render() calls camera.updateMatrixWorld() for a parentless camera, and that
 recurses into children, so a listener parented to the camera is updated every frame for free.

 PANNING IS 'equalpower', NOT Three.js's 'HRTF' DEFAULT. HRTF is a binaural model built for
 headphones and reads as phasey on speakers; equalpower is literally "stereo volumes hint the
 direction", which is the effect wanted, and costs a fraction as much CPU.
*/
import { Audio, AudioListener, PerspectiveCamera, PositionalAudio, Scene } from 'three';
import { settings } from '../settings.svelte';
import { MAP_SIZE } from '../world/terrain';

/*
 Every sound that ships. Mirrors utils/convert-sounds.sh's manifest — if the two disagree, a sound
 either 404s or is dead weight in public/sounds/, and nothing else notices.

 'music' is absent deliberately: it is streamed through an <audio> element rather than decoded into
 a buffer (see startMusic), because decoded it is ~80 MB resident and this game runs on phones.
*/
export type SfxName =
	| 'complete'
	| 'gameover'
	| 'seen'
	| 'turn'
	| 'meanie'
	| 'absorb'
	| 'create'
	| 'transfer'
	| 'hyperspace'
	| 'hyperspace-forced'
	| 'error';

const SFX: SfxName[] = [
	'complete',
	'gameover',
	'seen',
	'turn',
	'meanie',
	'absorb',
	'create',
	'transfer',
	'hyperspace',
	'hyperspace-forced',
	'error',
];

/*
 THE VOLUME CURVE. settings.soundVolume is 0-10 and linear gain is wrong for loudness — 5 would
 sound far louder than half. Uniform decibels per step instead, with two anchors fixed by intent
 (PLAN-SOUND.md):

   0  is TRUE SILENCE, not a very small gain.
   10 is unity — the loudest asset at full scale, deliberately much too loud.

 The ceiling is unity rather than something louder because the assets peak between -2.3 and
 -16.8 dBFS, so any master gain above 1.0 clips the hot ones (turn, at -2.3 dBFS, first). "Too
 loud" should come from the material, never from distortion.

 DB_PER_STEP is THE tuning knob and is expected to move once someone has listened on real
 hardware. At 3.5 the range is -31.5 dB (1) to 0 dB (10), which is wide enough that the bottom is
 quiet-but-audible rather than pointless.
*/
const DB_PER_STEP = 3.5;

/*
 PER-SOUND TRIM, in dB, applied on top of the master curve. Calibrated by play on 2026-09-01 at
 volume 5, which is where the reference sounds (music, meanie, turn, complete, gameover) sit right
 — so those are 0 by definition and this table only records the ones that were wrong.

 The rule behind the numbers is frequency, not importance. absorb and create fire on EVERY object
 appearing or disappearing, player or watcher, which over a landscape is hundreds of plays: at
 parity with a win sting they wear the ear out. The transfer/hyperspace trio is the next tier —
 heard many times a landscape, though not constantly. Everything at 0 is heard a handful of times
 or once.

 A frequently-heard sound has to be quieter than an occasional one to feel EQUALLY loud over time.
 These are ordinary tuning knobs: re-tune by ear, they are not derived from anything.
*/
const TRIM_DB: Record<SfxName, number> = {
	absorb: -10,
	create: -10,
	transfer: -10,
	hyperspace: -4,
	'hyperspace-forced': -4,
	/*
	 The only POSITIVE trim, and the reason is the sound rather than its importance: error-2-tock
	 is 70 ms of a fast-decaying 143 Hz tone, so at the same peak as everything else it carries
	 3.34 dB less total energy than the error-1-soft candidate did, and sits low enough that the
	 ear is less sensitive to it again. Peak normalisation is not loudness normalisation, which is
	 the entire reason this table exists — a boost here is not the sound being made important.

	 +4 as measured in play. It remains the quietest thing in the game relative to its own peak.
	*/
	error: +4,
	seen: 0,
	turn: 0,
	meanie: 0,
	complete: 0,
	gameover: 0,
};

const trimGain = (name: SfxName): number => Math.pow(10, TRIM_DB[name] / 20);

export function volumeToGain(v: number): number {
	if (v <= 0) return 0;
	return Math.pow(10, (-(10 - Math.min(v, 10)) * DB_PER_STEP) / 20);
}

/*
 Distance falloff, tuned for a 32x32 map — the defaults assume a world measured in metres and
 would leave everything at full volume across a landscape this small. refDistance is about two
 cells: inside that a sound is at full level, beyond it the inverse model rolls off, reaching
 roughly an eighth at the far corner.
*/
const REF_DISTANCE = 2.5;
const ROLLOFF = 1.1;
const MAX_DISTANCE = MAP_SIZE * 1.5;

// Concurrent positional voices. Absorb/create fire on every object appearing or disappearing, and
// a watcher drain phase can morph several at once, so this is sized for a busy 1 Hz tick rather
// than for the common case. Overflow steals the oldest voice.
const VOICE_COUNT = 12;

interface Voice {
	node: PositionalAudio;
	startedAt: number;
}

interface AudioState {
	ctx: AudioContext;
	listener: AudioListener;
	camera: PerspectiveCamera;
	master: GainNode;
	sfxBus: GainNode;
	musicBus: GainNode;
	buffers: Map<SfxName, AudioBuffer>;
	voices: Voice[];
	centre: Audio | null;
	music: { el: HTMLAudioElement; src: MediaElementAudioSourceNode } | null;
	musicWanted: boolean;
}

let A: AudioState | null = null;

/*
 Create the graph. Idempotent, and safe to call before any user gesture: the context will simply
 start 'suspended' and every play below becomes a no-op until unlockAudio() runs. That is not a
 failure mode to design around, it is the normal path on iOS — see unlockAudio.
*/
export function initAudio(camera: PerspectiveCamera): void {
	if (A) return;
	if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return;

	const listener = new AudioListener();
	camera.add(listener);
	const ctx = listener.context as AudioContext;

	const master = ctx.createGain();
	const sfxBus = ctx.createGain();
	const musicBus = ctx.createGain();
	sfxBus.connect(master);
	musicBus.connect(master);
	// The listener's own gain is Three.js's master; we insert ours in front of it so that
	// PositionalAudio (which connects itself to listener.getInput()) is covered too.
	master.connect(listener.getInput());

	const voices: Voice[] = [];
	for (let i = 0; i < VOICE_COUNT; i++) {
		const node = new PositionalAudio(listener);
		node.panner.panningModel = 'equalpower';
		node.setRefDistance(REF_DISTANCE);
		node.setRolloffFactor(ROLLOFF);
		node.setDistanceModel('inverse');
		node.setMaxDistance(MAX_DISTANCE);
		/*
		 Re-route through the sfx bus so the SFX switch and the master curve both apply.

		 IT IS THE GAIN NODE THAT MOVES, NOT THE PANNER. Three.js wires
		 source -> panner -> gain -> listener.getInput(); disconnecting the PANNER and sending it
		 straight to the bus does route the audio correctly and silently drops `gain` out of the
		 chain, which is where setVolume() writes — so every per-sound trim below would have been
		 a no-op, in a way nothing would report.
		*/
		node.gain.disconnect();
		node.gain.connect(sfxBus);
		voices.push({ node, startedAt: 0 });
	}

	const centre = new Audio(listener);
	centre.gain.disconnect();
	centre.gain.connect(sfxBus);

	A = {
		ctx,
		listener,
		camera,
		master,
		sfxBus,
		musicBus,
		buffers: new Map(),
		voices,
		centre,
		music: null,
		musicWanted: false,
	};

	applyAudioSettings();
	void loadSfx();
}

async function loadSfx(): Promise<void> {
	const a = A;
	if (!a) return;
	await Promise.all(
		SFX.map(async name => {
			try {
				const res = await fetch(`${import.meta.env.BASE_URL}sounds/${name}.m4a`);
				if (!res.ok) throw new Error(`${res.status}`);
				a.buffers.set(name, await a.ctx.decodeAudioData(await res.arrayBuffer()));
			} catch (e) {
				// A missing sound must never take the game down with it.
				console.warn(`audio: could not load ${name}`, e);
			}
		})
	);
}

/*
 THE GESTURE UNLOCK, and the one ordering rule that matters on iOS: this must be called
 SYNCHRONOUSLY from inside a user-gesture handler. Anything awaited in front of it spends the
 gesture and the resume is refused — the identical constraint engine/platform.ts's
 enterFullscreenLandscape() already lives under, and for the same reason.

 Returns nothing and throws nothing: a refused resume is not an error, it just means the next
 gesture gets another go.
*/
export function unlockAudio(): void {
	if (!A) return;
	if (A.ctx.state !== 'suspended') {
		if (A.musicWanted) startMusic();
		return;
	}
	/*
	 resume() is called SYNCHRONOUSLY here — that is the whole iOS constraint — but it is a PROMISE,
	 and the state does not flip to 'running' until it settles. Retrying the pending music start on
	 the next line therefore found a context still marked 'suspended' and did nothing, so the tune
	 never began on the gesture that unlocked it; it took a later, unrelated re-render to start.

	 Deferring only the retry keeps the synchronous call inside the gesture where it must be, while
	 letting the start see the state it is waiting for.
	*/
	void A.ctx.resume().then(() => {
		if (A?.musicWanted) startMusic();
	});
}

export function isAudioRunning(): boolean {
	return A?.ctx.state === 'running';
}

/* Master/bus gains from settings. Called from a MainView effect, so it tracks live changes. */
export function applyAudioSettings(): void {
	if (!A) return;
	const g = volumeToGain(settings.soundVolume);
	A.master.gain.value = g;
	A.sfxBus.gain.value = settings.soundEffects ? 1 : 0;
	A.musicBus.gain.value = settings.music ? 1 : 0;
}

function ready(): AudioState | null {
	if (!A || A.ctx.state !== 'running') return null;
	if (settings.soundVolume <= 0 || !settings.soundEffects) return null;
	return A;
}

/*
 A sound with a place in the world: absorb/create at the cell it happened on, turn/meanie/seen at
 the watcher or tree responsible. World coords follow the project's Y-up convention —
 x = col, y = height, z = (MAP_SIZE-1) - row (CLAUDE.md, Three.js notes).
*/
export function playSfxAt(name: SfxName, col: number, row: number, height: number): void {
	const a = ready();
	if (!a) return;
	const buf = a.buffers.get(name);
	if (!buf) return;

	// Oldest voice wins if all are busy — a stolen tail is far less noticeable than a missing
	// attack, and the alternative (dropping the new sound) silences the event that just happened.
	let v = a.voices.find(x => !x.node.isPlaying);
	if (!v) v = a.voices.reduce((o, x) => (x.startedAt < o.startedAt ? x : o), a.voices[0]);
	if (v.node.isPlaying) v.node.stop();

	v.node.position.set(col, height, MAP_SIZE - 1 - row);
	v.node.setVolume(trimGain(name));
	v.node.setBuffer(buf);
	v.startedAt = a.ctx.currentTime;
	v.node.play();
}

/*
 A sound with no place in the world. Transfer and hyperspace are the cases: it is our own spirit
 travelling, so the sound is always located on the camera and a pan would be describing a journey
 the listener is inside. Win/lose stings are not events in the world at all.
*/
export function playSfx(name: SfxName): void {
	const a = ready();
	if (!a || !a.centre) return;
	const buf = a.buffers.get(name);
	if (!buf) return;
	if (a.centre.isPlaying) a.centre.stop();
	a.centre.setVolume(trimGain(name));
	a.centre.setBuffer(buf);
	a.centre.play();
}

/*
 Music is STREAMED, never decoded. Decoded it is 227 s x 44.1 kHz x 2ch x Float32 ~= 80 MB
 resident, which is unrelated to its 3.6 MB download and punishing on a phone. The element is also
 created on first use rather than at init, so a player who starts a landscape never fetches it —
 it is 3.6 MB of a 4.0 MB payload and only two screens want it.

 Paths go through import.meta.env.BASE_URL, matching engine/scene.ts's skybox and surface loads.
 A bare relative path resolves against the current URL and so breaks the moment the game is served
 from a subdirectory, which utils/deploy.sh makes a real possibility rather than a hypothetical.
*/
export function startMusic(): void {
	const a = A;
	if (!a) return;
	a.musicWanted = true;
	if (!settings.music || settings.soundVolume <= 0) return;
	if (a.ctx.state !== 'running') return; // will be retried by unlockAudio()

	// An element that already exists and was merely paused (backgrounding) resumes from where it
	// was — play() on a paused element is a resume, not a restart.
	if (!a.music) {
		const el = new window.Audio(`${import.meta.env.BASE_URL}sounds/music.m4a`);
		el.loop = true;
		el.crossOrigin = 'anonymous';
		const src = a.ctx.createMediaElementSource(el);
		src.connect(a.musicBus);
		a.music = { el, src };
	}
	void a.music.el.play().catch(() => {
		/* autoplay refused — the next gesture calls unlockAudio() and we try again */
	});
}

/*
 Stop, as in "we have left the screen that wanted music": the tune is over and the next start
 begins it again. Distinct from pauseMusic below, and the difference is currentTime.
*/
export function stopMusic(): void {
	const a = A;
	if (!a) return;
	a.musicWanted = false;
	if (a.music) {
		a.music.el.pause();
		a.music.el.currentTime = 0;
	}
}

/*
 Pause, as in "the app went to the background": an <audio> element keeps playing when the page is
 hidden, so without this, switching apps on a tablet leaves the tune playing until the app is
 explicitly killed.

 It deliberately does NOT reset currentTime and does NOT clear musicWanted — coming back to an app
 should pick the tune up where it was, not restart it, and the want is still true the whole time.
 That is the entire difference from stopMusic, and it is why this is a second function rather than
 a flag on the first.
*/
export function pauseMusic(): void {
	A?.music?.el.pause();
}

/*
 Teardown. Audio nodes are not GPU resources so they are not in the Disposer, but the voices ARE
 children of the scene, and MainView's Effect 2 rebuilds the scene wholesale — so they have to be
 re-parented rather than leaked. Called on engine teardown, not on every level build.
*/
export function disposeAudio(): void {
	const a = A;
	if (!a) return;
	stopMusic();
	a.voices.forEach(v => {
		if (v.node.isPlaying) v.node.stop();
		v.node.gain.disconnect();
		v.node.removeFromParent();
	});
	if (a.centre) {
		if (a.centre.isPlaying) a.centre.stop();
		a.centre.gain.disconnect();
	}
	a.music?.src.disconnect();
	a.master.disconnect();
	a.sfxBus.disconnect();
	a.musicBus.disconnect();
	a.listener.getInput().disconnect();
	a.camera.remove(a.listener);
	/*
	 THE CONTEXT IS DELIBERATELY NOT CLOSED. THREE.AudioContext.getContext() memoises a single
	 context for the life of the page and hands the same one to every AudioListener ever
	 constructed — so close() does not release a resource, it permanently poisons the singleton,
	 and every later listener gets a dead context back. The symptom is remote from the cause:
	 "Construction of GainNode is not useful when context is closed", thrown by code that never
	 went near disposeAudio.

	 Suspending is the honest equivalent and is reversible; unlockAudio() resumes it.
	*/
	void a.ctx.suspend();
	A = null;
}

/*
 The voices have to live in the scene graph or nothing updates their world matrix, and MainView's
 Effect 2 throws the whole scene away on every level build — so this is not an optimisation, it is
 what keeps positional audio working after the first landscape. Must be called with each new scene.
*/
export function reparentAudio(scene: Scene): void {
	if (!A) return;
	A.voices.forEach(v => scene.add(v.node));
}
