<script lang="ts">
	import { settings, debug, save } from '../state.svelte';
	import { game, startGame, resumeGame, enterDebug } from '../game/state.svelte';

	interface MenuEntry {
		name: string;
		text: string | (() => string);
		condition?: () => boolean;
		select?: () => void;
		left?: () => void;
		right?: () => void;
		children?: MenuEntry[];
	}

	let path = $state(['start']);

	// Keep focus on the correct top-level entry when phase changes.
	$effect(() => {
		if (game.phase === 'PAUSED') path = ['resume'];
		else path = ['start'];
	});

	const toggle = (key: keyof typeof settings) => {
		(settings as any)[key] = !(settings as any)[key];
		save();
	};
	const decr = (key: keyof typeof settings, min: number, step = 1) => {
		(settings as any)[key] = Math.max(min, (settings as any)[key] - step);
		save();
	};
	const incr = (key: keyof typeof settings, max: number, step = 1) => {
		(settings as any)[key] = Math.min(max, (settings as any)[key] + step);
		save();
	};

	const menuEntryBack: MenuEntry = {
		name: 'back',
		text: 'Back',
		select: () => (path = path.slice(0, -1)),
	};

	const menuTree: MenuEntry = {
		name: 'main',
		text: '',
		children: [
			{
				name: 'resume',
				text: 'Resume',
				condition: () => game.phase === 'PAUSED',
				select: () => resumeGame(),
			},
			{
				name: 'start',
				text: 'Start',
				condition: () => game.phase !== 'PAUSED',
				select: () => startGame(),
			},
			{
				name: 'debug',
				text: 'Free roam',
				condition: () => game.phase !== 'PAUSED',
				select: () => enterDebug(),
			},
			{
				name: 'levelId',
				text: () => `Level: ${settings.levelId}`,
				left: () => {
					const idx = settings.levelIds.indexOf(settings.levelId);
					if (idx === 0) return;
					settings.levelId = settings.levelIds[idx - 1];
					save();
				},
				right: () => {
					const idx = settings.levelIds.indexOf(settings.levelId);
					if (idx >= settings.levelIds.length - 1) return;
					settings.levelId = settings.levelIds[idx + 1];
					save();
				},
			},
			{
				name: 'settings',
				text: 'Settings',
				children: [
					menuEntryBack,
					{
						name: 'game',
						text: 'Game',
						children: [
							menuEntryBack,
							{
								name: 'rotationInterval',
								text: () => `Rotation interval: ${settings.rotationInterval}s`,
								left: () => decr('rotationInterval', 8, 2),
								right: () => incr('rotationInterval', 16, 2),
							},
							{
								name: 'mouseSpeed',
								text: () => `Mouse speed: ${settings.mouseSpeed}`,
								left: () => decr('mouseSpeed', 1),
								right: () => incr('mouseSpeed', 10),
							},
						],
					},
					{
						name: 'sound',
						text: 'Sound',
						children: [
							menuEntryBack,
							{
								name: 'volume',
								text: () => `Sound volume: ${settings.soundVolume}`,
								left: () => decr('soundVolume', 0),
								right: () => incr('soundVolume', 10),
							},
						],
					},
					{
						name: 'display',
						text: 'Display',
						condition: () => debug(),
						children: [
							menuEntryBack,
							{
								name: 'grid',
								text: () => 'Show grid: ' + (settings.showGrid ? 'yes' : 'no'),
								select: () => toggle('showGrid'),
								left: () => toggle('showGrid'),
								right: () => toggle('showGrid'),
							},
							{
								name: 'surfaces',
								text: () => 'Show surfaces: ' + (settings.showSurfaces ? 'yes' : 'no'),
								select: () => toggle('showSurfaces'),
								left: () => toggle('showSurfaces'),
								right: () => toggle('showSurfaces'),
							},
							{
								name: 'axis',
								text: () => 'Show axis: ' + (settings.showAxis ? 'yes' : 'no'),
								select: () => toggle('showAxis'),
								left: () => toggle('showAxis'),
								right: () => toggle('showAxis'),
							},
							{
								name: 'position',
								text: () => 'Show position: ' + (settings.showPosition ? 'yes' : 'no'),
								select: () => toggle('showPosition'),
								left: () => toggle('showPosition'),
								right: () => toggle('showPosition'),
							},
							{
								name: 'fps',
								text: () => 'Show FPS: ' + (settings.showFPS ? 'yes' : 'no'),
								select: () => toggle('showFPS'),
								left: () => toggle('showFPS'),
								right: () => toggle('showFPS'),
							},
						],
					},
					{
						name: 'generator',
						text: 'Level generator',
						condition: () => debug(),
						children: [
							menuEntryBack,
							{
								name: 'mapsize',
								text: () => `Map size: ${settings.mapSize}`,
								left: () => decr('mapSize', 5),
								right: () => incr('mapSize', 64),
							},
							{
								name: 'smooths',
								text: () => `Smoothing passes: ${settings.smooths}`,
								left: () => decr('smooths', 0),
								right: () => incr('smooths', 5),
							},
							{
								name: 'despikes',
								text: () => `Despike passes: ${settings.despikes}`,
								left: () => decr('despikes', 0),
								right: () => incr('despikes', 5),
							},
						],
					},
				],
			},
		],
	};

	const currentMenu = $derived(
		path.slice(0, -1).reduce((a, v) => a.find(e => e.name === v)!.children!, menuTree.children!)
	);

	function handleKeydown(event: KeyboardEvent) {
		const currentEntry = path.reduce((a, v) => a.children!.find(e => e.name === v)!, menuTree);
		let pos = currentMenu.indexOf(currentEntry);
		switch (event.code) {
			case 'ArrowUp':
				pos = (pos + currentMenu.length - 1) % currentMenu.length;
				path = path.slice(0, -1).concat([currentMenu[pos].name]);
				break;
			case 'ArrowDown':
				pos = (pos + 1) % currentMenu.length;
				path = path.slice(0, -1).concat([currentMenu[pos].name]);
				break;
			case 'ArrowLeft':
				currentEntry.left?.();
				break;
			case 'ArrowRight':
				currentEntry.right?.();
				break;
			case 'Enter':
			case 'Space':
				if (currentEntry.select) currentEntry.select();
				else if (currentEntry.children) path = path.concat([currentEntry.children[0].name]);
				break;
			case 'Backspace':
				if (path.length > 1) path = path.slice(0, -1);
				break;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<main>
	{#each currentMenu as menuEntry}
		{#if !menuEntry.condition || menuEntry.condition()}
			<div class:focus={menuEntry.name === path.slice(-1)[0]}>
				{typeof menuEntry.text === 'string' ? menuEntry.text : menuEntry.text()}
			</div>
		{/if}
	{/each}
</main>

<style>
	main {
		font-family: 'Courier New', Courier, monospace;
		font-size: 20px;
		padding-left: 20px;
		position: fixed;
		top: 300px;
		left: 20px;
	}
	div {
		padding: 5px 24px;
	}

	div.focus {
		padding: 5px 0px;
	}

	div.focus::before {
		content: '> ';
	}
</style>
