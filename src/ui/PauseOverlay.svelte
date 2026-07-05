<script lang="ts">
	import { giveUp, resumeGame } from '../game/state.svelte';

	// Bare modifier presses (Alt, Control, Shift, Meta/Cmd/Win) are ignored — they're almost
	// always the leading half of an OS shortcut (Alt+Tab, Cmd+Tab, Win+Tab...) rather than a
	// deliberate "resume" input. Without this, alt-tabbing away from PAUSE fired a keydown for
	// 'Alt' before the OS actually switched focus, silently resuming (and re-requesting pointer
	// lock) an instant before the window lost focus — leaving the game stuck in PLAYING with no
	// lock and no UI to recover from.
	const IGNORED_KEYS = new Set(['Alt', 'Control', 'Shift', 'Meta', 'AltGraph', 'OS']);

	// First Escape already got us here (via MainView's pointer-lock-loss handling). From here:
	// a second Escape confirms giving up; any other (non-modifier) key resumes.
	function handleKeydown(event: KeyboardEvent) {
		if (IGNORED_KEYS.has(event.key)) return;
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
