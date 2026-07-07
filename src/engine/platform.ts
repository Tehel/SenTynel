// Platform/browser plumbing that isn't specific to any one engine subsystem — see
// PLAN-MOBILE.md's Phase M0. Interim heuristic ahead of Phase M4's real
// `settings.inputMode`: good enough to gate a one-shot Start action without risking a
// surprise fullscreen jump for desktop dev/playtest sessions.
export function isTouchCapable(): boolean {
	return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

// Must be called synchronously from a user-gesture handler (e.g. the Start tap) — both
// APIs reject if called on load. Fullscreens the whole document, not just the canvas:
// the HUD, menu, and phase overlays are siblings of the canvas (see App.svelte), and
// fullscreening the canvas alone would hide all of them. Orientation lock only holds
// while fullscreen is active in most browsers, so it's requested right after. Failures
// (unsupported API, user/browser denial) are swallowed — the Phase M0 portrait fallback
// overlay covers the case where lock doesn't stick.
export async function enterFullscreenLandscape(): Promise<void> {
	if (!isTouchCapable()) return;
	try {
		await document.documentElement.requestFullscreen();
	} catch {
		return;
	}
	try {
		await screen.orientation?.lock?.('landscape');
	} catch {
		// Unsupported or rejected — portrait fallback overlay handles it.
	}
}
