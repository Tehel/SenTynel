<script lang="ts">
	import Hud from './ui/Hud.svelte';
	import MainView from './ui/MainView.svelte';
	import Menu from './ui/Menu.svelte';
	import { load } from './state.svelte';
	import { game, pauseGame, resumeGame } from './game/state.svelte';

	load();

	function onKeydown(e: KeyboardEvent) {
		if (e.code === 'Escape') {
			if (game.phase === 'PLAYING') pauseGame();
			else if (game.phase === 'PAUSED') resumeGame();
		}
	}
</script>

<svelte:head><title>The senTynel viewer</title></svelte:head>
<svelte:window onkeydown={onKeydown} />

<main>
	<Hud />
	<MainView />
	{#if game.phase !== 'PLAYING'}
		<Menu />
	{/if}
</main>

<style>
</style>
