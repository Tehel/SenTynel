<script lang="ts">
	import Hud from './ui/Hud.svelte';
	import MainView from './ui/MainView.svelte';
	import MainMenu from './ui/MainMenu.svelte';
	import PauseOverlay from './ui/PauseOverlay.svelte';
	import WinScreen from './ui/WinScreen.svelte';
	import LoseScreen from './ui/LoseScreen.svelte';
	import HelpLine from './ui/HelpLine.svelte';
	import { load } from './settings.svelte';
	import { game, completeTransfer } from './game/state.svelte';
	import { TRANSFER_DELAY_MS } from './game/timing';

	load();

	// TRANSFER is still timed (a camera move, not a "press any key" screen). WON/LOST are
	// keypress-only — WinScreen/LoseScreen call completeWon()/completeLost() directly.
	$effect(() => {
		if (game.phase === 'TRANSFER') {
			const t = window.setTimeout(completeTransfer, TRANSFER_DELAY_MS);
			return () => clearTimeout(t);
		}
	});
</script>

<svelte:head><title>The SenTynel</title></svelte:head>

<main>
	<MainView />
	<Hud />
	{#if game.phase === 'PLAYING'}
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
