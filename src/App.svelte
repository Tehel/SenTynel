<script lang="ts">
	import Hud from './ui/Hud.svelte';
	import MainView from './ui/MainView.svelte';
	import MainMenu from './ui/MainMenu.svelte';
	import PauseOverlay from './ui/PauseOverlay.svelte';
	import WinScreen from './ui/WinScreen.svelte';
	import LoseScreen from './ui/LoseScreen.svelte';
	import HelpLine from './ui/HelpLine.svelte';
	import PortraitOverlay from './ui/PortraitOverlay.svelte';
	import ScanVignette from './ui/ScanVignette.svelte';
	import { load } from './settings.svelte';
	import { isTouchCapable } from './engine/platform';
	import {
		game, pauseGame, giveUp, returnToMenu, advanceDemo, exitDemo, failDemo, startDemo,
	} from './game/state.svelte';
	import { loadStats } from './game/stats.svelte';
	import { loadDemoProgress } from './game/demo.svelte';
	import { DEMO_LOSS_HOLD_MS, DEMO_WIN_HOLD_MS } from './game/timing';

	load();
	loadStats();
	loadDemoProgress();

	/*
	 Touch devices open straight into attract mode.

	 The menu is an arrow-key tree and the game is a mouse-look game; until PLAN-MOBILE.md's Phase M4
	 gives touch its own controls, a phone that lands on MENU is a phone looking at a list it cannot
	 move through. The demo needs neither — it drives itself — so it is the one thing a touch device
	 can actually be shown today, and showing it beats showing an inert menu.

	 Run at App init rather than from an effect: game.phase is read by MainView's own effects on the
	 first flush, so deciding who is driving before any of them mount avoids a frame of MENU and the
	 scene rebuild that leaving it would cost. isTouchCapable() is the same coarse heuristic Start
	 uses for fullscreen (engine/platform.ts) — a touch-screen laptop gets attract mode too, and
	 exits it with any key, which is precisely the thing it has and a phone does not.
	*/
	if (isTouchCapable()) startDemo();

	// TRANSFER's return to PLAYING is driven by the camera's transfer glide finishing
	// (engine/loop.ts calls completeTransfer() once CameraController.updateTransfer signals
	// completion), the same pattern as BIRDSEYE's completeBirdsEyeExit(). WON/LOST are
	// keypress-only — WinScreen/LoseScreen call completeWon()/completeLost() directly.

	/*
	 Demo supervisor: the half of attract mode that no player is present for.

	 A demo win or loss holds its end screen for a beat — long enough to read, which is the whole
	 point of showing it to a passer-by — and then moves on by itself. This is the WON/LOST timer
	 PLAN.md records as deliberately removed, back for demo mode only: it was wrong for a player,
	 who wants to leave the screen at their own pace, and it is the only way an unattended run
	 continues.

	 A win goes to advanceDemo(), which moves the bot's own cursor and begins the next landscape
	 without touching the player's progress. A loss — including the watchdog's verdict on a
	 landscape going nowhere (engine/bot.ts) — goes to failDemo(), which retries the landscape and
	 blacklists it after three consecutive failures, rewinding to the win that paid for it. It never
	 steps over a landscape the bot couldn't win, so the cursor still can't advance unearned; what it
	 no longer does is stop and wait for a witness. failDemo() hands back to the menu itself when
	 there is nothing behind it to re-steer, which is the old behaviour on the demo's first
	 landscape. Its escape hatch is Delete on the menu's Demo line.
	*/
	$effect(() => {
		if (!game.demo) return;
		if (game.phase !== 'WON' && game.phase !== 'LOST') return;
		const won = game.phase === 'WON';
		const timer = setTimeout(() => (won ? advanceDemo() : failDemo()), won ? DEMO_WIN_HOLD_MS : DEMO_LOSS_HOLD_MS);
		return () => clearTimeout(timer);
	});

	// Android back-gesture / browser back-button guard (PLAN-MOBILE.md Phase M0): Phase 4
	// deliberately has no mid-level save, so an unguarded back swipe would silently discard a
	// whole landscape's progress. A history entry is pushed for the duration of a game session
	// (anything past MENU); popstate while it's in place is routed into the same pause flow ESC
	// already uses, then immediately re-pushed so the gesture doesn't actually navigate away.
	// Once back at MENU the guard drops, so the *next* back press behaves normally (harmless on
	// a single-page app — at worst it exits, matching Android's own "back from the main screen"
	// convention).
	let historyGuarded = false;
	$effect(() => {
		if (game.phase === 'MENU') {
			historyGuarded = false;
		} else if (!historyGuarded) {
			history.pushState({ sentynel: true }, '');
			historyGuarded = true;
		}
	});

	function handlePopState() {
		if (!historyGuarded) return;
		// A demo has no progress worth guarding and nobody watching for the resume key, so a back
		// gesture is treated the way any other deliberate input is: it ends the demo. Pausing it
		// would leave the overlay up with no way out but another gesture.
		//
		// Except on touch, where the menu it would drop into cannot be operated (see the auto-start
		// above): the gesture is swallowed and the demo plays on. The keyboard exit in MainView still
		// works, on the devices that have a keyboard to use it with.
		if (game.demo) {
			if (!isTouchCapable()) exitDemo();
		} else if (game.phase === 'PAUSED') giveUp();
		else if (game.phase === 'PLAYING' || game.phase === 'TRANSFER' || game.phase === 'BIRDSEYE') pauseGame();
		else if (game.phase === 'DEBUG') returnToMenu();
		history.pushState({ sentynel: true }, '');
	}
</script>

<svelte:head><title>The SenTynel</title></svelte:head>

<svelte:window onpopstate={handlePopState} />

<main>
	<MainView />
	<Hud />
	{#if game.phase === 'PLAYING' || game.phase === 'BIRDSEYE'}
		<HelpLine />
	{:else if game.phase === 'MENU'}
		<MainMenu />
	{:else if game.phase === 'PAUSED'}
		<PauseOverlay />
	{:else if game.phase === 'WON'}
		<WinScreen />
	{:else if game.phase === 'LOST'}
		<LoseScreen />
	{/if}
	<!-- Self-gating on phase and scan state, like Hud — always mounted so it can appear the instant
	     a watcher's attention lands on the player, without waiting on a phase-keyed remount. -->
	<ScanVignette />
	<PortraitOverlay />
</main>

<style>
</style>
