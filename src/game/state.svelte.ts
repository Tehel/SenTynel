import { settings, save } from '../state.svelte';
import { logEvent } from './log';

export type GamePhase = 'MENU' | 'PLAYING' | 'PAUSED' | 'DEBUG' | 'TRANSFER' | 'WON' | 'LOST';

export const game = $state({
	phase: 'MENU' as GamePhase,
	energy: 10,
	// Incremented only by startGame() — lets effects distinguish a new game from a resume.
	startCount: 0,
	// Incremented only by enterDebug() — used to snap the camera on each DEBUG entry.
	debugCount: 0,
	// Incremented by beginTransfer() — triggers camera snap effect in MainView.
	transferCount: 0,
	// Set true after the Sentinel is absorbed; further absorption is locked for the level.
	sentinelAbsorbed: false,
	// Active body position — null until first transfer (starting synthoid inferred from level data).
	activeSynthoidCol: null as number | null,
	activeSynthoidRow: null as number | null,
	// The body the player just transferred away from. Captured by beginTransfer before
	// activeSynthoidCol/Row are overwritten, so MainView can rotate it / look back at it.
	previousSynthoidCol: null as number | null,
	previousSynthoidRow: null as number | null,
	// Incremented when the landscape should be rebuilt without changing levelId (LOST flow).
	// MainView's scene-build effect reads this as a reactive dep.
	levelEpoch: 0,
});

export function startGame(): void {
	game.phase = 'PLAYING';
	game.energy = 10;
	game.startCount++;
	game.transferCount = 0;
	game.sentinelAbsorbed = false;
	game.activeSynthoidCol = null;
	game.activeSynthoidRow = null;
	game.previousSynthoidCol = null;
	game.previousSynthoidRow = null;
	logEvent('state', 'startGame', { energy: game.energy });
}

export function pauseGame(): void {
	if (game.phase === 'PLAYING' || game.phase === 'TRANSFER') {
		game.phase = 'PAUSED';
		logEvent('state', 'pauseGame');
	}
}

export function resumeGame(): void {
	if (game.phase === 'PAUSED') {
		game.phase = 'PLAYING';
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

export function beginTransfer(col: number, row: number): void {
	game.previousSynthoidCol = game.activeSynthoidCol;
	game.previousSynthoidRow = game.activeSynthoidRow;
	game.activeSynthoidCol = col;
	game.activeSynthoidRow = row;
	game.transferCount++;
	game.phase = 'TRANSFER';
	// Pending proper camera animation (Phase 5): switch back to PLAYING after 1 s.
	setTimeout(() => {
		if (game.phase === 'TRANSFER') game.phase = 'PLAYING';
	}, 1000);
	logEvent('state', 'beginTransfer', { col, row });
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

const RESET_DELAY_MS = 2000;

// Drives the LOST → MENU flow: hold the LOST view for ~2 s, then reset the landscape
// (same levelId) and return to the menu. levelEpoch++ tells MainView to rebuild.
export function triggerLost(): void {
	if (game.phase === 'LOST') return;
	logEvent('state', 'triggerLost', { energy: game.energy });
	game.phase = 'LOST';
	setTimeout(() => {
		if (game.phase !== 'LOST') return;
		game.levelEpoch++;
		game.phase = 'MENU';
		logEvent('state', 'lostResetComplete');
	}, RESET_DELAY_MS);
}

// Drives the WON → MENU flow: hold the WON view for ~2 s, then advance levelId by the
// remaining energy and return to the menu (the level-id change rebuilds the scene).
export function triggerWon(): void {
	if (game.phase === 'WON') return;
	const jump = game.energy;
	logEvent('state', 'triggerWon', { remainingEnergy: jump, fromLevel: settings.levelId });
	game.phase = 'WON';
	setTimeout(() => {
		if (game.phase !== 'WON') return;
		settings.levelId = settings.levelId + jump;
		if (!settings.levelIds.includes(settings.levelId)) settings.levelIds.push(settings.levelId);
		save();
		game.phase = 'MENU';
		logEvent('state', 'wonResetComplete', { newLevel: settings.levelId });
	}, RESET_DELAY_MS);
}

export function gainEnergy(n: number, cause = 'unknown'): void {
	const from = game.energy;
	game.energy += n;
	logEvent('energy', 'gain', { n, cause, from, to: game.energy });
}
