// Platform/browser plumbing that isn't specific to any one engine subsystem — see
// PLAN-MOBILE.md's Phase M0. Interim heuristic ahead of Phase M4's real
// `settings.inputMode`: good enough to gate a one-shot Start action without risking a
// surprise fullscreen jump for desktop dev/playtest sessions.
export function isTouchCapable(): boolean {
	return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

/*
 Must be called synchronously from a user-gesture handler (the Play tap, or the tap that resumes a
 demo) — both APIs reject if called on load, which is why an auto-started demo cannot ask for this
 and leans on the manifest instead (see below).

 Fullscreens the whole document, not just the canvas: the HUD, menu, and phase overlays are siblings
 of the canvas (see App.svelte), and fullscreening the canvas alone would hide all of them.
 `navigationUI: 'hide'` is what asks Android for the system status and navigation bars as well, not
 merely the browser's own chrome. Orientation lock only holds while fullscreen is active in most
 browsers, so it's requested right after. Failures (unsupported API, user/browser denial) are
 swallowed — the Phase M0 portrait fallback overlay covers the case where lock doesn't stick.

 THE INSTALLED CASE IS THE MANIFEST'S JOB, not this function's. public/manifest.webmanifest declares
 `display: fullscreen`, so a home-screen launch starts with no system bars at all and needs no
 gesture — which is the only way to have them hidden from the very first frame, since the demo
 auto-starts without one. This is the fallback for a plain browser tab, and the thing that puts the
 bars back on pause.
*/
export async function enterFullscreenLandscape(): Promise<void> {
	if (!isTouchCapable()) return;
	try {
		await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
	} catch {
		return;
	}
	try {
		await screen.orientation?.lock?.('landscape');
	} catch {
		// Unsupported or rejected — portrait fallback overlay handles it.
	}
}

/*
 Hand the screen back — called when a demo is paused, so the system bars return and there is an
 obvious way out of an attract mode running on somebody's tablet. "Paused" should mean the device is
 theirs again.

 Needs no user gesture, unlike entering, so the back-gesture pause can use it too. Guarded on
 fullscreenElement because exitFullscreen() rejects when nothing is fullscreen — the ordinary state
 for an installed launch, where the absence of bars comes from the manifest rather than from this
 API and so cannot be undone here. That is a real limit and not worth pretending otherwise: in the
 installed app the way out is Android's own edge gestures, which stay live in fullscreen.
*/
export async function exitFullscreen(): Promise<void> {
	if (!document.fullscreenElement) return;
	try {
		await document.exitFullscreen();
	} catch {
		// Nothing to recover: we are either already out or the browser refused.
	}
}

/*
 SCREEN WAKE LOCK — keep the display awake while the game is actually on.

 An attract mode is the case that needs it: the demo plays for hours and touches nothing, so every
 device's idle timer eventually blanks the screen on a page that is, from the OS's point of view,
 doing nothing at all. A player is only marginally different — mouse-look and keys reset a desktop's
 idle timer, but a touch player looking around with one long drag does not.

 Two things about this API drive the shape below. It is only granted to a VISIBLE document, and the
 browser RELEASES the lock by itself whenever the page is hidden — so a single request at startup
 quietly stops working the first time the app is backgrounded, and the lock has to be re-acquired on
 every return to visibility. Hence a desired-state setter rather than acquire/release calls: callers
 say what they want and this keeps reality matching it, however many times the page comes and goes.
*/
let wakeLock: WakeLockSentinel | null = null;
let wakeLockWanted = false;
let visibilityHooked = false;
// Every transition goes through one chain, so two quick phase changes cannot race into holding two
// locks or releasing the one we just asked for.
let wakeLockQueue: Promise<void> = Promise.resolve();

async function syncWakeLock(): Promise<void> {
	if (!('wakeLock' in navigator)) return;

	// Not wanted, or not grantable right now (hidden pages are refused, and the browser has already
	// dropped anything we held).
	if (!wakeLockWanted || document.visibilityState !== 'visible') {
		const held = wakeLock;
		wakeLock = null;
		await held?.release().catch(() => {});
		return;
	}
	if (wakeLock) return;

	try {
		const sentinel = await navigator.wakeLock.request('screen');
		// The want can flip while the request is in flight — a demo paused a frame after starting.
		// Whoever asked last wins, so hand it straight back rather than pinning the screen on.
		if (!wakeLockWanted) {
			await sentinel.release().catch(() => {});
			return;
		}
		wakeLock = sentinel;
		// Fires on the browser's own release (page hidden, OS power policy) as well as ours, so the
		// slot is cleared either way and the next sync knows to ask again.
		sentinel.addEventListener('release', () => {
			if (wakeLock === sentinel) wakeLock = null;
		});
	} catch {
		// Unsupported, insecure context, or refused. Nothing to fall back to and nothing worth
		// telling the player: the screen dimming is a nuisance, not a failure of the game.
	}
}

/*
 Say whether the screen should be held awake. Idempotent and cheap — call it from an effect on
 whatever "the game is running" means to the caller.
*/
export function setWakeLockWanted(wanted: boolean): void {
	wakeLockWanted = wanted;
	if (!visibilityHooked) {
		// Lazily, to honour the no-side-effects-at-module-load convention, and because a page that
		// never asks for a wake lock has no use for the listener.
		visibilityHooked = true;
		document.addEventListener('visibilitychange', () => {
			wakeLockQueue = wakeLockQueue.then(syncWakeLock).catch(() => {});
		});
	}
	wakeLockQueue = wakeLockQueue.then(syncWakeLock).catch(() => {});
}
