<script lang="ts">
	import Hud from './ui/Hud.svelte';
	import MainView from './ui/MainView.svelte';
	import MainMenu from './ui/MainMenu.svelte';
	import PauseOverlay from './ui/PauseOverlay.svelte';
	import WinScreen from './ui/WinScreen.svelte';
	import LoseScreen from './ui/LoseScreen.svelte';
	import HelpLine from './ui/HelpLine.svelte';
	import PortraitOverlay from './ui/PortraitOverlay.svelte';
	import { load } from './settings.svelte';
	import { game, pauseGame, giveUp, returnToMenu, advanceDemo, exitDemo } from './game/state.svelte';
	import { loadStats } from './game/stats.svelte';
	import { loadDemoProgress } from './game/demo.svelte';
	import { DEMO_LOSS_HOLD_MS, DEMO_WIN_HOLD_MS } from './game/timing';

	load();
	loadStats();
	loadDemoProgress();

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
	 landscape going nowhere (engine/bot.ts) — returns to the menu instead of skipping ahead:
	 stepping over a landscape the bot can't win would be cheating, so the demo stops and the
	 cursor stays put, which is also how the bot's weakest landscape makes itself known. Its
	 escape hatch is Settings → Reset demo progress.
	*/
	$effect(() => {
		if (!game.demo) return;
		if (game.phase !== 'WON' && game.phase !== 'LOST') return;
		const won = game.phase === 'WON';
		const timer = setTimeout(() => (won ? advanceDemo() : exitDemo()), won ? DEMO_WIN_HOLD_MS : DEMO_LOSS_HOLD_MS);
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
		if (game.demo) exitDemo();
		else if (game.phase === 'PAUSED') giveUp();
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
	<PortraitOverlay />
</main>

<style>
</style>
