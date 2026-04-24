import { logEvent } from './log';

export type GamePhase = 'MENU' | 'PLAYING' | 'PAUSED' | 'DEBUG' | 'TRANSFER' | 'WON' | 'LOST';

export const game = $state({
	phase: 'MENU' as GamePhase,
	energy: 10,
	// Incremented only by startGame() — lets effects distinguish a new game from a resume.
	startCount: 0,
	// Incremented only by enterDebug() — used to snap the camera on each DEBUG entry.
	debugCount: 0,
});

export function startGame(): void {
	game.phase = 'PLAYING';
	game.energy = 10;
	game.startCount++;
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
