<script lang="ts">
	import Hud from './Hud.svelte';
	import MainView from './MainView.svelte';
	import Menu from './Menu.svelte';
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
