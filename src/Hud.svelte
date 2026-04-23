<script lang="ts">
	import { lpad } from './sentland';
	import { settings, game } from './state.svelte';
	import icons from './icons';

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
</script>

<main>
	<div id="energy">
		{#each energySplit as icon}
			<img alt={icon} src={'data:image/png;base64,' + icons[icon]} />
		{/each}
	</div>
	<div id="levelId">{lpad('' + (settings.levelId ?? 0), '0', 4)}</div>
</main>

<style>
	#energy {
		position: fixed;
		top: 5px;
		left: 30%;
	}
	#energy img {
		padding: 10px;
	}
	#levelId {
		position: fixed;
		top: 10px;
		right: 2%;
	}
</style>
