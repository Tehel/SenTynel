<script lang="ts">
	import Hud from './ui/Hud.svelte';
	import MainView from './ui/MainView.svelte';
	import Menu from './ui/Menu.svelte';
	import { load } from './state.svelte';

	load();
</script>

<svelte:head><title>The senTynel viewer</title></svelte:head>

<main>
	<Hud />
	<MainView />
	<Menu />
</main>

<style>
</style>
