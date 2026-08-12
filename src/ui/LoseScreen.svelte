<script lang="ts">
	import { game, completeLost, currentLevelId, exitDemo } from '../game/state.svelte';

	const levelId = currentLevelId();
	// The demo watchdog writes a landscape off while the bot may still have energy in hand
	// (engine/bot.ts) — captioning that "Energy Depleted" would be plainly wrong to anyone watching.
	const stalled = game.lostReason === 'stalled';

	// A demo loss returns to the menu on its own after a beat (App.svelte's supervisor); a keypress
	// is just someone getting there first.
	function handleKeydown() {
		if (game.demo) exitDemo();
		else completeLost();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div id="dim"></div>
<div id="caption">
	<div id="title">{stalled ? 'Nowhere To Go' : 'Energy Depleted'}</div>
	<div id="detail">Landscape {levelId}</div>
	<div id="hint">Press any key to continue</div>
</div>

<style>
	#dim {
		position: fixed;
		inset: 0;
		background: rgba(30, 0, 0, 0.7);
		pointer-events: none;
	}
	#caption {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		font-family: 'Courier New', Courier, monospace;
		color: #ff6c6c;
		text-align: center;
		pointer-events: none;
	}
	#title {
		font-size: 48px;
		letter-spacing: 4px;
	}
	#detail {
		margin-top: 16px;
		font-size: 18px;
		color: white;
	}
	#hint {
		margin-top: 24px;
		font-size: 16px;
		opacity: 0.8;
		color: white;
	}
</style>
