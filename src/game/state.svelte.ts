import { settings, save } from '../settings.svelte';
import { logEvent } from './log';
import { ACTION_COOLDOWN_MS } from './timing';
import { stats, saveStats, resetStats } from './stats.svelte';

export type GamePhase = 'MENU' | 'PLAYING' | 'PAUSED' | 'DEBUG' | 'TRANSFER' | 'BIRDSEYE' | 'WON' | 'LOST';

export const game = $state({
	phase: 'MENU' as GamePhase,
	energy: 10,
	// Incremented only by startGame() — lets effects distinguish a new game from a resume.
	startCount: 0,
	// Incremented only by enterDebug() — used to snap the camera on each DEBUG entry.
	debugCount: 0,
	// Incremented by beginTransfer() — triggers the camera transfer glide in MainView.
	transferCount: 0,
	// Set true after the Sentinel is absorbed; further absorption is locked for the level.
	sentinelAbsorbed: false,
	// True once the player has taken their first successful action (create / absorb /
	// transfer / hyperspace). Watchers stay dormant — no rotation, no drain — until then.
	firstActionTaken: false,
	// Active body position — null only in the brief window between startGame()/enterDebug()
	// and MainView's Effect 3a resolving it to the level's starting synthoid via
	// setStartingSynthoid(); every consumer past that point can treat it as always set while
	// PLAYING/TRANSFER/DEBUG-with-a-body is reachable. Updated thereafter by beginTransfer().
	activeSynthoidCol: null as number | null,
	activeSynthoidRow: null as number | null,
	// The body the player just transferred away from. Captured by beginTransfer before
	// activeSynthoidCol/Row are overwritten, so MainView can rotate it to face the new body
	// and fade it back in as the transfer glide plays.
	previousSynthoidCol: null as number | null,
	previousSynthoidRow: null as number | null,
	// Incremented when the landscape should be rebuilt without changing levelId (LOST flow).
	// MainView's scene-build effect reads this as a reactive dep.
	levelEpoch: 0,
	// performance.now() timestamp of the last watcher pool-drain hit. Drives the brief
	// red-border canvas flash. Zero means "never drained".
	drainPulseAt: 0,
	// rAF timestamp of the last accepted player action. Gates the 1 Hz action cadence —
	// see canPerformAction().
	lastActionAt: 0,
	// Which phase to restore on resumeGame(). Set by pauseGame() from whatever phase it was
	// called from; BIRDSEYE maps to PLAYING (its camera state is already reset to ground by
	// the time pauseGame() runs — see MainView's onLockLost). TRANSFER is the only phase that
	// resumes to itself, so an interrupted body-transfer glide (frozen while PAUSED, since
	// engine/camera.ts's updateTransfer isn't called without pointer lock) picks back up
	// exactly where it left off instead of being abandoned mid-flight.
	pausedFrom: 'PLAYING' as 'PLAYING' | 'TRANSFER',
});

export function startGame(): void {
	game.phase = 'PLAYING';
	game.energy = 10;
	game.startCount++;
	game.transferCount = 0;
	game.sentinelAbsorbed = false;
	game.firstActionTaken = false;
	game.activeSynthoidCol = null;
	game.activeSynthoidRow = null;
	game.previousSynthoidCol = null;
	game.previousSynthoidRow = null;
	game.lastActionAt = 0;
	logEvent('state', 'startGame', { energy: game.energy });
}

// Gates the player action cadence to match the watchers' 1 Hz tempo. Pure — does not
// consume the cooldown itself. Pair with markActionPerformed() once the rule actually takes
// effect, so a failed attempt (no target, blocked placement, insufficient energy) doesn't
// cost the slot — only real actions should be rate-limited.
export function canPerformAction(time: number): boolean {
	return time - game.lastActionAt >= ACTION_COOLDOWN_MS;
}

// Starts the 1 Hz action cooldown. Call only once an action has actually taken effect.
export function markActionPerformed(time: number): void {
	game.lastActionAt = time;
}

// Watcher dormancy ends on the first successful player action. Idempotent —
// the rules layer calls it after every action's success path; the first call wins.
export function markFirstAction(): void {
	if (game.firstActionTaken) return;
	game.firstActionTaken = true;
	logEvent('state', 'firstActionTaken');
}

export function pauseGame(): void {
	if (game.phase === 'PLAYING' || game.phase === 'TRANSFER' || game.phase === 'BIRDSEYE') {
		game.pausedFrom = game.phase === 'TRANSFER' ? 'TRANSFER' : 'PLAYING';
		game.phase = 'PAUSED';
		logEvent('state', 'pauseGame');
	}
}

export function resumeGame(): void {
	if (game.phase === 'PAUSED') {
		game.phase = game.pausedFrom;
		logEvent('state', 'resumeGame');
	}
}

export function enterDebug(): void {
	if (game.phase === 'MENU') {
		game.phase = 'DEBUG';
		game.debugCount++;
		logEvent('state', 'enterDebug');
	}
}

export function returnToMenu(): void {
	logEvent('state', 'returnToMenu', { from: game.phase });
	game.phase = 'MENU';
}

export function endGame(outcome: 'WON' | 'LOST'): void {
	logEvent('state', 'endGame', { outcome });
	game.phase = outcome;
}

// Seeds activeSynthoidCol/Row with the level's starting synthoid position. Called once from
// MainView's Effect 3a right after the scene is built for a fresh game or DEBUG entry — the
// state layer itself has no access to level data, so it can't resolve this on its own (see
// startGame()'s null reset above). Every other consumer (engine/actions.ts, engine/meanie.ts,
// engine/watcher.ts) reads activeSynthoidCol/Row directly with no fallback of its own.
export function setStartingSynthoid(col: number, row: number): void {
	game.activeSynthoidCol = col;
	game.activeSynthoidRow = row;
	logEvent('state', 'setStartingSynthoid', { col, row });
}

// Begin a transfer to the synthoid at (col, row). Records the body we're leaving so the
// view layer can show it as a shell and fade it back in as the camera glides away from it.
// Use `completeTransfer()` to end the TRANSFER phase — called by engine/loop.ts once
// CameraController's transfer glide (engine/camera.ts's updateTransfer) finishes, the same
// pattern as completeBirdsEyeExit().
export function beginTransfer(col: number, row: number): void {
	game.previousSynthoidCol = game.activeSynthoidCol;
	game.previousSynthoidRow = game.activeSynthoidRow;
	game.activeSynthoidCol = col;
	game.activeSynthoidRow = row;
	game.transferCount++;
	game.phase = 'TRANSFER';
	logEvent('state', 'beginTransfer', { col, row });
}

export function completeTransfer(): void {
	if (game.phase !== 'TRANSFER') return;
	game.phase = 'PLAYING';
	logEvent('state', 'transferComplete');
}

// Triggered by a steep left-click on empty sky (see engine/actions.ts's isBirdsEyeTrigger).
// The camera-side flight up/down is entirely CameraController's concern (see
// engine/camera.ts's enterBirdsEye/exitBirdsEye) — this just gates the phase, which pauses
// the game clock (BIRDSEYE is absent from GameLoop's ticking phase list) and blocks actions
// for the whole round trip, including the ~1s fly-back-down, until completeBirdsEyeExit().
export function enterBirdsEye(): void {
	if (game.phase !== 'PLAYING') return;
	game.phase = 'BIRDSEYE';
	logEvent('state', 'enterBirdsEye');
}

// Called by engine/loop.ts once CameraController reports the fly-back-down transition has
// finished (not on the return click itself — the click only starts the reverse flight).
export function completeBirdsEyeExit(): void {
	if (game.phase !== 'BIRDSEYE') return;
	game.phase = 'PLAYING';
	logEvent('state', 'birdsEyeExitComplete');
}

export function markSentinelAbsorbed(): void {
	game.sentinelAbsorbed = true;
	logEvent('state', 'sentinelAbsorbed');
}

export function spendEnergy(n: number): boolean {
	if (game.energy < n) {
		logEvent('energy', 'spendRefused', { requested: n, have: game.energy });
		return false;
	}
	const from = game.energy;
	game.energy -= n;
	logEvent('energy', 'spend', { n, from, to: game.energy });
	// Death threshold: strictly negative. A player at exactly 0 stays alive and can still
	// recover by absorbing something nearby.
	if (game.energy < 0) triggerLost();
	return true;
}

// Enter LOST. `LoseScreen` calls `completeLost()` on keypress to rebuild and return to MENU.
export function triggerLost(): void {
	if (game.phase === 'LOST') return;
	logEvent('state', 'triggerLost', { energy: game.energy });
	stats.deaths++;
	saveStats();
	game.phase = 'LOST';
}

export function completeLost(): void {
	if (game.phase !== 'LOST') return;
	game.levelEpoch++;
	game.phase = 'MENU';
	logEvent('state', 'lostResetComplete');
}

// Voluntary quit from PAUSED (second Escape). Same rebuild-and-return-to-menu tail as
// completeLost(), but skips the LOST phase/hold — quitting isn't dying.
export function giveUp(): void {
	if (game.phase !== 'PAUSED') return;
	logEvent('state', 'giveUp', { fromLevel: settings.levelId });
	game.levelEpoch++;
	game.phase = 'MENU';
}

// Hyperspacing from the Pedestal is the only way to win a level, but once the Sentinel is
// absorbed, absorb is locked for the rest of the level (see markSentinelAbsorbed) — so a
// player who reaches the Pedestal with less than the normal 3-energy hyperspace cost has no
// way left to earn more and would otherwise be permanently stuck (transfer is free but wins
// nothing). Called when that spend is refused (0–2 energy) or when it succeeds but leaves
// nothing over (exactly 3 energy, which would otherwise jump 0 landscapes — worse-off
// arrivals must not out-jump this one). Floors energy to 1 so completeWon()'s jump (it reads
// game.energy as the landscape count to advance) is never zero, guaranteeing forward progress
// instead of a stall.
export function floorEnergyForPedestalHyperspace(): void {
	const from = game.energy;
	game.energy = 1;
	logEvent('energy', 'pedestalHyperspaceFloor', { from, to: game.energy });
}

// Enter WON. `WinScreen` calls `completeWon()` on keypress to advance the level and return
// to MENU. The remaining energy at trigger-time is captured then; advancing later is fine
// because no other path mutates `energy` between WON and MENU.
export function triggerWon(): void {
	if (game.phase === 'WON') return;
	logEvent('state', 'triggerWon', { remainingEnergy: game.energy, fromLevel: settings.levelId });
	stats.victories++;
	// Landscape 9999 is the last one — completing it is "the game", but replaying it
	// (there's nowhere further to jump to) only counts once per run.
	if (settings.levelId === 9999 && !stats.completedGameThisRun) {
		stats.gameCompletions++;
		stats.completedGameThisRun = true;
	}
	saveStats();
	game.phase = 'WON';
}

export function completeWon(): void {
	if (game.phase !== 'WON') return;
	const jump = game.energy;
	// The final landscape has nowhere to jump to — leave levelId/levelIds untouched.
	if (settings.levelId !== 9999) {
		settings.levelId = Math.min(settings.levelId + jump, 9999);
		if (!settings.levelIds.includes(settings.levelId)) {
			settings.levelIds.push(settings.levelId);
			settings.levelIds.sort((a, b) => a - b)
		}
		save();
	}
	game.phase = 'MENU';
	logEvent('state', 'wonResetComplete', { newLevel: settings.levelId });
}

// "Reset progress" (Settings menu): relocks every landscape and clears stats, as if
// starting the game for the first time — except gameCompletions, which persists across
// resets by design (it's what the per-completion rotation speedup in
// world/objects/watcher.ts scales on).
export function resetProgress(): void {
	settings.levelId = 0;
	settings.levelIds = [0];
	save();
	resetStats();
	logEvent('state', 'progressReset');
}

export function gainEnergy(n: number, cause = 'unknown'): void {
	if (n < 0) {
		logEvent('energy', 'gainNegativeRefused', { n, cause });
		return;
	}
	const from = game.energy;
	game.energy += n;
	logEvent('energy', 'gain', { n, cause, from, to: game.energy });
}

// Passive energy loss (watcher pool drain). Unlike spendEnergy, drains always apply —
// they push the player below 0 and into LOST rather than refusing the deduction.
export function drainEnergy(n: number, cause: string): void {
	if (n <= 0) return;
	const from = game.energy;
	game.energy -= n;
	logEvent('energy', 'drain', { n, cause, from, to: game.energy });
	if (game.energy < 0) triggerLost();
}
