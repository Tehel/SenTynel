<script lang="ts">
	import { settings } from '../settings.svelte';
	import { activeStats } from '../game/stats.svelte';
	import { demoProgress } from '../game/demo.svelte';
	import { game, completeWon, currentLevelId, exitDemo } from '../game/state.svelte';

	// spendEnergy(3) for the hyperspace already ran before triggerWon(), so game.energy here
	// IS the jump amount completeWon() is about to apply — read it now, before that happens.
	const jump = game.energy;
	// currentLevelId() is still the landscape just won — the advance hasn't run yet. In demo mode
	// that's the bot's own cursor, and the counts below are its own record (activeStats), so the
	// screen reports the run being watched rather than the player's history.
	const levelId = currentLevelId();
	const unlockedCount = (game.demo ? demoProgress.levelIds : settings.levelIds).length;
	const stats = activeStats();
	const isFinalLevel = levelId === 9999;
	const rawNextLevelId = levelId + jump;
	const nextLevelId = Math.min(rawNextLevelId, 9999);
	const capped = !isFinalLevel && rawNextLevelId > 9999;

	// A demo win advances on its own after a beat (App.svelte's supervisor), so a keypress here is
	// someone asking for the demo to stop — not for the level to be banked into their own progress.
	function handleKeydown() {
		if (game.demo) exitDemo();
		else completeWon();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div id="dim"></div>
<div id="caption">
	{#if isFinalLevel}
		<div id="title">Game Completed</div>
		<div id="detail">You have conquered all 10,000 landscapes!</div>
		<div id="stats">
			<div>Landscapes unlocked: {unlockedCount}</div>
			<div>Sentinels absorbed: {stats.absorbed.sentinel}</div>
			<div>Sentries absorbed: {stats.absorbed.sentry}</div>
			<div>Trees absorbed: {stats.absorbed.tree}</div>
			<div>Meanies absorbed: {stats.absorbed.meanie}</div>
			<div>Transfers made: {stats.transfers}</div>
			<div>Hyperspace jumps: {stats.hyperspaceCount}</div>
			<div>Deaths: {stats.deaths}</div>
			<div>Times completed: {stats.gameCompletions}</div>
		</div>
	{:else}
		<div id="title">Landscape Complete</div>
		{#if capped}
			<div id="detail">Jumping ahead {jump} landscapes — capped at the final landscape: 9999!</div>
			<div id="encourage">The end is in sight — one more push!</div>
		{:else}
			<div id="detail">Jumping ahead {jump} landscape{jump === 1 ? '' : 's'} — next: {nextLevelId}</div>
		{/if}
	{/if}
	<div id="hint">Press any key to continue</div>
</div>

<style>
	#dim {
		position: fixed;
		inset: 0;
		background: rgba(0, 20, 10, 0.7);
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
		color: #6cffb0;
		text-align: center;
		pointer-events: none;
	}
	#title {
		font-size: 48px;
		letter-spacing: 4px;
	}
	#detail {
		margin-top: 16px;
		font-size: 18px;
		color: white;
	}
	#encourage {
		margin-top: 8px;
		font-size: 16px;
		color: #6cffb0;
	}
	#stats {
		margin-top: 16px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 16px;
		color: white;
	}
	#hint {
		margin-top: 24px;
		font-size: 16px;
		opacity: 0.8;
		color: white;
	}
</style>
