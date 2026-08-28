<script lang="ts">
	import { game, giveUp, resumeGame, resetDemoAndRestart } from '../game/state.svelte';
	import { demoProgress } from '../game/demo.svelte';
	import { isTouchCapable } from '../engine/platform';
	import { Scrubber, SCRUB_PX_PER_ENTRY } from '../engine/touchGestures';
	import { save, settings } from '../settings.svelte';

	interface Props {
		/*
		 Touch demo pause only: the landscape the picker currently names, and the way it reports a new
		 one. The value lives in App.svelte, not here, because the tap that resumes has to read it and
		 this component only exists during PAUSED. Absent for an ordinary keyboard pause, which has
		 no picker.
		*/
		pendingLevelId?: number | null;
		onPick?: (levelId: number) => void;
	}

	let { pendingLevelId = null, onPick }: Props = $props();

	/*
	 A paused DEMO on a touch device is the only pause with controls of its own — see PLAN-MOBILE.md.
	 Everything else is the keyboard flow below, unchanged. Derived rather than passed in so a caller
	 cannot get the two variants out of step with who is actually driving.
	*/
	const demoTouch = $derived(game.demo && isTouchCapable());

	/*
	 The classic/enhanced switch, for a device that has neither the menu nor the End key.

	 A BUTTON rather than a double tap, and for the same reason a long-press was rejected for the
	 reset (see PLAN-MOBILE.md): a hidden gesture is a gesture nobody finds. There is also a
	 concrete cost here — a single tap already means pause/resume, so recognising a double tap
	 would mean holding the first one back to see whether a second arrives, putting a delay on the
	 most-used interaction on the device to serve the least-used one. The pause screen is already
	 where every other touch control lives.

	 One flag, so this and the End key cannot disagree about what a press does.
	*/
	const enhanced = $derived(settings.visualStyle === 'enhanced');

	function toggleGraphics() {
		settings.visualStyle = enhanced ? 'classic' : 'enhanced';
		save();
	}

	/*
	 THE LANDSCAPE PICKER — press the number and drag, with momentum.

	 It replaced a swipe-to-step stepper, which was the wrong instrument: a demo's unlocked list runs
	 to hundreds of entries and stepping it cost a gesture each. Physics is engine/touchGestures.ts's
	 Scrubber (pure and unit-tested); this owns the pointer plumbing, the rAF loop that drives the
	 glide, and the strip.

	 The list is read ONCE, on mount. It cannot change while the overlay is up — every path that
	 touches demoProgress.levelIds starts a landscape, which unmounts this — and pinning it keeps the
	 scrubber's index from meaning a different entry between frames.
	*/
	const ids = demoProgress.levelIds;
	// Read once, on purpose: the picker owns its position from here on, and re-deriving it from the
	// prop would have App.svelte's value — which this component is what updates — fight the drag.
	// svelte-ignore state_referenced_locally
	const startIndex = Math.max(0, ids.indexOf(pendingLevelId ?? demoProgress.levelId));

	// Plain let: the scrubber is mutated 60 times a second and nothing renders from it directly —
	// `offset` below is the reactive mirror, written once per frame.
	let scrubber = new Scrubber(ids.length, startIndex);
	let offset = $state(startIndex);
	let dragging = $state(false);
	let raf: number | null = null;
	let lastFrame = 0;

	const selectedIndex = $derived(Math.min(ids.length - 1, Math.max(0, Math.round(offset))));

	/*
	 Which entries to draw. A window either side of the selection rather than the whole list: the list
	 can be hundreds long, and only what fits on screen can be read. The fractional part of `offset`
	 is what slides them, so the strip moves continuously under the finger even though the numbers
	 themselves are placed at whole-entry spacing.
	*/
	const WINDOW = 6;
	const visible = $derived.by(() => {
		const from = Math.max(0, selectedIndex - WINDOW);
		const to = Math.min(ids.length - 1, selectedIndex + WINDOW);
		const out: Array<{ i: number; id: number }> = [];
		for (let i = from; i <= to; i++) out.push({ i, id: ids[i] });
		return out;
	});

	// Only report a *changed* entry: the drag writes offset every frame, and App.svelte's pending
	// value is a choice, not an animation.
	let reported = ids[startIndex];
	function publish() {
		const id = ids[scrubber.index];
		if (id === reported) return;
		reported = id;
		onPick?.(id);
	}

	function animate() {
		if (raf !== null) return;
		lastFrame = performance.now();
		const step = (now: number) => {
			const dt = now - lastFrame;
			lastFrame = now;
			scrubber.tick(dt);
			offset = scrubber.offset;
			publish();
			raf = scrubber.settled ? null : requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
	}

	// Pointer events rather than touch events: they cover mouse and stylus with the same code (useful
	// for testing this in a desktop browser at all), and pointer capture keeps the drag alive when the
	// finger leaves the strip — which it will, since the strip is only as tall as one line of text.
	function onScrubDown(event: PointerEvent) {
		event.preventDefault();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		dragging = true;
		scrubber.begin(event.clientX, event.timeStamp);
		offset = scrubber.offset;
	}

	function onScrubMove(event: PointerEvent) {
		if (!dragging) return;
		scrubber.drag(event.clientX, event.timeStamp);
		offset = scrubber.offset;
		publish();
	}

	function onScrubUp(event: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		scrubber.release(event.timeStamp);
		// Even a still finger leaves the strip off-entry, so there is always a snap to run.
		animate();
	}

	$effect(() => () => {
		if (raf !== null) cancelAnimationFrame(raf);
	});

	// Confirm-before-acting, the same two-step the menu's Delete uses. Local state, so it is
	// discarded if the overlay goes away — resuming past a half-confirmed reset cancels it, which
	// is the forgiving direction for the one control here that destroys something.
	let resetConfirming = $state(false);

	// Bare modifier presses (Alt, Control, Shift, Meta/Cmd/Win) are ignored — they're almost
	// always the leading half of an OS shortcut (Alt+Tab, Cmd+Tab, Win+Tab...) rather than a
	// deliberate "resume" input. Without this, alt-tabbing away from PAUSE fired a keydown for
	// 'Alt' before the OS actually switched focus, silently resuming (and re-requesting pointer
	// lock) an instant before the window lost focus — leaving the game stuck in PLAYING with no
	// lock and no UI to recover from.
	const IGNORED_KEYS = new Set(['Alt', 'Control', 'Shift', 'Meta', 'AltGraph', 'OS']);

	// First Escape already got us here (via MainView's pointer-lock-loss handling). From here:
	// a second Escape confirms giving up; any other (non-modifier) key resumes.
	//
	// A paused demo is left entirely alone: MainView's own demo keydown ends it and returns to the
	// menu, which is what a key press should do to an attract mode. Resuming here as well made both
	// fire on one event and worked only by listener order — now that a demo can genuinely be PAUSED,
	// that ordering is not something to rely on.
	function handleKeydown(event: KeyboardEvent) {
		if (game.demo) return;
		if (IGNORED_KEYS.has(event.key)) return;
		// End toggles the terrain style rather than resuming — a frozen scene is a good place to
		// compare the two looks, and resuming out of it would be the opposite of what was asked.
		if (event.key === 'End') return;
		if (event.key === 'Escape') giveUp();
		else resumeGame();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div id="dim"></div>
<div id="caption">
	<!-- A stranded demo is not a pause somebody asked for, so it does not claim to be one. Naming it
	     is the difference between "I stopped this" and "this stopped" — and the controls below mean
	     something different in each case, which the hint has to say. -->
	<div id="title">{game.demoHalted ? 'Nowhere Left To Go' : 'Paused'}</div>
	{#if game.demoHalted}
		<div class="hint">
			The bot lost this landscape and has no earlier win left to re-steer, so it has stopped
			rather than replay a landing it never earned.
		</div>
	{/if}
	{#if demoTouch}
		<!-- data-touch-control marks everything App.svelte's gesture handler must keep its hands
		     off: without it, the touch that drags the strip or presses a button is ALSO read as a
		     screen tap, and the demo resumes out from under it. -->
		<!-- A slider is what this is, and the value attributes are worth having. No keyboard
		     interaction to go with the role, deliberately: this variant only renders on a touch
		     device, where any key press ends the demo outright (MainView's demo keydown). -->
		<div
			id="picker"
			class:dragging
			data-touch-control="true"
			role="slider"
			tabindex="-1"
			aria-label="Landscape"
			aria-valuemin={ids[0]}
			aria-valuemax={ids[ids.length - 1]}
			aria-valuenow={ids[selectedIndex]}
			onpointerdown={onScrubDown}
			onpointermove={onScrubMove}
			onpointerup={onScrubUp}
			onpointercancel={onScrubUp}
		>
			{#each visible as entry (entry.id)}
				<span
					class="entry"
					class:selected={entry.i === selectedIndex}
					style="transform: translateX(calc(-50% + {(entry.i - offset) * SCRUB_PX_PER_ENTRY}px))"
				>
					{entry.id}
				</span>
			{/each}
			<div class="marker"></div>
		</div>
		<div class="hint">
			Drag the landscapes · tap anywhere to {game.demoHalted ? 'play the one chosen' : 'resume'}
		</div>
		{#if resetConfirming}
			<div class="controls">
				<button data-touch-control="true" onclick={() => resetDemoAndRestart()}>Confirm reset</button>
				<button data-touch-control="true" onclick={() => (resetConfirming = false)}>Cancel</button>
			</div>
			<div class="hint">Sends the bot back to landscape 0 and clears its own record. Yours is untouched.</div>
		{:else}
			<div class="controls">
				<button data-touch-control="true" onclick={toggleGraphics}>
					Graphics: {enhanced ? 'Enhanced' : 'Classic'}
				</button>
				<button data-touch-control="true" onclick={() => (resetConfirming = true)}>Reset demo progress</button>
			</div>
		{/if}
	{:else}
		<div class="hint">Press ESC again to return to main title, or any other key to resume</div>
	{/if}
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
	.hint {
		margin-top: 16px;
		font-size: 16px;
		opacity: 0.8;
		max-width: 30em;
		padding: 0 1em;
	}
	/*
	 The picker. Deliberately much taller than the text it holds: it is the one thing on this screen
	 you have to hit with a moving thumb, so its grab area is a band across the screen rather than the
	 glyphs themselves.
	*/
	#picker {
		position: relative;
		margin-top: 20px;
		width: 100%;
		height: 76px;
		pointer-events: auto;
		/* Or the browser claims a horizontal drag as a scroll and cancels the pointer mid-gesture. */
		touch-action: none;
		/* Entries fade out towards the edges instead of stopping dead, so the list reads as
		   continuing past the screen — which it does. */
		mask-image: linear-gradient(to right, transparent, black 22%, black 78%, transparent);
		-webkit-mask-image: linear-gradient(to right, transparent, black 22%, black 78%, transparent);
	}
	#picker .entry {
		position: absolute;
		left: 50%;
		top: 26px;
		font-size: 20px;
		opacity: 0.4;
		/* The numbers must not wrap or re-centre as they slide; the transform does all placement. */
		white-space: nowrap;
	}
	#picker .entry.selected {
		font-size: 26px;
		top: 22px;
		opacity: 1;
	}
	/* The fixed point the strip slides under — without it there is nothing to say which entry is
	   chosen while everything is moving. */
	#picker .marker {
		position: absolute;
		left: 50%;
		bottom: 8px;
		width: 34px;
		height: 2px;
		margin-left: -17px;
		background: white;
		opacity: 0.55;
	}
	#picker.dragging .marker {
		opacity: 1;
	}
	.controls {
		margin-top: 20px;
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		justify-content: center;
	}
	/* The only interactive elements in the app so far, hence the local reset — #caption is
	   pointer-events: none so the canvas keeps receiving everything else. */
	.controls button {
		pointer-events: auto;
		font-family: inherit;
		font-size: 16px;
		color: white;
		background: rgba(255, 255, 255, 0.12);
		border: 1px solid rgba(255, 255, 255, 0.5);
		border-radius: 4px;
		/* Comfortably past the ~44px minimum touch target — this is the only way out of a reset
		   mis-tap, and a cramped button on a phone is a mis-tap waiting to happen. */
		padding: 14px 22px;
	}
</style>
