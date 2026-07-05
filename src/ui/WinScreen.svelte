<script lang="ts">
	import { settings } from '../settings.svelte';
	import { game, completeWon } from '../game/state.svelte';

	// spendEnergy(3) for the hyperspace already ran before triggerWon(), so game.energy here
	// IS the jump amount completeWon() is about to apply — read it now, before that happens.
	const jump = game.energy;
	const nextLevelId = settings.levelId + jump;

	function handleKeydown() {
		completeWon();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div id="dim"></div>
<div id="caption">
	<div id="title">Landscape Complete</div>
	<div id="detail">Jumping ahead {jump} landscape{jump === 1 ? '' : 's'} — next: {nextLevelId}</div>
	<div id="hint">Press any key to continue</div>
</div>

<style>
	#dim {
		position: fixed;
		inset: 0;
		background: rgba(0, 20, 10, 0.7);
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
		color: #6cffb0;
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
