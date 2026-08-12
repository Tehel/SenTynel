import { settings, save } from '../settings.svelte';
import { logEvent } from './log';
import { ACTION_COOLDOWN_MS } from './timing';
import { recordDeath, recordVictory, resetStats, setStatsTarget } from './stats.svelte';
import { demoProgress, resetDemoProgress, saveDemoProgress } from './demo.svelte';
import { seedGameRandom } from './random';

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
	// Demo (attract) mode: the bot in engine/bot.ts is driving instead of a human. The phase
	// machine is otherwise untouched — the bot plays through PLAYING/TRANSFER under the ordinary
	// rules. What this flag changes is who is allowed to drive: MainView skips the pointer-lock
	// request (grabbing the watcher's cursor would be rude, and Escape would then pause the
	// demo), and engine/loop.ts accepts the bot in place of a held lock.
	demo: false,
	// Why the run ended, for LoseScreen's caption. 'stalled' is the demo watchdog
	// (engine/bot.ts) declaring a landscape a write-off — the bot may still have energy in hand,
	// so captioning that "Energy Depleted" would be a visible lie in an attract mode someone is
	// watching.
	lostReason: 'energy' as 'energy' | 'stalled',
});

/*
 The landscape being played: the demo bot's own cursor while it is driving, the player's otherwise.

 Attract mode plays landscape after landscape unattended, so it keeps its progress apart from the
 player's (game/demo.svelte.ts) — otherwise every win it scored would unlock a landscape nobody
 played. Everything downstream of "which landscape is this" goes through here: the scene build
 (MainView's Effect 2), the per-landscape gameplay seed below, and the end screens.

 The menu deliberately does NOT use this — it steps through the player's own unlocked list.
*/
export function currentLevelId(): number {
	return game.demo ? demoProgress.levelId : settings.levelId;
}

/*
 Reset everything that varies within a landscape and enter PLAYING.

 Split out of startGame() so game.demo can be decided *before* this runs: the gameplay seed and
 the scene build both read currentLevelId(), which needs to know who is driving. Not exported —
 every entry point goes through startGame() or startDemo(), each of which pins the flag first.
*/
function beginLevel(): void {
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
	game.lostReason = 'energy';
	// Everything that varies within a landscape — hyperspace landings, where conservation trees
	// appear — comes from here, so a run is reproducible from this point on. See game/random.ts.
	seedGameRandom(currentLevelId(), game.levelEpoch);
	logEvent('state', 'beginLevel', {
		energy: game.energy,
		levelId: currentLevelId(),
		epoch: game.levelEpoch,
		demo: game.demo,
	});
}

export function startGame(): void {
	// Cleared here rather than only in returnToMenu() so a hand-played Start can never inherit
	// demo mode from a previous run, whatever path got us back to the menu.
	game.demo = false;
	setStatsTarget('player');
	beginLevel();
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
	game.demo = false;
	setStatsTarget('player');
}

/*
 Demo mode entry: the bot plays its *own* landscape, resuming from where its last run reached
 (game/demo.svelte.ts), not the one selected in the menu — hence the flag and the stats target
 being pinned before beginLevel(), which seeds from currentLevelId().

 The bot picks up from the next frame, once MainView's Effect 3a has seeded the starting body and
 the camera.
*/
export function startDemo(): void {
	game.demo = true;
	setStatsTarget('demo');
	beginLevel();
	logEvent('state', 'startDemo', { level: currentLevelId() });
}

/*
 The demo's own win-and-continue: advance the bot's cursor by the energy it finished on and begin
 the next landscape without passing through MENU.

 The jump is the leftover energy, exactly as for a player (completeWon below) — the bot steers it
 by spending the surplus down before the final hyperspace, see planEndgame in game/bot.ts.
*/
export function advanceDemo(): void {
	if (game.phase !== 'WON' || !game.demo) return;
	const from = demoProgress.levelId;
	const jump = game.energy;
	// Landscape 9999 is the last one; there is nowhere further to go, so the demo starts over.
	demoProgress.levelId = from === 9999 ? 0 : Math.min(from + jump, 9999);
	if (!demoProgress.levelIds.includes(demoProgress.levelId)) {
		demoProgress.levelIds.push(demoProgress.levelId);
		demoProgress.levelIds.sort((a, b) => a - b);
	}
	saveDemoProgress();
	logEvent('state', 'advanceDemo', { from, jump, to: demoProgress.levelId });
	startDemo();
}

// Any key or click while the bot is playing drops back to the menu, as does the supervisor in
// App.svelte after a demo loss. Deliberately not pauseGame(): a paused demo has nothing to resume
// it, since the bot isn't watching for input.
//
// levelEpoch is bumped for the same reason completeLost()/giveUp() bump it — the landscape the
// menu orbits behind should be a clean one, not whatever the bot left standing on it. Needed
// explicitly because currentLevelId() reverting to the player's landscape only forces a rebuild
// when the two cursors differ.
export function exitDemo(): void {
	if (!game.demo) return;
	logEvent('state', 'exitDemo', { from: game.phase });
	game.levelEpoch++;
	returnToMenu();
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
// `reason` is 'energy' for the ordinary bankruptcy; the demo watchdog (engine/bot.ts) passes
// 'stalled' when it writes a landscape off, which only changes LoseScreen's caption.
export function triggerLost(reason: 'energy' | 'stalled' = 'energy'): void {
	if (game.phase === 'LOST') return;
	logEvent('state', 'triggerLost', { energy: game.energy, reason });
	game.lostReason = reason;
	recordDeath();
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
	logEvent('state', 'triggerWon', { remainingEnergy: game.energy, fromLevel: currentLevelId() });
	// recordVictory bumps gameCompletions on a 9999 win, once per run, on whichever stats record
	// is playing — so a demo reaching the end compounds the bot's watcher speedup, not the
	// player's.
	recordVictory(currentLevelId() === 9999);
	game.phase = 'WON';
}

// The player's win-and-return-to-menu. A demo win never comes through here — it goes to
// advanceDemo() instead, which moves the bot's own cursor and starts the next landscape without
// touching settings or persisting anything of the player's.
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

// "Reset demo progress" (Settings menu): the same for the bot's own record. Its escape hatch — a
// landscape the bot can't win is re-attempted every time the demo starts, since a failure
// deliberately leaves its cursor where it is, so there has to be a way to send it back to 0.
// Only reachable from MENU, where the stats target is the player's, hence the switch and restore.
export function resetDemoRun(): void {
	resetDemoProgress();
	setStatsTarget('demo');
	resetStats();
	setStatsTarget('player');
	logEvent('state', 'demoProgressReset');
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
