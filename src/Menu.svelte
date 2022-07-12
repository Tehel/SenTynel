<script lang="ts">
	import type { Writable } from 'svelte/store';

	import {
		levelId,
		levelIds,
		soundVolume,
		rotationInterval,
		mouseSpeed,
		showGrid,
		showSurfaces,
		showAxis,
		showPosition,
		showFPS,
		mapSize,
		smooths,
		despikes,
		debug,
		save,
	} from './stores';

	interface MenuEntry {
		name: string;
		text: string | (() => void);
		condition?: () => boolean;
		select?: () => void;
		left?: () => void;
		right?: () => void;
		children?: MenuEntry[];
	}

	let path = ['start'];
	// force redraw of the menu
	let update = () => (path = path);

	// helpers for menu actions
	let toggle = (wr: Writable<boolean>) => {
		wr.update(n => !n);
		update();
		save();
	};
	let decr = (wr: Writable<number>, min: number, step: number = 1) => {
		wr.update(n => Math.max(min, n - step));
		update();
		save();
	};
	let incr = (wr: Writable<number>, max: number, step: number = 1) => {
		wr.update(n => Math.min(max, n + step));
		update();
		save();
	};

	// generic "Back" menu entry
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
				name: 'start',
				text: 'Start',
				select: () => {
					console.log('start game');
				},
			},
			{
				name: 'levelId',
				text: () => `Level: ${$levelId}`,
				left: () => {
					const idx = $levelIds.indexOf($levelId);
					if (idx === 0) return;
					levelId.set($levelIds[idx - 1]);
					save();
				},
				right: () => {
					const idx = $levelIds.indexOf($levelId);
					if (idx >= $levelIds.length - 1) return;
					levelId.set($levelIds[idx + 1]);
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
								text: () => `Rotation interval: ${$rotationInterval}s`,
								left: () => decr(rotationInterval, 8, 2),
								right: () => incr(rotationInterval, 16, 2),
							},
							{
								name: 'mouseSpeed',
								text: () => `Mouse speed: ${$mouseSpeed}`,
								left: () => decr(mouseSpeed, 1),
								right: () => incr(mouseSpeed, 10),
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
								text: () => `Sound volume: ${$soundVolume}`,
								left: () => decr(soundVolume, 0),
								right: () => incr(soundVolume, 10),
							},
						],
					},
					{
						name: 'display',
						text: 'Display',
						condition: () => debug,
						children: [
							menuEntryBack,
							{
								name: 'grid',
								text: () => 'Show grid: ' + ($showGrid ? 'yes' : 'no'),
								select: () => toggle(showGrid),
								left: () => toggle(showGrid),
								right: () => toggle(showGrid),
							},
							{
								name: 'surfaces',
								text: () => 'Show surfaces: ' + ($showSurfaces ? 'yes' : 'no'),
								select: () => toggle(showSurfaces),
								left: () => toggle(showSurfaces),
								right: () => toggle(showSurfaces),
							},
							{
								name: 'axis',
								text: () => 'Show axis: ' + ($showAxis ? 'yes' : 'no'),
								select: () => toggle(showAxis),
								left: () => toggle(showAxis),
								right: () => toggle(showAxis),
							},
							{
								name: 'position',
								text: () => 'Show position: ' + ($showPosition ? 'yes' : 'no'),
								select: () => toggle(showPosition),
								left: () => toggle(showPosition),
								right: () => toggle(showPosition),
							},
							{
								name: 'fps',
								text: () => 'Show FPS: ' + ($showFPS ? 'yes' : 'no'),
								select: () => toggle(showFPS),
								left: () => toggle(showFPS),
								right: () => toggle(showFPS),
							},
						],
					},
					{
						name: 'generator',
						text: 'Level generator',
						condition: () => debug,
						children: [
							menuEntryBack,
							{
								name: 'mapsize',
								text: () => `Map size: ${$mapSize}`,
								left: () => decr(mapSize, 5),
								right: () => incr(mapSize, 64),
							},
							{
								name: 'smooths',
								text: () => `Smoothing passes: ${$smooths}`,
								left: () => decr(smooths, 0),
								right: () => incr(smooths, 5),
							},
							{
								name: 'volume',
								text: () => `Despike passes: ${$despikes}`,
								left: () => decr(despikes, 0),
								right: () => incr(despikes, 5),
							},
						],
					},
				],
			},
		],
	};

	let currentMenu: MenuEntry[];
	$: currentMenu = path.slice(0, -1).reduce((a, v) => a.find(e => e.name === v).children, menuTree.children);

	function handleKeydown(event: KeyboardEvent) {
		// console.log(event.code);
		const currentEntry = path.reduce((a, v) => a.children.find(e => e.name === v), menuTree);
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
				if (currentEntry.left) currentEntry.left();
				update();
				break;
			case 'ArrowRight':
				if (currentEntry.right) currentEntry.right();
				update();
				break;
			case 'Enter':
			case 'Space':
				if (currentEntry.select) currentEntry.select();
				else if (currentEntry.children) path = path.concat([currentEntry.children[0].name]);
				break;
			case 'Backspace':
				if (path.length > 1) path = path.slice(0, -1);
				break;
			case 'Escape':
				break;
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />

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
