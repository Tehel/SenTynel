<script lang="ts">
	import { game } from '../game/state.svelte';
	import { ACTION_COOLDOWN_MS } from '../game/timing';
	import icons from './icons';

	const LOW_ENERGY_THRESHOLD = 3;
	const PULSE_PERIOD_MS = 1000;
	const PULSE_MIN = 0.3;
	const PULSE_MAX = 1;
	const COOLDOWN_BAR_WIDTH = 80;

	const visible = $derived(
		game.phase === 'PLAYING' || game.phase === 'TRANSFER' || game.phase === 'PAUSED'
	);
	// New actions are only ever dispatched during PLAYING (see engine/loop.ts), but a
	// successful transfer immediately switches phase to TRANSFER — the cooldown it just
	// started must stay visible through that ~1s camera move, or the bar would vanish and
	// reappear already-empty. Excludes PAUSED: that's an out-of-band interruption, not part
	// of a normal action's lifecycle.
	const cooldownVisible = $derived(game.phase === 'PLAYING' || game.phase === 'TRANSFER');

	const energySplit = $derived.by(() => {
		const s: string[] = [];
		let value = game.energy;
		while (value >= 15) {
			s.push('golden');
			value -= 15;
		}
		while (value >= 3) {
			s.push('synthoid');
			value -= 3;
		}
		if (value === 2) s.push('boulder');
		if (value === 1) s.push('tree');
		return s;
	});

	// Low-energy warning: sine pulse between PULSE_MIN and PULSE_MAX at ~1 Hz. Never fully
	// invisible, just a breathing dim so the HUD stays readable while it warns.
	let pulseOpacity = $state(1);
	$effect(() => {
		if (!visible || game.energy > LOW_ENERGY_THRESHOLD) {
			pulseOpacity = 1;
			return;
		}
		let raf: number;
		const tick = (time: number) => {
			const t = (time % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
			pulseOpacity = PULSE_MIN + ((PULSE_MAX - PULSE_MIN) * (1 + Math.sin(t * 2 * Math.PI))) / 2;
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	// Action-cadence readout: a bar that starts full the instant an action actually succeeds
	// and shrinks to nothing over ACTION_COOLDOWN_MS, so the player can see at a glance when
	// the next create/absorb/transfer/hyperspace will land — same lastActionAt clock
	// game/state.svelte.ts's canPerformAction/markActionPerformed gate on, just read here.
	let cooldownWidth = $state(0);
	$effect(() => {
		if (!cooldownVisible) {
			cooldownWidth = 0;
			return;
		}
		let raf: number;
		const tick = (time: number) => {
			const remaining = 1 - (time - game.lastActionAt) / ACTION_COOLDOWN_MS;
			cooldownWidth = Math.max(0, remaining) * COOLDOWN_BAR_WIDTH;
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});
</script>

{#if visible}
	<main>
		<div id="energy" style="opacity: {pulseOpacity}">
			{#each energySplit as icon}
				<img alt={icon} src={'data:image/png;base64,' + icons[icon as keyof typeof icons]} />
			{/each}
		</div>
	</main>
{/if}
{#if cooldownVisible}
	<div id="cooldown" style="width: {cooldownWidth}px"></div>
{/if}

<style>
	#energy {
		position: fixed;
		top: 5px;
		left: 30%;
	}
	#energy img {
		padding: 10px;
	}
	#cooldown {
		position: fixed;
		top: 15px;
		left: 66.6%;
		height: 12px;
		background: white;
	}
</style>
