<script lang="ts">
	import { game } from '../game/state.svelte';
</script>

<main>
	{#if game.phase === 'BIRDSEYE'}
		<div>Click to return</div>
	{:else}
		<div>R Synth · B Bldr · T Tree · U absorb · H hyperspace · Esc pause</div>
		<div>Space transfer · look up + click sky: bird's eye</div>
	{/if}
</main>

<style>
	main {
		position: fixed;
		bottom: 10px;
		left: 0;
		right: 0;
		text-align: center;
		font-family: 'Courier New', Courier, monospace;
		font-size: 13px;
		color: rgba(255, 255, 255, 0.7);
		text-shadow: 0 0 4px rgba(0, 0, 0, 0.8);
		pointer-events: none;
	}
</style>
