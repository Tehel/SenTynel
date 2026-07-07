<script lang="ts">
	import { settings, debug, save } from '../settings.svelte';
	import { startGame, enterDebug, resetProgress } from '../game/state.svelte';
	import { enterFullscreenLandscape } from '../engine/platform';
	import {
		findLevelByCode,
		getLevelCode,
		startBackgroundCodeIndexing,
		stopBackgroundIndexing,
	} from '../game/levelCodes';

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

	// Fill the level-code cache while idling at the menu; paused on unmount (i.e. as soon as
	// the player starts a level) so it never competes with the render/game loop during play.
	$effect(() => {
		startBackgroundCodeIndexing();
		return () => stopBackgroundIndexing();
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

	const animationStyles = ['fade', 'squash', 'dissolve'] as const;
	const cycleAnimationStyle = (dir: 1 | -1 = 1) => {
		const i = animationStyles.indexOf(settings.animationStyle);
		const next = (i + dir + animationStyles.length) % animationStyles.length;
		settings.animationStyle = animationStyles[next];
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
				name: 'start',
				text: 'Start',
				select: () => {
					enterFullscreenLandscape();
					startGame();
				},
			},
			{
				name: 'levelId',
				text: () => `Level: ${settings.levelId}, code: ${getLevelCode(settings.levelId)}`,
				left: () => {
					const idx = settings.levelIds.indexOf(settings.levelId);
					if (idx <= 0) return;
					settings.levelId = settings.levelIds[idx - 1];
					save();
				},
				right: () => {
					const idx = settings.levelIds.indexOf(settings.levelId);
					if (idx < 0 || idx >= settings.levelIds.length - 1) return;
					settings.levelId = settings.levelIds[idx + 1];
					save();
				},
			},
			{
				name: 'levelCode',
				text: 'Input level code',
				select: () => {
					codeInput = '';
					codeStatus = 'idle';
				},
			},
			{
				name: 'settings',
				text: 'Settings',
				children: [
					menuEntryBack,
					{
						name: 'debug',
						text: 'Free roam',
						condition: () => debug(),
						select: () => enterDebug(),
					},
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
							{
								name: 'animationStyle',
								text: () => `Animation: ${settings.animationStyle}`,
								select: () => cycleAnimationStyle(),
								left: () => cycleAnimationStyle(-1),
								right: () => cycleAnimationStyle(),
							},
							{
								name: 'particleEffects',
								text: () => 'Particle effects: ' + (settings.particleEffects ? 'yes' : 'no'),
								select: () => toggle('particleEffects'),
								left: () => toggle('particleEffects'),
								right: () => toggle('particleEffects'),
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
							{
								name: 'watcherCones',
								text: () => 'Show watcher cones: ' + (settings.showWatcherCones ? 'yes' : 'no'),
								select: () => toggle('showWatcherCones'),
								left: () => toggle('showWatcherCones'),
								right: () => toggle('showWatcherCones'),
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
					{
						name: 'resetProgress',
						text: 'Reset progress',
						select: () => (confirmingReset = true),
					},
				],
			},
		],
	};

	const currentMenu = $derived(
		path.slice(0, -1).reduce((a, v) => a.find(e => e.name === v)!.children!, menuTree.children!)
	);
	// condition() filters BOTH rendering and keyboard nav/dispatch — a hidden entry can no
	// longer be focused or triggered by cycling past it.
	const visibleMenu = $derived(currentMenu.filter(e => !e.condition || e.condition()));
	// Falls back to the first visible sibling if the raw focus (path's last segment) points
	// at an entry that's no longer visible (e.g. a debug-gated entry after debug() flips off).
	const focusedName = $derived(
		visibleMenu.some(e => e.name === path[path.length - 1]) ? path[path.length - 1] : visibleMenu[0]?.name
	);
	const currentEntry = $derived(visibleMenu.find(e => e.name === focusedName) ?? null);

	// Input level code — a small local mode that takes over rendering + keydown while active.
	// null = not in code-entry mode.
	let codeInput = $state<string | null>(null);
	let codeStatus = $state<'idle' | 'searching' | 'not-found'>('idle');
	let codeAbort: AbortController | null = null;

	// "Reset progress" confirmation — another small local mode, same shape as codeInput.
	let confirmingReset = $state(false);

	async function submitCode() {
		if (!codeInput) return;
		codeStatus = 'searching';
		codeAbort = new AbortController();
		const found = await findLevelByCode(codeInput, codeAbort.signal);
		if (found !== null) {
			settings.levelId = found;
			if (!settings.levelIds.includes(found)) {
				settings.levelIds.push(found);
				settings.levelIds.sort((a, b) => a - b);
			}
			save();
			codeInput = null;
			codeStatus = 'idle';
		} else {
			codeStatus = 'not-found';
		}
	}

	function handleCodeInputKey(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			codeAbort?.abort();
			codeInput = null;
			codeStatus = 'idle';
			return;
		}
		if (codeStatus === 'searching') return; // Escape is the only live key mid-search
		if (event.key === 'Backspace') {
			codeInput = (codeInput ?? '').slice(0, -1);
			codeStatus = 'idle';
		} else if (event.key === 'Enter') {
			submitCode();
		} else if (/^[0-9a-fA-F]$/.test(event.key) && (codeInput?.length ?? 0) < 8) {
			codeInput = (codeInput ?? '') + event.key.toLowerCase();
			codeStatus = 'idle';
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (confirmingReset) {
			if (event.key === 'Enter') {
				resetProgress();
				confirmingReset = false;
			} else if (event.key === 'Escape') {
				confirmingReset = false;
			}
			return;
		}
		if (codeInput !== null) {
			handleCodeInputKey(event);
			return;
		}
		if (visibleMenu.length === 0) return;
		let pos = Math.max(0, visibleMenu.findIndex(e => e.name === focusedName));
		switch (event.code) {
			case 'ArrowUp':
				pos = (pos + visibleMenu.length - 1) % visibleMenu.length;
				path = [...path.slice(0, -1), visibleMenu[pos].name];
				break;
			case 'ArrowDown':
				pos = (pos + 1) % visibleMenu.length;
				path = [...path.slice(0, -1), visibleMenu[pos].name];
				break;
			case 'ArrowLeft':
				currentEntry?.left?.();
				break;
			case 'ArrowRight':
				currentEntry?.right?.();
				break;
			case 'Enter':
			case 'Space':
				if (currentEntry?.select) {
					currentEntry.select();
				} else if (currentEntry?.children) {
					const firstVisible = currentEntry.children.find(c => !c.condition || c.condition());
					if (firstVisible) path = [...path, firstVisible.name];
				}
				break;
			case 'Backspace':
				if (path.length > 1) path = path.slice(0, -1);
				break;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<main>
	{#if confirmingReset}
		<div class="focus">
			Reset all progress? Relocks every landscape and clears stats — completions are kept.
			Enter to confirm, Escape to cancel.
		</div>
	{:else if codeInput !== null}
		<div class="focus">
			{#if codeStatus === 'searching'}
				Looking for your level...
			{:else if codeStatus === 'not-found'}
				Not found, try again: {codeInput}_
			{:else}
				Enter code: {codeInput}_
			{/if}
		</div>
	{:else}
		{#each visibleMenu as menuEntry}
			<div class:focus={menuEntry.name === focusedName}>
				{typeof menuEntry.text === 'string' ? menuEntry.text : menuEntry.text()}
			</div>
		{/each}
	{/if}
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
