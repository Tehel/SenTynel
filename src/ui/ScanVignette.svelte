<script lang="ts">
	/*
	 THE SCAN WARNING (RULES-FIDELITY.md C6, PLAN-RULES.md R4) — the cue that says "you are seen".

	 The original gives two independent cues and we only ever had one: a ping on each energy point
	 *taken*, which is MainView's red drain flash, and a fuzzy screen while you are *watched*, which
	 was missing entirely. The missing one is the one worth having: it is the cue you can still act
	 on, where the flash only tells you that you were too slow.

	 Two states, exactly the two the drain phase already distinguishes (engine/watcher.ts splits
	 pool-drain from Meanie conversion on precisely this test):

	  - partial (amber, steady): a watcher can see your body but not your square. It cannot take
	    anything; it will make a Meanie instead. Informational, so it stays dim and does not ramp.
	  - full (amber -> red, ramping): a watcher's attention is on you and it can see your square. The
	    lock-on stall is running, and the ramp IS the countdown — it reaches full saturation exactly
	    as the drain begins. That is the whole point: it turns "you are seen" into "you have about
	    this long", which is the information the original's filling indicator carried.

	 Deliberately not the same red as MainView's #drainFlash, which is a hard 200 ms spike with a much
	 tighter inset. This is a slow wash; that is a hit. Sitting them at different intensities and
	 speeds is what keeps "act now" and "you already paid" from reading as one event.

	 Driven by its own rAF rather than the 4 Hz tick, because the ramp has to be smooth between the
	 1 Hz drain phases that update the state behind it.
	*/
	import { game } from '../game/state.svelte';
	import { WATCHER_GRACE_MS } from '../game/timing';

	// Only while the player is actually in the world. PAUSED deliberately excluded: the clock is
	// stopped, so a warning that cannot change is just decoration over the pause overlay.
	const visible = $derived(game.phase === 'PLAYING' || game.phase === 'TRANSFER');

	// Peak spread/opacity of a fully-committed lock. Tuned to sit clearly under #drainFlash's 80px
	// spike so the two never read as the same event.
	const MAX_SPREAD_PX = 140;
	const MAX_ALPHA = 0.5;
	// A watcher can only see you but not your square: no drain possible, so a low steady amber.
	const PARTIAL_SPREAD_PX = 70;
	const PARTIAL_ALPHA = 0.22;
	// Amber -> red across the stall. Hue in degrees; 38 is a warm amber, 0 is red.
	const HUE_FROM = 38;
	const HUE_TO = 0;

	let shadow = $state('none');

	$effect(() => {
		if (!visible || game.scanState === 'none') {
			shadow = 'none';
			return;
		}

		const paint = () => {
			if (game.scanState === 'partial') {
				shadow = `inset 0 0 ${PARTIAL_SPREAD_PX}px ${PARTIAL_SPREAD_PX / 5}px hsla(${HUE_FROM}, 90%, 45%, ${PARTIAL_ALPHA})`;
				return;
			}
			/*
			 Progress of the soonest drain. game.scanElapsedMs is how far that watcher had counted at
			 the last 1 Hz tick and game.scanUpdatedAt is when we recorded it, so adding the wall-clock
			 since then ramps smoothly between ticks without assuming the drain phase's clock and
			 performance.now() share an origin.
			*/
			const elapsed = game.scanElapsedMs + (performance.now() - game.scanUpdatedAt);
			const t = Math.max(0, Math.min(1, elapsed / WATCHER_GRACE_MS));
			// More watchers on you is a worse emergency than one, and now literally costs more per
			// second. Deepen rather than widen, so the count reads without the frame closing in.
			const crowd = Math.min(1, (game.scanWatchers - 1) * 0.25);
			const spread = PARTIAL_SPREAD_PX + (MAX_SPREAD_PX - PARTIAL_SPREAD_PX) * t;
			const alpha = (PARTIAL_ALPHA + (MAX_ALPHA - PARTIAL_ALPHA) * t) * (1 + crowd * 0.6);
			const hue = HUE_FROM + (HUE_TO - HUE_FROM) * t;
			shadow = `inset 0 0 ${spread}px ${spread / 5}px hsla(${hue}, 95%, 45%, ${Math.min(0.8, alpha)})`;
		};

		let raf = requestAnimationFrame(function tick() {
			paint();
			raf = requestAnimationFrame(tick);
		});
		return () => cancelAnimationFrame(raf);
	});
</script>

{#if visible && game.scanState !== 'none'}
	<div id="scanVignette" style="box-shadow: {shadow}"></div>
{/if}

<style>
	#scanVignette {
		position: fixed;
		inset: 0;
		pointer-events: none;
		/* Under MainView's #drainFlash, so a point actually being taken still spikes clearly on top. */
		z-index: 1;
	}
</style>
