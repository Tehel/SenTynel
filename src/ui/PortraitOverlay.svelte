<script lang="ts">
	// CSS-only, always mounted (see App.svelte) — visibility is driven purely by the
	// orientation media query, not game phase or JS. Covers the moment before Phase M0's
	// fullscreen+orientation-lock engages on Start, and any browser where the lock call
	// silently fails or isn't supported (PLAN-MOBILE.md Phase M0).
</script>

<div id="portraitOverlay">
	<div id="message">Rotate your device to landscape to play</div>
</div>

<style>
	#portraitOverlay {
		display: none;
		position: fixed;
		inset: 0;
		z-index: 1000;
		background-color: #041d51;
		color: white;
		font-family: 'Courier New', Courier, monospace;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 24px;
		box-sizing: border-box;
	}
	@media (orientation: portrait) {
		#portraitOverlay {
			display: flex;
		}
	}
	#message {
		font-size: 20px;
	}
</style>
