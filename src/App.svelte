<script lang="ts">
	import Hud from './ui/Hud.svelte';
	import MainView from './ui/MainView.svelte';
	import MainMenu from './ui/MainMenu.svelte';
	import PauseOverlay from './ui/PauseOverlay.svelte';
	import WinScreen from './ui/WinScreen.svelte';
	import LoseScreen from './ui/LoseScreen.svelte';
	import HelpLine from './ui/HelpLine.svelte';
	import { load } from './settings.svelte';
	import { game, completeTransfer, completeWon, completeLost } from './game/state.svelte';
	import { TRANSFER_DELAY_MS, WIN_LOSS_DELAY_MS } from './game/timing';

	load();

	// Phase scheduler: triggerWon/triggerLost/beginTransfer just set the phase; the timed
	// transition back to PLAYING/MENU happens here so the rules layer stays free of
	// setTimeout. Effect cleanup cancels any in-flight timer when the phase changes early
	// (e.g. PAUSED interrupting a TRANSFER, or LOST being re-entered).
	$effect(() => {
		const phase = game.phase;
		if (phase === 'TRANSFER') {
			const t = window.setTimeout(completeTransfer, TRANSFER_DELAY_MS);
			return () => clearTimeout(t);
		}
		if (phase === 'WON') {
			const t = window.setTimeout(completeWon, WIN_LOSS_DELAY_MS);
			return () => clearTimeout(t);
		}
		if (phase === 'LOST') {
			const t = window.setTimeout(completeLost, WIN_LOSS_DELAY_MS);
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
