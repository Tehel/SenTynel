<script lang="ts">
	import { settings, debug, save } from '../settings.svelte';
	import { startGame, startDemo, enterDebug, resetProgress, resetDemoRun } from '../game/state.svelte';
	import { demoProgress, setDemoLevel } from '../game/demo.svelte';
	import { PLANNER_IDS } from '../game/botPlanners';
	import { enterFullscreenLandscape } from '../engine/platform';
	import { ensureIndexReady, findLevelByCode, getLevelCode } from '../game/levelCodes';

	interface MenuEntry {
		name: string;
		text: string | (() => string);
		condition?: () => boolean;
		select?: () => void;
		left?: () => void;
		right?: () => void;
		// Delete/Suppr on this entry. Reserved for destructive actions — the two progress resets,
		// which used to sit at the bottom of Settings where nobody would find them by accident and
		// nobody would find them on purpose either. Every `del` goes through the same confirmation
		// step, so a mis-hit costs one Escape.
		del?: () => void;
		// One dim line under the menu while this entry is focused. `del` is otherwise invisible —
		// a key nothing on screen mentions is a key that does not exist.
		hint?: string;
		children?: MenuEntry[];
	}

	let path = $state(['play']);

	// Kick off the level-code index (Worker-built, cached in localStorage) as soon as the menu is
	// reachable, so it's likely already resolved by the time a player opens "Input level code".
	// Idempotent and fire-and-forget: it runs off the main thread, so there's nothing to pause on
	// unmount the way the old main-thread trickle needed.
	ensureIndexReady();

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

	// Which strategy plays the demo. Debug-gated: a comparison tool while v2 is being proved out,
	// not something a player should have to have an opinion about.
	const cycleBotPlanner = (dir: 1 | -1 = 1) => {
		const i = PLANNER_IDS.indexOf(settings.botPlanner);
		settings.botPlanner = PLANNER_IDS[(i + dir + PLANNER_IDS.length) % PLANNER_IDS.length];
		save();
	};

	/*
	 Walk an unlocked-landscape list by one, in either direction, and hand the result to whoever
	 owns that cursor. Shared by the Play and Demo lines: the two lists are separate by design
	 (game/demo.svelte.ts) but stepping through them is the same motion, and a stop at each end
	 rather than a wrap — a list of unlocked landscapes has a first and a last, and jumping from
	 landscape 0 to the far end of a journey is not what "left" means.
	*/
	const stepLevel = (ids: number[], current: number, dir: 1 | -1, apply: (id: number) => void) => {
		const idx = ids.indexOf(current);
		const next = idx + dir;
		if (idx < 0 || next < 0 || next >= ids.length) return;
		apply(ids[next]);
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
				/*
				 Play — the merge of the old Start and Level lines. They were always one decision
				 (which landscape, then go) split across two lines with the level code stranded on the
				 second, so the line you were told to write down was never the line you pressed Enter
				 on. One entry: Enter plays, left/right walks the unlocked list, Delete resets it.
				*/
				name: 'play',
				text: () => `Play: ${settings.levelId} (code: ${getLevelCode(settings.levelId)})`,
				hint: '← → select landscape · Enter starts · Del resets progress',
				select: () => {
					enterFullscreenLandscape();
					startGame();
				},
				left: () => stepLevel(settings.levelIds, settings.levelId, -1, id => {
					settings.levelId = id;
					save();
				}),
				right: () => stepLevel(settings.levelIds, settings.levelId, 1, id => {
					settings.levelId = id;
					save();
				}),
				del: () => (confirming = 'player'),
			},
			{
				/*
				 Demo — the Play line's mirror, over the bot's own record. It has always played its own
				 landscape rather than the one the menu points at (game/demo.svelte.ts), which is why
				 the number is on the line: the cursor it resumes from is the demo's, so the demo's
				 line is the only honest place to show and steer it.

				 The skipped count is the OUTPUT of an unattended run, and the reason it is on screen
				 rather than only in localStorage: a soak's whole product is the list of landscapes the
				 bot gave up on (game/state.svelte.ts's failDemo), and a number nobody can see is a
				 number nobody checks. Debug-gated, though — the reader it is for is whoever left the
				 soak running, and to anyone else it is a defect count on an attract mode.
				*/
				name: 'demo',
				text: () =>
					`Demo: ${demoProgress.levelId}` +
					(debug() ? ` (skipped: ${demoProgress.blacklist.length})` : ''),
				hint: '← → select landscape · Enter starts · Del resets demo progress',
				// No fullscreen/orientation lock here, unlike Play: the demo is something you
				// watch and walk away from, and locking a watcher's device into landscape for it
				// would be presumptuous.
				select: () => startDemo(),
				left: () => stepLevel(demoProgress.levelIds, demoProgress.levelId, -1, setDemoLevel),
				right: () => stepLevel(demoProgress.levelIds, demoProgress.levelId, 1, setDemoLevel),
				del: () => (confirming = 'demo'),
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
								name: 'botPlanner',
								text: () => 'Demo bot: ' + settings.botPlanner,
								condition: () => debug(),
								select: () => cycleBotPlanner(),
								left: () => cycleBotPlanner(),
								right: () => cycleBotPlanner(),
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
							{
								name: 'exposureMap',
								text: () => 'Show exposure map: ' + (settings.showExposureMap ? 'yes' : 'no'),
								select: () => toggle('showExposureMap'),
								left: () => toggle('showExposureMap'),
								right: () => toggle('showExposureMap'),
							},
						],
					},
					{
						name: 'debug',
						text: 'Free roam',
						condition: () => debug(),
						select: () => enterDebug(),
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

	// Reset confirmation — another small local mode, same shape as codeInput. Which record is being
	// reset, or null for "not asking": the player's own progress, or the demo bot's.
	let confirming = $state<'player' | 'demo' | null>(null);

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
		if (confirming !== null) {
			if (event.key === 'Enter') {
				if (confirming === 'demo') resetDemoRun();
				else resetProgress();
				confirming = null;
			} else if (event.key === 'Escape') {
				confirming = null;
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
			case 'Delete':
				currentEntry?.del?.();
				break;
			case 'Backspace':
				if (path.length > 1) path = path.slice(0, -1);
				break;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<main>
	{#if confirming === 'player'}
		<div class="focus">
			Reset all progress? Relocks every landscape and clears stats — completions are kept.
			Enter to confirm, Escape to cancel.
		</div>
	{:else if confirming === 'demo'}
		<div class="focus">
			Reset the demo's progress? Sends the bot back to landscape 0 and clears its own stats —
			yours are untouched. Enter to confirm, Escape to cancel.
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
		{#if currentEntry?.hint}
			<div class="hint">{currentEntry.hint}</div>
		{/if}
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

	/* Dimmer and smaller than the entries themselves: it describes the focused line rather than
	   offering another one, so it must not read as something you can arrow onto. */
	div.hint {
		margin-top: 12px;
		font-size: 14px;
		color: rgba(255, 255, 255, 0.45);
	}
</style>
