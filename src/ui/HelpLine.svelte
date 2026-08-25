<script lang="ts">
	import { game } from '../game/state.svelte';
	import { isTouchCapable } from '../engine/platform';

	// On touch there is no way out of the demo (see MainView's onMouseDown), so the line that names
	// one would be an instruction that does nothing when followed. What touch has instead is the
	// pause — the gesture is invisible, so this is the only thing that advertises it.
	const touch = isTouchCapable();
</script>

<main>
	{#if game.demo}
		<div>DEMO — the bot is playing</div>
		{#if touch}
			<div>Tap to pause</div>
		{:else}
			<div>Press any key or click to return to the menu</div>
		{/if}
	{:else if game.phase === 'BIRDSEYE'}
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
