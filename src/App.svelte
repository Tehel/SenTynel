<script lang="ts">
	import MainView from './MainView.svelte';

	let levelId: number = 0;
</script>

<svelte:head><title>The senTynel viewer</title></svelte:head>

<main>
	<div id="levelSelect">Level: <input type="number" bind:value={levelId} min="0" max="9999" /></div>
	<MainView {levelId} />
</main>

<style>
	#levelSelect {
		padding: 8px;
	}
</style>
