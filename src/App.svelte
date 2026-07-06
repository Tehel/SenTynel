<script lang="ts">
	import Hud from './ui/Hud.svelte';
	import MainView from './ui/MainView.svelte';
	import MainMenu from './ui/MainMenu.svelte';
	import PauseOverlay from './ui/PauseOverlay.svelte';
	import WinScreen from './ui/WinScreen.svelte';
	import LoseScreen from './ui/LoseScreen.svelte';
	import HelpLine from './ui/HelpLine.svelte';
	import { load } from './settings.svelte';
	import { game } from './game/state.svelte';
	import { loadStats } from './game/stats.svelte';

	load();
	loadStats();

	// TRANSFER's return to PLAYING is driven by the camera's transfer glide finishing
	// (engine/loop.ts calls completeTransfer() once CameraController.updateTransfer signals
	// completion), the same pattern as BIRDSEYE's completeBirdsEyeExit(). WON/LOST are
	// keypress-only — WinScreen/LoseScreen call completeWon()/completeLost() directly.
</script>

<svelte:head><title>The SenTynel</title></svelte:head>

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
</main>

<style>
</style>
