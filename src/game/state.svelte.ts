export type GamePhase = 'MENU' | 'PLAYING' | 'PAUSED' | 'WON' | 'LOST' | 'HYPERSPACING';

export const game = $state({
	phase: 'MENU' as GamePhase,
	energy: 10,
});

export function startGame(): void {
	game.phase = 'PLAYING';
	game.energy = 10;
}

export function pauseGame(): void {
	if (game.phase === 'PLAYING') game.phase = 'PAUSED';
}

export function resumeGame(): void {
	if (game.phase === 'PAUSED') game.phase = 'PLAYING';
}

export function returnToMenu(): void {
	game.phase = 'MENU';
}

export function endGame(outcome: 'WON' | 'LOST'): void {
	game.phase = outcome;
}
