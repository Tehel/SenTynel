<script lang="ts">
	import { game } from '../game/state.svelte';
	import icons from './icons';

	const LOW_ENERGY_THRESHOLD = 3;
	const PULSE_PERIOD_MS = 1000;
	const PULSE_MIN = 0.3;
	const PULSE_MAX = 1;

	const visible = $derived(
		game.phase === 'PLAYING' || game.phase === 'TRANSFER' || game.phase === 'PAUSED'
	);

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

<style>
	#energy {
		position: fixed;
		top: 5px;
		left: 30%;
	}
	#energy img {
		padding: 10px;
	}
</style>
