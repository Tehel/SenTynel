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
	import { game, pauseGame, giveUp, returnToMenu } from './game/state.svelte';
	import { loadStats } from './game/stats.svelte';

	load();
	loadStats();

	// TRANSFER's return to PLAYING is driven by the camera's transfer glide finishing
	// (engine/loop.ts calls completeTransfer() once CameraController.updateTransfer signals
	// completion), the same pattern as BIRDSEYE's completeBirdsEyeExit(). WON/LOST are
	// keypress-only — WinScreen/LoseScreen call completeWon()/completeLost() directly.

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
		if (game.phase === 'PAUSED') giveUp();
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
