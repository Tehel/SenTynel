/// <reference types="svelte" />
/// <reference types="vite/client" />

// TS's bundled lib.dom.d.ts omits ScreenOrientation.lock/unlock — the Screen Orientation
// API's lock() isn't supported in Safari, so TS leaves it out of the stable DOM lib even
// though Chromium/Firefox implement it (see engine/platform.ts, PLAN-MOBILE.md Phase M0).
type OrientationLockType =
	| 'any'
	| 'natural'
	| 'landscape'
	| 'portrait'
	| 'portrait-primary'
	| 'portrait-secondary'
	| 'landscape-primary'
	| 'landscape-secondary';

interface ScreenOrientation {
	lock(orientation: OrientationLockType): Promise<void>;
	unlock(): void;
}