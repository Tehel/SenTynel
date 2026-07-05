<script lang="ts">
	import { giveUp, resumeGame } from '../game/state.svelte';

	// First Escape already got us here (via MainView's pointer-lock-loss handling). From here:
	// a second Escape confirms giving up; any other key resumes.
	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') giveUp();
		else resumeGame();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div id="dim"></div>
<div id="caption">
	<div id="title">Paused</div>
	<div id="hint">Press ESC again to return to main title, or any other key to resume</div>
</div>

<style>
	#dim {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
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
		color: white;
		text-align: center;
		pointer-events: none;
	}
	#title {
		font-size: 48px;
		letter-spacing: 4px;
	}
	#hint {
		margin-top: 16px;
		font-size: 16px;
		opacity: 0.8;
	}
</style>
