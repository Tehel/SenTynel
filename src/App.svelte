<script lang="ts">
	import Hud from './ui/Hud.svelte';
	import MainView from './ui/MainView.svelte';
	import Menu from './ui/Menu.svelte';
	import { load } from './state.svelte';
	import { game } from './game/state.svelte';

	load();
</script>

<svelte:head><title>The SenTynel</title></svelte:head>

<main>
	<MainView />
	<Hud />
	{#if game.phase === 'MENU' || game.phase === 'PAUSED' || game.phase === 'WON' || game.phase === 'LOST'}
		<Menu />
	{/if}
</main>

<style>
</style>
