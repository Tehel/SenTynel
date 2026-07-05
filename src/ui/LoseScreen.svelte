<script lang="ts">
	import { settings } from '../settings.svelte';
	import { completeLost } from '../game/state.svelte';

	function handleKeydown() {
		completeLost();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div id="dim"></div>
<div id="caption">
	<div id="title">Energy Depleted</div>
	<div id="detail">Landscape {settings.levelId}</div>
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
