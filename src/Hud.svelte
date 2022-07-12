<script lang="ts">
	import { onDestroy } from 'svelte';
	import { lpad } from './sentland';
	import { energy, levelId } from './stores';
	import icons from './icons';

	let energySplit: string[] = [];

	const unsubscribe = energy.subscribe(value => {
		const s: string[] = [];
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

		energySplit = s;
	});

	onDestroy(unsubscribe);
</script>

<main>
	<div id="energy">
		{#each energySplit as icon}
			<img alt={icon} src={'data:image/png;base64,' + icons[icon]} />
		{/each}
	</div>
	<div id="levelId">{lpad('' + ($levelId ?? 0), '0', 4)}</div>
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
